// The terrarium: Phaser scene + Matter world + decor + the generation loop.

import { Bug } from './bug.js';
import { behaviourAt, dayFraction, clockLabel } from './dayNight.js';
import { randomPopulation, breedGeneration, rank } from '../core/breeding.js';
import { makeRng } from '../core/rng.js';
import {
  computeWorld, tierSettings, isTouchDevice, pickRadius, aspectChangedMeaningfully,
} from './viewport.js';

/** Mutable — the world reshapes itself to the viewport. Read, never cache. */
export const WORLD = { w: 1280, h: 800 };

/** Inset from the world edge to the glass wall, scaled to the smaller side. */
const wallInset = () => Math.max(12, Math.round(Math.min(WORLD.w, WORLD.h) * 0.03));

export class TerrariumScene extends Phaser.Scene {
  constructor() {
    super('terrarium');
    this.bugs = [];
    this.generation = 0;
    this.preset = 'balanced';
    this.timeScale = 1;
    this.seed = 1337;
    this.selected = null;
    this.history = [];
    this.env = behaviourAt(0.5);
    this.touch = false;
    this.popSize = 12;
    this.popSizeExplicit = false;   // true once the user moves the slider
    // World px hidden behind the bottom sheet. The canvas draws full bleed so
    // the glass buttons have live terrarium to refract; the playable box stops
    // short of it so no bug is ever unreachable under the panel.
    this.insetBottom = 0;
  }

  create() {
    this.rng = makeRng(this.seed);
    this.touch = isTouchDevice();

    // Tier comes from the real screen, not from scale.gameSize — that reports
    // WORLD units, which are normalized to constant area and would call every
    // device a tablet.
    this.settings = tierSettings();
    if (!this.popSizeExplicit) this.popSize = this.settings.population;
    this.lastAspect = WORLD.w / WORLD.h;

    this.terrariumBounds = new Phaser.Geom.Rectangle(0, 0, 10, 10);
    this.matter.world.disableGravity();

    this.groundLayer = this.add.graphics().setDepth(0);
    this.decorLayer = this.add.graphics().setDepth(1);
    this.fxLayer = this.add.graphics().setDepth(30);
    this.lightLayer = this.add.graphics().setDepth(40);
    this.fx = [];

    this.applyWorldBounds();
    this.drawGround();
    this.buildDecor();
    this.spawnGeneration(randomPopulation(this.popSize, this.rng));

    this.input.on('pointerdown', (p) => this.handleClick(p));
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
  }

  /* -------------------------------------------------------- responsive -- */

  /** Height of the playable box — the world minus whatever the sheet covers. */
  get playHeight() {
    return Math.max(160, WORLD.h - this.insetBottom);
  }

  applyWorldBounds() {
    const inset = wallInset();
    const pad = inset + 16;
    const h = this.playHeight;
    this.terrariumBounds.setTo(pad, pad, WORLD.w - pad * 2, h - pad * 2);
    // Phaser reuses the existing wall bodies when setBounds is called again.
    this.matter.world.setBounds(
      inset, inset, WORLD.w - inset * 2, h - inset * 2,
      Math.max(24, inset * 1.3), true, true, true, true
    );
  }

  /** Re-fence the play area after the sheet opens, closes, or changes layout. */
  setInsetBottom(px) {
    const next = Math.max(0, Math.round(px));
    if (Math.abs(next - this.insetBottom) < 4) return false;
    this.insetBottom = next;
    this.applyWorldBounds();
    this.drawGround();
    const b = this.terrariumBounds;
    for (const bug of this.bugs) {
      bug.sprite.setPosition(
        Phaser.Math.Clamp(bug.sprite.x, b.x, b.right),
        Phaser.Math.Clamp(bug.sprite.y, b.y, b.bottom)
      );
      bug.wander = bug.pickWanderPoint();
    }
    return true;
  }

  /**
   * The viewport changed. Only reshape the world when the aspect ratio really
   * moved — iOS Safari fires resize constantly as its toolbars slide.
   */
  onResize(gameSize) {
    const next = computeWorld(gameSize.width, gameSize.height);
    // Caller already debounced; reshape straight away or not at all.
    if (!aspectChangedMeaningfully(this.lastAspect, next.w / next.h)) return false;
    this.reshapeWorld(gameSize);
    return true;
  }

