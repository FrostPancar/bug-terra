// The part catalogue.
//
// `bugArt.js` knows how to draw a bug. Nothing else knew WHAT it draws, which
// meant the only way to find out whether `spine_density` put anything on the
// sprite was to read 800 lines of canvas code. This module is that answer,
// written down once: every part the renderer can produce, the genes that drive
// it, and the exact threshold at which it appears.
//
// Two rules keep it honest:
//
//   1. Every `gate` here is the real expression from bugArt.js, not a rounded
//      version of it. `tests/parts.test.js` renders across each gate and fails
//      if the sprite doesn't actually change where this file says it does.
//   2. A gene that feeds stats but puts nothing on the sprite is marked
//      `art: false` and says what it really does instead. The builder shows
//      that badge rather than implying the slider is doing something visible.
//
// This is a description of the renderer, so it lives beside the renderer. It
// imports nothing but genes and the kind tables — no simulation, no world.

import { GENE_SPECS, normalizeGenome } from '../core/genes.js';
import { HORN_TYPES, WING_TYPES, EYE_TYPES, MANDIBLE_TYPES, bodyPlan } from './bugArt.js';

/* ------------------------------------------------------------- constants -- */

/** The renderer's three skeletons. Derived from genes, never stored. */
export const BODY_PLANS = ['insect', 'arachnid', 'myriapod'];

/** bugArt's SWATCHES table — `hue` indexes it, it is not a continuous wheel. */
export const SWATCH_NAMES = [
  'vermilion', 'orange', 'amber', 'yellow', 'leaf', 'jade',
  'teal', 'cobalt', 'periwinkle', 'violet', 'magenta', 'rose',
];

export const PART_GROUPS = [
  { key: 'body',    label: 'Body',     blurb: 'the masses everything else mounts on' },
  { key: 'limbs',   label: 'Limbs',    blurb: 'legs and what is on the end of them' },
  { key: 'wings',   label: 'Wings',    blurb: 'four kinds fan, one kind covers' },
  { key: 'weapons', label: 'Weapons',  blurb: 'the front end and the back end' },
  { key: 'sensory', label: 'Sensory',  blurb: 'eyes and antennae' },
  { key: 'surface', label: 'Surface',  blurb: 'colour, speckle, fur' },
];

/* ----------------------------------------------------------------- parts -- */

const variants = (names, blurbs) =>
  names.map((name, index) => ({ index, name, blurb: blurbs[index] ?? '' }));

/**
 * @typedef {object} Part
 * @property {string} id
 * @property {string} group
 * @property {string} name
 * @property {string} blurb
 * @property {boolean} [core]      always on the bug; cannot be removed
 * @property {boolean} [art]       false = feeds stats only, draws nothing
 * @property {string} [gate]       the literal condition from bugArt.js
 * @property {string} [drawnBy]    the function in bugArt.js that renders it
 * @property {(g: object) => boolean} [present]
 * @property {object|((g:object)=>object)} [on]   patch that adds the part
 * @property {object|((g:object)=>object)} [off]  patch that removes it
 * @property {string} [variantGene]
 * @property {{index:number,name:string,blurb:string}[]} [variants]
 * @property {{zoom:number,y:number}|null} [focus]  how a thumbnail should frame it
 * @property {{gene:string,effect:string}[]} genes
 */

