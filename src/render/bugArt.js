// Procedural bug art — flat vector, vertical, minimal.
//
// STYLE CONTRACT (matched to the reference designs):
//   • Canonical pose is HEAD UP. Everything is mirror-symmetric about the
//     vertical axis. The sim compensates by adding 90° to sprite rotation.
//   • ZERO outlines. Forms separate by value and overlap, never by stroke.
//   • Limbs are capsules: uniform width, round caps, smooth single arcs. No
//     tapering, no joints drawn as separate bones.
//   • Body segments are FLAT: one solid shell fill with a soft warm blob near
//     the middle and NO darkening toward the rim. Centred on the thorax and
//     myriapod rings, skewed low on the abdomen; elongated segments also get a
//     soft centreline. The blob's CORE colour is a reference-palette swatch
//     picked by `light_hue` — a fixed palette, never a lighten of the body hue
//     (see REF_PALETTE) — and only its outer fade is derived from the body, so
//     the edge harmonises instead of going muddy. The blob is DELIBERATELY
//     faint — see BLOB_ALPHA.
//   • The HEAD CARRIES NO LIGHTING AT ALL. One solid `col.shell` fill, no
//     gradient, no bloom, no rim darkening. The single exception is the crown
//     mark's blended variant (see drawCrownMark), which is the only blend
//     allowed anywhere on the head.
//   • Restrained palette: one dominant hue, black, white, and a single bright
//     complementary accent. Three colours plus neutrals, never more.
//   • ONE eye silhouette, three fill treatments. The shape is an asymmetric
//     wedge — a wide rounded corner at the outer-top, tapering to a point at the
//     inner-lower side — set wide on the head and partly tucked behind it.
//   • NO SHELL SPECKLE. `iridescence` and the fine granular scatter it painted
//     over the shell and the limbs are both gone: the gene existed to justify
//     the speckle, the speckle was the only thing on the sprite that broke the
//     flat-fill rule above, and nothing else read the gene as art. The only
//     scatter left anywhere is the horn/jaw `dots` pattern, which is opt-in
//     through `pattern_horn`/`pattern_mandible`.
//
// Three body plans, because forcing a centipede through a beetle's geometry is
// what made them read as sausages:
//   insect    head + thorax + abdomen, legs on the thorax
//   arachnid  cephalothorax + abdomen, four leg pairs up front
//   myriapod  head + 6-10 repeating segments, ONE leg pair per segment
//
// The abdomen is OPTIONAL on the first two: `body_segments` counts trunk
// segments (head excluded, thorax first), so a one-segment bug has none. See
// buildTrunk() for the model and drawBug() for the z-order it implies.
//
// Swap this module for the anyCreature/GLB pipeline later; nothing outside it
// knows how a bug looks.

import { morphology } from '../core/stats.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** Deterministic scatter, so a pattern never shimmers between frames. */
function hash01(i, salt = 0) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/* ============================================================== colour ==== */

/** Bright, poster-flat hues. A continuous wheel spends its range in olive. */
const SWATCHES = [
  { h: 0.015, s: 0.66, l: 0.53 },  // vermilion  (the reference red)
  { h: 0.055, s: 0.74, l: 0.55 },  // orange
  { h: 0.110, s: 0.76, l: 0.56 },  // amber
  { h: 0.145, s: 0.72, l: 0.58 },  // yellow
  { h: 0.270, s: 0.48, l: 0.46 },  // leaf
  { h: 0.420, s: 0.52, l: 0.45 },  // jade
  { h: 0.500, s: 0.58, l: 0.48 },  // teal
  { h: 0.570, s: 0.60, l: 0.52 },  // cobalt
  { h: 0.665, s: 0.52, l: 0.55 },  // periwinkle
  { h: 0.755, s: 0.46, l: 0.52 },  // violet
  { h: 0.875, s: 0.54, l: 0.56 },  // magenta
  { h: 0.955, s: 0.60, l: 0.58 },  // rose
];

/**
 * THE REFERENCE PALETTE — fixed, hand-sampled from `Image References/Palette.jpg`.
 *
 * NOT to be confused with SWATCHES above: that is the 12-hue base-colour wheel a
 * genome's `hue` indexes into, and every tone in palette() is derived from the
 * one swatch it lands on. This table is the opposite idea.
 *
 * DESIGN MANDATE: lighting colours are always drawn from this fixed reference
 * palette, never computed from the body hue by lightness math. A procedural
 * `l + 0.22` lighten tints the highlight with the body's own hue, which is what
 * made the old fill read as a shaded 3D ball rather than a flat shape with a
 * warm light on it. The reference art puts the SAME warm cream/tan bloom on
 * every body, whatever colour that body is — so the bloom colour is a constant,
 * looked up here.
 *
 * Sampled hexes, left to right in the reference image.
 */
const REF_PALETTE = {
  tan:    '#bb9e7c',
  brown:  '#594637',
  rust:   '#bf5640',
  orange: '#d76334',
  gold:   '#e7bc53',
  sage:   '#589873',
  ink:    '#2b292a',
  cream:  '#e5dbcf',
  pink:   '#e2a9af',
  blue:   '#4255be',
};

/** '#rrggbb' → 'rgba(r,g,b,a)'. The reference palette is stored as hex. */
function refA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * '#rrggbb' → its HUE only, as a 0..1 turn.
 *
 * REF_PALETTE stores flat hexes, so a swatch's saturation and lightness are
 * baked into it and cannot be addressed separately. The segment bloom needs the
 * swatch's IDENTITY (its hue) while taking its s/l from genes — see palette()'s
 * lighting section — so this throws the baked s/l away on purpose.
 */
function hexHue(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6;
  return ((h % 1) + 1) % 1;
}

/**
 * Peak alpha of the body-segment bloom, at its dead centre.
 *
 * It was 0.90 and read as an opaque cream disc with a hard shoulder stamped on
 * the shell — "too opaque and sharp". Halved to 0.52, and the ramp underneath it
 * went from three stops to six so the falloff is a long gentle fade instead of a
 * step. Every other stop is expressed as a fraction of this, so the whole effect
 * dims from one number.
 */
const BLOB_ALPHA = 0.52;

/**
 * Ordered REF_PALETTE keys, so `wing_tip_hue` can index them by number.
 * Index 0 of the GENE is white — which is not in here, because the reference
 * palette has no white — so the gene's 1..10 map onto this list's 0..9.
 */
export const REF_PALETTE_ORDER = [
  'tan', 'brown', 'rust', 'orange', 'gold', 'sage', 'ink', 'cream', 'pink', 'blue',
];

/** Wing tip wash colour at alpha `a`. 0 = white, 1..10 = a REF_PALETTE swatch. */
function wingTipColour(g, a) {
  const i = clamp(Math.round(g.wing_tip_hue ?? 0), 0, REF_PALETTE_ORDER.length);
  if (i === 0) return `rgba(255,255,255,${a})`;
  return refA(REF_PALETTE[REF_PALETTE_ORDER[i - 1]], a);
}

const hsl = (h, s, l, a = 1) =>
  `hsla(${(((h % 1) + 1) % 1 * 360).toFixed(1)}, ${(clamp(s, 0, 1) * 100).toFixed(1)}%, ${(clamp(l, 0, 1) * 100).toFixed(1)}%, ${a})`;

export function palette(g) {
  const sw = SWATCHES[Math.floor(clamp(g.hue, 0, 0.999) * SWATCHES.length)];
  const h = sw.h;
  const s = clamp(sw.s * (0.80 + g.saturation * 0.35), 0.34, 0.86);
  const l = clamp(sw.l * (0.86 + g.lightness * 0.30), 0.38, 0.70);

  // One bright complementary accent — the cyan against red in the reference.
  const accentH = h + 0.5;

  // Limbs are either near-black or a deep tone of the body. Both appear in the
  // reference set; `pattern_leg` picks, so it is heritable rather than arbitrary.
  //
  // This used to be a third reading of the single shared `pattern` gene, sat
  // alongside the horn and mandible treatments it also drove. "Are the legs
  // inked" is not one of flat/gradient/dots/oval — it is a different body part
  // asking a different question — so it now has a gene of its own. The 0.5
  // threshold is unchanged, so a leg that inked before inks at the same value.
  const inkLimbs = (g.pattern_leg ?? 0) > 0.5;

  /**
   * THE LIGHTING COLOUR — a REF_PALETTE swatch chosen by `light_hue`, not a
   * lighten of the body. Still off the fixed palette per the mandate above;
   * what changed is that the swatch is a gene rather than a hardcoded cream, so
   * two bugs of the same colour can carry different light.
   */
  const lightHex = REF_PALETTE[REF_PALETTE_ORDER[
    clamp(Math.round(g.light_hue ?? 7), 0, REF_PALETTE_ORDER.length - 1)]];

  /**
   * THE LIGHTING'S SATURATION AND LIGHTNESS ARE THEIR OWN GENES NOW.
   *
   * SUPERSEDED RATIONALE, written down because it stood here for several passes
   * and is being deliberately overridden: the bloom's OUTER stops used to be
   * derived from the BODY (`hsl(h, s*0.52, l+0.30)`) on the argument that a
   * lighter version of the body meeting the body can never go muddy, and the
   * CORE stops used the `light_hue` swatch's baked-in hex saturation/lightness.
   * Between them, nothing about how bright or how saturated a bug's light was
   * could be authored — it fell out of the body's own colour and of a hardcoded
   * hex.
   *
   * NEW RATIONALE: only the HUE comes off REF_PALETTE now. Saturation and
   * lightness are `lighting_saturation` / `lighting_lightness`, independent of
   * the body's `saturation`/`lightness` and heritable on their own. The
   * anti-muddiness the old derivation bought is bought instead by the FLOOR
   * below: the effective lightness is clamped to be at least the body's own, so
   * the bloom is always a LIGHTENING of the shell and can never render darker
   * than the surface it sits on — the user's explicit constraint, and it holds
   * at `lighting_lightness = 0` on a light body just as on a dark one.
   *
   * The outer stops keep their old SHAPE (saturation pulled back, alpha to zero
   * before the rim, so the flat undarkened edge survives) — they just take their
   * s/l from the lighting genes rather than from the body.
   */
  const lightH = hexHue(lightHex);
  const lightS = clamp(g.lighting_saturation ?? 0.33, 0, 1);
  const lightL = clamp(Math.max(g.lighting_lightness ?? 0.85, l), 0, 0.98);
  const core = (a) => hsl(lightH, lightS, lightL, a);
  const lift = (a) => hsl(lightH, clamp(lightS * 0.60, 0, 1), lightL, a);

  return {
    shell:   hsl(h, s, l),
    // The one surviving tone of the old airbrush gradient. It is NOT a head
    // treatment any more (the head is flat `shell`, see drawBug); the elytra
    // pass is its only consumer, where it separates the two wing covers.
    deep:    hsl(h, s * 1.02, Math.max(0.20, l - 0.14)),
    // Body-segment bloom. All six stops are now the SAME authored colour —
    // `light_hue`'s hue at `lighting_saturation`/`lighting_lightness` — the core
    // three at full strength and the outer three with the saturation pulled back
    // (see `lift`), fading out to nothing well short of the rim so the edge
    // stays flat undarkened `shell`.
    // Six stops, all faint: see BLOB_ALPHA for why the numbers are this low.
    segBloom:     core(BLOB_ALPHA),
    segBloomMid:  core(BLOB_ALPHA * 0.68),
    segBloomMid2: core(BLOB_ALPHA * 0.44),
    segBloomFar:  lift(BLOB_ALPHA * 0.24),
    segBloomFar2: lift(BLOB_ALPHA * 0.10),
    segBloomOut:  lift(0),
    // The crown mark — a flat colour patch on the head's own surface. Gold and
    // orange straight off REF_PALETTE, never computed from the body hue.
    crownSolid:    REF_PALETTE.gold,
    crownBlendTop: refA(REF_PALETTE.gold, 0.95),
    crownBlendMid: refA(REF_PALETTE.orange, 0.62),
    crownBlendOut: refA(REF_PALETTE.orange, 0),
    // The soft centreline. It is the segment's own shell colour and it is drawn
    // ON TOP OF the bloom, so its job is to bring that patch of segment back to
    // `shell`. RAISED 0.30 → 0.72: at 0.30 the result was 70% bloom, i.e. a
    // stripe of light cream-tinted body rather than of body colour, which is why
    // it read as "some other colour" instead of "the shell, faded". At 0.72 the
    // shell dominates the blend unambiguously and the line reads as the body's
    // own colour softened by whatever light is left over it.
    shellSoft:   hsl(h, s, l, 0.72),
    shellClear:  hsl(h, s, l, 0),
    seam:      hsl(h, s * 1.05, Math.max(0.16, l - 0.20)),
    seamClear: hsl(h, s * 1.05, Math.max(0.16, l - 0.20), 0),
    // The translucency border — same deep tone as the seam, at a low, fixed
    // alpha, so it reads as a thin, less-opaque edge rather than an outline.
    // See TRANSLUCENT_BORDER_ALPHA/THRESHOLD.
    segBorder: hsl(h, s * 1.05, Math.max(0.16, l - 0.20), TRANSLUCENT_BORDER_ALPHA),
    limb:    inkLimbs ? '#17161c' : hsl(h, s * 0.92, Math.max(0.24, l - 0.16)),
    limbLo:  inkLimbs ? '#0e0d11' : hsl(h, s * 0.95, Math.max(0.18, l - 0.24)),
    accent:  hsl(accentH, 0.72, 0.60),
    horn:    hsl(h, s * 0.90, Math.max(0.26, l - 0.10)),
    sclera:  '#ffffff',
    // NO `iris`. The eye carries no coloured disc of any kind on any fill
    // treatment now — see drawEyes. `accentH` survives because `accent` below
    // still uses it.
    pupil:   '#14131a',
    // WINGS ARE NEVER TINTED BY THE GENOME. Every other surface here derives
    // from the body hue; the wing membrane deliberately does not. The reference
    // sheet draws the same neutral grey membrane on every bug whatever colour
    // that bug is, and both tones are locked at exactly 0.70 alpha — the two
    // greys differ only in value, so overlapping blades still separate.
    wing:    'rgba(178,181,188,0.70)',
    wingLo:  'rgba(146,150,159,0.70)',
    // Wing tip wash. White is the default and is NOT a REF_PALETTE slot (the
    // palette has no white), so it is state 0 of `wing_tip_hue`; 1–10 pick a
    // swatch. Same two-stop-into-nothing technique as the blended crown mark.
    wingTip:    wingTipColour(g, 0.78),
    wingTipOut: wingTipColour(g, 0),
    h, s, l, inkLimbs,
  };
}

/* ========================================================== body plan ==== */

/**
 * `body_length` used to decide this. It no longer reaches the renderer at all
 * (see buildTrunk) — a many-legged bug is a myriapod when it is actually built
 * out of many segments, which is what the word means.
 */
export function bodyPlan(g) {
  if (g.leg_count >= 8 && g.body_segments >= 6) return 'myriapod';
  if (g.leg_count >= 8) return 'arachnid';
  return 'insect';
}