  /** Rebuild terrain for a new aspect, keeping the population's genomes. */
  reshapeWorld(gameSize) {
    const next = computeWorld(gameSize.width, gameSize.height);
    WORLD.w = next.w;
    WORLD.h = next.h;
    this.lastAspect = next.w / next.h;

    this.scale.setGameSize(next.w, next.h);
    this.settings = tierSettings();
    if (!this.popSizeExplicit) this.popSize = this.settings.population;

    this.applyWorldBounds();
    this.drawGround();
    this.decorLayer.clear();
    this.buildDecor();

    // pull everyone back inside the new walls
    const b = this.terrariumBounds;
    for (const bug of this.bugs) {
      bug.sprite.setPosition(
        Phaser.Math.Clamp(bug.sprite.x, b.x, b.right),
        Phaser.Math.Clamp(bug.sprite.y, b.y, b.bottom)
      );
      bug.wander = bug.pickWanderPoint();
    }

    // setGameSize changed the drawing buffer; refresh recomputes the FIT
    // scaling against the parent box. Without this the canvas keeps its old
    // CSS size and either overflows the host or leaves a gap.
    this.scale.refresh();
    this.emitState();
  }

  /* --------------------------------------------------------- terrain ---- */

  drawGround() {
    const g = this.groundLayer;
    const inset = wallInset();
    g.clear();
    g.fillStyle(0x2b2117, 1).fillRect(0, 0, WORLD.w, WORLD.h);
    const playH = this.playHeight;
    const r = makeRng(99);
    const n = this.settings.speckles;
    for (let i = 0; i < n; i++) {
      const shade = [0x3a2c1e, 0x241b12, 0x453425, 0x1d160f][Math.floor(r() * 4)];
      g.fillStyle(shade, 0.55);
      g.fillRect(r() * WORLD.w, r() * WORLD.h, 2 + r() * 5, 2 + r() * 4);
    }
    // glass frame — traces the PLAYABLE box, not the full canvas, so the wall
    // sits where the bugs actually stop.
    g.lineStyle(Math.max(5, inset * 0.4), 0x9fd9e8, 0.16)
      .strokeRect(inset, inset, WORLD.w - inset * 2, playH - inset * 2);
  }

  buildDecor() {
    const g = this.decorLayer;
    const r = makeRng(4242);
    this.decor = [];

    // Drop the previous rocks' bodies first — reshaping the world calls this
    // again, and orphaned static bodies would pile up invisibly.
    for (const body of this.rockBodies ?? []) this.matter.world.remove(body);
    this.rockBodies = [];

    const margin = wallInset() + 40;
    const spanX = Math.max(60, WORLD.w - margin * 2);
    const spanY = Math.max(60, WORLD.h - margin * 2);

    // rocks — static physics bodies
    for (let i = 0; i < this.settings.rocks; i++) {
      const x = margin + r() * spanX;
      const y = margin + r() * spanY;
      const rad = 22 + r() * 34;
      this.rockBodies.push(this.matter.add.circle(x, y, rad, { isStatic: true, friction: 0.4 }));
      g.fillStyle(0x5b5b5f, 1).fillCircle(x, y, rad);
      g.fillStyle(0x7a7a80, 1).fillCircle(x - rad * 0.22, y - rad * 0.26, rad * 0.62);
      g.fillStyle(0x3f3f45, 1).fillCircle(x + rad * 0.34, y + rad * 0.34, rad * 0.34);
      this.decor.push({ kind: 'rock', x, y, r: rad });
    }

    // plants — decorative only, bugs walk under them
    for (let i = 0; i < this.settings.plants; i++) {
      const x = margin * 0.6 + r() * (WORLD.w - margin * 1.2);
      const y = margin * 0.6 + r() * (WORLD.h - margin * 1.2);
      const blades = 4 + Math.floor(r() * 6);
      for (let b = 0; b < blades; b++) {
        const a = -Math.PI / 2 + (b / blades - 0.5) * 1.9;
        const len = 26 + r() * 46;
        g.lineStyle(3 + r() * 3, [0x3f7a3a, 0x2f6330, 0x54994a][Math.floor(r() * 3)], 0.95);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * len * 0.6, y + Math.sin(a) * len * 0.6);
        g.lineTo(x + Math.cos(a + 0.4) * len, y + Math.sin(a + 0.4) * len);
        g.strokePath();
      }
      this.decor.push({ kind: 'plant', x, y });
    }