/** @type {Part[]} */
export const PARTS = [
  /* ---------------------------------------------------------------- body -- */
  {
    id: 'plan',
    group: 'body',
    name: 'Body plan',
    blurb: 'Which skeleton gets built. Not a gene — the renderer reads it off leg count and length.',
    core: true,
    drawnBy: 'bodyPlan() → buildTrunk()',
    gate: 'leg_count ≥ 8 && body_length > 0.70 → myriapod · leg_count ≥ 8 → arachnid · else insect',
    variantGene: null,
    variants: variants(BODY_PLANS, [
      'head + thorax + abdomen, legs on the thorax',
      'cephalothorax + abdomen, four leg pairs up front',
      'head + 6–10 repeating segments, one leg pair each',
    ]),
    variantOf: (g) => BODY_PLANS.indexOf(bodyPlan(g)),
    setVariant: (g, i) => {
      if (i === 2) return { leg_count: 10, body_length: Math.max(g.body_length, 0.82) };
      if (i === 1) return { leg_count: 8, body_length: Math.min(g.body_length, 0.62) };
      return { leg_count: 6 };
    },
    genes: [
      { gene: 'leg_count', effect: '8 or 10 legs leave the insect skeleton entirely' },
      { gene: 'body_length', effect: 'past 0.70 an eight-legger becomes a myriapod instead' },
    ],
  },
  {
    id: 'abdomen',
    group: 'body',
    name: 'Abdomen',
    blurb: 'The rear mass. On a myriapod it is the repeating segments instead.',
    core: true,
    drawnBy: 'buildTrunk() → the abdomen ellipse',
    genes: [
      { gene: 'body_length', effect: 'length of the ellipse (capped so it can never go planky)' },
      { gene: 'body_width', effect: 'width of every trunk mass at once' },
      { gene: 'abdomen_taper', effect: 'squeezes the abdomen narrower, 0 round → 1 pointed' },
      { gene: 'body_segments', effect: 'stretches the whole body through morphology(): 4 segments draw longer than 2, and the legs scale with it' },
    ],
  },
  {
    id: 'thorax',
    group: 'body',
    name: 'Thorax',
    blurb: 'The middle mass the legs hang off. An arachnid fuses it into the cephalothorax.',
    core: true,
    drawnBy: 'buildTrunk() → the thorax ellipse',
    genes: [
      { gene: 'thorax_ratio', effect: 'trades thorax size against abdomen (insect plan only)' },
      { gene: 'body_width', effect: 'sets the base radius' },
    ],
  },
  {
    id: 'head',
    group: 'body',
    name: 'Head',
    blurb: 'The capsule the eyes tuck under and the horn, jaws and antennae mount on.',
    core: true,
    drawnBy: 'buildHead()',
    genes: [
      { gene: 'head_size', effect: 'capsule radius, 0.36–0.48 of body width (ignored on arachnids)' },
      { gene: 'body_width', effect: 'the width the head radius is a fraction of' },
    ],
  },
  {
    id: 'segments',
    group: 'body',
    name: 'Trunk segments',
    blurb: 'Myriapods only: 6 to 10 repeating rings, each carrying its own leg pair.',
    drawnBy: 'buildTrunk() — myriapod branch',
    gate: 'body plan is myriapod; count = clamp(round(6 + body_length × 4), 6, 10)',
    present: (g) => bodyPlan(g) === 'myriapod',
    on: (g) => ({ leg_count: 10, body_length: Math.max(g.body_length, 0.82) }),
    off: { leg_count: 6 },
    genes: [
      { gene: 'body_length', effect: 'how many segments, 6 at 0.0 → 10 at 1.0' },
      { gene: 'leg_count', effect: 'must be 8+ to reach the myriapod skeleton at all' },
    ],
  },

  /* --------------------------------------------------------------- limbs -- */
  {
    id: 'legs',
    group: 'limbs',
    name: 'Legs',
    blurb: 'Capsules: one uniform width, round caps, a single arc. Never tapered, never jointed.',
    core: true,
    drawnBy: 'buildLegs() → drawLegs()',
    gate: 'pairs = leg_count / 2 — except a myriapod, which gets one pair per segment',
    genes: [
      { gene: 'leg_count', effect: 'how many pairs, and past 8 which skeleton gets built' },
      { gene: 'leg_length', effect: 'reach, 0.80–1.40 of the body unit (halved on myriapods)' },
      { gene: 'leg_thickness', effect: 'capsule width, 2.6px floor so it never reads as hair' },
      { gene: 'leg_spread', effect: 'how far the fan splays front to back' },
      { gene: 'leg_joints', effect: 'grip and speed — the art draws one arc either way', art: false },
    ],
  },
  {
    id: 'claws',
    group: 'limbs',
    name: 'Tarsal claws',
    blurb: 'A short hooked capsule on the end of each leg.',
    drawnBy: 'drawLegs() → the second capsule',
    gate: 'claw_size > 0.30',
    present: (g) => g.claw_size > 0.30,
    on: { claw_size: 0.72 },
    off: { claw_size: 0.15 },
    genes: [
      { gene: 'claw_size', effect: 'hook length, and the main grip input' },
      { gene: 'leg_thickness', effect: 'claws are drawn at 0.55 of the leg width' },
    ],
  },

  /* --------------------------------------------------------------- wings -- */
  {
    id: 'wings',
    group: 'wings',
    name: 'Wings',
    blurb: 'Slim blades fanned back from the rear mass. Elytra are the exception: they lie on the shell.',
    drawnBy: 'drawSoftWings() / drawElytra()',
    gate: 'wing_count > 0 && wing_area > 0.05',
    present: (g) => g.wing_count > 0 && g.wing_area > 0.05,
    on: { wing_count: 4, wing_area: 0.72, wing_beat: 0.6 },
    off: { wing_count: 0, wing_area: 0 },
    variantGene: 'wing_type',
    variants: variants(WING_TYPES, [
      'two blades a side, medium spread',
      'hard covers laid over the abdomen — no fan at all',
      'two wide blades a side',
      'three slim blades a side',
      'four narrow blades a side, the widest fan',
    ]),
    genes: [
      { gene: 'wing_count', effect: '0 / 2 / 4 — zero means flightless, whatever the area' },
      { gene: 'wing_type', effect: 'blade count and spread; elytra swap to shell covers' },
      { gene: 'wing_area', effect: 'blade length, and how much of the abdomen elytra cover' },
      { gene: 'wing_beat', effect: 'flap rate — only visible in the walk and attack states' },
    ],
  },

  /* ------------------------------------------------------------- weapons -- */
  {
    id: 'horn',
    group: 'weapons',
    name: 'Horn',
    blurb: 'Tapered filled curves off the front of the head — mass at the base, a point at the tip.',
    drawnBy: 'drawHorn()',
    gate: 'horn_size ≥ 0.12',
    present: (g) => g.horn_size >= 0.12,
    on: { horn_size: 0.78 },
    off: { horn_size: 0 },
    variantGene: 'horn_type',
    variants: variants(HORN_TYPES, [
      'one heavy blade curving forward',
      'a shared column splitting into two hooked arms',
      'a long clean snout, barely tapering',
      'three prongs, the middle one longest',
      'paired bull horns sweeping out and up',
    ]),
    genes: [
      { gene: 'horn_size', effect: 'length, 0.26–1.15 of the body unit depending on kind' },
      { gene: 'horn_type', effect: 'which of the five shapes gets drawn' },
      { gene: 'head_size', effect: 'the horn is anchored to the head edge and scales off it' },
    ],
  },
  {
    id: 'mandibles',
    group: 'weapons',
    name: 'Mandibles',
    blurb: 'A pair at the mouth that swings open in the attack state.',
    drawnBy: 'drawMandibles()',
    gate: 'mandible_size ≥ 0.10',
    present: (g) => g.mandible_size >= 0.10,
    on: { mandible_size: 0.75 },
    off: { mandible_size: 0 },
    variantGene: 'mandible_type',
    variants: variants(MANDIBLE_TYPES, [
      'a fat comma curving in, mass at the base',
      'straight tapered spikes angling out',
      'long slender arms hooking hard inward',
      'two soft rounded lobes — barely a weapon',
    ]),
    genes: [
      { gene: 'mandible_size', effect: 'jaw length as a fraction of head radius' },
      { gene: 'mandible_type', effect: 'which of the four shapes gets drawn' },
      { gene: 'mandible_serration', effect: 'multiplies the bite stat — nothing on the sprite', art: false },
    ],
  },
  {
    id: 'tail',
    group: 'weapons',
    name: 'Tail',
    blurb: 'Cerci or metasoma trailing off the rear mass. A plain capsule until a stinger loads it.',
    drawnBy: 'drawTail()',
    gate: 'tail_length × 0.44 > 0.08  →  tail_length > 0.182',
    present: (g) => g.tail_length * 0.44 > 0.08,
    on: { tail_length: 0.6 },
    off: { tail_length: 0 },
    genes: [
      { gene: 'tail_length', effect: 'reach, up to 0.44 of the body unit' },
      { gene: 'stinger_size', effect: 'past 0.18 the capsule becomes a solid kite' },
    ],
  },
  {
    id: 'stinger',
    group: 'weapons',
    name: 'Stinger',
    blurb: 'Turns the tail into a solid kite and is the only source of venom.',
    drawnBy: 'drawTail() — the kite branch',
    gate: 'stinger_size > 0.18, and the tail must be drawn at all',
    present: (g) => g.stinger_size > 0.18 && g.tail_length * 0.44 > 0.08,
    on: (g) => ({ stinger_size: 0.85, tail_length: Math.max(g.tail_length, 0.5) }),
    off: { stinger_size: 0 },
    genes: [
      { gene: 'stinger_size', effect: 'kite width; below 0.08 venom is exactly 0' },
      { gene: 'tail_length', effect: 'how far the kite reaches back' },
    ],
  },
  {
    id: 'spines',
    group: 'weapons',
    name: 'Defensive spines',
    blurb: 'Feeds defense and the Centipede and Millipede windows. The renderer has no art for it yet.',
    art: false,
    gate: 'never drawn — spine_density reaches stats and classification only',
    present: (g) => g.spine_density >= 0.45,
    on: { spine_density: 0.8 },
    off: { spine_density: 0.1 },
    genes: [
      { gene: 'spine_density', effect: 'raises defense; required ≥ 0.65 for Centipede, ≥ 0.70 for Millipede', art: false },
    ],
  },

  /* ------------------------------------------------------------- sensory -- */
  {
    id: 'eyes',
    group: 'sensory',
    name: 'Eyes',
    blurb: 'Big and set wide, drawn UNDER the head so its edge crops them.',
    core: true,
    drawnBy: 'drawEyes()',
    gate: 'the iris only appears when saturation > 0.35 (and never on compound eyes)',
    variantGene: 'eye_type',
    variants: variants(EYE_TYPES, [
      'pointed at both ends — the leaf shape',
      'a plain circle',
      'round at the inner end, drawn to a point at the outer',
      'one big lens plus a rim of ommatidia, no iris',
    ]),
    genes: [
      { gene: 'eye_size', effect: 'radius, 0.62–0.88 of head radius' },
      { gene: 'eye_type', effect: 'which of the four shapes gets drawn' },
      { gene: 'eye_count', effect: 'pairs past the first are drawn as small dark ocelli' },
      { gene: 'saturation', effect: 'above 0.35 the eye gains a coloured iris and pupil' },
    ],
  },
  {
    id: 'ocelli',
    group: 'sensory',
    name: 'Extra eyes',
    blurb: 'Every pair past the first lands on the head as a small dark dot. Three extra pairs is the ceiling.',
    drawnBy: 'buildHead() → the minor eyes',
    gate: 'eye_count ≥ 4  (extra pairs = clamp(round(eye_count / 2) − 1, 0, 3))',
    present: (g) => g.eye_count >= 4,
    on: { eye_count: 8 },
    off: { eye_count: 2 },
    genes: [
      { gene: 'eye_count', effect: '4 → one extra pair, 6 → two, 8 → three. Also +11% vision each pair' },
      { gene: 'eye_size', effect: 'ocelli are drawn at 0.17 of the main eye radius' },
    ],
  },
  {
    id: 'antennae',
    group: 'sensory',
    name: 'Antennae',
    blurb: 'A pair of thin capsules off the head that wag with the animation phase.',
    drawnBy: 'drawAntennae()',
    gate: 'antenna_length > 0.104  (the length has to clear 0.15 of the body unit)',
    present: (g) => 0.10 + g.antenna_length * 0.48 > 0.15,
    on: { antenna_length: 0.7 },
    off: { antenna_length: 0 },
    genes: [
      { gene: 'antenna_length', effect: 'reach, 0.10–0.58 of the body unit' },
      { gene: 'head_size', effect: 'antennae anchor to the head edge' },
    ],
  },

  /* ------------------------------------------------------------- surface -- */
  {
    id: 'colour',
    group: 'surface',
    name: 'Shell colour',
    blurb: 'Twelve poster-flat swatches. `hue` picks one — it is an index, not a continuous wheel.',
    core: true,
    drawnBy: 'palette()',
    gate: 'swatch = floor(hue × 12)',
    variantGene: 'hue',
    variants: SWATCH_NAMES.map((name, index) => ({ index, name, blurb: `swatch ${index}` })),
    variantOf: (g) => Math.floor(Math.min(0.999, Math.max(0, g.hue)) * SWATCH_NAMES.length),
    setVariant: (_g, i) => ({ hue: (i + 0.5) / SWATCH_NAMES.length }),
    genes: [
      { gene: 'hue', effect: 'picks one of the twelve swatches' },
      { gene: 'saturation', effect: 'scales the swatch 0.80–1.15×, and gates the iris at 0.35' },
      { gene: 'lightness', effect: 'scales the swatch 0.86–1.16×' },
    ],
  },
  {
    id: 'inklimbs',
    group: 'surface',
    name: 'Ink limbs',
    blurb: 'Legs, antennae and tail go near-black instead of a deep tone of the body.',
    drawnBy: 'palette() → col.limb',
    gate: 'pattern > 0.5',
    present: (g) => g.pattern > 0.5,
    on: { pattern: 0.8 },
    off: { pattern: 0.2 },
    genes: [
      { gene: 'pattern', effect: 'the only thing this gene changes on the sprite: black limbs or not' },
      { gene: 'pattern_scale', effect: 'no art. Reaches nothing but breeding drift right now', art: false },
      { gene: 'pattern_contrast', effect: 'no art, but Firefly, Ladybird and Butterfly all window on it', art: false },
    ],
  },
  {
    id: 'setae',
    group: 'surface',
    name: 'Setae',
    blurb: 'A fringe of short capsules radiating off the abdomen.',
    drawnBy: 'drawSetae()',
    gate: 'setae ≥ 0.35',
    present: (g) => g.setae >= 0.35,
    on: { setae: 0.85 },
    off: { setae: 0 },
    genes: [
      { gene: 'setae', effect: 'count (10–26) and length of the fringe; also helps camouflage' },
      { gene: 'body_width', effect: 'setae are drawn off the abdomen rim, so they scale with it' },
    ],
  },
  {
    id: 'speckle',
    group: 'surface',
    name: 'Iridescent speckle',
    blurb: 'Fine granular scatter in the accent colour. Not glitter — a dusting.',
    drawnBy: 'speckle() / speckleLimb()',
    gate: 'iridescence ≥ 0.28 on the shell, ≥ 0.34 on the limbs',
    present: (g) => g.iridescence >= 0.28,
    on: { iridescence: 0.75 },
    off: { iridescence: 0 },
    genes: [
      { gene: 'iridescence', effect: '90–290 specks by amount; costs camouflage in the stat block' },
      { gene: 'hue', effect: 'the speck colour is the complement of the shell hue' },
    ],
  },
];