/**
 * Horns, redrawn from the reference sheet. Every one of them mounts on the REAR
 * OF THE HEAD (see drawHorn) and points forward, with `horn_serration` adding
 * notches at 0/1/2 without changing the silhouette underneath.
 *
 * `crown` is the one survivor of the old set and is deliberately exempt from the
 * redesign: its geometry is untouched and horn_serration does nothing to it.
 */
export const HORN_TYPES = ['nose', 'pincer', 'y_shaped', 'split', 'crown'];
/**
 * WING_TYPE IS NO LONGER A SHAPE PICKER.
 *
 * It used to enumerate five blade shapes and one of them (`elytra`) was a
 * structurally different thing wearing the same enum. The blade shape is now
 * DERIVED from the wing's own proportions (see wingShapeCoefficient), so the
 * only question left for this gene is the structural one it was smuggling all
 * along: does this bug fan soft membranous blades, or does it fold hard shell
 * covers over its abdomen?
 *
 *   0 membranous  soft blades — the shape family comes from the coefficient
 *   1 elytra      hard covers laid on the abdomen; no blades at all
 *
 * INDEX 1 IS LOAD-BEARING: classification.js pins Ladybird with `wing_type: 1`
 * meaning elytra, so elytra had to keep its slot.
 */
export const WING_TYPES = ['membranous', 'elytra'];

/**
 * THE THREE MEMBRANOUS BLADE SILHOUETTES, traced from `Image References/WIngs.jpg`.
 *
 *   leaf      broad and rounded, widest just past mid-length, blunt tip.
 *             Top-left panel, and the isolated four-wing close-up top-right.
 *   oval      a shorter, narrower, near-symmetric oval. Bottom-left panel.
 *   crescent  a long thin blade that bows backward and tapers to a fine curved
 *             point. Bottom-middle panel and the close-up bottom-right — by far
 *             the most extreme silhouette of the three.
 *
 * The top-middle panel is NOT a fourth family: it is the top-left silhouette at
 * a larger sweep angle with a gold tip wash, i.e. exactly what `wing_angle` plus
 * `wing_tip_hue` already produce from the `leaf` family. Treating it as its own
 * shape would have duplicated `leaf` under a second name.
 */
export const WING_SHAPES = ['leaf', 'oval', 'crescent'];

/**
 * SHAPE COEFFICIENT — wings change family by proportion, not by a type switch.
 *
 * A single slenderness number, on the same "derived gate" pattern as bodyPlan():
 *
 *     coefficient = clamp(0.5 + 0.50·wing_length − 0.70·wing_width − 0.30·wing_roundness, 0, 1)
 *
 * Longer pushes it up; wider and rounder push it down. Then two thresholds:
 *
 *     coefficient <  0.34   →  leaf       (broad, round, low slenderness)
 *     coefficient <  0.62   →  oval       (the middle ground)
 *     otherwise             →  crescent   (long, thin, high slenderness)
 *
 * The gene defaults (length 0.55, width 0.46, roundness 0.55) evaluate to 0.288,
 * so an untouched genome wears the `leaf` of the top-left panel.
 */
export function wingShapeCoefficient(g) {
  return clamp(
    0.5 + 0.50 * (g.wing_length ?? 0.55)
        - 0.70 * (g.wing_width ?? 0.46)
        - 0.30 * (g.wing_roundness ?? 0.55),
    0, 1,
  );
}

/** The coefficient's thresholds, as a family name. */
export function wingShape(g) {
  const c = wingShapeCoefficient(g);
  return c < 0.34 ? 'leaf' : c < 0.62 ? 'oval' : 'crescent';
}

/**
 * Per-family proportion multipliers. These are what make the three read as
 * different silhouettes rather than one silhouette at three sizes: the crescent
 * is far longer and less than half as wide as the leaf, the oval is the
 * stubbiest of the three.
 */
const WING_FAMILY = {
  leaf:     { lenK: 1.00, widK: 1.30 },
  oval:     { lenK: 0.72, widK: 1.06 },
  crescent: { lenK: 1.38, widK: 0.42 },
};

/**
 * SWEEP ANGLE, calibrated off the sketch rather than guessed.
 *
 * Measured from the body's long axis (0° = straight forward, past the head) to
 * the wing's own axis, across the four full-bug panels: top-left ≈ 55°,
 * bottom-left ≈ 100°, top-middle ≈ 110°, bottom-middle ≈ 150°. The MAPPING is
 * unchanged and does not need to be — 35° at gene 0, 165° at gene 1.
 *
 * WHAT CHANGED IS THE GENE'S REACHABLE WINDOW: `wing_angle` is now 0.7–1.0
 * (see genes.js), i.e. 126°–165°, so a resting wing is always swept well back
 * the way the sheet draws it. Its 0.85 default renders
 * lerp(35°, 165°, 0.85) = 145.5°. The old comment claimed 0.50 renders the
 * sketch's ≈100° median; 0.50 is no longer reachable, and 100° is now a FLIGHT
 * angle rather than a resting one — see FLIGHT_SWEEP_OFFSET.
 */
const WING_SWEEP_MIN = 0.61;   // 35°
const WING_SWEEP_MAX = 2.88;   // 165°

/**
 * "WHEN FLYING" — there is no `flying` state in this codebase.
 *
 * The pose machine has exactly three states: `idle`, `walk`, `attack` (see
 * ANIM_ORDER, and the builder's pose buttons). Nothing in it represents flight
 * as a distinct thing. The two states that DO represent locomotion are `walk`
 * and `attack`, and they are already the two that beat the wings at all — the
 * flap term in drawSoftWings() turns on for exactly those two. So "flying" is
 * read here as "the wings are beating", i.e. walk or attack, which keeps the
 * sweep offset and the flap perfectly in step: a bug either has its wings back
 * and still, or forward and beating, never one without the other.
 *
 * The offset swings them 0.3 of the gene's range FORWARD (−0.3 → −39°) for the
 * beat. Given the gene's own 0.7–1.0 window the result lands in 0.4–0.7
 * (87°–126°), so the clamp floor of 0 is never actually reached; it is there
 * because the sweep mapping's domain is 0–1 and a value outside it would
 * extrapolate the lerp, not because 0.4 needs defending.
 */
const FLIGHT_SWEEP_OFFSET = 0.30;

/** Sweep in radians for a pose state. Exported so tests can state the claim. */
export function wingSweep(g, state) {
  const flying = state === 'walk' || state === 'attack';
  const v = clamp((g.wing_angle ?? 0.85) - (flying ? FLIGHT_SWEEP_OFFSET : 0), 0, 1);
  return lerp(WING_SWEEP_MIN, WING_SWEEP_MAX, v);
}
/**
 * EYES ARE ONE SHAPE NOW.
 *
 * `Image References/Eyes_Noses.jpg` draws three heads in its EYES row and all
 * three carry the SAME silhouette — a wedge/comma, wide and rounded at the
 * outer-top corner, tapering to a point at the inner-lower side, tucked against
 * the head edge so the head crops its inner half. The three icons differ only in
 * how that one shape is FILLED. So the old four-way shape switch (almond/round/
 * teardrop/compound) is gone: eyeWedgePath() is the only silhouette, and
 * `eye_type` was repurposed to pick the surface treatment instead.
 *
 *   0 dark      near-black fill with a scatter of small white dots
 *   1 notched   white fill with a dark notch hugging the outer-top corner
 *   2 hooked    white fill with a small dark hook/comma mark near that corner
 */
export const EYE_FILLS = ['dark', 'notched', 'hooked'];

/**
 * CROWN MARK — a flat colour patch capping the top of the head.
 *
 * NAMING: this is UNRELATED to HORN_TYPES' `'nose'`, which is a spike of horn
 * geometry mounted on the thorax. The sketch labels this row "NOSES" too, but it
 * is a marking painted on the head's own surface with no geometry of its own,
 * and reusing the word would guarantee the two get conflated. Hence `crown`.
 *
 *   0 none      no marking at all
 *   1 solid     a solid gold cap with a hard, crisp lower edge
 *   2 blended   the same cap area, faded down into the head's base colour with
 *               no edge — the ONLY gradient permitted anywhere on the head
 */
export const CROWN_MARKS = ['none', 'solid', 'blended'];
/**
 * THREE kinds, not four. `chelicerae_teeth` and `chelicerae_smooth` were the
 * same column drawn twice, differing by a single fang at the tip — a serration
 * level pretending to be a kind, and the one place in the file where
 * `mandible_serration` was deliberately ignored. They are merged: `chelicerae`
 * is one kind, and its fang appears at `mandible_serration ≥ 1` exactly like
 * every other tooth on every other jaw here.
 */
export const MANDIBLE_TYPES = ['wide_thin', 'narrow_thick', 'chelicerae'];

/** The sketch's 0 SR / 1 SR / 2 SR. Horn serration is already an integer gene. */
export const hornSerration = (g) => clamp(Math.round(g.horn_serration ?? 0), 0, 2);
/**
 * The mandible side reuses `mandible_serration`, which has to stay continuous
 * because stats.js multiplies the bite by it. The renderer buckets it here.
 */
export const mandibleSerration = (g) => Math.min(2, Math.floor((g.mandible_serration ?? 0) * 3));

/* ============================================================ layout ===== */

/**
 * Skeleton in local pixel space, built along +x with +y lateral. drawBug()
 * rotates the whole thing so the bug points up; keeping the build in +x means
 * all the fan/spacing maths stays readable.
 */
export function layout(g, ppu = 26) {
  const m = morphology(g);
  const plan = bodyPlan(g);

  // Round, never planky.
  const maxRatio = plan === 'myriapod' ? 3.4 : 1.75;
  let bodyLen = m.length * ppu * 0.86;
  let bodyWid = m.width * ppu * 1.30;
  const ratio = bodyLen / bodyWid;
  if (ratio > maxRatio) bodyWid = bodyLen / maxRatio;
  if (ratio < 0.95) bodyLen = bodyWid * 0.95;

  const unit = (bodyLen + bodyWid) * 0.5;

  const L = {
    g, m, plan, ppu, bodyLen, bodyWid, unit,
    parts: [], legs: [], eyes: [], antennae: [],
    hornType: HORN_TYPES[g.horn_type ?? 0],
    wingType: WING_TYPES[clamp(Math.round(g.wing_type ?? 0), 0, WING_TYPES.length - 1)],
    wingShape: wingShape(g),
    eyeFill: EYE_FILLS[clamp(Math.round(g.eye_type ?? 0), 0, 2)],
    crownMark: CROWN_MARKS[clamp(Math.round(g.crown_mark_style ?? 0), 0, 2)],
    mandibleType: MANDIBLE_TYPES[clamp(Math.round(g.mandible_type ?? 0), 0, MANDIBLE_TYPES.length - 1)],
    wingPairs: g.wing_count / 2,
    wingArea: g.wing_area,
    setae: g.setae,
  };

  buildTrunk(L);
  buildLegs(L);
  buildHead(L);

  let maxX = 0, maxY = 0;
  const bump = (x, y) => { maxX = Math.max(maxX, Math.abs(x)); maxY = Math.max(maxY, Math.abs(y)); };
  for (const p of L.parts) { bump(p.x + p.rx, p.ry); bump(p.x - p.rx, p.ry); }
  for (const leg of L.legs) { bump(leg.foot.x, leg.foot.y); bump(leg.knee.x, leg.knee.y); }
  for (const e of L.eyes) bump(e.x + e.rx, e.y + e.ry);
  // Horns grow off the REAR OF THE HEAD now, so the bound is measured from
  // there — same origin drawHorn() uses, see HORN_BASE_K. The 1.1 covers
  // `split`, whose tip lands at 1.05 × hornLen past its own base.
  bump(hornOriginX(L) + L.hornLen * 1.1, L.hornLen * 0.7);
  bump(L.tailTip?.x ?? 0, L.tailTip?.y ?? 0);
  if (L.wingPairs > 0) bump(L.wingSpan.x, L.wingSpan.y);

  // The ground shadow is blurred outward from the trunk, so the frame has to
  // leave room for its falloff or the baked sprite crops it into a straight
  // edge. The spread factor covers the blob growing past the silhouette it
  // traces; the blur term covers the soft edge past that — see SHADOW_SPREAD
  // / SHADOW_BLUR_BODY_K.
  const shadowPad = unit * (SHADOW_SPREAD - 1 + SHADOW_BLUR_BODY_K * 1.5);
  L.half = Math.ceil(Math.max(maxX, maxY) + unit * 0.05 + shadowPad + 3);
  return L;
}

/* ---------------------------------------------------------------- trunk -- */

/**
 * SEGMENT MODEL
 *
 * `body_segments` is the number of TRUNK segments. The head is not one of them —
 * it is always present and always separate. Segment 1 is the thorax; every
 * segment after it is an abdominal segment:
 *
 *   1  → thorax only. NO abdomen. The bug is a head and a ball of legs.
 *   2  → thorax + one abdomen. The default, and what most bugs are.
 *   3+ → thorax + a chain of abdominal segments, each shorter and narrower than
 *        the one in front of it so the whole thing still tapers to a point.
 *   6+ → with 8 or more legs this becomes the myriapod plan instead, one leg
 *        pair per segment.
 *
 * `body_length` deliberately appears nowhere below. Trunk extent is segment
 * count times segment size; a separate "length" gene fighting the same axis is
 * what made long bugs read as sausages.
 *
 * L.thorax and L.abdomen are the named handles the rest of the file uses.
 * L.abdomen is NULL when body_segments is 1 — every consumer must guard it.
 */
