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
  body_width:         { min: 0, max: 1, default: 0.21 },
  /**
   * `body_length` IS GONE, and `body_size` is not a gene either — it never
   * comes back as a stored value. It is a DERIVED coefficient, computed in
   * morphology() from the width/length of the parts that actually exist
   * (body_width plus every head/thorax/abdomen axis below): bigger parts,
   * bigger hidden size. See bodySize() in stats.js. `body_length` used to be
   * the same idea half-heartedly — a slider claiming to be "size" that no
   * other gene had to agree with — so it is not migrated, it is replaced.
   */
  body_mass:          { min: 0, max: 1, default: 0.75 },
  /**
   * PER-PART SIZE, TWO AXES EACH. `head_size` and `thorax_ratio` ARE GONE.
   *
   * Every trunk mass used to be a fraction of the single `body_width` gene —
   * one knob that resized the head, the thorax and the abdomen together, with
   * `head_size`/`thorax_ratio` only able to shift a part's share of that one
   * width, and no way at all to say "long abdomen, narrow thorax". The three
   * masses now size themselves: `*_width` is the lateral half-axis (the part's
   * `ry`), `*_length` the along-the-body half-axis (its `rx`), and neither
   * touches any other part.
   *
   * `body_width` SURVIVES and still legitimately does work — it is the scale
   * every one of these six is a fraction of (so the whole bug still has one
   * overall size), plus the myriapod ring radius, the length/width ratio clamp
   * and, through `unit`, leg and antenna scaling. What it no longer does is
   * decide the head/thorax/abdomen PROPORTIONS on its own.
   *
   * DEFAULTS ARE CALIBRATED TO THE OLD SPRITE, not to the middle of the range:
   * each one reproduces the radius the pre-split formula produced at the old
   * defaults (abdomen 0.54 · thorax 0.315 · head 0.206 of body width), so an
   * untouched genome renders the proportions it always did.
   */
  head_width:         { min: 0, max: 1, default: 0.13 },
  head_length:        { min: 0, max: 1, default: 0.13 },
  thorax_width:       { min: 0, max: 1, default: 0.287 },
  thorax_length:      { min: 0, max: 1, default: 0.287 },
  abdomen_width:      { min: 0, max: 1, default: 0.41 },
  abdomen_length:     { min: 0, max: 1, default: 0.41 },
  abdomen_taper:      { min: 0, max: 1, default: 0.51 },   // 0 round, 1 pointed
  // `carapace_thickness` IS GONE. `body_mass` replaces it for every purpose it
  // used to serve — shell volume, defense, health — see morphology() and
  // computeStats() in stats.js. A separate "how thick is the shell" slider
  // sitting next to "how heavy is the animal" invited a bug to be armoured
  // without being heavy, which the density model underneath never actually
  // supported; one gene now carries both readings honestly.

  /* ---- limbs ---- */
  leg_count:          { min: 2, max: 12, integer: true, step: 2, default: 6 },
  leg_length:         { min: 0, max: 1, default: 0.47 },
  leg_thickness:      { min: 0, max: 1, default: 1.00 },
  leg_spread:         { min: 0, max: 1, default: 0.75 },
  // NARROWED 1-5 -> 0/1. A binary "does this leg carry a third joint",
  // default off. It used to be a count nothing drew (see drawLegs in
  // bugArt.js — the art was one arc whatever the value), so the middle of the
  // range was indistinguishable from either end. 1 now draws a real, minimal
  // extra bend in the leg curve; see LEG_JOINT_KINK in bugArt.js.
  leg_joints:         { min: 0, max: 1, integer: true, default: 0 },
  // `foot_size` IS GONE. It was `claw_size` before that, and by the end it was a
  // slider whose only honest answer was "as big as possible": the foot pad is
  // punctuation at the end of a capsule leg, and every value under the maximum
  // read as a leg that had been cut short rather than as a design choice. The
  // pad is now HARDCODED at its old maximum (0.95 of the leg width, see
  // drawLegs) and there is no gene. stats.js keeps the grip and attack terms it
  // used to feed, as constants — calibrated at this gene's old DEFAULT, not at
  // the maximum the pad is drawn at, so removing a slider does not hand every
  // bug a free stat. See FOOT_GRIP/FOOT_ATTACK.

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
  // NARROWED 0–1 → 0.7–1.0. The mapping behind it is unchanged (35° at gene 0,
  // 165° at gene 1, see WING_SWEEP_MIN/MAX in bugArt.js) — what narrowed is the
  // part of it a genome may REACH. Wings at rest are swept well back in the
  // reference sheet; the bottom two thirds of the old window drew blades held
  // out sideways, which never appeared in the art. 0.85 renders 145.5°, and the
  // window spans 126°–165°. The old 0.50 default is now out of range and
  // clampGene pulls any stored value below 0.7 up to it.
  //
  // Flight is the exception, and it is applied in the renderer rather than here:
  // drawSoftWings() subtracts 0.3 from this value while the bug is in motion,
  // reaching 0.4–0.7 (i.e. 87°–126°) — wings swung forward to beat.
  wing_angle:         { min: 0.7, max: 1.0, default: 0.85 },
  // Tip wash colour. 0 = white (the default, and NOT a REF_PALETTE entry — the
  // reference palette has no white); 1–10 select a REF_PALETTE swatch in order:
  // tan/brown/rust/orange/gold/sage/ink/cream/pink/blue.
  wing_tip_hue:       { min: 0, max: 12, integer: true, default: 0 },
  wing_beat:          { min: 0, max: 1, default: 0.15 },

  /* ---- weapons & defence ---- */
  mandible_size:      { min: 0, max: 1, default: 0.90 },
  // NARROWED 0–3 → 0–2. `chelicerae_teeth` and `chelicerae_smooth` were the same
  // column differing by one fang, i.e. a serration level wearing a kind's
  // clothes. They merged into a single `chelicerae` at index 2, and the fang is
  // now `mandible_serration ≥ 1` like every other tooth on every other jaw.
  // clampGene pulls any stored 3 down to 2 — which is the merged kind, so an old
  // `chelicerae_smooth` genome still renders chelicerae.
  mandible_type:      { min: 0, max: 2, integer: true, default: 0 },   // wide_thin/narrow_thick/chelicerae
  // Stays CONTINUOUS: stats.js reads it as a bite multiplier. The renderer
  // buckets it into the sketch's three levels itself — min(2, floor(v * 3)).
  mandible_serration: { min: 0, max: 1, default: 0.53 },
  horn_size:          { min: 0, max: 1, default: 0.88 },
  horn_type:          { min: 0, max: 4, integer: true, default: 1 },   // nose/pincer/y_shaped/split/crown
  // Discrete 3-level detail on the horn — the sketch's "0 SR / 1 SR / 2 SR".
  // Integer like leg_joints/body_segments, NOT a continuous 0–1 gene.
  horn_serration:     { min: 0, max: 2, integer: true, default: 0 },
  // `spine_density` IS GONE — it fed defense and nothing else, with no art of
  // its own (see the old `spines` part note in partLibrary.js). Its defense
  // role folded into `body_mass`; its classification role (Centipede,
  // Millipede) moved to `spikyness`, which is the same idea WITH art behind it.
  tail_length:        { min: 0, max: 1, default: 0 },      // cerci / metasoma
  stinger_size:       { min: 0, max: 1, default: 0 },

  /* ---- sensory ---- */
  eye_count:          { min: 2, max: 12, integer: true, step: 2, default: 2 },
  // REPURPOSED, then reopened. This picks the eye's surface treatment: dark
  // +white-dots / notched / hooked — all three the SAME wedge silhouette,
  // differing only in fill/mark. A fourth value, `flat`, breaks that on
  // purpose: same asymmetric identity, but a flatter, less-protruding
  // silhouette with no interior mark. See EYE_FILLS in bugArt.js.
  eye_type:           { min: 0, max: 3, integer: true, default: 1 },   // dark/notched/hooked/flat
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
  /**
   * THE `pattern` GENE IS SPLIT, one gene per component it used to speak for.
   *
   * One knob used to answer three unrelated questions at once: what treatment
   * the horn wears, what treatment the mandibles wear, and whether the legs are
   * inked black. Nothing about a bug requires those three to agree, and the
   * shared gene made it impossible to give a bug dotted jaws and a flat horn.
   *
   * The two surface genes bucket FIVE ways now:
   *
   *     mode = min(4, floor(v × 5))
   *       0 flat · 1 gradient · 2 dots · 3 oval · 4 diagonal
   *
   * `diagonal` is the newest — repeating 45° stripes across the whole clipped
   * silhouette. The divisor moved 4 → 5 with it; 0.08 × 5 = 0.4 still lands in
   * bucket 0, so the defaults below did NOT have to be recalibrated.
   *
   * `flat` is bucket 0 and is the whole point of the low defaults: bucket 0 used
   * to be `gradient`, so an untouched genome had a gradient on its horn and jaws
   * whether anyone asked for one or not. 0.08 lands in `flat` — solid colour,
   * no gradient, no dots, no highlight — so the default bug is genuinely plain
   * and every treatment is something a genome opted into.
   */
  pattern_horn:       { min: 0, max: 1, default: 0.08 },   // flat/gradient/dots/oval/diagonal
  pattern_mandible:   { min: 0, max: 1, default: 0.08 },   // flat/gradient/dots/oval/diagonal
  /**
   * THE PATTERN'S OWN COLOUR, one gene per component.
   *
   * Whatever `pattern_horn` / `pattern_mandible` selects — the gradient's far
   * stop, the dots, the oval, the stripes — used to be painted in the BODY's own
   * hue walked toward amber. So "what colour is the decoration on my horn" was
   * not a question a genome could answer; it was a side effect of the shell
   * colour, in precisely the way `light_hue` fixed for the segment bloom.
   *
   * Same convention as `light_hue` and `wing_tip_hue`: an integer indexing
   * REF_PALETTE_ORDER (tan/brown/rust/orange/gold/sage/ink/cream/pink/blue).
   * SEPARATE genes, because the mode genes are already separate — a bug can wear
   * gold stripes on its horn and sage dots on its jaws.
   *
   * Only the HUE comes off the palette. The tone's saturation and lightness are
   * still derived from the piece's colour and from `pattern_contrast`, so that
   * gene keeps its whole job. Default 4 is `gold`, the warm amber lift the old
   * hardcoded shift aimed at, so a genome that never touches these is unchanged
   * in spirit.
   */
  pattern_horn_hue:     { min: 0, max: 11, integer: true, default: 4 },
  pattern_mandible_hue: { min: 0, max: 11, integer: true, default: 4 },
  /**
   * LEG COLOUR: normal / inked / gradient.
   *
   * Used to be the old shared `pattern` gene's third reading, continuous 0-1
   * and read as a threshold ("above 0.5 the limbs ink") — a slider implying a
   * spectrum between two states nothing in between ever meant anything. It is
   * a stepped 0/1/2 pick now, same convention as `horn_serration`: 0 is the
   * exact old "unmarked" leg, 1 the exact old "inked" leg (clampGene rounds a
   * stored value to the nearest integer, so the 0.5 threshold survives as the
   * boundary between them for any old genome). 2 is new: GRADIENT, a colour at
   * the foot fading to the normal leg tone toward the body — see drawLegs in
   * bugArt.js.
   */
  pattern_leg:        { min: 0, max: 2, integer: true, default: 0 },   // normal/inked/gradient
  // The gradient leg's foot-end colour. Same REF_PALETTE-index convention as
  // `pattern_horn_hue`; unused unless `pattern_leg` selects gradient.
  pattern_leg_hue:    { min: 0, max: 11, integer: true, default: 4 },
  // SHARED, deliberately. These two do not pick a treatment, they modulate
  // whichever treatment each component already picked — how loud it reads, how
  // coarse the dots are. That is a house style, not a per-part decision, and
  // splitting them would add sliders whose difference nobody can state an
  // intention about. The mode gene is where the per-part identity lives.
  //
  // `pattern_scale` NOW REACHES THREE MODES, not one. It was dot density and
  // size only; it also POSITIONS the gradient's light/dark transition along the
  // piece (0.5 reproduces the old full-length ramp) and sets the diagonal
  // stripes' pitch. It still does nothing to `flat` or `oval`.
  pattern_scale:      { min: 0, max: 1, default: 0.11 },   // dot pitch · gradient position · stripe pitch
  pattern_contrast:   { min: 0, max: 1, default: 0.21 },   // how loud a treatment reads
  // THE LIGHTING COLOUR, heritable and independent of the body's own colour.
  // The body-segment bloom used to be a hardcoded cream whatever the genome
  // said. It still comes off the fixed REF_PALETTE (lighting colour never gets
  // computed from the body hue — see the mandate in bugArt.js), but WHICH
  // swatch is now a gene: 0–9 index REF_PALETTE_ORDER. 7 is cream, which is
  // what every bug used to get, so the default is the old fixed behaviour.
  light_hue:          { min: 0, max: 11, integer: true, default: 7 },
  /**
   * THE LIGHTING'S OWN SATURATION AND LIGHTNESS.
   *
   * `light_hue` only ever picked a swatch, and everything else about the bloom
   * rode on values that were not its own: the core stops used the swatch's
   * baked-in hex s/l, and the outer fade was built from the BODY's `saturation`
   * and `lightness`. So "how bright is the light on this bug" was not a
   * question a genome could answer — it was a side effect of the body colour.
   * These two own it. Only the HUE now comes off REF_PALETTE; the rendered
   * bloom colour is hsl(that hue, lighting_saturation, lighting_lightness).
   *
   * Defaults reproduce cream (#e5dbcf ≈ 33% saturation, 85% lightness), which
   * is the light every bug used to get.
   *
   * FLOOR: the effective lightness is clamped to the body's own lightness in
   * palette(), so the bloom can never render DARKER than the shell it sits on,
   * whatever this gene says. See palette()'s lighting section.
   */
  lighting_saturation: { min: 0, max: 1, default: 0.33 },
  lighting_lightness:  { min: 0, max: 1, default: 0.85 },
  // A flat colour patch capping the top of the head: none / solid gold with a
  // hard edge / the same cap blended down into the head colour. Its colours come
  // straight off bugArt's fixed REF_PALETTE, never from the body hue.
  //
  // NAMING: this is UNRELATED to horn_type's `nose`, which is a spike of horn
  // geometry mounted on the thorax. The reference sheet labels this row "NOSES"
  // as well; the word is avoided here on purpose so the two cannot be confused.
  crown_mark_style:   { min: 0, max: 2, integer: true, default: 0 },   // none/solid/blended
  setae:              { min: 0, max: 1, default: 0.16 },   // hairiness
  // NO `iridescence`. It drove exactly one thing — the fine accent-hue speckle
  // over the shell and the limbs — and that speckle is gone from bugArt.js (see
  // the note where speckle() used to be). With nothing left to render, the gene
  // was a camouflage penalty attached to an invisible finish, so it went too:
  // out of GENE_SPECS, out of the archetype bias vectors, out of the camouflage
  // formula in stats.js, and out of classification's surface axis.
  translucency:       { min: 0, max: 1, default: 0.13 },
  // A short, rounded spike off the left AND right of every trunk segment —
  // thorax, each abdominal segment, each myriapod ring. Same flat fill and
  // same colour mix as the segment it grows from (see drawSegmentSpikes in
  // bugArt.js) — it is read as part of the shell, not a separate part painted
  // on top. Default 0: opt-in, so an untouched genome is unchanged.
  spikyness:          { min: 0, max: 1, default: 0 },
  /**
   * A marking on the trunk masses themselves (thorax, each abdominal segment,
   * each myriapod ring) — separate from `pattern_horn`/`pattern_mandible`,
   * which only ever reached the horn and jaws. Stepped, same convention as
   * `pattern_leg`: 0 none, 1 a symmetric dot scatter, 2 horizontal bands. Both
   * marked options are mirrored across the segment's own centreline — see
   * drawShellPattern in bugArt.js — because an independently-rolled scatter on
   * a bilaterally symmetric animal reads as noise, not a marking.
   */
  pattern_shell:      { min: 0, max: 2, integer: true, default: 0 },   // none/dots/lines
  // The shell marking's own colour. Same REF_PALETTE-index convention as
  // `pattern_horn_hue`; unused unless `pattern_shell` selects a marking.
  pattern_shell_hue:  { min: 0, max: 11, integer: true, default: 7 },
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
