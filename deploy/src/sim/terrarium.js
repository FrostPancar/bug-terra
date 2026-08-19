// The terrarium: Phaser scene + Matter world + decor + the generation loop.

import { Bug } from './bug.js';
import { behaviourAt, dayFraction, clockLabel } from './dayNight.js';
import { breedGeneration, rank } from '../core/breeding.js';
import { seededPopulation } from '../core/archetypes.js';
import { makeRng } from '../core/rng.js';
import { PlantBed } from './plants.js';
import { placeObject, fieldAt, breedingModifiers } from './objects.js';
import { Knowledge, sendToVet, vetStatus, isAway, VET } from './knowledge.js';
import { vetReadout } from '../core/impressions.js';
import { drawBug } from '../render/bugArt.js';
import {
  computeWorld, tierSettings, isTouchDevice, pickRadius, aspectChangedMeaningfully,
} from './viewport.js';

/** Mutable — the world reshapes itself to the viewport. Read, never cache. */
export const WORLD = { w: 1280, h: 800 };

/** Inset from the world edge to the glass wall, scaled to the smaller side. */
const wallInset = () => Math.max(12, Math.round(Math.min(WORLD.w, WORLD.h) * 0.03));

/** 0xRRGGBB lerp — used for the wilting palette shift. */
function mixToward(a, b, k) {
  const t = Math.max(0, Math.min(1, k));
  const ch = (v, s) => (v >> s) & 255;
  const m = [16, 8, 0].map((s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t));
  return (m[0] << 16) | (m[1] << 8) | m[2];
}

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
    // What the player has learned, and what they have not. The panel reads this
    // rather than reading stats — see sim/knowledge.js.
    this.knowledge = new Knowledge();
    /** @type {Array<ReturnType<typeof placeObject>>} */
    this.objects = [];
    /** @type {PlantBed|null} */
    this.bed = null;
    /** Bugs currently at the vet: out of the terrarium, not gone. */
    this.atVet = [];
    this.clock = 0;                 // seconds of sim time, for vet timers
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
    this.plantLayer = this.add.graphics().setDepth(2);
    this.fxLayer = this.add.graphics().setDepth(30);
    this.lightLayer = this.add.graphics().setDepth(40);
    this.fx = [];

    this.applyWorldBounds();
    this.drawGround();
    this.buildDecor();
    this.buildGarden();
    this.spawnGeneration(seededPopulation(this.popSize, this.rng));

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
    // Keep the garden inside the new walls without restarting its lifecycle.
    if (this.bed) {
      const b = this.terrariumBounds;
      this.bed.bounds = { x: b.x + 20, y: b.y + 20, right: b.right - 20, bottom: b.bottom - 20 };
      for (const p of this.bed.plants) {
        p.x = p.plot.x = Math.min(b.right - 20, Math.max(b.x + 20, p.x));
        p.y = p.plot.y = Math.min(b.bottom - 20, Math.max(b.y + 20, p.y));
      }
      for (const o of this.objects) {
        o.x = Math.min(b.right - 20, Math.max(b.x + 20, o.x));
        o.y = Math.min(b.bottom - 20, Math.max(b.y + 20, o.y));
      }
      this.drawGarden();
    }

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

  /* ---------------------------------------------------------- garden ---- */

  /**
   * Placeable objects and the plant bed. Plants tick alongside decor rather
   * than alongside bugs — they have no Matter.js body beyond a footprint, and
   * they read the same `behaviourAt()` signal bug behaviour reads.
   */
  buildGarden() {
    const b = this.terrariumBounds;
    this.bed = new PlantBed({
      rng: makeRng(this.seed ^ 0x5eed),
      bounds: { x: b.x + 20, y: b.y + 20, right: b.right - 20, bottom: b.bottom - 20 },
    });
    this.objects = [];

    // A starter garden so the loop is visible on first run. Everything here is
    // ordinary placement — nothing about it is special-cased.
    const r = makeRng(777);
    const at = (fx, fy) => ({ x: b.x + b.width * fx, y: b.y + b.height * fy });
    const pond = at(0.18, 0.72);
    const heap = at(0.82, 0.24);
    this.objects.push(placeObject('pond', pond.x, pond.y));
    this.objects.push(placeObject('compost_heap', heap.x, heap.y));
    this.objects.push(placeObject('training_rock', at(0.5, 0.2).x, at(0.5, 0.2).y));

    const starters = ['grass_patch', 'moss_bed', 'fern_cluster', 'berry_bush', 'flowering_bush'];
    for (const id of starters) {
      for (let tries = 0; tries < 12; tries++) {
        const x = Math.round(b.x + 40 + r() * (b.width - 80));
        const y = Math.round(b.y + 40 + r() * (b.height - 80));
        if (this.bed.plant(id, x, y, { state: r() < 0.5 ? 'growing' : 'mature' })) break;
      }
    }
  }

  /** Aggregated object influence at a point — passed straight to the plant bed. */
  fieldFor(x, y) { return fieldAt(this.objects, x, y); }

  drawGarden() {
    const g = this.plantLayer;
    g.clear();
    for (const p of this.bed?.plants ?? []) {
      if (p.state === 'seed') {
        g.fillStyle(0x6b543a, 0.9).fillCircle(p.x, p.y, 3);
        continue;
      }
      const wilt = p.wilt;
      const base = [0x3f7a3a, 0x2f6330, 0x54994a][p.id.length % 3];
      // Wilting is a palette shift, not a label. You are supposed to notice it.
      const col = wilt > 0.15 ? mixToward(base, 0x8a7a3c, Math.min(1, wilt)) : base;
      const blades = 3 + (p.id.length % 4);
      const len = (18 + 40 * p.scale) * (1 - wilt * 0.35);
      for (let i = 0; i < blades; i++) {
        const a = -Math.PI / 2 + (i / blades - 0.5) * 1.9;
        g.lineStyle(2 + p.scale * 2.5, col, 0.95);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x + Math.cos(a) * len * 0.6, p.y + Math.sin(a) * len * 0.6);
        g.lineTo(p.x + Math.cos(a + 0.4) * len, p.y + Math.sin(a + 0.4) * len);
        g.strokePath();
      }
      if (p.pendingYield > 0) {
        g.fillStyle(0xffd166, 1).fillCircle(p.x, p.y - len * 0.7, 4);
      }
    }
    for (const o of this.objects) {
      g.fillStyle(0x2c3b4a, 0.5).fillCircle(o.x, o.y, Math.max(10, o.spec.footprint || 12));
      g.lineStyle(2, 0x9fd9e8, 0.35).strokeCircle(o.x, o.y, Math.max(10, o.spec.footprint || 12));
    }
  }

  /* ------------------------------------------------------- vet station --- */

  /**
   * Take a bug out for a look-over. It leaves the terrarium for the length of
   * the visit and cannot go straight back in afterwards, so this is a decision
   * rather than something you do to every bug constantly.
   */
  sendToVet(bug) {
    if (!bug || !sendToVet(this.knowledge, bug.genome, this.clock)) return false;
    bug.sprite.setVisible(false);
    bug.sprite.setStatic(true);
    this.atVet.push(bug);
    this.bugs = this.bugs.filter((b) => b !== bug);
    if (this.selected === bug) this.selected = this.bugs[0] ?? null;
    this.emitState();
    return true;
  }

  /**
   * The Vet Station's entire output: a picture, and words about what is in the
   * picture. This is the ONE sanctioned path from a genome to the player, and
   * it is deliberately the least useful view for min-maxing — it tells you what
   * the bug IS, never what it is worth.
   *
   * The genome crosses into the UI as pixels and prose, never as data: the
   * caller gets a canvas and a list of sentences, and no way back to a number.
   */
  vetPortrait(bug, { size = 260 } = {}) {
    if (!bug) return null;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.translate(size / 2, size / 2);
    // Held still, head-up, at a resolution where the parts actually read.
    drawBug(ctx, bug.genome, { phase: 0, state: 'idle', ppu: Math.round(size / 8.5) });
    return { canvas, readout: vetReadout(bug.genome) };
  }

  /** Anyone whose visit has elapsed comes home. Cooldown starts on return. */
  returnFromVet() {
    if (!this.atVet.length) return;
    const back = [];
    this.atVet = this.atVet.filter((bug) => {
      const rec = this.knowledge.recordFor(bug.genome);
      if (isAway(rec, this.clock)) return true;
      back.push(bug);
      return false;
    });
    for (const bug of back) {
      const b = this.terrariumBounds;
      bug.sprite.setVisible(true);
      bug.sprite.setStatic(false);
      bug.sprite.setPosition(b.x + this.rng() * b.width, b.y + this.rng() * b.height);
      bug.wander = bug.pickWanderPoint();
      this.bugs.push(bug);
    }
    if (back.length) this.emitState();
  }

  /** Record a fight for both parties — this is how combat impressions unlock. */
  noteFight(winner, loser) {
    if (winner) this.knowledge.fought(winner.genome, { won: true });
    if (loser) this.knowledge.fought(loser.genome, { won: false });
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

  /**
   * Breed the CURRENT genomes into the next generation and respawn.
   *
   * `at` is where the breeding happens — the modifiers of whatever structures
   * cover that point are read HERE, at the moment the call runs. Nothing was
   * written onto any bug beforehand; that is the whole distinction the objects
   * doc draws between a rate multiplier and a gene write.
   */
  breed(opts = {}) {
    const genomes = this.bugs.map((b) => b.genome);
    const at = opts.at ?? { x: this.terrariumBounds.centerX, y: this.terrariumBounds.centerY };
    const mods = breedingModifiers(this.objects, at.x, at.y);
    // Locks come from what the lineage already is: a Beetle line holds its
    // wings closed unless you deliberately breed it out of Beetle.
    const dominant = this.bugs[0]?.classification ?? null;
    const { population, report } = breedGeneration(genomes, {
      preset: this.preset,
      rng: this.rng,
      size: this.popSize,
      mutationScale: 0.10 * mods.mutationScale,
      selection: mods.selection,
      locked: mods.lockChoices > 0 ? (dominant?.locks ?? []) : [],
      unlocked: dominant?.unlocks ?? [],
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
    this.spawnGeneration(seededPopulation(this.popSize, this.rng));
    return this.seed;
  }

  onBugDown(bug) {
    bug.sprite.setAlpha(0.35);
    bug.sprite.setStatic(true);
    this.flash(bug.sprite.x, bug.sprite.y, 0xff5b4a, 26);
    this.noteFight(bug.poisonBy ?? bug.lastAttacker ?? null, bug);
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
    this.clock += dt;
    this.env = behaviourAt(dayFraction(new Date(), this.timeScale));

    const alive = this.bugs.filter((b) => b.alive);
    for (const b of alive) b.update(dt, alive);

    // Watching IS the mechanic. Time on screen is what buys the phrases the
    // panel is allowed to show.
    for (const b of alive) this.knowledge.observe(b.genome, dt);

    // Plants tick beside the decor, on the same clock the bugs read.
    if (this.bed) {
      this.gardenTick = (this.gardenTick ?? 0) + dt;
      this.bed.tick(dt, { light: this.env.light, disturbance: alive.length * 0.05 },
                   (x, y) => this.fieldFor(x, y));
      if (this.gardenTick > 0.5) { this.gardenTick = 0; this.drawGarden(); }
    }
    this.returnFromVet();

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

  /**
   * The population's direction of travel, as a phrase. The GA still ranks by a
   * numeric fitness internally — it has to — but the number never leaves this
   * method. Comparing this generation's mean against the last two is enough to
   * say "coming along" without ever printing a score.
   */
  poolTrend() {
    const h = this.history;
    if (h.length < 2) return 'too early to say';
    const last = h[h.length - 1];
    const prev = h[h.length - 2];
    const d = (last.mean ?? 0) - (prev.mean ?? 0);
    const scale = Math.max(1, Math.abs(prev.mean ?? 1)) * 0.02;
    if (d > scale) return 'the pool is coming along';
    if (d < -scale) return 'the pool has slipped';
    return 'the pool is holding steady';
  }

  emitState() {
    const alive = this.bugs.filter((b) => b.alive);
    // rank() is still what selection uses; the numbers stay inside this call.
    const ranked = this.bugs.length ? rank(this.bugs.map((b) => b.genome), this.preset) : [];
    const sel = this.selected;
    this.events.emit('state', {
      clock: clockLabel(new Date(), this.timeScale),
      env: this.env,
      generation: this.generation,
      preset: this.preset,
      seed: this.seed,
      alive: alive.length,
      total: this.bugs.length + this.atVet.length,
      popSize: this.popSize,
      tier: this.settings?.tier ?? 'desktop',
      trend: this.poolTrend(),
      diversity: ranked.length ? describeDiversity(ranked) : 'nothing to compare yet',
      garden: this.bed?.snapshot() ?? [],
      atVet: this.atVet.map((b) => ({
        ...b.snapshot(),
        remaining: Math.ceil(vetStatus(this.knowledge.recordFor(b.genome), this.clock).remaining),
      })),
      vetCapacity: VET,
      selected: sel ? {
        ...sel.snapshot(),
        impressions: this.knowledge.known(sel.genome).map((i) => i.phrase),
        familiarity: this.knowledge.familiarity(sel.genome),
        moments: this.knowledge.recordFor(sel.genome).moments.slice(-5),
        vet: vetStatus(this.knowledge.recordFor(sel.genome), this.clock),
      } : null,
      roster: this.bugs.map((b) => b.snapshot()),
      history: this.history.slice(-40),
    });
  }
}

/** Spread of the pool, as a word. Same rule: the number stays in here. */
function describeDiversity(ranked) {
  const vals = ranked.map((r) => r.fitness);
  const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  const cv = Math.abs(mean) > 1e-6 ? sd / Math.abs(mean) : 0;
  if (cv < 0.06) return 'they are all much of a muchness';
  if (cv < 0.18) return 'a few stand out';
  return 'wildly different animals';
}
