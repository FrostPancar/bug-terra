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
import { HORN_TYPES, WING_TYPES, EYE_FILLS, CROWN_MARKS, MANDIBLE_TYPES, bodyPlan } from './bugArt.js';

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
  { key: 'wings',   label: 'Wings',    blurb: 'three silhouettes fan, one kind covers' },
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
    gate: 'leg_count ≥ 8 && body_segments ≥ 6 → myriapod · leg_count ≥ 8 → arachnid · else insect',
    variantGene: null,
    variants: variants(BODY_PLANS, [
      'head + thorax + abdomen, legs on the thorax',
      'cephalothorax + abdomen, four leg pairs up front',
      'head + 6–10 repeating segments, one leg pair each',
    ]),
    variantOf: (g) => BODY_PLANS.indexOf(bodyPlan(g)),
    setVariant: (g, i) => {
      if (i === 2) return { leg_count: 10, body_segments: Math.max(g.body_segments, 6) };
      if (i === 1) return { leg_count: 8, body_segments: Math.min(g.body_segments, 3) };
      return { leg_count: 6 };
    },
    genes: [
      { gene: 'leg_count', effect: '8+ legs leave the insect skeleton entirely' },
      { gene: 'body_segments', effect: 'at 6+ an eight-legger becomes a myriapod instead' },
    ],
  },
  {
    id: 'abdomen',
    group: 'body',
    name: 'Abdomen',
    blurb: 'The rear mass, built from every trunk segment past the thorax. A one-segment bug has none at all.',
    drawnBy: 'buildTrunk() → the abdominal segment chain',
    gate: 'body_segments ≥ 2  (segment 1 is the thorax; the head is not a segment)',
    present: (g) => g.body_segments >= 2,
    on: { body_segments: 3 },
    off: { body_segments: 1 },
    genes: [
      { gene: 'body_segments', effect: 'how many abdominal segments: count − 1. At 1 there is no abdomen at all' },
      { gene: 'abdomen_width', effect: 'lateral half-axis of every abdominal segment, 0.22–1.00 of body width. Touches no other mass' },
      { gene: 'abdomen_length', effect: 'along-the-body half-axis, 0.22–1.00 of body width — the chain gets longer, not wider' },
      { gene: 'body_width', effect: 'the overall scale the abdomen\'s two axes are fractions of' },
      { gene: 'abdomen_taper', effect: 'squeezes the abdomen narrower, 0 round → 1 pointed, and tapers the chain to its tip' },
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
      { gene: 'thorax_width', effect: 'lateral half-axis, 0.16–0.70 of body width (× 1.334 on the arachnid plan)' },
      { gene: 'thorax_length', effect: 'along-the-body half-axis, same range — and it moves where the head mounts, since the head sits off the thorax\'s front edge' },
      { gene: 'body_width', effect: 'the overall scale both thorax axes are fractions of' },
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
      { gene: 'head_width', effect: 'lateral half-axis, 0.12–0.80 of body width (× 1.36 on the arachnid plan). Also where the eyes sit laterally' },
      { gene: 'head_length', effect: 'along-the-body half-axis, same range. Also how far the head stands off the thorax' },
      { gene: 'body_width', effect: 'the overall scale both head axes are fractions of' },
    ],
  },
  {
    id: 'segments',
    group: 'body',
    name: 'Trunk segments',
    blurb: 'Myriapods only: 6 to 10 repeating rings, each carrying its own leg pair.',
    drawnBy: 'buildTrunk() — myriapod branch',
    gate: 'body plan is myriapod (leg_count ≥ 8 && body_segments ≥ 6); count = clamp(body_segments, 6, 10)',
    present: (g) => bodyPlan(g) === 'myriapod',
    on: (g) => ({ leg_count: 10, body_segments: Math.max(g.body_segments, 8) }),
    off: { leg_count: 6, body_segments: 2 },
    genes: [
      { gene: 'body_segments', effect: 'one ring per segment, 6 to 10' },
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
      { gene: 'leg_length', effect: 'reach, 0.55–1.85 of the body unit (halved on myriapods)' },
      { gene: 'leg_thickness', effect: 'capsule width, 2.2px floor so it never reads as hair' },
      { gene: 'leg_spread', effect: 'how far the fan splays front to back' },
      { gene: 'leg_joints', effect: 'grip and speed — the art draws one arc either way', art: false },
    ],
  },
  {
    id: 'feet',
    group: 'limbs',
    name: 'Feet',
    blurb: 'A round pad on the tip of every leg, in the leg\'s own colour. '
         + 'Always present and always the same size — there is no foot gene any more.',
    core: true,
    drawnBy: 'drawLegs() → the foot circle at leg.foot',
    gate: 'always, at a fixed 0.95 of the leg width (FOOT_PAD_R)',
    genes: [
      { gene: 'leg_thickness', effect: 'the only thing that changes a foot: the pad is a fixed 0.95 of the leg width, so a thicker leg is the only way to a bigger foot' },
    ],
  },

  /* --------------------------------------------------------------- wings -- */
  {
    id: 'wings',
    group: 'wings',
    name: 'Wings',
    blurb: 'One blade per wing, swept back off the thorax, drawn above everything else. Three silhouettes — leaf, oval, crescent — picked by proportion, not by a type gene. Elytra are the exception: they lie on the shell.',
    drawnBy: 'drawSoftWings() / drawElytra()',
    gate: 'wing_count > 0 && wing_area > 0.05',
    present: (g) => g.wing_count > 0 && g.wing_area > 0.05,
    on: { wing_count: 4, wing_area: 0.72, wing_beat: 0.6 },
    off: { wing_count: 0, wing_area: 0 },
    variantGene: 'wing_type',
    variants: variants(WING_TYPES, [
      'soft blades — the silhouette comes from the shape coefficient, not from here',
      'hard covers laid over the abdomen — no blades at all',
    ]),
    genes: [
      { gene: 'wing_count', effect: '0 / 2 / 4 / 6 — one blade a side per pair; zero means flightless, whatever the area' },
      { gene: 'wing_type', effect: 'soft membranous blades, or hard elytra covers — structure only, never the blade shape' },
      { gene: 'wing_area', effect: 'overall wing size: scales length and width together (0.62–1.30), and how much of the abdomen elytra cover' },
      { gene: 'wing_length', effect: 'blade length along its own axis, 0.85–2.30 of the body unit' },
      { gene: 'wing_width', effect: 'blade half-width as 0.09–0.52 of its length — aspect ratio, never length' },
      { gene: 'wing_roundness', effect: 'blunt vs. finely tapered tip; moves the outline only, never the size' },
      { gene: 'wing_angle', effect: 'resting sweep off the body axis. The gene reaches 0.7–1.0 only, i.e. 126°–165°; its 0.85 default renders 145.5°. Walking and attacking subtract 0.3, swinging the blades forward to 87°–126° to beat' },
      { gene: 'wing_tip_hue', effect: '0 = white tip wash; 1–10 pick a reference-palette swatch instead' },
      { gene: 'wing_beat', effect: 'flap rate — only visible in the walk and attack states' },
    ],
    /**
     * SHAPE COEFFICIENT — the blade silhouette is derived, not selected. Must
     * stay literally in step with wingShapeCoefficient() in bugArt.js.
     */
    derived: {
      name: 'wing shape',
      gate: 'clamp(0.5 + 0.50 * wing_length - 0.70 * wing_width - 0.30 * wing_roundness, 0, 1)',
      buckets: [
        { name: 'leaf', gate: '< 0.34', blurb: 'broad and rounded, widest past mid-length, blunt tip' },
        { name: 'oval', gate: '< 0.62', blurb: 'shorter and narrower, near-symmetric, blunt both ends' },
        { name: 'crescent', gate: '>= 0.62', blurb: 'long thin blade bowed backward to a fine curved point' },
      ],
    },
  },

  /* ------------------------------------------------------------- weapons -- */
  {
    id: 'horn',
    group: 'weapons',
    name: 'Horn',
    blurb: 'Tapered filled curves off the REAR OF THE HEAD — mass at the base, a point at the tip. Drawn under the trunk, so the thorax buries the root and the horn reads as growing out of the head/thorax junction rather than resting on it.',
    drawnBy: 'drawHorn()',
    gate: 'horn_size ≥ 0.12',
    present: (g) => g.horn_size >= 0.12,
    on: { horn_size: 0.78 },
    off: { horn_size: 0 },
    variantGene: 'horn_type',
    variants: variants(HORN_TYPES, [
      'one straight central spike, wide at the base — the plainest horn',
      'paired horns curling back in over a tight U of empty space',
      'a stem forking into two outward-hooking arms',
      'the big one: heavy base, the widest sweep, tips hooking in',
      'three prongs, the middle one longest',
    ]),
    genes: [
      { gene: 'horn_size', effect: 'length, 0.18–1.55 of the body unit depending on kind' },
      { gene: 'horn_type', effect: 'which of the five shapes gets drawn' },
      { gene: 'pattern_horn', effect: 'flat / gradient / dots / oval / diagonal surface treatment on the horn fill — its own gene, independent of the jaws' },
      { gene: 'pattern_horn_hue', effect: 'which of the ten reference-palette swatches the decoration tone is drawn from — independent of the body\'s own hue' },
      { gene: 'pattern_scale', effect: 'gradient: where the light/dark transition sits along the horn\'s long axis. dots: dot size and count. diagonal: stripe pitch. Shared by the horn and the jaws' },
      { gene: 'pattern_contrast', effect: 'how far the light tone departs from the horn colour' },
    ],
  },
  {
    id: 'hornserration',
    group: 'weapons',
    name: 'Horn serration',
    blurb: 'Notches on the horn at three fixed levels — 0, 1, 2. Each level is the one below it PLUS more notches, never a different shape.',
    drawnBy: 'drawHorn() — the serration loops in every case but crown',
    gate: 'horn_serration ≥ 1, and the horn must be drawn at all (horn_size ≥ 0.12). NEVER on crown (horn_type 4)',
    present: (g) => g.horn_serration >= 1 && g.horn_size >= 0.12 && g.horn_type !== 4,
    on: (g) => ({ horn_serration: 2, horn_size: Math.max(g.horn_size, 0.78), horn_type: g.horn_type === 4 ? 0 : g.horn_type }),
    off: { horn_serration: 0 },
    genes: [
      { gene: 'horn_serration', effect: '0 smooth · 1 one notch per side · 2 two — barbs on nose, inner teeth on pincer, spurs on y_shaped, antler branches on split. crown ignores it entirely' },
      { gene: 'horn_type', effect: 'decides what a notch looks like; crown is exempt and shows no serration at any level' },
      { gene: 'horn_size', effect: 'notches scale with the horn, so a tiny horn hides them' },
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
      'a long slender crescent sweeping outward to a fine point; the pair splays',
      'short and heavy, bulk at the base, hooking hard inward so the tips converge',
      'a blunt column with parallel sides and a domed top, bare or fanged by serration',
    ]),
    genes: [
      { gene: 'mandible_size', effect: 'jaw length, 0.38–1.22 of the head radius' },
      { gene: 'mandible_type', effect: 'which of the three shapes gets drawn' },
      {
        gene: 'mandible_serration',
        effect: 'multiplies the bite stat, AND cuts teeth into the inner edge at three levels — min(2, floor(v × 3)), so 0–0.33 smooth, 0.33–0.67 one tooth, 0.67+ two. Every kind reads it now: on the chelicerae, 1 or 2 both add the single tip fang that used to be a kind of its own',
      },
      { gene: 'pattern_mandible', effect: 'flat / gradient / dots / oval / diagonal surface treatment on the jaw fill — its own gene, independent of the horn' },
      { gene: 'pattern_mandible_hue', effect: 'which of the ten reference-palette swatches the decoration tone is drawn from — independent of the body\'s own hue' },
      { gene: 'pattern_scale', effect: 'gradient: where the light/dark transition sits along the jaw\'s long axis. dots: dot size and count. diagonal: stripe pitch. Shared by the horn and the jaws' },
      { gene: 'pattern_contrast', effect: 'how far the light tone departs from the jaw colour' },
    ],
  },
  {
    id: 'tail',
    group: 'weapons',
    name: 'Tail',
    blurb: 'Cerci or metasoma trailing off the rear mass. A plain capsule until a stinger loads it.',
    drawnBy: 'drawTail()',
    gate: 'tail_length × 0.62 > 0.08  →  tail_length > 0.129',
    present: (g) => g.tail_length * 0.62 > 0.08,
    on: { tail_length: 0.6 },
    off: { tail_length: 0 },
    genes: [
      { gene: 'tail_length', effect: 'reach, up to 0.62 of the body unit' },
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
    present: (g) => g.stinger_size > 0.18 && g.tail_length * 0.62 > 0.08,
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
    blurb: 'One shape only: a wedge, wide and rounded at the outer-top corner and drawn to a point at the inner-lower side. Big, set wide, and drawn UNDER the head so its edge crops the inner half. `eye_type` picks how it is FILLED, not what shape it is.',
    core: true,
    drawnBy: 'drawEyes() → eyeWedgePath()',
    gate: 'no gate — there is nothing optional inside an eye any more. The iris is GONE on every fill treatment (it was a bright complementary disc that read as a coloured dot in the eye)',
    variantGene: 'eye_type',
    variants: variants(EYE_FILLS, [
      'near-black, with a scatter of small white dots',
      'white, with a dark notch cut into the outer-top corner. Nothing else',
      'white, with a small dark hook curling in from the outer-top corner. Nothing else',
    ]),
    genes: [
      { gene: 'eye_size', effect: 'radius, 0.45–1.05 of head radius' },
      { gene: 'eye_type', effect: 'the fill treatment — dark speckled / notched / hooked. It no longer changes the silhouette; there is only one' },
      { gene: 'eye_count', effect: 'pairs past the first are drawn as a small mirrored eye array behind the main pair' },
    ],
  },
  {
    id: 'crownmark',
    group: 'sensory',
    name: 'Crown mark',
    blurb: 'A flat colour patch capping the top of the head — gold, off the fixed reference palette, clipped to the head so it never reaches past the silhouette. NOT a horn: `horn_type` has a variant called "nose" and this is unrelated to it, no geometry of its own at all.',
    drawnBy: 'drawCrownMark()',
    gate: 'crown_mark_style ≥ 1  (0 draws nothing)',
    present: (g) => g.crown_mark_style >= 1,
    on: { crown_mark_style: 1 },
    off: { crown_mark_style: 0 },
    // State 0 is "no mark", which is the part being ABSENT rather than a variant
    // of it — the gate above already covers it. The variant list is the two
    // states that actually draw something, offset by one onto the gene.
    variantGene: 'crown_mark_style',
    variants: variants(CROWN_MARKS.slice(1), [
      'a solid gold cap with a hard, crisp lower edge',
      'the same cap faded down into the head colour — the only blend anywhere on the head',
    ]),
    variantOf: (g) => Math.max(0, Math.min(1, Math.round(g.crown_mark_style ?? 0) - 1)),
    setVariant: (_g, i) => ({ crown_mark_style: i + 1 }),
    genes: [
      { gene: 'crown_mark_style', effect: '0 none, 1 solid gold cap, 2 the cap blended into the head' },
    ],
  },
  {
    id: 'ocelli',
    group: 'sensory',
    name: 'Extra eyes',
    blurb: 'Every pair past the first joins a small mirrored array behind the main eyes — the same wedge shape, scaled down, arranged in rows so it reads as a deliberate cluster rather than scattered dots. Sized and positioned so it never overlaps the main pair\'s own footprint. Three extra pairs is the ceiling.',
    drawnBy: 'buildHead() → the minor eyes',
    gate: 'eye_count ≥ 4  (extra pairs = clamp(round(eye_count / 2) − 1, 0, 3))',
    present: (g) => g.eye_count >= 4,
    on: { eye_count: 8 },
    off: { eye_count: 2 },
    genes: [
      { gene: 'eye_count', effect: '4 → one row of two behind the main pair, 6 → a second row, 8+ → a third (the ceiling). Also +11% vision each pair' },
      { gene: 'eye_size', effect: 'the array radius is solved from the main eyes\' own radius, clamped so an array eye is always visibly smaller and clear of the main pair\'s silhouette' },
    ],
  },
  {
    id: 'antennae',
    group: 'sensory',
    name: 'Antennae',
    blurb: 'A pair of thin capsules off the head that wag with the animation phase.',
    drawnBy: 'drawAntennae()',
    gate: 'antenna_length > 0.101  (the length has to clear 0.15 of the body unit)',
    present: (g) => 0.06 + g.antenna_length * 0.89 > 0.15,
    on: { antenna_length: 0.7 },
    off: { antenna_length: 0 },
    genes: [
      { gene: 'antenna_length', effect: 'reach, 0.06–0.95 of the body unit' },
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
      { gene: 'saturation', effect: 'scales the swatch 0.80–1.15×' },
      { gene: 'lightness', effect: 'scales the swatch 0.86–1.16×' },
    ],
  },
  {
    id: 'inklimbs',
    group: 'surface',
    name: 'Ink limbs',
    blurb: 'Legs, antennae and tail go near-black instead of a deep tone of the body.',
    drawnBy: 'palette() → col.limb',
    gate: 'pattern_leg > 0.5',
    present: (g) => g.pattern_leg > 0.5,
    on: { pattern_leg: 0.8 },
    off: { pattern_leg: 0.2 },
    genes: [
      { gene: 'pattern_leg', effect: 'above 0.5 the limbs ink. Its own gene now — this used to be a third reading of the shared `pattern`, which meant black legs and a dotted horn could not be asked for separately' },
    ],
  },
  {
    id: 'hornpattern',
    group: 'surface',
    name: 'Horn & jaw pattern',
    blurb: 'A surface treatment applied to the whole horn or the whole jaw as ONE shape — flat, a gradient that slides along the shape, light speckle dots, one oval highlight, or repeating diagonal stripes. The horn and the mandibles pick independently, and each also picks its own decoration colour off the reference palette. Body patterns are a later pass — this reaches the weapons only.',
    drawnBy: 'surfacePattern() → patternedSilhouette()',
    gate: 'a horn or a mandible has to be drawn (horn_size ≥ 0.12 or mandible_size ≥ 0.10); mode = min(4, floor(pattern_horn × 5)) for the horn, the same over pattern_mandible for the jaws',
    present: (g) => g.horn_size >= 0.12 || g.mandible_size >= 0.10,
    on: { mandible_size: 0.75 },
    off: { mandible_size: 0, horn_size: 0 },
    // The variant strip drives the HORN's gene. The mandible's is the same five
    // states over its own slider; showing both strips would be two identical
    // pickers side by side.
    variantGene: 'pattern_horn',
    variants: variants(['flat', 'gradient', 'dots', 'oval', 'diagonal'], [
      'solid colour, nothing on it at all — the default',
      'the base colour lifting to the decoration tone, positioned along the shape by pattern_scale',
      'light speckle dots scattered over the shape',
      'one lighter oval patch near the tip, the rest flat',
      'repeating 45° stripes swept across the whole clipped silhouette',
    ]),
    variantOf: (g) => Math.min(4, Math.floor(Math.max(0, Math.min(1, g.pattern_horn)) * 5)),
    setVariant: (_g, i) => ({ pattern_horn: (i + 0.5) / 5, pattern_mandible: (i + 0.5) / 5 }),
    genes: [
      { gene: 'pattern_horn', effect: 'the HORN\'s treatment: 0–0.2 flat, 0.2–0.4 gradient, 0.4–0.6 dots, 0.6–0.8 oval, 0.8+ diagonal' },
      { gene: 'pattern_mandible', effect: 'the JAWS\' treatment, same five buckets, chosen independently of the horn\'s' },
      { gene: 'pattern_scale', effect: 'gradient: slides the light/dark transition along the shape. dots: bigger scale means fewer, larger dots. diagonal: stripe pitch. Shared by both components' },
      { gene: 'pattern_contrast', effect: 'how loud a treatment reads: gradient depth, dot opacity, oval tone gap, stripe opacity. Shared by both components' },
    ],
  },
  {
    id: 'seglight',
    group: 'surface',
    name: 'Segment lighting',
    blurb: 'The soft warm bloom on every trunk segment. Only its HUE comes off the reference palette; how bright and how saturated it is are two genes of its own, independent of the body colour — floor-clamped so the light can never render darker than the shell it sits on.',
    core: true,
    drawnBy: 'palette() → segmentMass()',
    gate: 'always, on every trunk mass. Never on the head, which carries no lighting at all',
    genes: [
      { gene: 'light_hue', effect: 'which of the ten reference-palette swatches the bloom\'s core is. 7 is cream, which is what every bug used to get' },
      { gene: 'lighting_lightness', effect: 'the bloom\'s own lightness, core and fade alike. Clamped up to the body\'s own lightness, so the light is never darker than the shell' },
      { gene: 'lighting_saturation', effect: 'the bloom\'s own saturation; the outer stops keep 60% of it so the edge stays soft' },
      { gene: 'lightness', effect: 'only as the FLOOR the lighting\'s lightness is clamped to — a lighter body raises the light with it, never the other way round' },
      { gene: 'body_segments', effect: 'one bloom per trunk segment' },
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
  feet:      { zoom: 1.50, y: -0.14 },
  wings:     { zoom: 1.12, y: -0.14 },
  horn:      { zoom: 3.00, y: 0.62 },
  hornserration: { zoom: 3.40, y: 0.66 },
  hornpattern:   { zoom: 3.00, y: 0.56 },
  mandibles: { zoom: 3.00, y: 0.52 },
  tail:      { zoom: 1.95, y: -0.44 },
  stinger:   { zoom: 2.10, y: -0.48 },
  eyes:      { zoom: 3.00, y: 0.50 },
  ocelli:    { zoom: 3.10, y: 0.54 },
  antennae:  { zoom: 2.20, y: 0.56 },
  inklimbs:  { zoom: 1.30, y: 0 },
  seglight:  { zoom: 1.55, y: -0.10 },
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
  body_length: 'no longer shapes the bug at all — the trunk is built from body_segments. It survives as an agility input only.',
  body_mass: 'density → mass. Raises attack, drags speed and agility, slows recovery.',
  carapace_thickness: 'the single biggest defense input, and it costs agility.',
  leg_joints: 'a third joint improves grip, which gates speed.',
  spine_density: 'adds to defense. Required by the Centipede and Millipede windows.',
  metabolism: 'burn rate: high recovery, low stamina.',
  aggression: 'biases the AI state machine only. It is not a combat stat.',
  translucency: 'helps camouflage. The renderer does not draw see-through cuticle yet.',
};

/**
 * gene → every part it touches. Built once, so the parameter panel can answer
 * "what does this slider move" for all 56 genes without a search.
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