function buildTrunk(L) {
  const { g, plan, bodyWid } = L;
  const segCount = clamp(Math.round(g.body_segments), 1, 10);
  L.segCount = segCount;
  L.abdomenSegs = segCount - 1;          // the thorax is segment 1
  L.thorax = null;
  L.abdomen = null;

  if (plan === 'myriapod') {
    const n = clamp(segCount, 6, 10);
    const segR = bodyWid * 0.46;
    const pitch = segR * 1.40;
    const frontX = pitch * (n - 1) * 0.5;
    L.segCount = n;
    for (let i = n - 1; i >= 0; i--) {
      const t = i / (n - 1);
      const r = segR * lerp(0.76, 1.0, Math.sin(t * Math.PI * 0.85 + 0.35));
      L.parts.push({ x: frontX - pitch * i, y: 0, rx: r * 1.02, ry: r, kind: 'seg', t });
    }
    L.trunkFrontX = frontX;
    // The frontmost ring stands in for the thorax so legs, wings and the head
    // all have something to anchor to. It is still drawn with its siblings.
    L.thorax = L.parts[L.parts.length - 1];
    L.abdomen = L.parts[0] ?? null;
    return;
  }

  // Insect and arachnid share the same construction; only the proportions and
  // the name of the front mass differ.
  const arach = plan === 'arachnid';

  /**
   * WIDTH AND LENGTH ARE SEPARATE GENES PER MASS.
   *
   * `thorax_ratio` is gone and no trunk mass reads a single shared radius any
   * more. `ry` is the LATERAL half-axis (width), `rx` the along-the-body one
   * (length) — the chain is laid out along +x, so that is the axis a longer
   * abdomen grows on. `body_width` is still the scale all four are a fraction
   * of, so it remains the one overall-size knob; what it no longer decides is
   * the proportion BETWEEN the masses.
   *
   * The ARACHNID factors below replace what used to be hardcoded constants
   * (abR 0.56, thR 0.42 with no gene input at all). They are now multipliers on
   * the gene-driven radius rather than replacements for it, so an arachnid's
   * head, thorax and abdomen answer to the same six genes as everyone else's
   * while keeping the plan's chunkier proportions.
   */
  const abW = bodyWid * lerp(0.22, 1.00, g.abdomen_width ?? 0.41) * (arach ? 1.037 : 1);
  const abL = bodyWid * lerp(0.22, 1.00, g.abdomen_length ?? 0.41) * (arach ? 1.037 : 1);
  // widened both ends: the thorax can go much slimmer and much heavier than the
  // old 0.34–0.44 window allowed.
  const thW = bodyWid * lerp(0.16, 0.70, g.thorax_width ?? 0.287) * (arach ? 1.334 : 1);
  const thL = bodyWid * lerp(0.16, 0.70, g.thorax_length ?? 0.287) * (arach ? 1.334 : 1);

  // Thorax sits at the origin; the abdominal chain grows backwards from it.
  const thorax = { x: 0, y: 0, rx: thL * (arach ? 1 : 1.04), ry: thW, kind: 'thorax' };

  const n = L.abdomenSegs;
  const abParts = [];
  if (n > 0) {
    // One segment keeps the old proportion; more segments each get shorter so a
    // ten-segment bug is long without being ten bodies long.
    const segLen = abL * (1.16 / Math.sqrt(n));
    const tipNarrow = lerp(1.0, 0.55, g.abdomen_taper);
    let x = -(thL * 0.74) - segLen * 0.60;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      // `abdomen_taper` STAYS: it is a roundness/shape modifier layered on top
      // of the size genes, not a size control of its own.
      const ry = abW * (1 - g.abdomen_taper * (arach ? 0.18 : 0.22)) * lerp(1.0, tipNarrow, t);
      abParts.push({ x, y: 0, rx: segLen, ry, kind: 'abdomen', seg: i });
      x -= segLen * 1.15;
    }
  }

  // parts stay ordered rear → front, which is what the tail, the wing anchor and
  // the myriapod leg host all read off.
  for (let i = abParts.length - 1; i >= 0; i--) L.parts.push(abParts[i]);
  L.parts.push(thorax);
  L.thorax = thorax;
  L.abdomen = abParts[0] ?? null;        // frontmost/largest abdominal segment
  L.trunkFrontX = thorax.x + thorax.rx;
}

/* ----------------------------------------------------------------- legs -- */

function buildLegs(L) {
  const { g, plan, unit } = L;
  const pairs = plan === 'myriapod' ? L.segCount : g.leg_count / 2;
  // widened both ends (was 0.80–1.40)
  const len = unit * lerp(0.55, 1.85, g.leg_length) * (plan === 'myriapod' ? 0.50 : 1);
  // Capsule limbs want real weight — thin lines look like hair, not design.
  // widened both ends (was 0.070 + 0.075x, clamped 2.6–13)
  const w = clamp(unit * (0.050 + g.leg_thickness * 0.115), 2.2, 16);

  for (let i = 0; i < pairs; i++) {
    const t = pairs === 1 ? 0.5 : i / (pairs - 1);
    let ax, ay;
    if (plan === 'myriapod') {
      const host = L.parts[L.parts.length - 1 - i] ?? L.parts[0];
      ax = host.x; ay = host.ry * 0.80;
    } else if (plan === 'arachnid') {
      const c = L.thorax;
      ax = c.x + lerp(c.rx * 0.46, -c.rx * 0.54, t); ay = c.ry * 0.76;
    } else {
      const th = L.thorax;
      ax = th.x + lerp(th.rx * 0.54, -th.rx * 0.62, t); ay = th.ry * 0.80;
    }
    // widened both ends (was 0.60 + 0.55x)
    const fan = lerp(-0.52, 0.78, t) * (0.42 + g.leg_spread * 0.86);
    for (const side of [-1, 1]) {
      L.legs.push(buildLeg({
        ax, ay: ay * side, side, pair: i, t,
        // The foot pad is a fixed size now (FOOT_PAD_R), so there is nothing
        // per-leg to carry here any more — `footSize` is gone with its gene.
        len: len * lerp(1.05, 0.92, t), w, fan,
        joints: g.leg_joints,
      }));
    }
  }
}

function buildLeg(o) {
  // Components, not polar angles: the lateral term is cos(tilt), positive for
  // any |tilt| < 90°, so a leg can never swing back across the shell.
  const tilt = clamp(o.fan, -0.75, 0.95);
  const bend = 0.40;
  const out = o.side;
  const kx = o.ax - Math.sin(tilt) * o.len * 0.50;
  const ky = o.ay + out * Math.cos(tilt) * o.len * 0.50;
  const fx = kx - Math.sin(tilt + bend) * o.len * 0.58;
  const fy = ky + out * Math.cos(tilt + bend) * o.len * 0.58;
  return { ...o, tilt, attach: { x: o.ax, y: o.ay }, knee: { x: kx, y: ky }, foot: { x: fx, y: fy } };
}

/* ----------------------------------------------------------------- head -- */

function buildHead(L) {
  const { g, plan, bodyWid, unit } = L;
  /**
   * TWO AXES, TWO GENES. `head_size` is gone; `head_width` sets the lateral
   * half-axis and `head_length` the along-the-body one, on the same
   * fraction-of-`body_width` scale the thorax and abdomen use.
   *
   * The old single window (0.16–0.62 of body width, arachnids pinned at a
   * hardcoded 0.28) is preserved in spirit: the range is widened at both ends
   * again, the default lands on the old 0.206-of-body-width head so an
   * untouched genome is unchanged, and the arachnid's chunkier head is now a
   * multiplier on the gene rather than a constant that ignored it.
   *
   * `headR` survives as the MEAN of the two axes, for the handful of things
   * that want one number for "how big is this head" (mandible reach, eye size).
   */
  const arach = plan === 'arachnid';
  const headW = bodyWid * lerp(0.12, 0.80, g.head_width ?? 0.13) * (arach ? 1.36 : 1);
  const headL = bodyWid * lerp(0.12, 0.80, g.head_length ?? 0.13) * (arach ? 1.36 : 1);
  const headR = (headW + headL) * 0.5;
  const hx = L.trunkFrontX + headL * (arach ? 0.06 : 0.54);
  L.head = { x: hx, y: 0, rx: headL, ry: headW, kind: 'head' };

  // The wedge eyes, set wide and tucked under the head edge so it crops the
  // inner half. `ry` is the long axis, `rx` the short one — the sketch's eye is
  // clearly taller than it is wide, hence the 0.55 rather than something nearer
  // a circle, and it is pushed far enough out that the rounded outer-top corner
  // clears the head silhouette instead of hiding behind it.
  const er = headR * lerp(0.45, 1.05, g.eye_size);   // widened both ends
  for (const side of [-1, 1]) {
    // Placed per-axis — along the head's length in x, across its width in y —
    // so an eye still sits on the head edge when the two differ.
    L.eyes.push({
      x: hx + headL * 0.04,
      y: side * headW * 0.98,
      rx: er * 0.55, ry: er, side,
    });
  }
  /*
   * THE EXTRA EYES ARE AN ARRAY, not a scatter.
   *
   * They used to be plain dark circles at 0.17 × the main radius, dropped along
   * a line that zig-zagged across the midline — one on the left, the next on the
   * right, each at a different x AND a different y. Three of them read as three
   * unrelated specks someone had flicked at the head, and at a large `eye_size`
   * the first one landed inside the main wedge's own footprint.
   *
   * Now: one small GRID. Two columns, mirrored about the midline exactly as the
   * main pair is, and one ROW PER EXTRA PAIR stepping back down the head. So
   * eye_count 4 is a single row of two, 6 adds a second row behind it, 8 a
   * third — the ceiling is unchanged, only the arrangement is.
   *
   * They are the same eyeWedgePath silhouette as the main pair, scaled down, so
   * a bug's eyes all look like the same organ.
   *
   * NON-OVERLAP IS COMPUTED, not eyeballed. `inner` is how far the main wedge
   * actually reaches toward the midline: walking eyeWedgePath's control points
   * through the 0.30 lean, the closest approach is the outer-edge belly at
   * (−0.30R, −1.10r), i.e. 0.30·sin(0.30)·R + 1.10·cos(0.30)·r ≈ 0.667 × the
   * main radius once r = 0.55R is substituted. The array's own half-extent is
   * mr × (COL + 1.70) — column offset plus the small wedge's outer belly — and
   * `mr` is solved so that lands inside 85% of the gap. The 0.26 ceiling is the
   * separate promise that these are always visibly SMALLER than the main pair.
   */
  const extra = clamp(Math.round(g.eye_count / 2) - 1, 0, 3);
  if (extra > 0) {
    const COL = 1.55;                            // column offset, in small radii
    const inner = Math.max(0, headW * 0.98 - er * 0.667);
    const mr = clamp(Math.min(er * 0.26, inner * 0.85 / (COL + 1.70)),
                     er * 0.09, er * 0.26);
    const x0 = hx + headL * 0.44;
    for (let row = 0; row < extra; row++) {
      for (const side of [-1, 1]) {
        L.eyes.push({
          x: x0 - row * mr * 2.8,
          y: side * mr * COL,
          rx: mr * 0.55, ry: mr, side, minor: true,
        });
      }
    }
  }

  // Antennae read longer: the window was 0.10–0.58 of the body unit, now
  // 0.06–0.95 — shorter at the bottom, far longer at the top, and the calibrated
  // default (0.55) lands well past the old maximum-ish middle.
  const antLen = unit * lerp(0.06, 0.95, g.antenna_length);
  if (antLen > unit * 0.15) for (const side of [-1, 1]) L.antennae.push({ side, len: antLen });

  // Horns read bigger: bases lowered (0.26 → 0.18) and every ceiling raised.
  const hornMax = L.hornType === 'nose' ? 1.15 : L.hornType === 'split' ? 1.55 : 1.30;
  L.hornLen = g.horn_size < 0.12 ? 0 : unit * lerp(0.18, hornMax, g.horn_size);
  L.mandible = g.mandible_size < 0.10 ? 0 : headR * lerp(0.38, 1.22, g.mandible_size);

  // With body_segments === 1 there is no abdomen, so the tail hangs off the
  // thorax. L.parts is never empty — the thorax is always there.
  const rear = L.parts[0];
  const tailLen = unit * lerp(0, 0.62, g.tail_length);   // widened top end
  if (tailLen > unit * 0.08) {
    L.tail = { len: tailLen, x0: rear.x - rear.rx * 0.62, sting: g.stinger_size };
    L.tailTip = { x: rear.x - rear.rx * 0.62 - tailLen, y: 0 };
  }

  if (L.wingPairs > 0 && L.wingArea > 0.05) {
    L.wing = wingMetrics(L);
    const reach = L.wing.len + L.wing.wid;
    L.wingSpan = { x: Math.abs(L.parts[0].x) + reach * 0.90, y: bodyWid * 0.5 + reach * 0.80 };
  } else {
    L.wingPairs = 0;
    L.wing = null;
    L.wingSpan = { x: 0, y: 0 };
  }
}

/**
 * One blade's length, half-width and sweep, in local pixels. Computed once in
 * layout() so the bounding box and the draw pass can never disagree.
 *
 * THE FOUR SIZE GENES ARE INDEPENDENT BY CONSTRUCTION:
 *   wing_area    scales len AND wid together — overall size, nothing else.
 *   wing_length  scales len only.
 *   wing_width   scales wid only (as a fraction of len, so it is a real aspect
 *                ratio rather than a second length knob).
 *   wing_roundness  touches neither; it only moves the outline's control points
 *                (see wingPath), so a rounder wing occupies the same box.
 * They do all feed the shape coefficient, which is the intended coupling —
 * a family change is the point — but none of them silently moves another's axis.
 */
function wingMetrics(L) {
  const { g } = L;
  const fam = WING_FAMILY[L.wingShape];
  const size = lerp(0.62, 1.30, L.wingArea);                      // overall size
  const len = L.unit * lerp(0.85, 2.30, g.wing_length ?? 0.55) * fam.lenK * size;
  const wid = len * lerp(0.09, 0.52, g.wing_width ?? 0.46) * fam.widK;
  // The RESTING sweep. Flight subtracts from it at draw time, where the state
  // is known — see wingSweep()/FLIGHT_SWEEP_OFFSET. The bounding box is measured
  // off reach rather than angle, so a swung-forward blade cannot escape it.
  const sweep = wingSweep(g, 'idle');
  return { len, wid, sweep, round: clamp(g.wing_roundness ?? 0.55, 0, 1), fam: L.wingShape };
}

/* ============================================================ drawing ==== */

function fillEllipse(ctx, x, y, rx, ry, fill) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Fraction of the head's own height the crown mark caps, measured from the top.
 * The sketch's cap covers a little under a fifth of the silhouette.
 */
const CROWN_CAP = 0.18;

/**
 * The crown mark — the ONLY thing on the head allowed to carry a blend.
 *
 * Again: nothing to do with HORN_TYPES' `'nose'` spike. This is a flat colour
 * patch on the head's own surface, clipped to the head ellipse so it can never
 * reach past the silhouette, drawn straight after the head's flat fill.
 *
 * Local +x points at the head's front, which is UP in the canonical pose, so the
 * "top" of the head is its +x extreme.
 */
function drawCrownMark(ctx, L, col) {
  if (L.crownMark === 'none') return;
  const h = L.head;
  // The cap's lower edge, in local x. CROWN_CAP is a fraction of the FULL height
  // (2 × rx), so the edge sits that far down from the +x pole.
  const edge = h.x + h.rx * (1 - CROWN_CAP * 2);
  const top = h.x + h.rx;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(h.x, 0, h.rx, h.ry, 0, 0, TAU);
  ctx.clip();

  if (L.crownMark === 'solid') {
    // Hard, crisp edge: a straight cut across the head, no blend at all.
    ctx.fillStyle = col.crownSolid;
    ctx.fillRect(edge, -h.ry * 1.05, top - edge, h.ry * 2.10);
  } else if (ctx.createLinearGradient) {
    // Blended: gold at the very top fading out well before the cap's nominal
    // edge, so there is no edge to see — it dissolves into the flat head fill.
    const foot = h.x + h.rx * (1 - CROWN_CAP * 3.4);
    const gr = ctx.createLinearGradient(top, 0, foot, 0);
    gr.addColorStop(0, col.crownBlendTop);
    gr.addColorStop(0.42, col.crownBlendMid);
    gr.addColorStop(1, col.crownBlendOut);
    ctx.fillStyle = gr;
    ctx.fillRect(foot, -h.ry * 1.05, top - foot, h.ry * 2.10);
  }
  ctx.restore();
}

/** Capsule: one uniform-width round-capped stroke. The core limb primitive. */
function capsule(ctx, ax, ay, bx, by, cx, cy, w, colour) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo(bx, by, cx, cy);
  ctx.stroke();
}