/**
 * How a thumbnail frames each part. The pose is head-up and drawBug() centres on
 * the origin, so `zoom` is a scale about that centre and `y` slides the bug down
 * — positive brings the head into frame, negative brings the tail. Without this
 * a horn is four pixels of a full-body tile and every part looks the same.
 *
 * null means the part IS the whole silhouette; frame all of it.
 */
const FOCUS = {
  plan: null, colour: null, spines: null,
  abdomen:   { zoom: 1.45, y: -0.26 },
  thorax:    { zoom: 2.00, y: 0.02 },
  head:      { zoom: 2.40, y: 0.46 },
  segments:  { zoom: 1.12, y: 0 },
  legs:      { zoom: 1.15, y: 0 },
  claws:     { zoom: 1.50, y: -0.10 },
  wings:     { zoom: 1.12, y: -0.14 },
  horn:      { zoom: 3.00, y: 0.62 },
  mandibles: { zoom: 3.00, y: 0.52 },
  tail:      { zoom: 1.95, y: -0.44 },
  stinger:   { zoom: 2.10, y: -0.48 },
  eyes:      { zoom: 3.00, y: 0.50 },
  ocelli:    { zoom: 3.10, y: 0.54 },
  antennae:  { zoom: 2.20, y: 0.56 },
  inklimbs:  { zoom: 1.30, y: 0 },
  setae:     { zoom: 1.55, y: -0.24 },
  speckle:   { zoom: 1.75, y: -0.12 },
};

