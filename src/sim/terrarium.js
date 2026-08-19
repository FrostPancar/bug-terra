// The terrarium: Phaser scene + Matter world + decor + the generation loop.

import { Bug } from './bug.js';
import { behaviourAt, dayFraction, clockLabel } from './dayNight.js';
import { randomPopulation, breedGeneration, rank } from '../core/breeding.js';
import { makeRng } from '../core/rng.js';

export const WORLD = { w: 1280, h: 800 };

export class TerrariumScene extends Phaser.Scene {
  constructor() {
    super('terrarium');
    this.bugs = [];
    this.generation = 0;
    this.preset = 'balanced';
    this.timeScale = 1;
    this.popSize = 12;
    this.seed = 1337;
    this.selected = null;
    this.history = [];
    this.env = behaviourAt(0.5);
  }

  create() {
    this.rng = makeRng(this.seed);
    this.terrariumBounds = new Phaser.Geom.Rectangle(40, 40, WORLD.w - 80, WORLD.h - 80);

    this.matter.world.setBounds(24, 24, WORLD.w - 48, WORLD.h - 48, 32, true, true, true, true);
    this.matter.world.disableGravity();

    this.groundLayer = this.add.graphics().setDepth(0);
    this.decorLayer = this.add.graphics().setDepth(1);
    this.fxLayer = this.add.graphics().setDepth(30);
    this.lightLayer = this.add.graphics().setDepth(40);

    this.drawGround();
    this.buildDecor();
    this.spawnGeneration(randomPopulation(this.popSize, this.rng));

    this.input.on('pointerdown', (p) => this.handleClick(p));
    this.fx = [];
  }

  /* --------------------------------------------------------- terrain ---- */

  drawGround() {
    const g = this.groundLayer;
    g.clear();
    g.fillStyle(0x2b2117, 1).fillRect(0, 0, WORLD.w, WORLD.h);
    const r = makeRng(99);
    for (let i = 0; i < 900; i++) {
      const shade = [0x3a2c1e, 0x241b12, 0x453425, 0x1d160f][Math.floor(r() * 4)];
      g.fillStyle(shade, 0.55);
      g.fillRect(r() * WORLD.w, r() * WORLD.h, 2 + r() * 5, 2 + r() * 4);
    }
    // glass frame
    g.lineStyle(10, 0x9fd9e8, 0.16).strokeRect(24, 24, WORLD.w - 48, WORLD.h - 48);
  }

  buildDecor() {
    const g = this.decorLayer;
    const r = makeRng(4242);
    this.decor = [];

    // rocks — static physics bodies
    for (let i = 0; i < 7; i++) {
      const x = 120 + r() * (WORLD.w - 240);
      const y = 110 + r() * (WORLD.h - 220);
      const rad = 22 + r() * 34;
      this.matter.add.circle(x, y, rad, { isStatic: true, friction: 0.4 });
      g.fillStyle(0x5b5b5f, 1).fillCircle(x, y, rad);
      g.fillStyle(0x7a7a80, 1).fillCircle(x - rad * 0.22, y - rad * 0.26, rad * 0.62);
      g.fillStyle(0x3f3f45, 1).fillCircle(x + rad * 0.34, y + rad * 0.34, rad * 0.34);
      this.decor.push({ kind: 'rock', x, y, r: rad });
    }

    // plants — decorative only, bugs walk under them
    for (let i = 0; i < 16; i++) {
      const x = 80 + r() * (WORLD.w - 160);
      const y = 80 + r() * (WORLD.h - 160);
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
    for (let i = 0; i < 10; i++) {
      const x = 70 + r() * (WORLD.w - 140);
      const y = 70 + r() * (WORLD.h - 140);
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
    let best = null, bestD = 60 * 60;
    for (const b of this.bugs) {
      const d = (b.sprite.x - p.worldX) ** 2 + (b.sprite.y - p.worldY) ** 2;
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) { this.selected = best; this.emitState(); }
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
      bestFitness: ranked[0]?.fitness ?? 0,
      meanFitness: ranked.length ? ranked.reduce((a, e) => a + e.fitness, 0) / ranked.length : 0,
      selected: this.selected?.snapshot() ?? null,
      roster: this.bugs.map((b) => b.snapshot()),
      history: this.history.slice(-40),
    });
  }
}