/*
 * speckle() and speckleLimb() USED TO LIVE HERE and are deliberately gone.
 *
 * They were the only readers of `iridescence` on the sprite: a fine accent-hue
 * scatter over every trunk mass and along every leg. The gene went with them
 * (see genes.js) because it existed only to drive this — it named a finish
 * nothing else in the file could express, it was the single exception to the
 * "body segments are FLAT" rule in the style contract at the top, and it cost
 * camouflage in the stat block for a texture most genomes never turned on.
 *
 * `hash01` survives: the horn/jaw `dots` pattern still scatters with it.
 */

/**
 * A filled shape that follows a quadratic curve and tapers from w0 to w1.
 * This is what separates a designed horn from a bent line: real silhouettes
 * need mass at the base and a rounded taper at the tip, which a stroke can't
 * give. See taperedPath for the tip cap.
 */
function taperedCurve(ctx, p0, p1, p2, w0, w1, fill, steps = 16) {
  taperedPath(ctx, p0, p1, p2, w0, w1, steps);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * taperedCurve's outline, left on the context so a caller can clip to it.
 *
 * THE TIP IS CAPPED WITH AN ARC, not a flat chisel edge. Every spike, barb and
 * tooth in the horn/mandible set ends here, and the old straight closing
 * segment is exactly what made them read as cut-off needles: at a narrow w1 the
 * two flanks met at a hard corner on each side of a razor-thin edge. A
 * semicircle of radius w1/2 swung round the endpoint turns that into a blunt,
 * rounded tip. It costs nothing when w1 is genuinely tiny and does all the work
 * when the caller asks for a fatter tip, which the serration callers now do.
 */
function taperedPath(ctx, p0, p1, p2, w0, w1, steps = 16) {
  ctx.beginPath();
  return taperedOutline(ctx, p0, p1, p2, w0, w1, steps);
}

/**
 * taperedPath's geometry WITHOUT the beginPath(), so several pieces can be
 * accumulated into one path and filled together.
 *
 * That is the whole mechanism behind patternedSilhouette(): canvas 2D fills any
 * number of sub-paths under a single fill() with non-zero winding, so a horn
 * made of a shaft plus four barbs can be one shape as far as the fill, the
 * gradient and the clip are concerned — no path union needed, just the
 * discipline of not calling beginPath() or fill() between pieces.
 *
 * Returns the piece's bounding box, which the silhouette pass unions up to size
 * the gradient and the decoration across the WHOLE shape.
 */
function taperedOutline(ctx, p0, p1, p2, w0, w1, steps = 16) {
  const left = [], right = [];
  let tipAngle = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    const x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
    const y = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y;
    const dx = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
    const dy = 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const w = lerp(w0, w1, t) * 0.5;
    left.push({ x: x + nx * w, y: y + ny * w });
    right.push({ x: x - nx * w, y: y - ny * w });
    if (i === steps) tipAngle = Math.atan2(dy, dx);
  }
  const tip = qpoint(p0, p1, p2, 1);
  const r = Math.abs(w1) * 0.5;
  ctx.moveTo(left[0].x, left[0].y);
  for (const p of left) ctx.lineTo(p.x, p.y);
  // Round the tip: the left flank ends at tipAngle + 90°, the right at
  // tipAngle - 90°, so sweep between them THROUGH the forward direction —
  // decreasing angle, i.e. anticlockwise in canvas terms.
  if (r > 0.02) ctx.arc(tip.x, tip.y, r, tipAngle + Math.PI / 2, tipAngle - Math.PI / 2, true);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();

  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of [...left, ...right,
                   { x: tip.x - r, y: tip.y - r }, { x: tip.x + r, y: tip.y + r }]) {
    box.minX = Math.min(box.minX, p.x); box.maxX = Math.max(box.maxX, p.x);
    box.minY = Math.min(box.minY, p.y); box.maxY = Math.max(box.maxY, p.y);
  }
  return box;
}

/* ------------------------------------------------- horn / jaw patterning -- */

/**
 * SURFACE TREATMENTS for the HORN and the MANDIBLES. Body patterns are a later
 * pass; the shell path is untouched.
 *
 * FIVE modes. Index 0 is `flat`, and index 4 is the new one:
 *
 *   flat      solid base colour. No gradient, no dots, no highlight, nothing.
 *   gradient  base lifting to the decoration tone along the shape's long axis
 *   dots      light speckle scattered over the silhouette
 *   oval      one lighter oval patch near the tip, the rest flat
 *   diagonal  repeating 45° stripes across the whole clipped silhouette
 *
 * `flat` exists because there was no way to ask for a plain horn. Bucket 0 was
 * `gradient`, so every genome — including an untouched one — wore a gradient it
 * had not chosen. Now:
 *
 *   mode = min(4, floor(v × 5))   over `pattern_horn` / `pattern_mandible`
 *
 * The divisor moved 4 → 5 with `diagonal`. The 0.08 default still lands in
 * bucket 0 (0.08 × 5 = 0.4), so an untouched genome is still plain and no gene
 * default had to be recalibrated.
 *
 * TWO GENES, not one. The horn and the jaws are separate objects and there is
 * no reason they should agree; `surfacePattern(g, col, 'horn' | 'mandible')`
 * reads the matching gene and every caller says which component it is.
 *
 * THE DECORATION COLOUR IS ITS OWN GENE TOO, one per component:
 * `pattern_horn_hue` and `pattern_mandible_hue`. It used to be the BODY's hue
 * walked toward amber — so "what colour is the pattern on my horn" was not a
 * question a genome could answer, it was a side effect of the shell colour, in
 * exactly the way `light_hue` fixed for the segment bloom. These two index
 * REF_PALETTE_ORDER the same way `light_hue` and `wing_tip_hue` do, and only the
 * HUE comes off the palette: the tone's saturation and lightness are still
 * derived from the piece's own colour and from `pattern_contrast`, so that gene
 * keeps its whole job.
 *
 * `pattern_scale` and `pattern_contrast` stay SHARED across both. They do not
 * choose a treatment, they modulate whichever treatment was chosen — dot
 * coarseness, gradient position, stripe pitch, overall loudness — which is a
 * house style rather than a per-part decision. See the note in genes.js.
 */
const PATTERN_MODES = ['flat', 'gradient', 'dots', 'oval', 'diagonal'];

/** Which gene each component's treatment comes off. */
const PATTERN_GENE = { horn: 'pattern_horn', mandible: 'pattern_mandible' };
/** ...and which gene its decoration colour comes off. */
const PATTERN_HUE_GENE = { horn: 'pattern_horn_hue', mandible: 'pattern_mandible_hue' };

/** @param {'horn'|'mandible'} which — which component's own gene to read. */
export function surfacePattern(g, col, which = 'horn') {
  const k = clamp(g.pattern_contrast ?? 0, 0, 1);
  const hueGene = PATTERN_HUE_GENE[which] ?? 'pattern_horn_hue';
  const h = hexHue(REF_PALETTE[REF_PALETTE_ORDER[
    clamp(Math.round(g[hueGene] ?? 4), 0, REF_PALETTE_ORDER.length - 1)]]);
  const v = clamp(g[PATTERN_GENE[which] ?? 'pattern_horn'] ?? 0, 0, 1);
  return {
    mode: PATTERN_MODES[Math.min(PATTERN_MODES.length - 1, Math.floor(v * PATTERN_MODES.length))],
    scale: clamp(g.pattern_scale ?? 0, 0, 1),
    k,
    lite: hsl(h, clamp(col.s * 1.02, 0, 1), clamp(col.l + 0.10 + k * 0.26, 0, 0.90)),
  };
}

/**
 * ONE HORN IS ONE SURFACE. So is one mandible.
 *
 * This used to be `patternedCurve()`, called once per tapered PIECE — and a
 * horn is not one piece. A serrated `split` horn is a shaft plus four antler
 * branches, five separate calls, so it got five separate gradients each running
 * base→amber across its own few pixels, five independent dot scatters, five
 * oval highlights. The result read as a pile of separately-painted parts rather
 * than as one object with a finish on it, and the smaller the piece the louder
 * the mismatch, because every gradient completed over its own tiny span.
 *
 * The fix is to treat the whole component as one shape:
 *
 *   1. ACCUMULATE  every piece's outline into a single path — one beginPath(),
 *      taperedOutline() per piece, no fill in between (canvas fills any number
 *      of sub-paths under non-zero winding, so no real path union is needed).
 *   2. FILL ONCE   flat, or with a gradient spanning the COMBINED bounding
 *      geometry from the base of the first piece to the far end of the shape.
 *   3. CLIP ONCE   to that same combined path.
 *   4. DECORATE ONCE  dots scattered across the whole silhouette's box, a
 *      single oval highlight near its far end, or one family of diagonal
 *      stripes swept across the box — never once per piece.
 *
 * `pieces` is an array of `{p0, p1, p2, w0, w1}` descriptors. The horn and
 * mandible cases build the array first and hand the lot over, rather than
 * drawing as they go.
 */
