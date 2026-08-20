// Genetics layer.
// A genome is a plain object of scalar genes. GENE_ORDER is the canonical
// vector order — crossover, serialization and any future GLB mapping all use it.

import { makeRng } from './rng.js';

/** @typedef {Record<string, number>} Genome */

/**
 * RANGE / DEFAULT CALIBRATION
 *
 * `default` is the value normalizeGenome() fills a missing gene with. It used to
 * be the arithmetic midpoint, which meant the "medium" bug was whatever fell out
 * of the range rather than something anyone designed. The defaults below are
 * calibrated against two reference genomes the design targets — a Larva
 * ("Drenex") and a Thorax Goliath ("Thiphon") — which bracket the viable design
 * space at its light and heavy ends. Each default is roughly the pair's mean,
 * then nudged for the explicit art direction: smaller heads, longer antennae,
 * bigger horns.
 *
 * WIDENING. Discrete/count genes are widened numerically at BOTH ends
 * (leg_count, leg_joints, wing_count, eye_count, body_segments). The normalized
 * 0..1 genes keep the 0..1 domain on purpose — it is the contract every consumer
 * (classification windows, palette(), the sigmoids in stats.js) is written
 * against, and pushing it to e.g. -0.2..1.2 would extrapolate every lerp into
 * negative radii. Their "range" is widened where it is actually felt instead: in
 * bugArt.js the lerp endpoints each gene drives were pushed outward at both
 * ends, so 0.0 reads smaller than it used to and 1.0 reads larger. See the
 * per-gene comments in bugArt.js.
 *
 * Enumeration genes (horn_type, mandible_type, crown_mark_style)
 * cannot widen without new art — each index is a hand-drawn shape. `eye_type` is
 * an enum too but no longer of shapes: the sketch has exactly ONE eye
 * silhouette, so it enumerates the three fill treatments applied to it.
 *
 * `horn_serration` is the one gene that is discrete WITHOUT being an enum: 0/1/2
 * are the same shape with progressively more notches, each level a strict
 * superset of the one below it.
 */