    // food pellets
    for (let i = 0; i < this.settings.food; i++) {
      const x = margin * 0.5 + r() * (WORLD.w - margin);
      const y = margin * 0.5 + r() * (WORLD.h - margin);
      g.fillStyle(0xd8b25a, 1).fillCircle(x, y, 5);
      g.fillStyle(0xf0d494, 1).fillCircle(x - 1.4, y - 1.6, 2.2);
      this.decor.push({ kind: 'food', x, y });
    }
  }

  /* ------------------------------------------------------ population ---- */

  spawnGeneration(population) {
    for (const b of this.bugs) b.destroy();
    this.bugs = population.map((genome) => new Bug(this, genome, {
      x: this.terrariumBounds.x + this.rng() * this.terrariumBounds.width,
      y: this.terrariumBounds.y + this.rng() * this.terrariumBounds.height,
      generation: this.generation,
      rng: this.rng,
    }));
    this.selected = this.bugs[0] ?? null;
    this.emitState();
  }

  /** Breed the CURRENT genomes into the next generation and respawn. */
  breed(opts = {}) {
    const genomes = this.bugs.map((b) => b.genome);
    const { population, report } = breedGeneration(genomes, {
      preset: this.preset,
      rng: this.rng,
      size: this.popSize,
      ...opts,
    });
    this.generation++;
    this.history.push({ gen: this.generation, ...report });
    this.spawnGeneration(population);
    return report;
  }

  /** Headless fast-forward: evolve N generations, then spawn the result. */
  fastForward(n = 10) {
    let genomes = this.bugs.map((b) => b.genome);
    let last = null;
    for (let i = 0; i < n; i++) {
      const step = breedGeneration(genomes, { preset: this.preset, rng: this.rng, size: this.popSize });
      genomes = step.population;
      this.generation++;
      last = step.report;
      this.history.push({ gen: this.generation, ...step.report });
    }
    this.spawnGeneration(genomes);
    return last;
  }

  reseed(seed) {
    this.seed = seed ?? Math.floor(Math.random() * 1e9);
    this.rng = makeRng(this.seed);
    this.generation = 0;
    this.history = [];
    this.spawnGeneration(randomPopulation(this.popSize, this.rng));
    return this.seed;
  }

  onBugDown(bug) {
    bug.sprite.setAlpha(0.35);
    bug.sprite.setStatic(true);
    this.flash(bug.sprite.x, bug.sprite.y, 0xff5b4a, 26);
    if (this.selected === bug) this.selected = this.bugs.find((b) => b.alive) ?? bug;
    if (this.bugs.filter((b) => b.alive).length <= 1) this.events.emit('roundOver');
  }

  flash(x, y, color = 0xffe9a8, size = 14) {
    this.fx.push({ x, y, color, size, life: 0.28, max: 0.28 });
  }

  handleClick(p) {
    const reach = pickRadius(WORLD, this.touch);
    let best = null, bestD = reach * reach;
    for (const b of this.bugs) {
      const d = (b.sprite.x - p.worldX) ** 2 + (b.sprite.y - p.worldY) ** 2;
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) {
      this.selected = best;
      this.emitState();
      this.events.emit('selected', best.snapshot());
    }
  }

  /* ------------------------------------------------------------ loop ---- */

  update(_time, delta) {
    const dt = Math.min(0.05, delta / 1000);
    this.env = behaviourAt(dayFraction(new Date(), this.timeScale));

    const alive = this.bugs.filter((b) => b.alive);
    for (const b of alive) b.update(dt, alive);

    // fx
    this.fxLayer.clear();
    this.fx = this.fx.filter((f) => (f.life -= dt) > 0);
    for (const f of this.fx) {
      const k = f.life / f.max;
      this.fxLayer.fillStyle(f.color, k * 0.9);
      this.fxLayer.fillCircle(f.x, f.y, f.size * (1.3 - k));
    }

    // selection ring
    if (this.selected) {
      this.fxLayer.lineStyle(2, 0xffffff, 0.55);
      this.fxLayer.strokeCircle(this.selected.sprite.x, this.selected.sprite.y, this.selected.radius + 9);
    }

    // ambient light overlay — the day/night cycle you can actually see
    const e = this.env;
    this.lightLayer.clear();
    this.lightLayer.fillStyle((e.rgb[0] << 16) | (e.rgb[1] << 8) | e.rgb[2], e.darkness * 0.62);
    this.lightLayer.fillRect(0, 0, WORLD.w, WORLD.h);

    this.hudTick = (this.hudTick ?? 0) + dt;
    if (this.hudTick > 0.2) { this.hudTick = 0; this.emitState(); }
  }

  emitState() {
    const alive = this.bugs.filter((b) => b.alive);
    const ranked = this.bugs.length ? rank(this.bugs.map((b) => b.genome), this.preset) : [];
    this.events.emit('state', {
      clock: clockLabel(new Date(), this.timeScale),
      env: this.env,
      generation: this.generation,
      preset: this.preset,
      seed: this.seed,
      alive: alive.length,
      total: this.bugs.length,
      popSize: this.popSize,
      tier: this.settings?.tier ?? 'desktop',
      bestFitness: ranked[0]?.fitness ?? 0,
      meanFitness: ranked.length ? ranked.reduce((a, e) => a + e.fitness, 0) / ranked.length : 0,
      selected: this.selected?.snapshot() ?? null,
      roster: this.bugs.map((b) => b.snapshot()),
      history: this.history.slice(-40),
    });
  }
}