function patternedSilhouette(ctx, pieces, base, pat, seed) {
  if (!pieces.length) return;

  // 1. one path, every piece.
  ctx.beginPath();
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let widest = 0;
  for (const p of pieces) {
    let b;
    if (p.circle) {
      // A disc sub-path, for a piece that is a cap rather than a taper (the
      // chelicera's dome). Same accumulation, so it takes the same fill, the
      // same gradient and the same clip as everything else in the silhouette
      // instead of being a separately-coloured lump on the end.
      // ANTICLOCKWISE, and that is load-bearing. Sub-paths are filled by the
      // non-zero rule, so a disc wound against the tapered outlines around it
      // SUBTRACTS where it overlaps them — which turned the chelicera's dome
      // into a ring with the column's tip punched out of it. taperedOutline
      // caps its tip with an anticlockwise arc, so this matches it.
      const { x, y, r } = p.circle;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU, true);
      ctx.closePath();
      b = { minX: x - r, maxX: x + r, minY: y - r, maxY: y + r };
      widest = Math.max(widest, r * 2);
    } else {
      b = taperedOutline(ctx, p.p0, p.p1, p.p2, p.w0, p.w1);
      widest = Math.max(widest, Math.abs(p.w0));
    }
    box.minX = Math.min(box.minX, b.minX); box.maxX = Math.max(box.maxX, b.maxX);
    box.minY = Math.min(box.minY, b.minY); box.maxY = Math.max(box.maxY, b.maxY);
  }

  // The shape's own axis: from the first piece's base to whichever piece tip is
  // furthest from it. On every horn and every jaw here the first piece IS the
  // main shaft, so this is the silhouette's long direction, and the gradient
  // laid along it therefore spans the whole object rather than one facet.
  const root = pieces[0].circle
    ? { x: pieces[0].circle.x, y: pieces[0].circle.y }
    : pieces[0].p0;
  let far = root, farD = -1;
  for (const p of pieces) {
    const tip = p.circle
      ? { x: p.circle.x, y: p.circle.y }
      : qpoint(p.p0, p.p1, p.p2, 1);
    const d = Math.hypot(tip.x - root.x, tip.y - root.y);
    if (d > farD) { farD = d; far = tip; }
  }

  // 2. fill once.
  if (pat.mode === 'gradient' && ctx.createLinearGradient) {
    /*
     * `pattern_scale` MOVES THE TRANSITION. It had no effect on this mode at all
     * before — it was documented as a dots-only knob — so the gradient always
     * ran the full base→tip span and there was no way to ask for "light only at
     * the very tip" or "light almost all the way down".
     *
     * `mid` is where the changeover sits along the root→far axis, and the two
     * stops straddle it by BAND, so a low scale piles the light toward the base
     * and a high scale pushes it out to the tip. 0.5 reproduces the old
     * full-length ramp exactly, which is what keeps this a new control rather
     * than a change to what gradient already meant.
     */
    const BAND = 0.34;
    const mid = 0.20 + pat.scale * 0.60;
    const gr = ctx.createLinearGradient(root.x, root.y, far.x, far.y);
    gr.addColorStop(0, base);
    gr.addColorStop(clamp(mid - BAND, 0.001, 0.998), base);
    gr.addColorStop(clamp(mid + BAND, 0.002, 0.999), pat.lite);
    gr.addColorStop(1, pat.lite);
    ctx.fillStyle = gr;
  } else {
    ctx.fillStyle = base;
  }
  ctx.fill();

  // `flat` is exactly what it says: the solid fill above and nothing else.
  if (pat.mode === 'flat' || pat.mode === 'gradient') return;

  // 3. clip once — to the combined path, which is still the current path.
  ctx.save();
  ctx.clip();

  const bw = Math.max(1, box.maxX - box.minX);
  const bh = Math.max(1, box.maxY - box.minY);

  if (pat.mode === 'dots') {
    // 4. one scatter over the whole silhouette's box. The clip discards
    // whatever lands off the shape, which is what keeps the density even
    // across a shaft and its barbs instead of restarting on each.
    const n = Math.round(lerp(34, 9, pat.scale) * (1 + Math.min(2, pieces.length - 1) * 0.5));
    const r = Math.max(0.6, lerp(0.16, 0.40, pat.scale) * widest);
    ctx.fillStyle = pat.lite;
    ctx.globalAlpha = 0.35 + pat.k * 0.6;
    for (let i = 0; i < n; i++) {
      const x = box.minX + hash01(i, seed) * bw;
      const y = box.minY + hash01(i, seed + 11) * bh;
      ctx.beginPath();
      ctx.arc(x, y, r * (0.6 + hash01(i, seed + 31)), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (pat.mode === 'diagonal') {
    /*
     * 4. ONE family of 45° stripes across the WHOLE accumulated silhouette.
     *
     * Same discipline as the dots: the bars are laid out over the combined
     * bounding box and the single clip established above throws away whatever
     * misses the shape. A shaft and its four barbs therefore wear one continuous
     * striping that lines up across the joins, instead of five independent
     * stripe families each restarting on its own piece.
     *
     * The frame is rotated −45° about the box's top-left corner, so the bars are
     * plain vertical rects in that frame and their spacing is a straight
     * `period` step. `span` is the box's own diagonal reach, doubled, which is
     * more than enough to cover the box from any corner after the rotation.
     */
    const period = Math.max(2.2, lerp(0.50, 1.80, pat.scale) * Math.max(2, widest));
    const span = bw + bh;
    ctx.save();
    ctx.translate(box.minX, box.minY);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = pat.lite;
    ctx.globalAlpha = 0.34 + pat.k * 0.52;
    for (let d = -span; d <= span; d += period) {
      ctx.fillRect(d, -span, period * 0.42, span * 2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  } else {
    // 4. ONE highlight patch, near the far end of the whole shape.
    const c = { x: lerp(root.x, far.x, 0.74), y: lerp(root.y, far.y, 0.74) };
    const a = Math.atan2(far.y - root.y, far.x - root.x);
    const w = Math.max(1, widest * 0.55);
    ctx.fillStyle = pat.lite;
    ctx.globalAlpha = 0.55 + pat.k * 0.45;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, Math.max(w * 1.05, farD * 0.16), w * 0.60, a, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** Point on the same quadratic taperedPath walks. */
function qpoint(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

/* ---------------------------------------------------------------- wings -- */

/**
 * One blade outline, traced from `Image References/WIngs.jpg`.
 *
 * Built root-at-origin running along +x, so the caller only has to translate to
 * the wing root and rotate by the sweep. Every family is a closed two-curve
 * outline — a leading edge out to the tip, a trailing edge back to the root —
 * which is what lets the tip actually come to a point instead of an ellipse's
 * blunt cap. `round` (0..1) slides the tip control points between a fine taper
 * and a blunt rounded cap WITHOUT moving len or wid, so roundness never leaks
 * into the wing's size.
 */
function wingPath(ctx, fam, len, wid, round) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  if (fam === 'crescent') {
    // Long thin blade bowed backward, tapering to a fine curved point. The tip
    // sits `bow` off the wing's own axis — that sideways drift is the whole
    // silhouette in the bottom-middle and bottom-right panels.
    const bow = len * 0.20;
    const tipX = len * (1 - round * 0.04);
    ctx.bezierCurveTo(len * 0.30, -wid * 0.92, len * 0.72, -wid * 0.58, tipX, bow);
    ctx.bezierCurveTo(len * 0.70, bow * 0.34 + wid * (0.26 + round * 0.30),
                      len * 0.34, wid * (0.58 + round * 0.22), 0, 0);
  } else if (fam === 'oval') {
    // Shorter, plumper, near-symmetric — bottom-left panel. The widest point
    // sits dead centre rather than past it, and BOTH ends are round.
    const tipX = len * (0.94 + round * 0.06);
    const tipY = wid * (0.26 + round * 0.20);
    ctx.bezierCurveTo(len * 0.10, -wid * 1.10, len * 0.60, -wid * 1.08, tipX, -tipY);
    ctx.bezierCurveTo(len * (1.04 + round * 0.03), 0, len * (1.04 + round * 0.03), 0, tipX, tipY);
    ctx.bezierCurveTo(len * 0.60, wid * 1.08, len * 0.10, wid * 1.10, 0, 0);
  } else {
    // leaf — broad and rounded, widest just past mid-length, BLUNT tip. The
    // top-left panel and the top-right close-up both end in a rounded cap, not
    // a point, so the tip is drawn as a short curve across rather than a taper.
    const tipX = len * (0.90 + round * 0.08);
    const tipY = wid * (0.30 + round * 0.22);
    ctx.bezierCurveTo(len * 0.06, -wid * 1.16, len * 0.58, -wid * 1.14, tipX, -tipY);
    ctx.bezierCurveTo(len * (1.06 + round * 0.04), 0, len * (1.06 + round * 0.04), 0, tipX, tipY);
    ctx.bezierCurveTo(len * 0.56, wid * 1.10, len * 0.10, wid * 0.80, 0, 0);
  }
  ctx.closePath();
}

/**
 * The membranous blades.
 *
 * COLOUR IS FIXED: the membrane is always `col.wing`/`col.wingLo`, a neutral
 * grey at 0.70 alpha with no genome input at all. The only colour a genome can
 * put on a wing is the TIP WASH — white by default, or one REF_PALETTE swatch
 * via `wing_tip_hue` — laid over the grey as a linear gradient clipped to the
 * blade, the same technique the blended crown mark uses on the head.
 *
 * FOUR-WING PLACEMENT, from the isolated close-ups (top-right, bottom-right):
 * both pairs share essentially the same root and open into a shallow V, the
 * REAR blade swept further back by ~0.30 rad and drawn a little shorter. The
 * old code fanned 2–4 blades per side per pair; the sketch has exactly one
 * blade per wing, so `wing_count / 2` pairs = that many blades a side.
 */
function drawSoftWings(ctx, L, col, phase, state) {
  if (L.wingPairs < 1 || L.wingType === 'elytra' || !L.wing) return;
  const { g } = L;
  const flap = state === 'walk' || state === 'attack'
    ? Math.sin(phase * TAU * (1 + g.wing_beat * 2.5)) * 0.13 : 0.02;
  const { len: baseLen, wid: baseWid, round, fam } = L.wing;
  // FLIGHT SWEEP. L.wing.sweep is the resting angle; a bug in motion swings its
  // blades forward by FLIGHT_SWEEP_OFFSET to beat them. "In motion" is walk or
  // attack — the same two states that turn the flap on, and the closest thing
  // this pose machine has to flying. See FLIGHT_SWEEP_OFFSET for the reasoning.
  const sweep = wingSweep(g, state);
  // Wings attach to the THORAX, always.
  const anchor = L.thorax;
  const n = L.wingPairs;                       // one blade per wing, per side

  // Stagger between pairs, measured off the close-ups: ~0.30 rad of extra sweep
  // per step back, and each successive blade a touch shorter.
  const STAGGER = 0.30;

  for (const side of [-1, 1]) {
    // Back to front, so the leading blade lands on top of the ones behind it.
    for (let i = n - 1; i >= 0; i--) {
      const len = baseLen * (1 - i * 0.12);
      const wid = baseWid * (1 - i * 0.08);
      ctx.save();
      // Roots are mirrored about y = 0 with no side-dependent offset, so the
      // pair is exactly symmetric about the body's centreline.
      ctx.translate(anchor.x - L.unit * 0.04, side * anchor.ry * 0.22);
      ctx.rotate(side * (sweep + flap + i * STAGGER));
      // The blade is traced on the -y side of its own axis; mirroring for the
      // right side keeps the leading edge leading on both.
      ctx.scale(1, side);

      wingPath(ctx, fam, len, wid, round);
      ctx.fillStyle = i % 2 === 0 ? col.wing : col.wingLo;
      ctx.fill();

      // Tip wash, clipped to the blade this was just filled with.
      if (ctx.createLinearGradient) {
        ctx.save();
        ctx.clip();
        const gr = ctx.createLinearGradient(len * 1.02, 0, len * 0.42, 0);
        gr.addColorStop(0, col.wingTip);
        gr.addColorStop(1, col.wingTipOut);
        ctx.fillStyle = gr;
        ctx.fillRect(0, -wid * 1.6, len * 1.1, wid * 3.2);
        ctx.restore();
      }
      ctx.restore();
    }
  }
}

function drawElytra(ctx, L, col) {
  if (L.wingPairs < 1 || L.wingType !== 'elytra') return;
  // No abdomen (body_segments === 1)? The covers lie on the thorax instead —
  // there is always a thorax, so this is never undefined.
  const body = L.abdomen ?? L.thorax;
  const cover = lerp(0.62, 1.10, L.wingArea);         // widened both ends
  const rx = body.rx * cover, ry = body.ry * cover;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(body.x, side * ry * 0.26, rx, ry * 0.78, 0, 0, TAU);
    ctx.fillStyle = side < 0 ? col.shell : col.deep;
    ctx.fill();
    ctx.restore();
  }
  // seam: a thin sliver of the deeper tone, no stroke
  ctx.fillStyle = col.seam;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(body.x - rx * 0.92, -Math.max(0.6, L.unit * 0.012), rx * 1.84, Math.max(1.2, L.unit * 0.024));
  ctx.globalAlpha = 1;
}

/* ----------------------------------------------------------------- legs -- */

/** Foot pad radius as a fraction of the leg width. Was `foot_size`'s maximum. */
const FOOT_PAD_R = 0.95;

/**
 * One leg's knee and foot AT A GIVEN PHASE — the walk swing applied to the
 * skeleton's resting points.
 *
 * Extracted from drawLegs() because the ground shadow needs the SAME animated
 * foot positions (see drawGroundShadow): a shadow line drawn to the resting
 * foot would visibly detach from the leg on every frame but the first. The maths
 * is byte-for-byte what drawLegs did inline.
 */
function poseLeg(leg, phase) {
  const off = (leg.pair * 0.34 + (leg.side > 0 ? 0.5 : 0)) % 1;
  const ph = (phase + off) % 1;
  const swing = Math.sin(ph * TAU) * 0.11;
  const cos = Math.cos(swing * leg.side * -1), sin = Math.sin(swing * leg.side * -1);
  const rel = (p) => ({
    x: leg.attach.x + (p.x - leg.attach.x) * cos - (p.y - leg.attach.y) * sin,
    y: leg.attach.y + (p.x - leg.attach.x) * sin + (p.y - leg.attach.y) * cos,
  });
  return { knee: rel(leg.knee), foot: rel(leg.foot) };
}

/**
 * `leg_joints` IS BINARY NOW (0/1, see genes.js) and 1 draws a real, minimal
 * kink at the knee instead of the single smooth arc every leg used to get.
 * `KINK` nudges the knee OUTWARD from the smooth curve's own control point,
 * still along a single round-capped stroke (one capsule call, unchanged), so
 * the bend stays a subtle crease rather than a visible two-segment leg —
 * "very slightly sharper, very rounded corners" per the design note, not a
 * jointed limb. 0 renders byte-for-byte the old curve.
 */
const LEG_JOINT_KINK = 0.22;

function drawLegs(ctx, L, col, phase) {
  for (const leg of L.legs) {
    const { knee, foot } = poseLeg(leg, phase);

    const kink = leg.joints >= 1 ? LEG_JOINT_KINK : 0;
    const cx = lerp(leg.attach.x, foot.x, 0.30 + kink);
    const cy = lerp(knee.y, foot.y, 0.18 - kink * 0.5);

    capsule(ctx, leg.attach.x, leg.attach.y, cx, cy, foot.x, foot.y, leg.w, col.limb);

    // Foot: a round pad at the tip, FIXED at the maximum the old `foot_size`
    // gene could reach. The gene is gone (see genes.js): every value under this
    // one read as a leg that stopped short rather than as a smaller foot, so
    // "as big as possible" was the only answer the slider had. 0.95 of the leg
    // width is a pad that clearly overhangs the capsule cap.
    //
    // Colour is `col.limb`, the LEG's own tone — not the darker `col.limbLo` it
    // used to take. A darker pad read as a separate object stuck on the end; the
    // foot is part of the leg, so it is the colour of the leg, and the overhang
    // alone is what makes it visible.
    const fr = leg.w * FOOT_PAD_R;
    fillEllipse(ctx, foot.x, foot.y, fr, fr, col.limb);
  }
}

/* ----------------------------------------------------------------- horn -- */

/**
 * HORNS GROW OUT OF THE BASE OF THE HEAD.
 *
 * They mounted on the front of the thorax before that, and off the head edge
 * before THAT. The origin is now the head's REAR edge — the side facing the
 * thorax, so the horn springs from the head/thorax junction and runs forward
 * over the head. Local +x points forward and buildHead() places the head at
 * `trunkFrontX + headR × 0.54`, so the rear edge is at `head.x − head.rx`; the
 * origin sits a shade inside that (HORN_BASE_K = 0.55) which, at the default
 * head placement, is within a hair of `trunkFrontX` — the junction itself.
 *
 * Two consequences, both handled:
 *
 *   • the horn is drawn BEFORE the trunk in drawBug() — a reversal of the old
 *     dead-last position. The thorax is now meant to cover the horn's base:
 *     that overlap is what sells the horn as ROOTED at the junction rather than
 *     as a shape resting on top of the bug. Everything past the base is clear
 *     of the thorax, so the silhouette still reads whole;
 *   • layout() bumps the sprite bounds off the same origin — hornOriginX().
 *
 * Lateral spread is measured in `sp`, a fraction of the horn's own length, so
 * the silhouette holds its proportions whatever the head is doing.
 */
const HORN_BASE_K = 0.55;

/** The horn's attachment point. layout() and drawHorn() must never disagree. */
function hornOriginX(L) {
  return L.head.x - L.head.rx * HORN_BASE_K;
}

function drawHorn(ctx, L, col, pat) {
  if (!L.hornLen) return;
  const x0 = hornOriginX(L);
  const len = L.hornLen;
  const sp = len * 0.42;                         // lateral unit
  const base = Math.max(3, L.unit * 0.115);      // horns want real mass
  const fill = col.horn;
  const sr = hornSerration(L.g);
  // Collected, not drawn. The whole horn — shaft, barbs, branches, every prong
  // — is one silhouette carrying one treatment; see patternedSilhouette().
  // The per-piece `seed` argument survives as the scatter seed for the whole
  // silhouette — the FIRST piece's, since that is the shaft. It no longer varies
  // between pieces, because there is only one scatter now.
  const pieces = [];
  const piece = (p0, p1, p2, w0, w1, seed) => pieces.push({ p0, p1, p2, w0, w1, seed });

  switch (L.hornType) {
    case 'nose': {
      // One straight central spike, wide at the base, tapering to a BLUNT
      // rounded tip — taperedPath caps every tip with an arc now, and the tip
      // width went 0.10 → 0.30 of base so there is a cap to see.
      // Serration adds PAIRS of small barbs up the shaft — the sketch's stacked
      // flame notches — leaving the spike underneath exactly as it was.
      piece({ x: x0, y: 0 }, { x: x0 + len * 0.55, y: 0 }, { x: x0 + len, y: 0 },
            base * 2.65, base * 0.30, 3);
      for (let i = 0; i < sr; i++) {
        const t = 0.40 + i * 0.26;
        for (const side of [-1, 1]) {
          piece({ x: x0 + len * t, y: side * base * 0.28 },
                { x: x0 + len * (t + 0.05), y: side * base * 0.95 },
                { x: x0 + len * (t + 0.17), y: side * base * 1.20 },
                base * 0.80, base * 0.34, 11 + i * 5 + side);
        }
      }
      break;
    }
    case 'pincer': {
      // Paired horns, bases close together, sweeping out and up and curling back
      // in — a tight U of empty space right over the attachment point.
      for (const side of [-1, 1]) {
        const p0 = { x: x0, y: side * base * 0.30 };
        const p1 = { x: x0 + len * 0.80, y: side * sp * 1.25 };
        const p2 = { x: x0 + len * 1.00, y: side * sp * 0.30 };
        piece(p0, p1, p2, base * 1.40, base * 0.30, 5 + side);
        for (let i = 0; i < sr; i++) {
          // inward-pointing tooth on the inner edge
          const c = qpoint(p0, p1, p2, 0.52 + i * 0.20);
          piece(c,
                { x: c.x + len * 0.04, y: c.y - side * sp * 0.18 },
                { x: c.x + len * 0.10, y: c.y - side * sp * 0.44 },
                base * 0.86, base * 0.36, 41 + i * 7 + side);
        }
      }
      break;
    }
    case 'y_shaped': {
      // A stem that forks into two outward-hooking arms. Serration hangs extra
      // spurs off the stem; the fork itself never changes.
      piece({ x: x0, y: 0 }, { x: x0 + len * 0.30, y: 0 }, { x: x0 + len * 0.62, y: 0 },
            base * 2.80, base * 1.58, 7);
      for (const side of [-1, 1]) {
        piece({ x: x0 + len * 0.56, y: side * base * 0.30 },
              { x: x0 + len * 0.80, y: side * sp * 0.55 },
              { x: x0 + len * 1.00, y: side * sp * 0.95 },
              base * 1.40, base * 0.30, 13 + side);
        for (let i = 0; i < sr; i++) {
          const t = 0.28 + i * 0.20;
          piece({ x: x0 + len * t, y: side * base * 0.40 },
                { x: x0 + len * (t + 0.06), y: side * sp * 0.50 },
                { x: x0 + len * (t + 0.13), y: side * sp * 0.74 },
                base * 0.86, base * 0.36, 61 + i * 9 + side);
        }
      }
      break;
    }
    case 'split': {
      // The big option: heavier base mass, a wider sweep than pincer, and
      // serration that reads as real antler branching off the inner edge.
      for (const side of [-1, 1]) {
        const p0 = { x: x0, y: side * base * 0.40 };
        const p1 = { x: x0 + len * 0.88, y: side * sp * 1.70 };
        const p2 = { x: x0 + len * 1.05, y: side * sp * 0.35 };
        piece(p0, p1, p2, base * 2.90, base * 0.34, 17 + side);
        for (let i = 0; i < sr; i++) {
          const c = qpoint(p0, p1, p2, 0.46 + i * 0.24);
          piece(c,
                { x: c.x + len * 0.06, y: c.y - side * sp * 0.26 },
                { x: c.x + len * 0.16, y: c.y - side * sp * 0.62 },
                base * 1.06, base * 0.42, 71 + i * 11 + side);
        }
      }
      break;
    }
    default: {
      // crown — EXEMPT from the redesign, geometry untouched, and deliberately
      // blind to horn_serration: the sheet drew no SR variants for it. It keeps
      // measuring its spread off the HEAD radius, which is what it always did.
      const h = L.head;
      // Three prongs, the middle one longest — graphic and symmetric.
      for (const dy of [-1, 0, 1]) {
        const sc = dy === 0 ? 1 : 0.72;
        piece(
          { x: x0, y: dy * h.ry * 0.38 },
          { x: x0 + len * 0.5 * sc, y: dy * h.ry * 0.78 },
          { x: x0 + len * sc, y: dy * h.ry * 1.00 },
          base * 1.04, base * 0.30, 23 + dy);
      }
      break;
    }
  }

  patternedSilhouette(ctx, pieces, fill, pat, pieces[0]?.seed ?? 3);
}

/* ------------------------------------------------------------- mandible -- */

/**
 * Mandibles stay on the HEAD — only the horn moved to the thorax.
 *
 * ALL THREE kinds take serration now, read off `mandible_serration` bucketed to
 * the sheet's 0/1/2 rather than blending continuously. The chelicerae used to be
 * the exception — a `teeth` kind and a `smooth` kind that ignored the serration
 * gene entirely — but the only difference between them was one fang at the tip,
 * which is a serration level by any reading. They are one kind now, and the fang
 * appears at serration ≥ 1 like every other tooth here.
 *
 * RE-TRACED from `Image References/Horns_alts.png`, MANDIBLES block, because the
 * first cut drifted badly from it. What the sheet actually draws, and what each
 * case now does:
 *
 *   WIDE THIN     a LONG, SLENDER crescent that sweeps OUTWARD as it rises and
 *                 comes to a fine point. The pair splays apart — the tips end up
 *                 further from the midline than the bases. Near-uniform slim
 *                 mass. The two barbs sit LOW, on the inner edge in the bottom
 *                 third, well away from the tip.
 *                 (was: a hard hook back across the midline, barbs near the tip)
 *
 *   NARROW THICK  SHORT and HEAVY — a fat claw with its bulk at the base, hooking
 *                 hard INWARD so the pair converges at the tips. Roughly half the
 *                 reach of wide_thin and nearly three times the base mass. The
 *                 two serrations are deep teeth bitten out of the middle of the
 *                 inner edge.
 *                 (was: near-straight and only slightly heavier than wide_thin,
 *                  which left the two kinds reading as the same blade)
 *
 *   CHELICERAE    a blunt vertical COLUMN with parallel sides and a domed top —
 *                 not a blade and not curved. Serration 0 is the bare column;
 *                 1 or 2 adds ONE small fang at the tip on the inner side.
 *                 (was: a tapering curved stub with three side-teeth down its
 *                  length, none of which the sheet draws)
 */
function drawMandibles(ctx, L, col, state, lunge, pat) {
  if (!L.mandible) return;
  const h = L.head;
  const open = state === 'attack' ? 0.34 + lunge * 0.7 : 0.16;
  const m = L.mandible;
  const w = Math.max(2, L.unit * 0.070);
  const fill = col.limbLo;
  const ax = h.x + h.rx * 0.60;
  const sr = mandibleSerration(L.g);

  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(ax, side * h.ry * 0.52);
    ctx.rotate(side * open);
    // Collected, not drawn — one jaw is ONE silhouette carrying one treatment,
    // blade plus every tooth on it. See patternedSilhouette().
    const pieces = [];
    const piece = (p0, p1, p2, w0, w1, seed) => pieces.push({ p0, p1, p2, w0, w1, seed });
    const cap = (x, y, r, seed) => pieces.push({ circle: { x, y, r }, seed });

    /**
     * `n` inward-pointing teeth on the inner edge of a blade. `t0`/`dt` place
     * them along the curve, because the sheet does not put them in the same
     * place on both blades: wide_thin's barbs sit low near the base, narrow
     * thick's bite into the middle.
     */
    const teeth = (p0, p1, p2, n, size, reach, t0, dt, seed) => {
      for (let i = 0; i < n; i++) {
        const c = qpoint(p0, p1, p2, t0 + i * dt);
        piece(c,
          { x: c.x + m * reach * 0.42, y: c.y - side * m * reach * 0.44 },
          { x: c.x + m * reach * 0.94, y: c.y - side * m * reach * 1.00 },
          w * size, w * size * 0.38, seed + i * 3);
      }
    };

    switch (L.mandibleType) {
      case 'narrow_thick': {
        // SHORT and HEAVY. Bulk at the base, hooking hard inward so the tips
        // converge — the sheet's fat claw. Half the reach of wide_thin.
        const p0 = { x: 0, y: 0 };
        const p1 = { x: m * 0.54, y: side * m * 0.38 };
        const p2 = { x: m * 0.92, y: side * m * -0.12 };
        piece(p0, p1, p2, w * 3.15, w * 0.62, 101 + side);
        // Deep teeth bitten out of the MIDDLE of the inner edge.
        teeth(p0, p1, p2, sr, 1.58, 0.32, 0.34, 0.26, 111 + side);
        break;
      }
      case 'chelicerae': {
        // The blunt column. The fang at its tip is a SERRATION now, not a
        // second kind: level 0 leaves the column bare, 1 and 2 both add it.
        // (One fang is all the sheet ever draws on a chelicera, so 2 does not
        // add a second — the levels above 0 agree, the way `crown` and
        // horn_serration already agree.)
        chelicera(piece, cap, m, w, side, sr >= 1);
        break;
      }
      default: {
        // wide_thin — a LONG slender crescent sweeping OUTWARD to a fine point.
        // The pair splays; it does not hook back over the midline.
        const p0 = { x: 0, y: 0 };
        const p1 = { x: m * 0.74, y: side * m * 0.26 };
        const p2 = { x: m * 1.32, y: side * m * 0.68 };
        piece(p0, p1, p2, w * 1.04, w * 0.26, 131 + side);
        // Barbs LOW on the inner edge, in the bottom third, not up by the tip.
        teeth(p0, p1, p2, sr, 0.98, 0.24, 0.22, 0.21, 141 + side);
        break;
      }
    }
    patternedSilhouette(ctx, pieces, fill, pat, pieces[0]?.seed ?? 101);
    ctx.restore();
  }
}

/**
 * The chelicera: a blunt column with parallel sides and a domed top, per the
 * sheet. The tip fang is a serration level, not a variant of the shape.
 *
 * The dome is a disc sub-path contributed to the SAME accumulated silhouette as
 * the column (see `cap`), not a separate fill. It used to be painted straight
 * onto the canvas with the flat base colour, which meant that on a patterned
 * jaw the dome was the one part carrying no pattern at all.
 */
function chelicera(piece, cap, m, w, side, withFang) {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: m * 0.32, y: side * m * 0.02 };
  const p2 = { x: m * 0.62, y: side * m * 0.04 };
  const capR = w * 1.88;
  // Stout: roughly twice as tall as it is wide, which is the sheet's proportion.
  // A slimmer column reads as a stick rather than a blunt fang.
  piece(p0, p1, p2, w * 3.75, w * 3.58, 151 + side);
  cap(p2.x, p2.y, capR, 151 + side);
  if (!withFang) return;
  // one small fang off the tip, on the inner side — rounded, not needled
  piece(
    { x: p2.x, y: p2.y - side * capR * 0.55 },
    { x: p2.x + m * 0.10, y: p2.y - side * capR * 0.95 },
    { x: p2.x + m * 0.24, y: p2.y - side * capR * 1.05 },
    w * 0.88, w * 0.30, 161 + side);
}

/* ------------------------------------------------------------- antennae -- */

function drawAntennae(ctx, L, col, phase) {
  const h = L.head;
  const w = Math.max(1.4, L.unit * 0.040);
  for (const a of L.antennae) {
    const wag = Math.sin(phase * TAU + a.side) * 0.08;
    capsule(ctx,
      h.x + h.rx * 0.40, a.side * h.ry * 0.50,
      h.x + a.len * 0.72, a.side * (h.ry * 1.00 + a.len * 0.16 + wag * a.len),
      h.x + a.len * 1.00, a.side * (h.ry * 0.50 + a.len * 0.40 + wag * a.len),
      w, col.limb);
  }
}

/* ----------------------------------------------------------------- tail -- */

function drawTail(ctx, L, col, state, lunge) {
  if (!L.tail) return;
  const t = L.tail;
  const tipX = t.x0 - t.len * (1 + (state === 'attack' ? lunge * 0.16 : 0));
  if (t.sting > 0.18) {
    // solid kite, like the reference's stinger — pure shape, no stroke
    const halfW = L.unit * (0.07 + t.sting * 0.11);
    ctx.fillStyle = col.shell;
    ctx.beginPath();
    ctx.moveTo(t.x0 + halfW * 0.4, 0);
    ctx.lineTo(t.x0 - t.len * 0.42, -halfW);
    ctx.lineTo(tipX, 0);
    ctx.lineTo(t.x0 - t.len * 0.42, halfW);
    ctx.closePath();
    ctx.fill();
  } else {
    capsule(ctx, t.x0, 0, t.x0 - t.len * 0.6, 0, tipX, 0, Math.max(1.6, L.unit * 0.06), col.limb);
  }
}

/* ----------------------------------------------------------------- eyes -- */

/**
 * THE eye silhouette — there is only one, traced off Eyes_Noses.jpg.
 *
 * An asymmetric wedge: a broad ROUNDED corner at the outer-top, the outer edge
 * bellying out below it, and a single POINT at the inner-lower end. Nothing about
 * it is symmetric, which is the difference between this and the old almond — the
 * sketch's eye has exactly one round end and exactly one point, on opposite
 * diagonals.
 *
 * Drawn in the eye's own frame with local +x toward the head's top. `side` is
 * folded in so +v is always OUTWARD, whichever eye this is; the caller has
 * already tilted the frame so the long axis leans out at the top.
 *
 * Quadratics only, deliberately: several tools in this repo drive the renderer
 * through a recording stub that speaks the same primitive set as the rest of the
 * file, and no other path here uses cubics.
 */
function eyeWedgePath(ctx, R, r, side) {
  const v = (w) => side * w;              // +v = away from the midline
  // WIDENED toward a semicircle. The wedge was too narrow across its short axis
  // — it read as a comma rather than as an eye, and next to the sketch it was
  // visibly thinner than what is drawn there. Every lateral control point is
  // pushed out by roughly a third and the inner edge is bowed further back, so
  // the body of the shape approaches half a disc. The IDENTITY is unchanged and
  // deliberately so: one broad rounded corner at the outer-top, one point at the
  // inner-lower end, asymmetric on both diagonals.
  ctx.beginPath();
  ctx.moveTo(-R * 0.94, v(-r * 0.14));                                  // the point: inner-lower
  ctx.quadraticCurveTo(-R * 0.30, v(r * 1.32), R * 0.24, v(r * 1.50));  // outer edge, bellying well out
  ctx.quadraticCurveTo(R * 1.00, v(r * 1.62), R * 1.02, v(r * 0.30));   // the broad rounded outer-top corner
  ctx.quadraticCurveTo(R * 1.04, v(-r * 0.52), R * 0.40, v(-r * 0.82)); // inner shoulder
  ctx.quadraticCurveTo(-R * 0.30, v(-r * 1.10), -R * 0.94, v(-r * 0.14)); // inner edge, back to the point
  ctx.closePath();
}

function drawEyes(ctx, L, col) {
  // THERE IS NO IRIS. Not on any fill treatment, not at any saturation.
  //
  // The eye used to carry an iris disc in the body of the wedge, drawn at the
  // bright COMPLEMENTARY accent hue — so on a red bug it was a pink/magenta dot
  // sitting in the middle of a white eye, which is exactly what it looked like.
  // A pupil circle on top of it went first; the disc underneath goes now. The
  // three treatments below are the whole of the eye: dark speckle, a notch, or a
  // hook. Nothing coloured is drawn inside an eye any more, and `col.iris` is
  // gone from palette() with it.
  for (const e of L.eyes) {
    /*
     * The array eyes are the SAME wedge, just small — see buildHead(). They were
     * plain circles, which is why they read as specks rather than as eyes. They
     * take the main pair's fill so a bug's eyes are all one organ, and they carry
     * NO interior mark: a notch or a hook at a quarter of the size is two or
     * three pixels of mud, and the array's job is to read as an array.
     */
    if (e.minor) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.side * 0.30);
      eyeWedgePath(ctx, e.ry, e.rx, e.side);
      ctx.fillStyle = L.eyeFill === 'dark' ? col.pupil : col.sclera;
      ctx.fill();
      ctx.restore();
      continue;
    }

    ctx.save();
    ctx.translate(e.x, e.y);
    // Lean the long axis OUTWARD at the top. The reference eyes tilt, which is
    // most of what stops them reading as two plain circles stuck on a ball.
    ctx.rotate(e.side * 0.30);

    const R = e.ry, r = e.rx;   // R along the lean, r across
    const s = e.side;
    const v = (w) => s * w;
    // The outer-top corner, where both marked treatments put their mark.
    const cx = R * 0.56, cy = v(r * 0.72);

    eyeWedgePath(ctx, R, r, s);
    ctx.fillStyle = L.eyeFill === 'dark' ? col.pupil : col.sclera;
    ctx.fill();

    ctx.save();
    ctx.clip();                            // every mark stays inside the wedge
    if (L.eyeFill === 'dark') {
      // scattered small white dots
      ctx.fillStyle = col.sclera;
      const dots = [[-0.42, -0.10], [-0.06, 0.42], [0.24, -0.30], [0.52, 0.46], [0.72, -0.16]];
      for (const [dx, dy] of dots) {
        fillEllipse(ctx, R * dx, v(r * dy), r * 0.30, r * 0.30, col.sclera);
      }
    } else if (L.eyeFill === 'notched') {
      // a dark notch cut into the outer-top corner — an ellipse hung off the rim
      // so the clip leaves a crisp crescent hugging the edge
      fillEllipse(ctx, cx + R * 0.22, cy + v(r * 0.42), R * 0.44, r * 0.72, col.pupil);
    } else {
      // a dark hook/comma near that corner: a tapered stroke curling inward
      taperedCurve(ctx,
        { x: cx + R * 0.26, y: cy + v(r * 0.30) },
        { x: cx - R * 0.16, y: cy + v(r * 0.16) },
        { x: cx - R * 0.20, y: cy - v(r * 0.62) },
        r * 0.62, r * 0.18, col.pupil);
    }
    ctx.restore();
    ctx.restore();
  }
}

/* ---------------------------------------------------------------- setae -- */

function drawSetae(ctx, L, col) {
  if (L.setae < 0.35) return;
  // No abdomen? Fringe the thorax — the fringe belongs to whatever rear mass
  // exists, and the thorax is always present.
  const body = L.abdomen ?? L.thorax;
  const n = Math.round(10 + L.setae * 16);
  const len = body.ry * (0.08 + L.setae * 0.24);      // widened both ends
  const w = Math.max(1, L.unit * 0.026);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const x = body.x + Math.cos(a) * body.rx * 0.96;
    const y = Math.sin(a) * body.ry * 0.96;
    capsule(ctx, x, y, x + Math.cos(a) * len * 0.6, y + Math.sin(a) * len * 0.6,
            x + Math.cos(a) * len, y + Math.sin(a) * len, w, col.limb);
  }
}