export const GENE_SPECS = {
  /* ---- body plan ---- */
  // Trunk segments, head NOT counted. Segment 1 is always the thorax; every
  // segment past it is an abdominal segment. 1 therefore means "no abdomen".
  body_segments:      { min: 1, max: 10, integer: true, default: 2 },
  body_length:        { min: 0, max: 1, default: 0.53 },
  body_width:         { min: 0, max: 1, default: 0.21 },
  body_mass:          { min: 0, max: 1, default: 0.75 },
  head_size:          { min: 0, max: 1, default: 0.10 },
  thorax_ratio:       { min: 0, max: 1, default: 0.22 },   // thorax vs abdomen
  abdomen_taper:      { min: 0, max: 1, default: 0.51 },   // 0 round, 1 pointed
  carapace_thickness: { min: 0, max: 1, default: 0.70 },

  /* ---- limbs ---- */
  leg_count:          { min: 2, max: 12, integer: true, step: 2, default: 6 },
  leg_length:         { min: 0, max: 1, default: 0.47 },
  leg_thickness:      { min: 0, max: 1, default: 1.00 },
  leg_spread:         { min: 0, max: 1, default: 0.75 },
  leg_joints:         { min: 1, max: 5, integer: true, default: 2 },
  // RENAMED from `claw_size`. Tarsal claws are gone from the art entirely; the
  // gene now sizes the round foot pad at the tip of every leg, from a small dot
  // at 0 to a heavy bulb at 1. It keeps its grip/attack roles in stats.js —
  // a broad foot is still traction, and still something to press with.
  foot_size:          { min: 0, max: 1, default: 0.30 },

  /* ---- wings ---- */
  // 0 / 2 / 4 / 6. Unchanged: zero is still a legal, meaningful genome (every
  // arachnid archetype uses it) and six still fans three blades a side.
  wing_count:         { min: 0, max: 6, integer: true, step: 2, default: 2 },
  // NARROWED 0–4 → 0–1, and no longer a shape picker. The blade SHAPE is derived
  // from wing_length/wing_width/wing_roundness now (see wingShapeCoefficient in
  // bugArt.js), so all this still decides is the structural question: soft
  // membranous blades, or hard elytra covers folded over the abdomen. Index 1 is
  // still elytra, which classification.js depends on. clampGene pulls any stored
  // 2/3/4 down to 1.
  wing_type:          { min: 0, max: 1, integer: true, default: 0 },   // membranous/elytra
  // KEPT, and narrowed in meaning to OVERALL SIZE — it scales a wing's length
  // and width together and does nothing else. It used to conflate size with
  // length; wing_length now owns length on its own. Kept rather than replaced
  // because classification.js windows and stats.js wing loading are both written
  // against it, and "how much wing is there" is exactly what they want.
  wing_area:          { min: 0, max: 1, default: 0.28 },
  // Length along the wing's own axis, independent of width.
  wing_length:        { min: 0, max: 1, default: 0.55 },
  // Half-width across that axis, expressed as a fraction of length — so it is a
  // true aspect ratio and cannot smuggle in a length change.
  wing_width:         { min: 0, max: 1, default: 0.46 },
  // Blunt vs. finely tapered tip. Moves outline control points only, never the
  // bounding box, so it is independent of both length and width.
  wing_roundness:     { min: 0, max: 1, default: 0.55 },
  // Sweep away from the body's long axis: 35° at 0, 165° at 1. The 0.50 default
  // is CALIBRATED, not picked — it renders 100°, the median resting angle across
  // the four full-bug panels of `Image References/WIngs.jpg`.
  wing_angle:         { min: 0, max: 1, default: 0.50 },
  // Tip wash colour. 0 = white (the default, and NOT a REF_PALETTE entry — the
  // reference palette has no white); 1–10 select a REF_PALETTE swatch in order:
  // tan/brown/rust/orange/gold/sage/ink/cream/pink/blue.
  wing_tip_hue:       { min: 0, max: 10, integer: true, default: 0 },
  wing_beat:          { min: 0, max: 1, default: 0.15 },

  /* ---- weapons & defence ---- */
  mandible_size:      { min: 0, max: 1, default: 0.90 },
  mandible_type:      { min: 0, max: 3, integer: true, default: 0 },   // wide_thin/narrow_thick/chelicerae_teeth/chelicerae_smooth
  // Stays CONTINUOUS: stats.js reads it as a bite multiplier. The renderer
  // buckets it into the sketch's three levels itself — min(2, floor(v * 3)).
  mandible_serration: { min: 0, max: 1, default: 0.53 },
  horn_size:          { min: 0, max: 1, default: 0.88 },
  horn_type:          { min: 0, max: 4, integer: true, default: 1 },   // nose/pincer/y_shaped/split/crown
  // Discrete 3-level detail on the horn — the sketch's "0 SR / 1 SR / 2 SR".
  // Integer like leg_joints/body_segments, NOT a continuous 0–1 gene.
  horn_serration:     { min: 0, max: 2, integer: true, default: 0 },
  spine_density:      { min: 0, max: 1, default: 0.44 },   // defensive spikes
  tail_length:        { min: 0, max: 1, default: 0 },      // cerci / metasoma
  stinger_size:       { min: 0, max: 1, default: 0 },

  /* ---- sensory ---- */
  eye_count:          { min: 2, max: 12, integer: true, step: 2, default: 2 },
  // REPURPOSED. There is only one eye SHAPE now (the sketch draws one silhouette
  // three times); this picks the FILL TREATMENT: dark+white-dots / notched /
  // hooked. The range narrowed 0–3 → 0–2 with the fourth shape, and clampGene
  // pulls any stored 3 down to 2.
  eye_type:           { min: 0, max: 2, integer: true, default: 1 },   // dark/notched/hooked
  eye_size:           { min: 0, max: 1, default: 0.80 },
  antenna_length:     { min: 0, max: 1, default: 0.55 },

  /* ---- physiology & behaviour ---- */
  metabolism:         { min: 0, max: 1, default: 0.33 },
  aggression:         { min: 0, max: 1, default: 0.74 },

  /* ---- surface & colour ---- */
  // COLOUR CALIBRATION — the default bug is the reference red #CA4B36
  // (hsl 8.6°, 58%, 50%). `hue` is a swatch INDEX (floor(hue × 12)), so 0.04
  // lands in swatch 0, vermilion (h 0.015, s 0.66, l 0.53); saturation and
  // lightness then scale that swatch. 0.57 / 0.50 renders hsl(5.4°, 66%, 53.5%)
  // = #D7483A, the closest this swatch table gets to the reference without
  // rewriting SWATCHES. #4962B8 (hsl 226°, 44%, 50%) is the secondary favourable
  // pick — same lightness, different hue — and stays reachable by breeding at
  // hue ≈ 0.68 (periwinkle, #5354C9) without any of these defaults moving.
  hue:                { min: 0, max: 1, circular: true, default: 0.04 },
  saturation:         { min: 0, max: 1, default: 0.57 },
  lightness:          { min: 0, max: 1, default: 0.50 },
  // Three-way surface treatment for the horn and the mandibles:
  // gradient / dots / oval, bucketed as min(2, floor(pattern × 3)). The old
  // `pattern > 0.5 → black limbs` reading is unchanged and still independent.
  pattern:            { min: 0, max: 1, default: 0.05 },
  pattern_scale:      { min: 0, max: 1, default: 0.11 },   // dot size/density
  pattern_contrast:   { min: 0, max: 1, default: 0.21 },   // how loud all three read
  // A flat colour patch capping the top of the head: none / solid gold with a
  // hard edge / the same cap blended down into the head colour. Its colours come
  // straight off bugArt's fixed REF_PALETTE, never from the body hue.
  //
  // NAMING: this is UNRELATED to horn_type's `nose`, which is a spike of horn
  // geometry mounted on the thorax. The reference sheet labels this row "NOSES"
  // as well; the word is avoided here on purpose so the two cannot be confused.
  crown_mark_style:   { min: 0, max: 2, integer: true, default: 0 },   // none/solid/blended
  setae:              { min: 0, max: 1, default: 0.16 },   // hairiness
  iridescence:        { min: 0, max: 1, default: 0 },
  translucency:       { min: 0, max: 1, default: 0.13 },
};

