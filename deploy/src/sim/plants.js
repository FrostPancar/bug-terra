// Plants: the one object category with upkeep.
//
// This is a slow, visible-to-the-eye state machine that runs beside the decor,
// not beside the bugs. It has no Matter.js body (beyond the collision footprint
// the rock decor already models) and it reads the same `behaviourAt()` day/night
// signal bug behaviour reads, so there is no second time system.
//
// THE HARD LINE: nothing in this file may import, read, or write a gene or a
// stat. A wilted plant stops SUPPLYING something; it never reaches backward into
// an animal. `tests/plants.test.js` asserts this by inspection of the module's
// imports, because it is the kind of rule that decays quietly.

import { PLANT_SPECS, specOf } from './objects.js';
import { makeRng } from '../core/rng.js';

export const PLANT_STATES = [
  'seed', 'sprout', 'growing', 'mature', 'spreading', 'declining', 'dead',
];

/** Seconds each state takes at a growth multiplier of 1. */
export const TIMINGS = {
  germinate: 40,      // favourable seconds a seed needs before it sprouts
  seedFail: 90,       // unfavourable seconds before a seed gives up
  sprout: 55,
  grow: 180,
  spreadEvery: 150,   // a mature plant tries to seed on this cadence
  declineGrace: 120,  // how long a neglected plant hangs on at one dead meter
};

/** Per-second meter decay, before any object contributions. */
export const DECAY = {
  hydration: 0.0085,
  light: 0.0070,      // only at night; daylight refills it (see decay())
  soil: 0.0040,
  crowdingPenalty: 0.0030,   // per additional plant sharing the plot's radius
  fallowRecovery: 0.0060,    // soil regained per second by an empty plot
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* ------------------------------------------------------------------ plot -- */

/**
 * The doc left per-plant vs. per-plot open. Per-plot won: it is what makes a
 * dead plant leave something behind. A plot that just killed a plant carries
 * `residue`, which suppresses soil recovery for a while — replanting straight
 * into a grave is a worse idea than moving one square over.
 */
export class Plot {
  constructor(x, y, { radius = 90 } = {}) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.hydration = 0.75;
    this.light = 0.70;
    this.soil = 0.80;
    this.residue = 0;         // 0..1, decays on its own
    this.occupant = null;
    this.crowding = 0;        // set by the bed each tick
  }

  get meters() { return this; }

  water(amount = 0.35) {
    this.hydration = clamp01(this.hydration + amount);
    return this.hydration;
  }

  /** Which meters are exhausted right now. Drives the decline rules. */
  get exhausted() {
    const out = [];
    if (this.hydration <= 0) out.push('hydration');
    if (this.light <= 0) out.push('light');
    if (this.soil <= 0) out.push('soil');
    return out;
  }

  /**
   * `env` is the terrarium's behaviour read plus the aggregated object field at
   * this plot: `{ light, field: { hydration, light, soil, envLight } }`.
   */
  decay(dt, env = {}) {
    const field = env.field ?? {};
    const ambient = clamp01((env.light ?? 0.5) + (field.envLight ?? 0));

    // Hydration always falls; a Pond or a hand with a watering can pushes back.
    this.hydration = clamp01(
      this.hydration - DECAY.hydration * dt + (field.hydration ?? 0) * dt
    );

    // Light is the only meter that refills on its own — that is what daylight
    // is. A Heat Lamp adds to it, a Shade Tree subtracts.
    const lightFlux = (ambient - 0.42) * DECAY.light * 2.6 + (field.light ?? 0);
    this.light = clamp01(this.light + lightFlux * dt);

    // Soil is drained by crowding and by anything digging or trampling here.
    const drain = DECAY.soil + this.crowding * DECAY.crowdingPenalty
                + (env.disturbance ?? 0) * 0.004;
    const feed = (field.soil ?? 0) * (1 - this.residue);
    const fallow = this.occupant ? 0 : DECAY.fallowRecovery * (1 - this.residue);
    this.soil = clamp01(this.soil - drain * dt + (feed + fallow) * dt);

    this.residue = clamp01(this.residue - dt * 0.0025);
    return this;
  }
}

/* ----------------------------------------------------------------- plant -- */

export class Plant {
  /**
   * @param {string} id     a key in PLANT_SPECS
   * @param {Plot} plot     the plot it occupies
   */
  constructor(id, plot, { state = 'seed' } = {}) {
    this.spec = specOf(id);
    if (this.spec.category !== 'plant') throw new Error(`${id} is not a plant`);
    this.id = id;
    this.plot = plot;
    this.x = plot.x;
    this.y = plot.y;
    this.state = state;
    this.age = 0;
    this.stateAge = 0;
    this.progress = 0;        // germination or growth, 0..1
    this.scale = 0.12;
    this.declineFor = 0;
    this.spreadTimer = 0;
    this.yieldTimer = 0;
    this.pendingYield = 0;    // nectar/berries waiting to be eaten
    this.trampled = 0;
    plot.occupant = this;
  }