/* ---------------------------------------------------- body-segment fill -- */

/**
 * How far the blob reaches, as a fraction of the part's semi-axes. Still under
 * 1 on purpose: the gradient has to be fully transparent before it gets to the
 * outline, so the rim stays flat, undarkened `shell`.
 *
 * RAISED 0.74 → 0.88. At 0.74 the highlight sat as a small disc in the middle
 * of a large flat field and the segment read as unlit with a spot on it; the
 * light now covers most of the mass, which is what the reference does. 0.88
 * leaves a 12% band of untouched flat `shell` at the rim — visibly flat, which
 * is the whole point of the previous pass, but no longer the majority of the
 * segment. Past ~0.92 that band closes up and the flatness goes with it.
 */
const BLOB_R = 0.88;
/**
 * Abdomen only: the blob sits low. Local +x points at the head, so a NEGATIVE
 * multiple of the part's own along-axis radius pushes the highlight toward the
 * tail — "down" in the head-up pose. Expressed in rx so it scales with the part.
 */
const ABDOMEN_BLOB_SKEW = -0.30;
/**
 * The centreline gate. In the reference sheet the round masses have no line and
 * only the stretched ones do, so it turns on when the part's long axis beats its
 * short one by this much — a shape elongated enough for a centreline to mean
 * something. Thorax (rx = ry × 1.04) and myriapod rings (× 1.02) fall under it;
 * a tapered abdominal segment clears it.
 */