export const GENE_ORDER = Object.keys(GENE_SPECS);

/** Force a gene value back into its legal range/quantisation. */
export function clampGene(name, value) {
  const spec = GENE_SPECS[name];
  if (!spec) throw new Error(`unknown gene: ${name}`);
  let v = value;
  if (spec.circular) {
    // hue wraps rather than clamps
    v = ((v - spec.min) % (spec.max - spec.min) + (spec.max - spec.min)) % (spec.max - spec.min) + spec.min;
  } else {
    v = Math.min(spec.max, Math.max(spec.min, v));
  }
  if (spec.integer) {
    const step = spec.step ?? 1;
    v = Math.round((v - spec.min) / step) * step + spec.min;
    v = Math.min(spec.max, Math.max(spec.min, v));
  }
  return v;
}

/** The value a missing gene is filled with: an authored default, else the midpoint. */
export function geneDefault(name) {
  const spec = GENE_SPECS[name];
  if (!spec) throw new Error(`unknown gene: ${name}`);
  return clampGene(name, spec.default ?? (spec.min + spec.max) / 2);
}

/** Sanitize an arbitrary object into a valid genome (missing genes get defaults). */
export function normalizeGenome(partial = {}) {
  const g = {};
  for (const name of GENE_ORDER) {
    const spec = GENE_SPECS[name];
    const raw = partial[name] ?? spec.default ?? (spec.min + spec.max) / 2;
    g[name] = clampGene(name, raw);
  }
  return g;
}

/** Uniformly random genome. */
export function randomGenome(rng = makeRng(Date.now())) {
  const g = {};
  for (const name of GENE_ORDER) {
    const spec = GENE_SPECS[name];
    g[name] = clampGene(name, rng.range(spec.min, spec.max));
  }
  return g;
}

export function toVector(genome) {
  return GENE_ORDER.map((k) => genome[k]);
}

export function fromVector(vec) {
  const g = {};
  GENE_ORDER.forEach((k, i) => { g[k] = clampGene(k, vec[i]); });
  return g;
}

/** Stable id for a genome — same genes always produce the same id. */
export function genomeId(genome) {
  const s = toVector(genome).map((v) => v.toFixed(4)).join(',');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(0, 7);
}

const SYLL_A = ['ka', 'mo', 'thi', 'ver', 'sar', 'lu', 'nyx', 'ob', 'gra', 'pel', 'zi', 'dre'];
const SYLL_B = ['dra', 'lith', 'mus', 'nex', 'phon', 'tarn', 'vex', 'wick', 'yar', 'zen'];

/** Deterministic pronounceable name from the genome id. */
export function genomeName(genome) {
  const id = genomeId(genome);
  // id is base36 and can exceed 2^31 — keep the arithmetic in float space so
  // bit ops can't wrap negative and index off the end of the syllable tables.
  const n = Math.abs(parseInt(id, 36)) || 1;
  const a = SYLL_A[Math.floor(n) % SYLL_A.length];
  const b = SYLL_B[Math.floor(n / 32) % SYLL_B.length];
  return (a + b).replace(/^./, (c) => c.toUpperCase());
}
