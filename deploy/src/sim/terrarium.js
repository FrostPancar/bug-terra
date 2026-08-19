// The terrarium: Phaser scene + Matter world + decor + the generation loop.

import { Bug } from './bug.js';
import { behaviourAt, dayFraction, clockLabel } from './dayNight.js';
import { breedGeneration, rank } from '../core/breeding.js';
import { seededPopulation } from '../core/archetypes.js';
import { makeRng } from '../core/rng.js';
import { PlantBed } from './plants.js';
import { placeObject, fieldAt, breedingModifiers, trainerAt } from './objects.js';
import { Knowledge, sendToVet, vetStatus, isAway, VET } from './knowledge.js';
import { Autosave, loadSave, clearSave, canPersist } from './save.js';
import { normalizeGenome } from '../core/genes.js';
import { DIRT_URI } from '../assets/dirt.js';
import { vetReadout } from '../core/impressions.js';
import { drawBug } from '../render/bugArt.js';
import {
  computeWorld, tierSettings, isTouchDevice, pickRadius, aspectChangedMeaningfully,
} from './viewport.js';

/** Mutable — the world reshapes itself to the viewport. Read, never cache. */
export const WORLD = { w: 1280, h: 800 };

/** Inset from the world edge to the wall, scaled to the smaller side. */
const wallInset = () => Math.max(12, Math.round(Math.min(WORLD.w, WORLD.h) * 0.03));

/**
 * The terrarium's palette — flat, saturated, cut-paper, pulled off the floor
 * photograph and the bug art rather than invented alongside them. The HUD in
 * index.html holds the same values in CSS; these are the ones the canvas needs.
 */
export const PALETTE = {
  ground: 0xa37a4f,   // the photograph's average, used while it decodes
  red:    0xd9452e,
  blue:   0x2f52c4,
  yellow: 0xf2be3c,
  green:  0x1e7b5f,
  cream:  0xefe2c9,
  ink:    0x17110d,
  leaf:   0x6f7f43,
  leafDark: 0x4e6234,
  wilt:   0xb08a3c,
};