const CENTRELINE_RATIO = 1.18;

/**
 * SEGMENT SPIKES — `spikyness`. A short, rounded spike off the LEFT and RIGHT
 * of every trunk segment (thorax, each abdominal segment, each myriapod
 * ring), flush against the segment's own side wall. Filled with `col.shell`,
 * the segment's own flat colour and nothing else — no bloom, no gradient — so
 * a spike reads as part of the shell rather than a separate part stuck on.
 * The apex is a quadratic curve, not a straight point, which is what keeps it
 * "rounded" rather than a thorn.
 */
const SPIKE_MIN = 0.02;          // below this, nothing is drawn at all
const SPIKE_LEN = [0.18, 0.52];  // fraction of ry, at spikyness 0 / 1
const SPIKE_BASE = [0.16, 0.26]; // fraction of rx, at spikyness 0 / 1

/**
 * The translucency border. Past `TRANSLUCENT_BORDER_THRESHOLD`, every segment
 * — and the spikes growing off it — takes a thin, low-opacity stroke of the
 * segment's own deep tone (`col.segBorder`), so the shape reads as slightly
 * see-through rather than gaining a hard outline. The threshold matches the
 * `camouflaged` trait's own translucency floor in classification.js, so the
 * two readings — "this bug is see-through" as a trait and as a render — agree.
 */
const TRANSLUCENT_BORDER_THRESHOLD = 0.55;
const TRANSLUCENT_BORDER_ALPHA = 0.35;

/** One spike, apex pointing away from the segment along its lateral axis. */
function drawOneSpike(ctx, x, baseY, tipY, halfBase, col, translucent) {
  ctx.beginPath();
  ctx.moveTo(x - halfBase, baseY);
  ctx.quadraticCurveTo(x, tipY, x + halfBase, baseY);
  ctx.closePath();
  ctx.fillStyle = col.shell;
  ctx.fill();
  if (translucent) {
    ctx.lineWidth = Math.max(0.6, halfBase * 0.28);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = col.segBorder;
    ctx.stroke();
  }
}

function drawSegmentSpikes(ctx, p, col, spiky, translucent) {
  if (!(spiky > SPIKE_MIN)) return;
  const rx = Math.max(0.5, p.rx);
  const ry = Math.max(0.5, p.ry);
  const len = ry * lerp(SPIKE_LEN[0], SPIKE_LEN[1], spiky);
  const halfBase = rx * lerp(SPIKE_BASE[0], SPIKE_BASE[1], spiky);
  for (const side of [-1, 1]) {
    const baseY = p.y + side * ry * 0.92;
    drawOneSpike(ctx, p.x, baseY, baseY + side * len, halfBase, col, translucent);
  }
}

/**
 * One trunk mass — thorax, abdominal segment, or myriapod ring.
 *
 * FLAT, not a shaded ball. A solid `shell` fill with a soft warm blob dropped
 * near the middle, nothing darkening toward the edge at all. The blob colour is
 * a constant off REF_PALETTE (see the mandate there), not a lighten of the body
 * hue, and its peak alpha is deliberately low (BLOB_ALPHA).
 *
 * NOTE the head does NOT come through here, and no longer has an equivalent of
 * its own: it is a single flat `col.shell` fill in drawBug(), with no lighting.
 *
 * `spiky` (from `spikyness`) and `translucent` (from `translucency` past its
 * threshold) are read once per call, off the genome, by drawBug() — see the
 * trunk-drawing closures there.
 */