  /** The doc's loop calls `plant.meters.decay(...)`; the plot IS the meters. */
  get meters() { return this.plot; }

  get alive() { return this.state !== 'dead'; }
  get mature() { return this.state === 'mature' || this.state === 'spreading'; }

  /** 0 = healthy, 1 = fully wilted. Drives the palette shift, nothing else. */
  get wilt() {
    if (this.state === 'declining') return clamp01(this.declineFor / TIMINGS.declineGrace);
    const worst = Math.min(this.plot.hydration, this.plot.light, this.plot.soil);
    return clamp01(0.5 - worst) * 1.4;
  }

  /** A growth multiplier from the plant's own spec. Never touches a bug. */
  get growthRate() { return this.spec.growth ?? 1; }

  /** Bugs walking over a sprout can destroy it, if the setting allows it. */
  trample(amount = 1) {
    if (this.state !== 'sprout' && this.state !== 'seed') return false;
    this.trampled += amount;
    if (this.trampled >= 3) { this.state = 'dead'; this.stateAge = 0; return true; }
    return false;
  }

  setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.stateAge = 0;
  }

  /**
   * One tick of the lifecycle. Pure with respect to the rest of the game: reads
   * its own meters and the ambient environment, writes only its own fields.
   */
  advanceLifecycle(dt, env = {}) {
    this.age += dt;
    this.stateAge += dt;
    const rate = this.growthRate;
    const dead = this.plot.exhausted;

    // ---- neglect rules, checked before anything else --------------------
    if (dead.length >= 3) { this.setState('dead'); return this.state; }
    if (dead.length >= 1 && this.state !== 'dead' && this.state !== 'declining') {
      this.setState('declining');
      this.declineFor = 0;
    }

    switch (this.state) {
      case 'seed': {
        const favourable = this.plot.light > 0.30 && this.plot.hydration > 0.25;
        if (favourable) {
          this.progress += (dt * rate) / TIMINGS.germinate;
          this.stalled = 0;
          if (this.progress >= 1) { this.progress = 0; this.setState('sprout'); }
        } else {
          this.stalled = (this.stalled ?? 0) + dt;
          if (this.stalled > TIMINGS.seedFail) this.setState('dead');
        }
        this.scale = 0.10;
        break;
      }

      case 'sprout': {
        this.scale = 0.22 + 0.10 * Math.min(1, this.stateAge / TIMINGS.sprout);
        if (this.stateAge > TIMINGS.sprout / rate) this.setState('growing');
        break;
      }

      case 'growing': {
        this.progress = Math.min(1, this.progress + (dt * rate) / TIMINGS.grow);
        this.scale = 0.32 + 0.68 * this.progress;
        if (this.progress >= 1) this.setState('mature');
        break;
      }

      case 'mature': {
        this.scale = 1;
        this.spreadTimer += dt;
        if (this.spreadTimer >= TIMINGS.spreadEvery / rate) {
          this.spreadTimer = 0;
          this.setState('spreading');
        }
        this.tickYield(dt);
        break;
      }

      case 'spreading': {
        // Spreading does not consume the parent — the scene picks the seed up
        // via `trySpreadSeed` and the plant drops straight back to mature.
        this.scale = 1;
        if (this.stateAge > 1) this.setState('mature');
        this.tickYield(dt);
        break;
      }

      case 'declining': {
        this.declineFor += dt * (dead.length >= 2 ? 2.4 : 1);
        this.scale = Math.max(0.35, this.scale - dt * 0.02);
        if (dead.length === 0) {
          // Recovered in time. Back to whatever it was doing.
          this.declineFor = 0;
          this.setState(this.progress >= 1 ? 'mature' : 'growing');
        } else if (this.declineFor >= TIMINGS.declineGrace) {
          this.setState('dead');
        }
        break;
      }

      case 'dead':
      default:
        this.scale = 0;
        break;
    }
    return this.state;
  }

  tickYield(dt) {
    const y = this.spec.yields;
    if (!y) return;
    this.yieldTimer += dt;
    if (this.yieldTimer >= y.everySeconds) {
      this.yieldTimer = 0;
      // A wilting plant stops supplying. It does not un-supply what it gave.
      if (this.wilt < 0.5) this.pendingYield = Math.min(3, this.pendingYield + 1);
    }
  }

  /** Take one pickup, if there is one. Returns the effect spec or null. */
  harvest() {
    if (this.pendingYield <= 0) return null;
    this.pendingYield -= 1;
    return this.spec.yields?.effect ?? null;
  }

  snapshot() {
    return {
      id: this.id, name: this.spec.name, state: this.state,
      x: this.x, y: this.y, scale: this.scale, wilt: this.wilt,
      hydration: this.plot.hydration, light: this.plot.light, soil: this.plot.soil,
      pendingYield: this.pendingYield,
    };
  }
}