for (const part of PARTS) part.focus = FOCUS[part.id] ?? null;

export const PART_IDS = PARTS.map((p) => p.id);

const BY_ID = Object.fromEntries(PARTS.map((p) => [p.id, p]));

export function partById(id) {
  return BY_ID[id] ?? null;
}

export function partsInGroup(key) {
  return PARTS.filter((p) => p.group === key);
}

/* --------------------------------------------------------------- editing -- */

const patchOf = (v, g) => (typeof v === 'function' ? v(g) : v ?? {});

/** Is this part on the sprite right now? Core parts always are. */
export function isPresent(part, genome) {
  if (!part) return false;
  if (part.core) return true;
  return Boolean(part.present?.(genome));
}

/** Genome + patch, re-normalized. Never mutates its argument. */
export function applyPatch(genome, patch) {
  return normalizeGenome({ ...genome, ...patch });
}

/** Tap-to-add: the smallest patch that makes the part appear. */
export function addPart(genome, id) {
  const part = partById(id);
  if (!part || part.core) return normalizeGenome(genome);
  return applyPatch(genome, patchOf(part.on, genome));
}

export function removePart(genome, id) {
  const part = partById(id);
  if (!part || part.core) return normalizeGenome(genome);
  return applyPatch(genome, patchOf(part.off, genome));
}