function segmentMass(ctx, p, col, crease = false, spiky = 0, translucent = false) {
  const rx = Math.max(0.5, p.rx);
  const ry = Math.max(0.5, p.ry);

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
  ctx.fillStyle = col.shell;
  ctx.fill();
  ctx.clip();

  // Work in the part's own unit circle so the blob and the line stretch with it.
  ctx.translate(p.x + rx * (p.kind === 'abdomen' ? ABDOMEN_BLOB_SKEW : 0), p.y);
  ctx.scale(rx, ry);

  if (ctx.createRadialGradient) {
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, BLOB_R);
    // Six stops, not three. The old ramp had a bright plateau and then a
    // shoulder you could see the edge of; this one never plateaus and never
    // steps — each stop is a small step down from the last, all the way out.
    gr.addColorStop(0, col.segBloom);
    gr.addColorStop(0.26, col.segBloomMid);
    gr.addColorStop(0.48, col.segBloomMid2);
    gr.addColorStop(0.68, col.segBloomFar);
    gr.addColorStop(0.86, col.segBloomFar2);
    gr.addColorStop(1, col.segBloomOut);
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(0, 0, BLOB_R, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  segmentCentreline(ctx, p, col, rx, ry, crease);
  drawSegmentSpikes(ctx, p, col, spiky, translucent);

  if (translucent) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
    ctx.lineWidth = Math.max(0.6, Math.min(rx, ry) * 0.045);
    ctx.strokeStyle = col.segBorder;
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * The soft line down the middle of an elongated segment. Same colour as the
 * segment's own shell, just faded, so it only shows where it crosses the bloom —
 * which is where the reference shows it.
 *
 * SOFT ON ALL FOUR SIDES, with a real blur.
 *
 * SUPERSEDED REASONING, kept so it is not re-derived: this used to argue against
 * ctx.filter on the grounds that "a real blur would bleed past the segment's
 * edge". That was wrong twice over. First, the streak's softness came from a
 * linear gradient across its SHORT axis only, so while its long sides faded, its
 * two ENDS were hard cuts sitting inside the segment — a visible bar with square
 * ends. Second, the bleed argument assumed a clip that is not in force here:
 * segmentMass() releases its ellipse clip (ctx.restore) BEFORE calling this, so
 * there was never a clip to bleed past, and establishing one is one save/clip
 * away. So: own ellipse clip, then ctx.filter — softness in both directions, and
 * the clip contains it exactly as drawGroundShadow's own pass is contained by
 * its geometry. The ctx.filter use is feature-detected the same way
 * drawGroundShadow's is (the test recorder and non-browser contexts lack it),
 * and where it is missing the old lateral-gradient path is the fallback.
 *
 * ONE LINE, NOT TWO — and this is the whole point of `crease`.
 *
 * The abdominal seam used to be a SECOND, independent softStreak() fired from
 * drawBug() after this one. The comment there claimed it would read as "a crisp
 * core inside a softer streak". It did not: rendered and looked at close up, an
 * abdomen showed a correct faint wide streak AND a separate hard hairline. Three
 * mismatches, all of them consequences of the two calls being independent:
 *
 *   LENGTH   halo 0.74·rx, seam 0.88·rx. The seam stuck 0.14·rx out of both ends
 *            of the halo, which is the single clearest "these are two different
 *            marks" cue there is.
 *   BLUR     the halo's blur radius was its own half-width, ry·0.085 (≈2.7px on
 *            a stock abdomen). The seam's was max(0.5, unit·0.012) (≈0.9px). A
 *            sub-pixel blur is not a blur; the seam came out a hard-edged stroke
 *            no matter what was drawn under it.
 *   CONTRAST the halo is `col.shellSoft`, ~4/255 off the shell it sits on. The
 *            seam is `col.seam` at 0.42 alpha, ~50/255 off it. The eye cannot
 *            read a mark twelve times fainter than another as its halo.
 *
 * So they are one call site now. `halfL` is computed ONCE and both streaks use
 * it; the core's half-width and blur are fractions OF THE HALO's half-width, so
 * the nesting is structural and cannot drift; and the core's blur is a real
 * fraction of the halo rather than a number of its own, so it can never collapse
 * to a hairline again. The core stays DARK on purpose — a joint is a shadow, not
 * a highlight.
 *
 * `crease` also OVERRIDES the elongation gate. The seam never had one, so a
 * round abdomen used to get the hard line with no halo at all — the worst case
 * of the three. The halo now goes wherever the core goes.
 */
const CREASE_HALF_L = 0.80;    // fraction of rx — shared by halo and core
const CREASE_HALO_W = 0.085;   // fraction of ry
const CREASE_CORE_W = 0.32;    // fraction of the HALO's half-width
const CREASE_CORE_BLUR = 0.62; // ditto — never a number of its own
const CREASE_CORE_ALPHA = 0.46;

function segmentCentreline(ctx, p, col, rx, ry, crease = false) {
  const long = Math.max(rx, ry);
  const short = Math.min(rx, ry);
  if (!crease && long / short < CENTRELINE_RATIO) return;
  if (!ctx.createLinearGradient) return;

  const halfL = rx * CREASE_HALF_L;
  const haloW = ry * CREASE_HALO_W;
  softStreak(ctx, p, rx, ry, halfL, haloW, haloW, col.shellSoft, col.shellClear, 1);
  if (!crease) return;
  softStreak(ctx, p, rx, ry, halfL, haloW * CREASE_CORE_W, haloW * CREASE_CORE_BLUR,
             col.seam, col.seamClear, CREASE_CORE_ALPHA);
}

/**
 * A soft-edged bar down a part's long axis, clipped to that part's ellipse.
 *
 * Used TWICE FROM ONE PLACE — segmentCentreline() draws the shell-coloured halo
 * and, on a creased mass, the darker core nested inside it. The clip is what
 * makes ctx.filter safe here: the blur cannot leave the silhouette because the
 * silhouette is the clip. Where ctx.filter is missing (the test recorder,
 * non-browser contexts) it degrades to a lateral linear-gradient, which is soft
 * on the long sides and hard at the ends — worse, but never wrong-coloured.
 *
 * `blur` IS ITS OWN ARGUMENT, and that is what the double-line fix turns on. It
 * used to be derived as max(0.6, halfW), which ties softness to width — so the
 * narrower of two nested streaks was automatically the crisper one, i.e. exactly
 * backwards for a core meant to disappear into a halo. The caller now sets the
 * two independently and expresses the core's blur as a fraction of the HALO's
 * width, so a thin core is still a soft one.
 */
function softStreak(ctx, p, rx, ry, halfL, halfW, blur, fill, clear, alpha) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
  ctx.clip();
  ctx.globalAlpha = alpha;

  const b = Math.max(0.6, blur);
  if ('filter' in ctx) {
    // The rect is shrunk by the blur radius along its length so the blurred
    // extent lands where the hard rect used to; both ENDS fall off over `b` too,
    // which is what stops a streak reading as a bar with square ends.
    ctx.filter = `blur(${b.toFixed(2)}px)`;
    ctx.fillStyle = fill;
    ctx.fillRect(p.x - halfL + b, p.y - halfW * 0.5, Math.max(0.5, (halfL - b) * 2), halfW);
    ctx.filter = 'none';
  } else {
    const ext = Math.max(halfW, b);
    const gr = ctx.createLinearGradient(0, p.y - ext, 0, p.y + ext);
    gr.addColorStop(0, clear);
    gr.addColorStop(0.5, fill);
    gr.addColorStop(1, clear);
    ctx.fillStyle = gr;
    ctx.fillRect(p.x - halfL, p.y - ext, halfL * 2, ext * 2);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ======================================================= ground shadow === */

/**
 * THE GROUND SHADOW — traced from `Image References/Shadow.jpg`.
 *
 * The reference is one bug on flat dirt with a soft, edgeless, cool brown-grey
 * darkening sitting directly under the trunk mass. It is faint: the dirt's own
 * value still reads straight through it, so it is a shadow rather than a
 * silhouette.
 *
 * DECISIONS worth writing down:
 *
 * DEAD CENTRE, not offset. An earlier pass leaned the blob toward the bug's
 * rear-right to fake a fixed light direction, but the sheet is baked once,
 * head-up, and the sim then rotates the sprite by the bug's facing — so a
 * body-space lean reads as the intended light direction at exactly one heading
 * and as a shadow drifting out from under the bug at every other one. Sitting
 * it dead centre is correct at every heading, which matters more than
 * matching the reference's one lighting angle.
 *
 * MULTIPLY, drawn HERE, in drawBug()'s local space. The sprite is baked into a
 * transparent frame (see bakeSpritesheet) and Phaser then draws that frame over
 * the terrain with ordinary alpha, so a `multiply` set here composites against
 * the frame's transparency, not against the dirt. Against a transparent
 * destination `multiply` degrades exactly to source-over, which is the correct
 * fallback: a faint desaturated brown at ~0.3 alpha laid over dirt reads as a
 * shadow either way. Where the shadow IS composited in-canvas over something —
 * the vet portrait in terrarium.js — the multiply does real work. Doing it
 * "properly" would mean drawing the shadow at ground-composite time in the
 * sim, which is a sim change for a difference no one can see at this alpha;
 * it stays here, where the geometry lives.
 *
 * THE FOOT LINES AND THE BODY BLOB NEVER MULTIPLY AGAINST EACH OTHER. They are
 * drawn to a scratch canvas with plain source-over first, and ONLY the
 * resulting flat shape is multiplied onto the destination, in one pass — see
 * shadowLayer(). Multiplying them directly against each other (the previous
 * approach) was fine on a transparent destination, per the note above, but
 * wherever the destination WASN'T transparent — the vet portrait, this
 * shadow drawn over a previous frame — the foot line's own alpha became
 * "destination" for the blob's multiply pass, and wherever a leg happened to
 * cross under the body blob the two stacked into a visibly darker patch that
 * had nothing to do with the actual light. A shadow's own pieces overlapping
 * should never read as extra shadow.
 *
 * FOOT LINES. Faint strokes from each animated foot to the trunk centroid, at
 * well under the blob's alpha, thin relative to the leg capsules drawn over
 * them. They are the "the bug is standing on something" cue, so their OUTER
 * end is pinned to the actual foot position — a contact shadow cannot drift
 * from the thing making contact — and only the inner end reaches for the
 * centroid. They must never read as a second set of legs.
 */

/** Cool brown-grey, sampled off the reference's shadow — NOT black, NOT warm. */
const SHADOW_RGB = '78,68,66';
/** Peak alpha of the body blob. Everything else is a fraction of this. */
const SHADOW_ALPHA = 0.44;
/** Foot lines, relative to the blob — a supporting detail, but a dark one. */
const SHADOW_LINE_K = 0.80;
/**
 * How much bigger than the body the blob is. At 1.0 the sprite covers its own
 * shadow completely and nothing survives at all, which reads as no shadow —
 * the reference's shadow clearly spreads a little past the silhouette on
 * every side, just not by much; this stays close to the body on purpose.
 */
const SHADOW_SPREAD = 1.18;
/** Blur radius, as a fraction of the body unit. The blob is a soft mass and
 *  reads better with more falloff; the foot lines are thin strokes and turn to
 *  mush past a much smaller radius, so each gets its own. */
const SHADOW_BLUR_BODY_K = 0.22;
const SHADOW_BLUR_LEG_K = 0.09;

/**
 * Trunk centroid, area-weighted. The thorax alone sits too far forward on a
 * long-abdomened bug — the foot lines then all converge ahead of the mass they
 * are supposed to sit under — so every trunk part votes, by area.
 */
function trunkCentre(L) {
  let wx = 0, wy = 0, wsum = 0;
  for (const p of L.parts) {
    const a = Math.max(0.01, p.rx * p.ry);
    wx += p.x * a; wy += p.y * a; wsum += a;
  }
  return wsum > 0 ? { x: wx / wsum, y: wy / wsum } : { x: L.thorax?.x ?? 0, y: 0 };
}

/**
 * Step 0 of drawBug's z-order: the ground plane, under literally everything.
 * Local coordinates, so it rotates and scales with the bug like the rest.
 */
function drawGroundShadow(ctx, L, phase) {
  const blurLeg = clamp(L.unit * SHADOW_BLUR_LEG_K, 1, 10);
  const blurBody = clamp(L.unit * SHADOW_BLUR_BODY_K, 1.5, 14);
  const centre = trunkCentre(L);
  const size = L.half * 2;

  // Foot lines and the body blob are drawn onto a scratch canvas first, with
  // plain source-over, so neither ever sees the other as "destination" — see
  // the class doc above for why that matters. `document` is absent in the
  // unit-test recorder (and any other non-browser 2D context), so that path
  // falls back to drawing straight onto ctx with the old single-pass multiply;
  // it loses the anti-stacking fix, but nothing exercises it for real pixels.
  const scratch = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (scratch) { scratch.width = size; scratch.height = size; }
  const sctx = scratch ? scratch.getContext('2d') : ctx;
  if (scratch) {
    sctx.translate(L.half, L.half);
  } else {
    sctx.save();
    sctx.globalCompositeOperation = 'multiply';
  }

  // Foot lines first, so the blob covers their inner ends and they vanish
  // into it rather than stopping at its rim. The OUTER end sits exactly on
  // the animated foot — a contact shadow's far end cannot drift from the
  // thing making contact — and only the inner end reaches for the centroid.
  if ('filter' in sctx) sctx.filter = `blur(${blurLeg.toFixed(2)}px)`;
  sctx.strokeStyle = `rgba(${SHADOW_RGB},${(SHADOW_ALPHA * SHADOW_LINE_K).toFixed(3)})`;
  sctx.lineCap = 'round';
  for (const leg of L.legs) {
    const { foot } = poseLeg(leg, phase);
    sctx.lineWidth = Math.max(1, leg.w * 0.55);
    sctx.beginPath();
    sctx.moveTo(foot.x, foot.y);
    sctx.lineTo(centre.x, centre.y);
    sctx.stroke();
  }

  // The body blob, dead centre under the trunk: every trunk part plus the
  // head, slightly swollen, filled as ONE path so the overlaps do not stack
  // into a darker core.
  if ('filter' in sctx) sctx.filter = `blur(${blurBody.toFixed(2)}px)`;
  sctx.beginPath();
  const masses = L.head ? [...L.parts, L.head] : L.parts;
  for (const p of masses) {
    const rx = Math.max(0.5, p.rx * SHADOW_SPREAD);
    const ry = Math.max(0.5, p.ry * SHADOW_SPREAD);
    // moveTo/closePath around each: ellipse() would otherwise chain a connecting
    // line from the previous subpath's end and leave a spur across the shape.
    sctx.moveTo(p.x + rx, p.y);
    sctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
    sctx.closePath();
  }
  sctx.fillStyle = `rgba(${SHADOW_RGB},${SHADOW_ALPHA})`;
  sctx.fill();
  if ('filter' in sctx) sctx.filter = 'none';

  if (scratch) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(scratch, -L.half, -L.half);
    ctx.restore();
  } else {
    sctx.restore();
  }
}

/* ============================================================== render === */

/**
 * Draw one frame. Canonical pose is HEAD UP; the skeleton is built along +x and
 * rotated here, so the sim adds 90° to sprite rotation to compensate.
 */
export function drawBug(ctx, g, opts = {}) {
  const { phase = 0, state = 'idle', ppu = 26 } = opts;
  const L = layout(g, ppu);
  const col = palette(g);
  // Two treatments, one per component, off two independent genes.
  const patHorn = surfacePattern(g, col, 'horn');
  const patMandible = surfacePattern(g, col, 'mandible');
  const breathe = state === 'idle' ? 1 + Math.sin(phase * TAU) * 0.018 : 1;
  const lunge = state === 'attack' ? Math.sin(Math.min(1, phase) * Math.PI) : 0;
  const translucentSegments = g.translucency >= TRANSLUCENT_BORDER_THRESHOLD;

  ctx.save();
  ctx.rotate(-Math.PI / 2);                 // head up
  ctx.translate(lunge * L.unit * 0.12, 0);
  ctx.scale(breathe, breathe);

  /* ---- Z-ORDER (painter's algorithm: later = on top) ----------------------
   *
   * STEP 0 IS THE GROUND SHADOW, and it is beneath literally everything — not
   * just under the body but under the setae, the legs and the tail as well.
   * It is not part of the bug: it is the plane the bug is standing ON, so
   * nothing the bug is made of may ever be drawn below it. It is the only thing
   * in this file drawn with `multiply` (and one of its two ctx.filter blurs,
   * the other being the segment centreline) — see
   * drawGroundShadow for why the blend lives here rather than at ground
   * composite time, and for the light-from-upper-left offset convention.
   *
   * THE ABDOMEN/THORAX RELATIONSHIP DEPENDS ON WINGS. This is a flip from the
   * previous rule, where the thorax was unconditionally the topmost trunk piece.
   *
   *   NO WINGS    … → head → antennae → horn → THORAX → abdomen
   *   HAS WINGS   … → head → antennae → horn → abdomen → THORAX → WINGS
   *
   * The reason the winged case inverts abdomen/thorax: wings attach to the
   * thorax, so the thorax has to clear the abdomen or the wing roots sit over a
   * mass that is behind their own anchor.
   *
   * WINGS ARE NOW TOPMOST — a deliberate reversal of the previous pass, which
   * put the thorax over them so a blade could not cover its own root. The wing
   * membrane is a fixed 0.70 alpha, so a blade lying over its root (or over the
   * horn) still shows what is under it; nothing is actually hidden, and the
   * sketch draws the wings as the frontmost plane. The horn no longer sits
   * immediately under them — see below — but since the horn points forward while
   * the blades sweep backward, the two barely overlap at all either way.
   *
   * The abdomen is a GROUP, not a single fill, and the whole group moves as one:
   * the abdominal segment masses, the elytra that lie on them, the speckle over
   * those, and the seam sliver that marks the joint. Splitting any of those from
   * the segments they belong to would put a cover or a seam on the wrong side of
   * the thorax. drawTrunkAbdomen() exists precisely so the group cannot be split
   * by accident. Likewise the thorax carries its own speckle.
   *
   * ELYTRA COUNT AS WINGS here. wing_type `elytra` makes drawSoftWings() a no-op
   * — the covers are drawn inside the abdomen group instead — but the bug still
   * has wings, so it takes the winged ordering and the thorax goes on top.
   *
   * FACE FURNITURE IS SPLIT, and the split is deliberate:
   *
   *   MANDIBLES go UNDER the head, with the eyes. They hinge behind the face,
   *   so the head edge cropping their roots is the thing that sells the hinge.
   *   Both blades reach forward well past the silhouette, so the head covers
   *   only the part that should be hidden anyway.
   *
   *   ANTENNAE go OVER the head. They sprout from the face plate itself, not
   *   from behind it, and their bases sit inside the head ellipse — drawn
   *   underneath they would simply disappear.
   *
   * THE HORN IS DRAWN UNDER THE TRUNK, and that is a deliberate reversal.
   *
   * It used to be dead last, above everything, because it mounted on the FRONT
   * OF THE THORAX and anywhere earlier buried its base under the very mass it
   * grew out of. Both halves of that changed together: the horn now springs
   * from the REAR OF THE HEAD (see drawHorn/HORN_BASE_K), and its base is
   * SUPPOSED to disappear under the thorax. A horn whose root is visible sits on
   * the bug; a horn whose root runs under the mass behind it grows out of it.
   *
   * So it is drawn immediately after the antennae and BEFORE the trunk block, in
   * both cases. Whichever ordering the trunk block then takes, the thorax is
   * drawn after the horn and covers the few pixels of root nearest the junction.
   * Everything past that — the whole visible length, the tip, every serration —
   * is forward of the head's rear edge and so clear of the thorax entirely, and
   * the shape still reads as a horn. It is drawn AFTER the head, so it lies over
   * the face rather than being cropped by it; head-up, that is a horn running up
   * the front of the skull, which is what the reference draws.
   *
   * Resulting call sequence, traced end to end:
   *
   *   NO WINGS   SHADOW → setae → legs → tail → eyes → mandibles → head → crown mark →
   *              antennae → HORN → thorax → abdomen group
   *   HAS WINGS  SHADOW → setae → legs → tail → eyes → mandibles → head → crown mark →
   *              antennae → HORN → abdomen group → thorax → wings
   *
   * In the wingless case the abdomen is drawn after the horn as well, which is
   * harmless: the horn points forward, away from the trunk, and the abdomen is
   * at the other end of the bug.
   */

  // 0. the ground plane, under everything the bug is made of.
  drawGroundShadow(ctx, L, phase);

  // 1. behind everything
  drawSetae(ctx, L, col);
  drawLegs(ctx, L, col, phase);
  drawTail(ctx, L, col, state, lunge);

  // 2. Eyes go UNDER the head so its edge crops them — that tucked-in look is a
  //    signature of the reference, and the wedge shape is drawn to be cropped.
  drawEyes(ctx, L, col);

  // 3. Mandibles go UNDER the head too, alongside the eyes. They are jaw parts
  //    hinged BEHIND the face, so the head edge cropping their roots is what
  //    makes them read as hinged rather than glued on. Their working ends reach
  //    forward past the silhouette, so nothing that matters is covered.
  //    Antennae stay ABOVE the head (step 5) — they sprout from the face plate
  //    itself and would vanish into it from underneath.
  drawMandibles(ctx, L, col, state, lunge, patMandible);

  // 4. the head — FLAT. One solid fill, no gradient, no bloom, no rim darkening.
  //    The crown mark that follows is the only blend allowed to touch it.
  ctx.beginPath();
  ctx.ellipse(L.head.x, 0, L.head.rx, L.head.ry, 0, 0, TAU);
  ctx.fillStyle = col.shell;
  ctx.fill();
  drawCrownMark(ctx, L, col);

  // 5. antennae, in front of the head
  drawAntennae(ctx, L, col, phase);

  // 6. the horn, UNDER the trunk. It springs from the rear of the head, and the
  //    thorax drawn after it is meant to bury that root — see the Z-ORDER note.
  drawHorn(ctx, L, col, patHorn);

  // 7/8. the trunk, ordered by whether the bug has wings
  const trunk = L.parts.filter((p) => p !== L.thorax);

  /** The abdomen group: segment masses (crease included) and elytra. */
  const drawTrunkAbdomen = () => {
    // THE SEAM IS NO LONGER DRAWN HERE. It used to be a second, independent
    // softStreak() laid over the abdomen after the fact, and that is exactly why
    // the abdomen showed TWO lines: see the ONE LINE note over segmentCentreline
    // for the three mismatches that produced. It is now the dark core of the one
    // crease segmentMass() draws, so there is no second stroke to drift.
    //
    // `elytra` is still the switch that suppresses the dark core — a shell cover
    // hides the joint — so segmentMass() is told which mass wants a crease.
    const creased = L.wingType === 'elytra' ? null : L.abdomen;
    for (const p of trunk) segmentMass(ctx, p, col, p === creased, g.spikyness, translucentSegments);
    drawElytra(ctx, L, col);                     // covers lie on the abdomen
  };

  /** The thorax. */
  const drawTrunkThorax = () => {
    segmentMass(ctx, L.thorax, col, false, g.spikyness, translucentSegments);
  };

  if (L.wingPairs > 0) {
    drawTrunkAbdomen();
    drawTrunkThorax();
  } else {
    drawTrunkThorax();
    drawTrunkAbdomen();
  }

  // 9. the wings, topmost of everything. See the Z-ORDER note above.
  drawSoftWings(ctx, L, col, phase, state);      // no-op for elytra

  ctx.restore();
}

/* ------------------------------------------------- spritesheet baking ---- */

export const ANIM_FRAMES = { idle: 4, walk: 8, attack: 6 };
export const ANIM_ORDER = ['idle', 'walk', 'attack'];

export function bakeSpritesheet(g, { ppu = 26, makeCanvas } = {}) {
  const L = layout(g, ppu);
  const size = L.half * 2;
  const total = ANIM_ORDER.reduce((n, k) => n + ANIM_FRAMES[k], 0);
  const create = makeCanvas ?? ((w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h; return c;
  });
  const canvas = create(size * total, size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const frames = {};
  let i = 0;
  for (const state of ANIM_ORDER) {
    frames[state] = [];
    const n = ANIM_FRAMES[state];
    for (let f = 0; f < n; f++) {
      ctx.save();
      ctx.translate(i * size + size / 2, size / 2);
      drawBug(ctx, g, { phase: f / n, state, ppu });
      ctx.restore();
      frames[state].push(i);
      i++;
    }
  }
  return { canvas, frameW: size, frameH: size, frames, total };
}