/* ------------------------------------------------------------------- bed -- */

/**
 * Owns the plots and the plants on them, and implements the two hooks the doc
 * names: `trySpreadSeed` and `clearPlot`. The terrarium calls `tick()` once per
 * frame with `dt` and the ambient environment.
 */
export class PlantBed {
  constructor({ rng = makeRng(31337), bounds = null, minGap = 46 } = {}) {
    this.rng = rng;
    this.bounds = bounds;         // { x, y, right, bottom } or null for unbounded
    this.minGap = minGap;
    this.plots = [];
    this.plants = [];
    this.settings = { plantsTrampleable: true, maxPlants: 24 };
  }

  plotAt(x, y, opts) {
    const plot = new Plot(x, y, opts);
    this.plots.push(plot);
    return plot;
  }

  /** Plant `id` at a point, creating a plot if there isn't one free there. */
  plant(id, x, y, opts = {}) {
    if (this.plants.length >= this.settings.maxPlants) return null;
    if (!this.hasRoom(x, y)) return null;
    const plot = this.plots.find((p) => p.x === x && p.y === y && !p.occupant)
              ?? this.plotAt(x, y);
    const p = new Plant(id, plot, opts);
    this.plants.push(p);
    return p;
  }

  hasRoom(x, y) {
    if (this.bounds) {
      const b = this.bounds;
      if (x < b.x || x > b.right || y < b.y || y > b.bottom) return false;
    }
    return !this.plants.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < this.minGap ** 2);
  }

  /** Plants sharing a plot's radius drain its soil faster. */
  updateCrowding() {
    for (const plot of this.plots) {
      let n = 0;
      for (const p of this.plants) {
        if (p.plot === plot || !p.alive) continue;
        if ((p.x - plot.x) ** 2 + (p.y - plot.y) ** 2 < plot.radius ** 2) n++;
      }
      plot.crowding = n;
    }
  }

  /**
   * The update hook, in the shape the objects doc specified.
   * `fieldFor(x, y)` supplies the aggregated object influence at a point —
   * pass `objects.fieldAt.bind(null, placedObjects)` or anything with that shape.
   */
  tick(dt, env = {}, fieldFor = null) {
    this.updateCrowding();
    for (const plant of this.plants) {
      const local = { ...env, field: fieldFor ? fieldFor(plant.x, plant.y) : (env.field ?? {}) };
      plant.meters.decay(dt, local);
      plant.advanceLifecycle(dt, local);
      if (plant.state === 'spreading') this.trySpreadSeed(plant);
      if (plant.state === 'dead') this.clearPlot(plant);
    }
    // Empty plots keep decaying too — that is how a fallow plot recovers soil.
    for (const plot of this.plots) {
      if (!plot.occupant) plot.decay(dt, { ...env, field: fieldFor ? fieldFor(plot.x, plot.y) : {} });
    }
    this.plants = this.plants.filter((p) => p.alive);
    return this.plants.length;
  }

  /** A mature plant attempts to seed nearby. Deterministic under a seeded rng. */
  trySpreadSeed(parent) {
    if (this.rng() > (parent.spec.spreadChance ?? 0)) return null;
    const angle = this.rng() * Math.PI * 2;
    const dist = this.minGap * (1.2 + this.rng() * 1.6);
    const x = Math.round(parent.x + Math.cos(angle) * dist);
    const y = Math.round(parent.y + Math.sin(angle) * dist);
    return this.plant(parent.id, x, y, { state: 'seed' });
  }

  /**
   * A dead plant frees its plot and leaves residue. Deliberately NOT a fresh
   * seed: a garden that reseeds itself forever needs no gardener.
   */
  clearPlot(plant) {
    const plot = plant.plot;
    plot.occupant = null;
    plot.residue = Math.min(1, plot.residue + 0.55);
    plot.soil = Math.min(plot.soil, 0.35);
    return plot;
  }

  snapshot() {
    return this.plants.map((p) => p.snapshot());
  }
}

export { PLANT_SPECS };