export function togglePart(genome, id) {
  const part = partById(id);
  if (!part || part.core) return normalizeGenome(genome);
  return isPresent(part, genome) ? removePart(genome, id) : addPart(genome, id);
}

/** Which variant of a part a genome currently carries. */
export function variantOf(part, genome) {
  if (!part?.variants) return -1;
  if (part.variantOf) return part.variantOf(genome);
  return Math.round(genome[part.variantGene] ?? 0);
}

/** Switch a part's kind, keeping everything else about it. */
export function setVariant(genome, id, index) {
  const part = partById(id);
  if (!part?.variants) return normalizeGenome(genome);
  const i = Math.max(0, Math.min(part.variants.length - 1, Math.round(index)));
  const patch = part.setVariant
    ? part.setVariant(genome, i)
    : { [part.variantGene]: i };
  return applyPatch(genome, patch);
}

/* ------------------------------------------------- the reverse direction -- */

/**
 * Genes that never reach the renderer, and what they actually do instead. Read
 * off `stats.js` and `classification.js` so the builder can say "this slider
 * moves numbers, not pixels" rather than leaving the player to wonder.
 */
export const SIM_ONLY = {
  body_mass: 'density → mass. Raises attack, drags speed and agility, slows recovery.',
  carapace_thickness: 'the single biggest defense input, and it costs agility.',
  leg_joints: 'a third joint improves grip, which gates speed.',
  mandible_serration: 'multiplies the bite in the attack formula.',
  spine_density: 'adds to defense. Required by the Centipede and Millipede windows.',
  metabolism: 'burn rate: high recovery, low stamina.',
  aggression: 'biases the AI state machine only. It is not a combat stat.',
  pattern_scale: 'nothing yet — it is carried through breeding and read by no formula.',
  pattern_contrast: 'no art, but Firefly, Ladybird and Butterfly all window on it.',
  translucency: 'helps camouflage. The renderer does not draw see-through cuticle yet.',
};

/**
 * gene → every part it touches. Built once, so the parameter panel can answer
 * "what does this slider move" for all 41 genes without a search.
 */
export const GENE_INFO = (() => {
  const map = {};
  for (const gene of Object.keys(GENE_SPECS)) {
    map[gene] = { gene, spec: GENE_SPECS[gene], parts: [], simOnly: SIM_ONLY[gene] ?? null };
  }
  for (const part of PARTS) {
    for (const entry of part.genes) {
      const row = map[entry.gene];
      if (!row) continue;                       // a typo here should be loud in tests
      row.parts.push({
        partId: part.id,
        partName: part.name,
        effect: entry.effect,
        art: entry.art !== false && part.art !== false,
      });
    }
  }
  return map;
})();

/** Every part a gene shows up in — the panel's "this slider moves…" line. */
export function partsForGene(gene) {
  return GENE_INFO[gene]?.parts ?? [];
}

/** True when a gene puts nothing at all on the sprite. */
export function isSimOnly(gene) {
  const row = GENE_INFO[gene];
  if (!row) return false;
  return !row.parts.some((p) => p.art);
}