/** One flat colour per object category, so a glance tells you what it is. */
const CATEGORY_COLOUR = {
  breeding: 0x2f52c4,
  gene: 0x7c4bb8,
  stat: 0xd9452e,
  traversal: 0xf2be3c,
  environment: 0x1e7b5f,
  plant: 0x6f7f43,
};

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
    // the floor photograph is unbroken behind the paper sheet; the playable box
    // stops short of it so no bug is ever unreachable under the panel.
    this.insetBottom = 0;
    // A run survives the tab closing. Without this the day/night cycle is the
    // only thing that carries over, and every impression the player earned is
    // discarded on refresh — see sim/save.js.
    this.autosave = new Autosave(() => this.serialize());
    this.resumed = false;
  }

  /**
   * The floor is a photograph, embedded as a data URI so the single-file build
   * stays a single file with no network. See tools/embed-assets.mjs.
   */
  preload() {
    this.load.image('dirt', DIRT_URI);
  }

  create() {
    this.touch = isTouchDevice();

    // Tier comes from the real screen, not from scale.gameSize — that reports
    // WORLD units, which are normalized to constant area and would call every
    // device a tablet.
    this.settings = tierSettings();
    if (!this.popSizeExplicit) this.popSize = this.settings.population;
    this.lastAspect = WORLD.w / WORLD.h;

    // Restore BEFORE the garden is built: the plant bed is seeded off
    // `this.seed`, so a resumed run has to know its seed first or it would
    // build a different garden than the one it is resuming.
    const saved = loadSave();
    const restored = this.applySaved(saved);
    this.rng = makeRng(restored?.rngState ?? this.seed);

    this.terrariumBounds = new Phaser.Geom.Rectangle(0, 0, 10, 10);
    this.matter.world.disableGravity();

    // The flat fill sits UNDER the photograph and only ever shows through
    // while the texture is decoding.
    this.groundLayer = this.add.graphics().setDepth(-2);
    this.ground = this.add.image(0, 0, 'dirt').setOrigin(0.5).setDepth(-1);
    this.plantLayer = this.add.graphics().setDepth(2);
    this.fxLayer = this.add.graphics().setDepth(30);
    this.lightLayer = this.add.graphics().setDepth(40);
    this.fx = [];

    this.applyWorldBounds();
    this.drawGround();
    this.buildGarden();
    // A resumed run spawns the animals it actually had, not a fresh draw from
    // the same seed — the population is the save's source of truth.
    this.spawnGeneration(restored?.population ?? seededPopulation(this.popSize, this.rng));

    this.input.on('pointerdown', (p) => this.handleClick(p));
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
  }

  /* ------------------------------------------------------- persistence --- */

  /**
   * Everything worth keeping between sessions. Genomes travel as plain objects
   * and are re-validated on the way back in, so a save written by an older
   * build can never produce an illegal animal.
   */
  serialize() {
    return {
      seed: this.seed,
      rngState: this.rng.state(),
      generation: this.generation,
      preset: this.preset,
      popSize: this.popSize,
      popSizeExplicit: this.popSizeExplicit,
      timeScale: this.timeScale,
      clock: this.clock,
      history: this.history.slice(-40),
      population: [...this.bugs, ...this.atVet].map((b) => ({ ...b.genome })),
      knowledge: this.knowledge.export(),
    };
  }

  /**
   * Apply a saved blob. Returns the parts `create()` still needs (the resumed
   * population and rng position), or null for a fresh terrarium.
   */
  applySaved(saved) {
    if (!saved || !Array.isArray(saved.population) || !saved.population.length) return null;
    let population;
    try {
      // clampGene runs inside normalizeGenome, so an edited or stale save
      // cannot smuggle an illegal genome past the one-rule.
      population = saved.population.map((g) => normalizeGenome(g));
    } catch {
      clearSave();
      return null;
    }

    this.seed = Number.isFinite(saved.seed) ? saved.seed : this.seed;
    this.generation = Number.isFinite(saved.generation) ? saved.generation : 0;
    if (typeof saved.preset === 'string') this.preset = saved.preset;
    if (Number.isFinite(saved.popSize)) this.popSize = saved.popSize;
    this.popSizeExplicit = Boolean(saved.popSizeExplicit);
    if (Number.isFinite(saved.timeScale)) this.timeScale = saved.timeScale;
    if (Number.isFinite(saved.clock)) this.clock = saved.clock;
    if (Array.isArray(saved.history)) this.history = saved.history;
    this.knowledge = new Knowledge(saved.knowledge ?? {});
    this.resumed = true;
    return { population, rngState: Number.isFinite(saved.rngState) ? saved.rngState : this.seed };
  }

  /** Something worth keeping happened. The write itself is debounced. */
  markDirty() { this.autosave.markDirty(); }

  /** Write now — the page is going away and there is no next tick. */
  flushSave() { return this.autosave.flush(); }

  /** True when a run can actually be kept, so the HUD can say so honestly. */
  get persists() { return canPersist(); }

  /** Throw the saved run away and start clean. Used by the HUD's reset. */
  forgetRun() {
    clearSave();
    this.knowledge = new Knowledge();
    this.resumed = false;
    this.reseed();
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
    if (!this.terrariumBounds) return false;
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
    // Loading the floor photograph moved create() behind the loader, so a
    // resize can now arrive before there is a world to reshape.
    if (!this.terrariumBounds) return false;
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

  /**
   * The floor. Every rock, pebble and fleck of grit is IN the photograph, which
   * is why nothing here scatters one — the procedural rocks this used to draw
   * were flat grey circles laid on top of photographed stones, and they read
   * exactly as badly as that sounds. The bugs are the only thing on the canvas
   * that is drawn.
   */
  drawGround() {
    const g = this.groundLayer;
    g.clear();
    // Underneath the photo, so a world the photo cannot fill never shows
    // through to the page background mid-decode.
    g.fillStyle(PALETTE.ground, 1).fillRect(0, 0, WORLD.w, WORLD.h);

    const img = this.ground;
    if (!img) return;
    const src = this.textures.get('dirt')?.getSourceImage();
    if (!src?.width) return;
    // Cover, not stretch: the shorter axis overflows and is cropped, so the
    // grit keeps its aspect whatever shape the window is.
    const scale = Math.max(WORLD.w / src.width, WORLD.h / src.height);
    img.setPosition(WORLD.w / 2, WORLD.h / 2);
    img.setDisplaySize(src.width * scale, src.height * scale);
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

    const starters = ['grass_patch', 'moss_bed', 'fern_cluster', 'berry_bush', 'flowering_bush']
      .slice(0, this.settings.garden ?? 5);
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

  /**
   * Plants and structures, drawn in the same flat cut-paper language as the
   * bugs: filled shapes, no outlines, no gradients. They sit low and muted on
   * purpose — the photograph is the ground and the bugs are the subject, and
   * neither should have to compete with a garden marker.
   */
  drawGarden() {
    const g = this.plantLayer;
    g.clear();

    // Structures read as worked ground, not as buttons someone left on the
    // floor: damp earth first, then a wash of the category's colour. A solid
    // disc at full alpha looked like stray UI sitting on the photograph.
    for (const o of this.objects) {
      const r = Math.max(12, o.spec.footprint || 14);
      const reach = o.spec.radius ?? 0;
      if (reach > 0) g.fillStyle(PALETTE.ink, 0.045).fillCircle(o.x, o.y, reach);
      g.fillStyle(PALETTE.ink, 0.2).fillCircle(o.x, o.y, r * 1.25);
      g.fillStyle(CATEGORY_COLOUR[o.spec.category] ?? PALETTE.cream, 0.3)
        .fillCircle(o.x, o.y, r);
    }

    for (const p of this.bed?.plants ?? []) {
      if (p.state === 'seed') {
        g.fillStyle(PALETTE.ink, 0.5).fillCircle(p.x, p.y, 3.5);
        continue;
      }
      const wilt = p.wilt;
      // Wilting is a palette shift, not a label. You are supposed to notice it.
      const base = p.id.length % 2 ? PALETTE.leaf : PALETTE.leafDark;
      const col = wilt > 0.15 ? mixToward(base, PALETTE.wilt, Math.min(1, wilt)) : base;
      const blades = 3 + (p.id.length % 4);
      const len = (16 + 34 * p.scale) * (1 - wilt * 0.35);
      const w = 3 + p.scale * 4;

      // A leaf is a filled tapered shape, not a stroked line — mass at the
      // base and a point at the tip is what separates a drawn plant from a
      // bent polyline.
      for (let i = 0; i < blades; i++) {
        const a = -Math.PI / 2 + (i / blades - 0.5) * 1.7;
        const tx = p.x + Math.cos(a) * len;
        const ty = p.y + Math.sin(a) * len;
        const nx = Math.cos(a + Math.PI / 2) * w;
        const ny = Math.sin(a + Math.PI / 2) * w;
        g.fillStyle(col, 0.95);
        g.beginPath();
        g.moveTo(p.x - nx * 0.5, p.y - ny * 0.5);
        g.lineTo(p.x + nx * 0.5, p.y + ny * 0.5);
        g.lineTo(tx, ty);
        g.closePath();
        g.fillPath();
      }
      g.fillStyle(col, 1).fillCircle(p.x, p.y, w * 0.7);

      // A ripe yield is a berry you can see, which is the only reason to grow
      // a Berry Bush.
      if (p.pendingYield > 0) {
        g.fillStyle(PALETTE.red, 1).fillCircle(p.x, p.y - len * 0.62, 4.5);
        g.fillStyle(PALETTE.cream, 0.7).fillCircle(p.x - 1.4, p.y - len * 0.62 - 1.5, 1.6);
      }
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
    this.markDirty();
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
    if (back.length) { this.markDirty(); this.emitState(); }
  }

  /** Record a fight for both parties — this is how combat impressions unlock. */
  noteFight(winner, loser) {
    if (winner) this.knowledge.fought(winner.genome, { won: true });
    if (loser) this.knowledge.fought(loser.genome, { won: false });
    this.markDirty();
  }

  /* ---------------------------------------------------------- training --- */

  /**
   * The third channel. Watching and fighting were already wired; this is what
   * makes `Knowledge.trained()` fire, and `grip` is the only stat on it — you
   * cannot learn how well a bug plants itself by staring at it.
   *
   * A session is time spent inside a trainer's radius. Leaving resets it: a bug
   * that wanders past a Training Rock has not trained on it.
   */
  trainingTick(dt, alive) {
    if (!this.objects.length) return;
    for (const bug of alive) {
      const t = trainerAt(this.objects, bug.sprite.x, bug.sprite.y);
      if (!t) { bug.trainer = null; bug.trainT = 0; continue; }

      // An Obstacle Course has to be run, not stood in.
      if (t.spec.requiresTraversal) {
        const v = bug.sprite.body.velocity;
        if (Math.hypot(v.x, v.y) < 0.12) continue;
      }

      if (bug.trainer !== t.id) { bug.trainer = t.id; bug.trainT = 0; }
      bug.trainT += dt;
      if (bug.trainT < (t.spec.sessionSeconds ?? 45)) continue;

      bug.trainT = 0;
      this.knowledge.trained(bug.genome, `worked the ${t.spec.name.toLowerCase()}`);
      // The gain itself is non-genetic and lands on this instance only — a
      // Feeding Trough's wears off, a Training Rock's stays.
      bug.train(t.spec.trains, t.spec.temporary ? (t.spec.decaySeconds ?? 300) : 0);
      this.flash(bug.sprite.x, bug.sprite.y, 0xf2c23e, 20);
      this.markDirty();
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

  /**
   * Breed the CURRENT genomes into the next generation and respawn.
   *
   * `at` is where the breeding happens — the modifiers of whatever structures
   * cover that point are read HERE, at the moment the call runs. Nothing was
   * written onto any bug beforehand; that is the whole distinction the objects
   * doc draws between a rate multiplier and a gene write.
   */
  /** Bugs standing inside any object whose breeding spec carries `key`. */
  bugsInField(key) {
    const sources = this.objects.filter((o) => o.spec.breeding?.[key]);
    if (!sources.length) return [];
    const inside = (o, b) => {
      const r = o.spec.radius ?? 0;
      return r > 0 && (o.x - b.sprite.x) ** 2 + (o.y - b.sprite.y) ** 2 <= r * r;
    };
    return this.bugs
      .map((b, i) => (sources.some((o) => inside(o, b)) ? i : -1))
      .filter((i) => i >= 0);
  }

  breed(opts = {}) {
    const genomes = this.bugs.map((b) => b.genome);
    if (!genomes.length) return null;
    const at = opts.at ?? { x: this.terrariumBounds.centerX, y: this.terrariumBounds.centerY };
    const mods = breedingModifiers(this.objects, at.x, at.y);
    const dominant = this.bugs[0]?.classification ?? null;

    // A Pollen Bloom gates breeding on a trait; a Cave waives every gate. Only
    // the scene knows which bug is standing where, so eligibility is decided
    // here and handed down as indices.
    let eligible = null;
    if (mods.requires && !mods.universal) {
      const want = String(mods.requires).toLowerCase();
      eligible = this.bugs
        .map((b, i) => ((b.classification?.traits ?? [])
          .some((t) => String(t).toLowerCase().includes(want)) ? i : -1))
        .filter((i) => i >= 0);
    }

    // The Nest bonds whoever is actually in it — two bugs, no tournament.
    const nested = mods.bypassSelection ? this.bugsInField('bypassSelection') : [];
    const pair = nested.length >= 2 ? [genomes[nested[0]], genomes[nested[1]]] : null;

    // A well-planted plot supports a bigger brood; a starved one supports fewer.
    const brood = Math.max(4, Math.min(30, Math.round(this.popSize * mods.growthRate)));

    const { population, report } = breedGeneration(genomes, {
      preset: this.preset,
      rng: this.rng,
      size: brood,
      rate: mods.rate,
      mutationScale: 0.10 * mods.mutationScale,
      selection: mods.selection,
      fitnessBonus: mods.fitnessBonus,
      favoured: mods.fitnessBonus ? this.bugsInField('fitnessBonus') : [],
      eligible,
      bypassSelection: Boolean(pair),
      pair,
      // The lineage holds its own identity genes steady — that is what a taxon
      // IS, and it applies whether or not anything is placed nearby. A Prism
      // Chamber goes one step further and pins the loosened genes too.
      locked: dominant?.locks ?? [],
      unlocked: mods.lockChoices > 0 ? [] : (dominant?.unlocks ?? []),
      ...opts,
    });

    // A refusal is a real outcome, not a silent no-op: the generation does not
    // advance and the pool is left exactly as it was.
    this.breedNote = report.refused ?? null;
    if (report.refused) { this.emitState(); return report; }

    this.generation++;
    this.history.push({ gen: this.generation, ...report });
    this.spawnGeneration(population);
    this.markDirty();
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
    this.markDirty();
    return last;
  }

  reseed(seed) {
    this.seed = seed ?? Math.floor(Math.random() * 1e9);
    this.rng = makeRng(this.seed);
    this.generation = 0;
    this.history = [];
    this.spawnGeneration(seededPopulation(this.popSize, this.rng));
    this.breedNote = null;
    this.markDirty();
    return this.seed;
  }

  onBugDown(bug) {
    bug.sprite.setAlpha(0.35);
    bug.sprite.setStatic(true);
    this.flash(bug.sprite.x, bug.sprite.y, PALETTE.red, 26);
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
    this.trainingTick(dt, alive);

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
      // A chunky ring in the terrarium's own cream, not a hairline highlight.
      this.fxLayer.lineStyle(3.5, PALETTE.cream, 0.95);
      this.fxLayer.strokeCircle(this.selected.sprite.x, this.selected.sprite.y, this.selected.radius + 10);
    }

    // ambient light overlay — the day/night cycle you can actually see
    const e = this.env;
    this.lightLayer.clear();
    this.lightLayer.fillStyle((e.rgb[0] << 16) | (e.rgb[1] << 8) | e.rgb[2], e.darkness * 0.5);
    this.lightLayer.fillRect(0, 0, WORLD.w, WORLD.h);

    this.hudTick = (this.hudTick ?? 0) + dt;
    if (this.hudTick > 0.2) { this.hudTick = 0; this.emitState(); }

    // Watching is itself progress — the knowledge record moves every frame —
    // so the run is worth keeping even when nothing was clicked.
    this.watchedFor = (this.watchedFor ?? 0) + dt;
    if (this.watchedFor > 10) { this.watchedFor = 0; this.markDirty(); }
    this.autosave.tick(dt);
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
      // Whether this run is being kept, and whether it was picked back up.
      persists: this.persists,
      resumed: this.resumed,
      breedNote: this.breedNote ?? null,
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
