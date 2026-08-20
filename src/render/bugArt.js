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
//     soft centreline. The blob colour is a fixed reference-palette cream/tan,
//     never a lighten of the body hue (see REF_PALETTE). The blob is DELIBERATELY
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
//   • Iridescence reads as a fine granular speckle, not glitter stars.
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

/** Deterministic scatter, so speckle never shimmers between frames. */
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
  // reference set; `pattern` picks, so it is heritable rather than arbitrary.
  //
  // This reading of `pattern` is INDEPENDENT of the three-way horn/mandible
  // surface treatment it also drives (see surfacePattern). Different body part,
  // different question — "are the legs inked" is not one of gradient/dots/oval —
  // so the 0.5 threshold is kept exactly as it was rather than being bent onto a
  // bucket boundary, and every existing genome keeps the limbs it had.
  const inkLimbs = g.pattern > 0.5;

  return {
    shell:   hsl(h, s, l),
    // The one surviving tone of the old airbrush gradient. It is NOT a head
    // treatment any more (the head is flat `shell`, see drawBug); the elytra
    // pass is its only consumer, where it separates the two wing covers.
    deep:    hsl(h, s * 1.02, Math.max(0.20, l - 0.14)),
    // Body-segment bloom, straight off the fixed reference palette — cream at
    // the core, warm tan on the way out, then out to nothing well short of the
    // rim so the edge stays flat undarkened `shell`. Six stops, all faint: see
    // BLOB_ALPHA for why the numbers are this low.
    segBloom:     refA(REF_PALETTE.cream, BLOB_ALPHA),
    segBloomMid:  refA(REF_PALETTE.cream, BLOB_ALPHA * 0.68),
    segBloomMid2: refA(REF_PALETTE.cream, BLOB_ALPHA * 0.44),
    segBloomFar:  refA(REF_PALETTE.tan, BLOB_ALPHA * 0.24),
    segBloomFar2: refA(REF_PALETTE.tan, BLOB_ALPHA * 0.10),
    segBloomOut:  refA(REF_PALETTE.tan, 0),
    // The crown mark — a flat colour patch on the head's own surface. Gold and
    // orange straight off REF_PALETTE, never computed from the body hue.
    crownSolid:    REF_PALETTE.gold,
    crownBlendTop: refA(REF_PALETTE.gold, 0.95),
    crownBlendMid: refA(REF_PALETTE.orange, 0.62),
    crownBlendOut: refA(REF_PALETTE.orange, 0),
    // The soft centreline is the segment's own shell colour, faded.
    shellSoft:   hsl(h, s, l, 0.30),
    shellClear:  hsl(h, s, l, 0),
    seam:    hsl(h, s * 1.05, Math.max(0.16, l - 0.20)),
    limb:    inkLimbs ? '#17161c' : hsl(h, s * 0.92, Math.max(0.24, l - 0.16)),
    limbLo:  inkLimbs ? '#0e0d11' : hsl(h, s * 0.95, Math.max(0.18, l - 0.24)),
    accent:  hsl(accentH, 0.72, 0.60),
    horn:    hsl(h, s * 0.90, Math.max(0.26, l - 0.10)),
    sclera:  '#ffffff',
    iris:    hsl(accentH, 0.70, 0.56),
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
 * Horns, redrawn from the reference sheet. Every one of them mounts on the
 * THORAX (see drawHorn) and points away from it, with `horn_serration` adding
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
 * bottom-left ≈ 100°, top-middle ≈ 110°, bottom-middle ≈ 150°. The window is set
 * to span that range with headroom — 35° at `wing_angle` 0, 165° at 1 — which
 * puts the sketch's median of ≈100° at exactly the midpoint, so `wing_angle`
 * defaults to 0.50 and a default bug rests at the sketch-typical angle.
 */
const WING_SWEEP_MIN = 0.61;   // 35°
const WING_SWEEP_MAX = 2.88;   // 165°
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
/** Two blade kinds that take serration, plus the chelicerae teeth/no-teeth pair. */
export const MANDIBLE_TYPES = ['wide_thin', 'narrow_thick', 'chelicerae_teeth', 'chelicerae_smooth'];

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
    mandibleType: MANDIBLE_TYPES[g.mandible_type ?? 0],
    wingPairs: g.wing_count / 2,
    wingArea: g.wing_area,
    setae: g.setae,
    shimmer: g.iridescence,
  };

  buildTrunk(L);
  buildLegs(L);
  buildHead(L);

  let maxX = 0, maxY = 0;
  const bump = (x, y) => { maxX = Math.max(maxX, Math.abs(x)); maxY = Math.max(maxY, Math.abs(y)); };
  for (const p of L.parts) { bump(p.x + p.rx, p.ry); bump(p.x - p.rx, p.ry); }
  for (const leg of L.legs) { bump(leg.foot.x, leg.foot.y); bump(leg.knee.x, leg.knee.y); }
  for (const e of L.eyes) bump(e.x + e.rx, e.y + e.ry);
  // Horns hang off the THORAX now, so the bound is measured from there. The 1.1
  // covers `split`, whose tip lands at 1.05 × hornLen past its own base.
  bump(L.thorax.x + L.thorax.rx + L.hornLen * 1.1, L.hornLen * 0.7);
  bump(L.tailTip?.x ?? 0, L.tailTip?.y ?? 0);
  if (L.wingPairs > 0) bump(L.wingSpan.x, L.wingSpan.y);

  L.half = Math.ceil(Math.max(maxX, maxY) + unit * 0.05 + 3);
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
  const abR = bodyWid * (arach ? 0.56 : 0.54);
  // widened both ends: the thorax can go much slimmer and much heavier than the
  // old 0.34–0.44 window allowed.
  const thR = arach ? bodyWid * 0.42 : bodyWid * lerp(0.24, 0.58, g.thorax_ratio);

  // Thorax sits at the origin; the abdominal chain grows backwards from it.
  const thorax = { x: 0, y: 0, rx: thR * (arach ? 1 : 1.04), ry: thR, kind: 'thorax' };

  const n = L.abdomenSegs;
  const abParts = [];
  if (n > 0) {
    // One segment keeps the old proportion; more segments each get shorter so a
    // ten-segment bug is long without being ten bodies long.
    const segLen = abR * (1.16 / Math.sqrt(n));
    const tipNarrow = lerp(1.0, 0.55, g.abdomen_taper);
    let x = -(thR * 0.74) - segLen * 0.60;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      const ry = abR * (1 - g.abdomen_taper * (arach ? 0.18 : 0.22)) * lerp(1.0, tipNarrow, t);
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
  L.trunkFrontX = thorax.x + thR;
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
        len: len * lerp(1.05, 0.92, t), w, fan, claw: g.claw_size,
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
  // Heads read smaller by default now: the window was 0.36–0.48 of body width,
  // which made even head_size=0 a boulder. Widened at both ends AND shifted
  // down, so the calibrated default (0.22) lands well under the old midpoint.
  const headR = bodyWid * (plan === 'arachnid' ? 0.28 : lerp(0.22, 0.62, g.head_size));
  const hx = L.trunkFrontX + headR * (plan === 'arachnid' ? 0.06 : 0.54);
  L.head = { x: hx, y: 0, rx: headR * 1.0, ry: headR, kind: 'head' };

  // The wedge eyes, set wide and tucked under the head edge so it crops the
  // inner half. `ry` is the long axis, `rx` the short one — the sketch's eye is
  // clearly taller than it is wide, hence the 0.55 rather than something nearer
  // a circle, and it is pushed far enough out that the rounded outer-top corner
  // clears the head silhouette instead of hiding behind it.
  const er = headR * lerp(0.45, 1.05, g.eye_size);   // widened both ends
  for (const side of [-1, 1]) {
    L.eyes.push({
      x: hx + headR * 0.04,
      y: side * headR * 0.98,
      rx: er * 0.55, ry: er, side,
    });
  }
  const extra = clamp(Math.round(g.eye_count / 2) - 1, 0, 3);
  for (let i = 0; i < extra; i++) {
    const t = extra === 1 ? 0.5 : i / (extra - 1);
    L.eyes.push({
      x: hx + headR * lerp(0.50, 0.14, t),
      y: (i % 2 === 0 ? -1 : 1) * headR * lerp(0.14, 0.38, t),
      rx: er * 0.17, ry: er * 0.17, side: 0, minor: true,
    });
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
  const sweep = lerp(WING_SWEEP_MIN, WING_SWEEP_MAX, g.wing_angle ?? 0.50);
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

/** Fine granular speckle — how iridescence reads in this style. */
function speckle(ctx, part, col, amount, seed) {
  if (amount < 0.28) return;
  const k = (amount - 0.28) / 0.72;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(part.x, 0, part.rx, part.ry, 0, 0, TAU);
  ctx.clip();
  const n = Math.round(90 + k * 200);
  ctx.fillStyle = col.accent;
  for (let i = 0; i < n; i++) {
    const a = hash01(i, seed) * TAU;
    // sqrt keeps the scatter even instead of clumping at the centre
    const r = Math.sqrt(hash01(i, seed + 9)) * 0.92;
    const d = hash01(i, seed + 21);
    ctx.globalAlpha = (0.10 + d * 0.55) * k;
    const s = (0.3 + d * 0.9) * Math.max(0.7, part.ry * 0.030);
    ctx.beginPath();
    ctx.arc(part.x + Math.cos(a) * part.rx * r, Math.sin(a) * part.ry * r, s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Speckle along a limb, matching the reference's dusted legs. */
function speckleLimb(ctx, leg, col, amount) {
  if (amount < 0.34) return;
  const k = (amount - 0.34) / 0.66;
  const n = Math.round(10 + k * 22);
  ctx.fillStyle = col.accent;
  for (let i = 0; i < n; i++) {
    const t = hash01(i, leg.pair * 7 + leg.side + 3);
    const u = 1 - t;
    // point on the quadratic
    const px = u * u * leg.attach.x + 2 * u * t * leg.knee.x + t * t * leg.foot.x;
    const py = u * u * leg.attach.y + 2 * u * t * leg.knee.y + t * t * leg.foot.y;
    const j = hash01(i, leg.pair * 13 + 5);
    ctx.globalAlpha = (0.18 + j * 0.5) * k;
    ctx.beginPath();
    ctx.arc(px + (j - 0.5) * leg.w * 0.7, py + (hash01(i, 31) - 0.5) * leg.w * 0.7,
            Math.max(0.5, leg.w * 0.10 * (0.5 + j)), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * A filled shape that follows a quadratic curve and tapers from w0 to w1.
 * This is what separates a designed horn from a bent line: real silhouettes
 * need mass at the base and a point at the tip, which a stroke can't give.
 */
function taperedCurve(ctx, p0, p1, p2, w0, w1, fill, steps = 16) {
  taperedPath(ctx, p0, p1, p2, w0, w1, steps);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** taperedCurve's outline, left on the context so a caller can clip to it. */
function taperedPath(ctx, p0, p1, p2, w0, w1, steps = 16) {
  const left = [], right = [];
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
  }
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (const p of left) ctx.lineTo(p.x, p.y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
}

/* ------------------------------------------------- horn / jaw patterning -- */

/**
 * `pattern`, `pattern_scale` and `pattern_contrast` used to reach nothing but a
 * black-limbs toggle. They now carry the reference sheet's three surface
 * treatments, applied to the HORN and the MANDIBLES only — body patterns are a
 * later pass, so the shell path is untouched.
 *
 *   pattern           min(2, floor(v × 3))  →  0 gradient · 1 dots · 2 oval
 *   pattern_scale     dot size and count (bigger = fewer, larger dots)
 *   pattern_contrast  how far the light tone departs from the base, for all three
 */
const PATTERN_MODES = ['gradient', 'dots', 'oval'];

/** Shortest way round the wheel, so red never travels through green to amber. */
function hueToward(from, to, t) {
  let d = ((to - from) % 1 + 1.5) % 1 - 0.5;
  return from + d * t;
}

export function surfacePattern(g, col) {
  const k = clamp(g.pattern_contrast ?? 0, 0, 1);
  // Warm lift: the reference sheet shifts red → amber toward the tip.
  const h = hueToward(col.h, 0.095, 0.35 + k * 0.5);
  return {
    mode: PATTERN_MODES[Math.min(2, Math.floor(clamp(g.pattern ?? 0, 0, 1) * 3))],
    scale: clamp(g.pattern_scale ?? 0, 0, 1),
    k,
    lite: hsl(h, clamp(col.s * 1.02, 0, 1), clamp(col.l + 0.10 + k * 0.26, 0, 0.90)),
  };
}

/**
 * Fill one tapered piece and then decorate it. The decoration clips to the piece
 * itself — that is the whole reason taperedPath exists separately — so dots and
 * highlights can never float off the silhouette.
 */
function patternedCurve(ctx, p0, p1, p2, w0, w1, base, pat, seed) {
  taperedPath(ctx, p0, p1, p2, w0, w1);
  if (pat.mode === 'gradient' && ctx.createLinearGradient) {
    const gr = ctx.createLinearGradient(p0.x, p0.y, p2.x, p2.y);
    gr.addColorStop(0, base);
    gr.addColorStop(1, pat.lite);
    ctx.fillStyle = gr;
  } else {
    ctx.fillStyle = base;
  }
  ctx.fill();
  if (pat.mode === 'gradient') return;

  ctx.save();
  ctx.clip();
  const px = (t) => qpoint(p0, p1, p2, t);
  if (pat.mode === 'dots') {
    // Same even sqrt-jittered scatter as speckle(), walked along the curve
    // instead of around an ellipse, because a horn is not an ellipse.
    const n = Math.round(lerp(34, 9, pat.scale));
    const r = Math.max(0.6, lerp(0.16, 0.40, pat.scale) * w0);
    ctx.fillStyle = pat.lite;
    ctx.globalAlpha = 0.35 + pat.k * 0.6;
    for (let i = 0; i < n; i++) {
      const t = Math.sqrt(hash01(i, seed)) * 0.98;
      const c = px(t);
      const j = hash01(i, seed + 11) - 0.5, j2 = hash01(i, seed + 23) - 0.5;
      const spread = lerp(w0, w1, t) * 1.1;
      ctx.beginPath();
      ctx.arc(c.x + j * spread, c.y + j2 * spread, r * (0.6 + hash01(i, seed + 31)), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    // oval — one highlight patch near the tip, the rest stays flat.
    const c = px(0.78);
    const d = px(0.92);
    const a = Math.atan2(d.y - c.y, d.x - c.x);
    const w = Math.max(1, lerp(w0, w1, 0.78));
    ctx.fillStyle = pat.lite;
    ctx.globalAlpha = 0.55 + pat.k * 0.45;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, w * 1.05, w * 0.46, a, 0, TAU);
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
  const { len: baseLen, wid: baseWid, sweep, round, fam } = L.wing;
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

function drawLegs(ctx, L, col, phase) {
  for (const leg of L.legs) {
    const off = (leg.pair * 0.34 + (leg.side > 0 ? 0.5 : 0)) % 1;
    const ph = (phase + off) % 1;
    const swing = Math.sin(ph * TAU) * 0.11;
    const cos = Math.cos(swing * leg.side * -1), sin = Math.sin(swing * leg.side * -1);
    const rel = (p) => ({
      x: leg.attach.x + (p.x - leg.attach.x) * cos - (p.y - leg.attach.y) * sin,
      y: leg.attach.y + (p.x - leg.attach.x) * sin + (p.y - leg.attach.y) * cos,
    });
    const knee = rel(leg.knee);
    const foot = rel(leg.foot);

    capsule(ctx, leg.attach.x, leg.attach.y,
            lerp(leg.attach.x, foot.x, 0.30), lerp(knee.y, foot.y, 0.18),
            foot.x, foot.y, leg.w, col.limb);

    // Foot: a small filled dot at the tip. Style only — it wants to punctuate
    // the capsule, not compete with it, so it stays under the cap's own width.
    fillEllipse(ctx, foot.x, foot.y, leg.w * 0.42, leg.w * 0.42, col.limbLo);

    if (leg.claw > 0.30) {
      const cl = leg.w * (0.5 + leg.claw * 1.1);
      capsule(ctx, foot.x, foot.y,
              foot.x + cl * 0.7, foot.y + leg.side * cl * 0.25,
              foot.x + cl, foot.y - leg.side * cl * 0.10,
              leg.w * 0.55, col.limbLo);
    }
    speckleLimb(ctx, { ...leg, knee, foot }, col, L.shimmer);
  }
}

/* ----------------------------------------------------------------- horn -- */

/**
 * HORNS MOUNT ON THE THORAX.
 *
 * They used to grow off the head edge. The origin is now the front of the
 * thorax — the reference sheet's blue attachment dot — so a horn reads as part
 * of the trunk rather than as headgear. Two consequences, both handled:
 *
 *   • the horn is drawn AFTER the thorax in drawBug(), not with the rest of the
 *     face furniture, or the thorax ellipse (topmost of the trunk) would bury
 *     its base;
 *   • layout() bumps the sprite bounds off the thorax, not the head.
 *
 * Lateral spread is measured in `sp`, a fraction of the horn's own length, so
 * the silhouette holds its proportions whatever the thorax is doing.
 */
function drawHorn(ctx, L, col, pat) {
  if (!L.hornLen) return;
  const th = L.thorax;
  const x0 = th.x + th.rx * 0.52;
  const len = L.hornLen;
  const sp = len * 0.42;                         // lateral unit
  const base = Math.max(3, L.unit * 0.115);      // horns want real mass
  const fill = col.horn;
  const sr = hornSerration(L.g);
  const piece = (p0, p1, p2, w0, w1, seed) =>
    patternedCurve(ctx, p0, p1, p2, w0, w1, fill, pat, seed);

  switch (L.hornType) {
    case 'nose': {
      // One straight central spike, wide at the base, sharp at the tip.
      // Serration adds PAIRS of small barbs up the shaft — the sketch's stacked
      // flame notches — leaving the spike underneath exactly as it was.
      piece({ x: x0, y: 0 }, { x: x0 + len * 0.55, y: 0 }, { x: x0 + len, y: 0 },
            base * 2.20, base * 0.10, 3);
      for (let i = 0; i < sr; i++) {
        const t = 0.40 + i * 0.26;
        for (const side of [-1, 1]) {
          piece({ x: x0 + len * t, y: side * base * 0.28 },
                { x: x0 + len * (t + 0.05), y: side * base * 0.95 },
                { x: x0 + len * (t + 0.17), y: side * base * 1.20 },
                base * 0.55, base * 0.05, 11 + i * 5 + side);
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
        piece(p0, p1, p2, base * 1.15, base * 0.10, 5 + side);
        for (let i = 0; i < sr; i++) {
          // inward-pointing tooth on the inner edge
          const c = qpoint(p0, p1, p2, 0.52 + i * 0.20);
          piece(c,
                { x: c.x + len * 0.04, y: c.y - side * sp * 0.18 },
                { x: c.x + len * 0.10, y: c.y - side * sp * 0.44 },
                base * 0.60, base * 0.06, 41 + i * 7 + side);
        }
      }
      break;
    }
    case 'y_shaped': {
      // A stem that forks into two outward-hooking arms. Serration hangs extra
      // spurs off the stem; the fork itself never changes.
      piece({ x: x0, y: 0 }, { x: x0 + len * 0.30, y: 0 }, { x: x0 + len * 0.62, y: 0 },
            base * 2.30, base * 1.30, 7);
      for (const side of [-1, 1]) {
        piece({ x: x0 + len * 0.56, y: side * base * 0.30 },
              { x: x0 + len * 0.80, y: side * sp * 0.55 },
              { x: x0 + len * 1.00, y: side * sp * 0.95 },
              base * 1.15, base * 0.10, 13 + side);
        for (let i = 0; i < sr; i++) {
          const t = 0.28 + i * 0.20;
          piece({ x: x0 + len * t, y: side * base * 0.40 },
                { x: x0 + len * (t + 0.06), y: side * sp * 0.50 },
                { x: x0 + len * (t + 0.13), y: side * sp * 0.74 },
                base * 0.60, base * 0.06, 61 + i * 9 + side);
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
        piece(p0, p1, p2, base * 2.40, base * 0.12, 17 + side);
        for (let i = 0; i < sr; i++) {
          const c = qpoint(p0, p1, p2, 0.46 + i * 0.24);
          piece(c,
                { x: c.x + len * 0.06, y: c.y - side * sp * 0.26 },
                { x: c.x + len * 0.16, y: c.y - side * sp * 0.62 },
                base * 0.75, base * 0.07, 71 + i * 11 + side);
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
          base * 0.85, base * 0.10, 23 + dy);
      }
      break;
    }
  }
}

/* ------------------------------------------------------------- mandible -- */

/**
 * Mandibles stay on the HEAD — only the horn moved to the thorax.
 *
 * Two of the four kinds take serration, and they read it off
 * `mandible_serration` bucketed to the sheet's 0/1/2 rather than blending
 * continuously. The chelicerae pair is the deliberate exception: `teeth` vs
 * `no teeth` is the sketch's own toggle between two VARIANTS, a fixed feature of
 * the shape, so those two kinds ignore the serration gene entirely.
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
 *                 not a blade and not curved. TEETH adds ONE small fang at the
 *                 tip on the inner side; NO TEETH is the bare column.
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
    const piece = (p0, p1, p2, w0, w1, seed) =>
      patternedCurve(ctx, p0, p1, p2, w0, w1, fill, pat, seed);

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
          w * size, w * 0.08, seed + i * 3);
      }
    };

    switch (L.mandibleType) {
      case 'narrow_thick': {
        // SHORT and HEAVY. Bulk at the base, hooking hard inward so the tips
        // converge — the sheet's fat claw. Half the reach of wide_thin.
        const p0 = { x: 0, y: 0 };
        const p1 = { x: m * 0.54, y: side * m * 0.38 };
        const p2 = { x: m * 0.92, y: side * m * -0.12 };
        piece(p0, p1, p2, w * 2.60, w * 0.26, 101 + side);
        // Deep teeth bitten out of the MIDDLE of the inner edge.
        teeth(p0, p1, p2, sr, 1.15, 0.30, 0.34, 0.26, 111 + side);
        break;
      }
      case 'chelicerae_teeth': {
        // The bare column plus ONE fang at the tip. That single fang is part of
        // the KIND, not a serration level — mandible_serration is not consulted.
        chelicera(ctx, piece, m, w, side, fill, true);
        break;
      }
      case 'chelicerae_smooth': {
        chelicera(ctx, piece, m, w, side, fill, false);
        break;
      }
      default: {
        // wide_thin — a LONG slender crescent sweeping OUTWARD to a fine point.
        // The pair splays; it does not hook back over the midline.
        const p0 = { x: 0, y: 0 };
        const p1 = { x: m * 0.74, y: side * m * 0.26 };
        const p2 = { x: m * 1.32, y: side * m * 0.68 };
        piece(p0, p1, p2, w * 0.85, w * 0.10, 131 + side);
        // Barbs LOW on the inner edge, in the bottom third, not up by the tip.
        teeth(p0, p1, p2, sr, 0.70, 0.22, 0.22, 0.21, 141 + side);
        break;
      }
    }
    ctx.restore();
  }
}

/**
 * The chelicera: a blunt column with parallel sides and a domed top, per the
 * sheet. Shared by both variants so only the tip fang differs.
 *
 * `taperedCurve` gives flat ends, so the dome is a plain circle capping the tip.
 * It is filled with the base colour rather than run through `piece` — it is the
 * silhouette's cap, not another patterned facet.
 */
function chelicera(ctx, piece, m, w, side, fill, withTeeth) {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: m * 0.32, y: side * m * 0.02 };
  const p2 = { x: m * 0.62, y: side * m * 0.04 };
  const cap = w * 1.55;
  // Stout: roughly twice as tall as it is wide, which is the sheet's proportion.
  // A slimmer column reads as a stick rather than a blunt fang.
  piece(p0, p1, p2, w * 3.10, w * 2.95, 151 + side);
  fillEllipse(ctx, p2.x, p2.y, cap, cap, fill);
  if (!withTeeth) return;
  // one small sharp fang off the tip, on the inner side
  piece(
    { x: p2.x, y: p2.y - side * cap * 0.55 },
    { x: p2.x + m * 0.10, y: p2.y - side * cap * 0.95 },
    { x: p2.x + m * 0.24, y: p2.y - side * cap * 1.05 },
    w * 0.62, w * 0.05, 161 + side);
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
  ctx.beginPath();
  ctx.moveTo(-R * 0.92, v(-r * 0.26));                                  // the point: inner-lower
  ctx.quadraticCurveTo(-R * 0.34, v(r * 1.00), R * 0.24, v(r * 1.14));  // outer edge, bellying out
  ctx.quadraticCurveTo(R * 0.94, v(r * 1.24), R * 0.96, v(r * 0.34));   // the broad rounded outer-top corner
  ctx.quadraticCurveTo(R * 0.98, v(-r * 0.32), R * 0.44, v(-r * 0.60)); // inner shoulder
  ctx.quadraticCurveTo(-R * 0.26, v(-r * 0.90), -R * 0.92, v(-r * 0.26)); // inner edge, back to the point
  ctx.closePath();
}

function drawEyes(ctx, L, col) {
  const { g } = L;
  // A flat white eye reads as graphic; an iris reads as a face. Bright, saturated
  // bugs get the iris — it's the cyan-on-red of the reference.
  //
  // NOT on the `dark` treatment. That fill is near-black with white speckle, and
  // a mid-tone coloured disc dropped on it either vanishes or fights the dots;
  // the sketch's own dark-eyed head shows speckle and nothing else. So the iris
  // is gated on a LIGHT sclera as well as on saturation.
  const hasIris = g.saturation > 0.35 && L.eyeFill !== 'dark';

  for (const e of L.eyes) {
    if (e.minor) { fillEllipse(ctx, e.x, e.y, e.rx, e.ry, col.pupil); continue; }

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

    if (hasIris) {
      // Sit the iris in the light body of the wedge, clear of the corner mark.
      const ir = Math.min(R, r) * 0.56;
      fillEllipse(ctx, -R * 0.06, v(r * 0.10), ir, ir, col.iris);
      fillEllipse(ctx, -R * 0.06, v(r * 0.10), ir * 0.50, ir * 0.50, col.pupil);
    }
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
 * How far the blob reaches, as a fraction of the part's semi-axes. Under 1 by a
 * wide margin on purpose: the gradient has to be fully transparent before it
 * gets anywhere near the outline, so the rim stays flat, undarkened `shell`.
 */
const BLOB_R = 0.74;
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
 * One trunk mass — thorax, abdominal segment, or myriapod ring.
 *
 * FLAT, not a shaded ball. A solid `shell` fill with a soft warm blob dropped
 * near the middle, nothing darkening toward the edge at all. The blob colour is
 * a constant off REF_PALETTE (see the mandate there), not a lighten of the body
 * hue, and its peak alpha is deliberately low (BLOB_ALPHA).
 *
 * NOTE the head does NOT come through here, and no longer has an equivalent of
 * its own: it is a single flat `col.shell` fill in drawBug(), with no lighting.
 */
function segmentMass(ctx, p, col) {
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

  segmentCentreline(ctx, p, col, rx, ry);
}

/**
 * The soft line down the middle of an elongated segment. Same colour as the
 * segment's own shell, just faded, so it only shows where it crosses the bloom —
 * which is where the reference shows it.
 *
 * Soft edges come from a linear gradient across the line's short axis, the way
 * the horn's gradient treatment already does it in this file; no ctx.filter,
 * which nothing here uses and the offscreen canvases would not honour anyway.
 *
 * This is NOT the abdominal seam drawn in drawBug(). That is a thin, hard,
 * DARK `col.seam` sliver marking a joint; this is a wide, soft, shell-coloured
 * fade. On an abdomen carrying both, the seam reads as a crisp core inside this
 * softer streak rather than competing with it — hence the low alpha here.
 */
function segmentCentreline(ctx, p, col, rx, ry) {
  const long = Math.max(rx, ry);
  const short = Math.min(rx, ry);
  if (long / short < CENTRELINE_RATIO) return;
  if (!ctx.createLinearGradient) return;

  const halfW = ry * 0.085;                 // lateral half-width of the streak
  const gr = ctx.createLinearGradient(0, p.y - halfW, 0, p.y + halfW);
  gr.addColorStop(0, col.shellClear);
  gr.addColorStop(0.5, col.shellSoft);
  gr.addColorStop(1, col.shellClear);

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
  ctx.clip();
  ctx.fillStyle = gr;
  ctx.fillRect(p.x - rx * 0.92, p.y - halfW, rx * 1.84, halfW * 2);
  ctx.restore();
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
  const pat = surfacePattern(g, col);        // horn + mandible surface treatment
  const breathe = state === 'idle' ? 1 + Math.sin(phase * TAU) * 0.018 : 1;
  const lunge = state === 'attack' ? Math.sin(Math.min(1, phase) * Math.PI) : 0;

  ctx.save();
  ctx.rotate(-Math.PI / 2);                 // head up
  ctx.translate(lunge * L.unit * 0.12, 0);
  ctx.scale(breathe, breathe);

  /* ---- Z-ORDER (painter's algorithm: later = on top) ----------------------
   *
   * THE ABDOMEN/THORAX RELATIONSHIP DEPENDS ON WINGS. This is a flip from the
   * previous rule, where the thorax was unconditionally the topmost trunk piece.
   *
   *   NO WINGS    … → head → THORAX → abdomen → horn
   *   HAS WINGS   … → head → abdomen → THORAX → horn → WINGS
   *
   * The reason the winged case inverts abdomen/thorax: wings attach to the
   * thorax, so the thorax has to clear the abdomen or the wing roots sit over a
   * mass that is behind their own anchor.
   *
   * WINGS ARE NOW TOPMOST — a deliberate reversal of the previous pass, which
   * put the thorax over them so a blade could not cover its own root. The wing
   * membrane is a fixed 0.70 alpha, so a blade lying over its root (or over the
   * horn) still shows what is under it; nothing is actually hidden, and the
   * sketch draws the wings as the frontmost plane. The horn keeps its place as
   * the last SOLID thing drawn, immediately under the wings, so its base is
   * still clear of the thorax it grows out of — and since the horn points
   * forward while the blades sweep backward, the two barely overlap at all.
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
   * Face furniture (antennae, mandibles) is drawn immediately after the head so
   * the head silhouette cannot swallow it. It projects FORWARD, away from the
   * trunk, so the trunk drawing over it costs nothing visible.
   *
   * THE HORN IS NOT FACE FURNITURE. It mounts on the thorax, so it is drawn dead
   * last, above everything, in both cases — anywhere earlier and its base is
   * buried under the very mass it grows out of. It points forward, away from the
   * trunk, so the abdomen sitting above the thorax in the wingless case cannot
   * cover it.
   */

  // 1. behind everything
  drawSetae(ctx, L, col);
  drawLegs(ctx, L, col, phase);
  drawTail(ctx, L, col, state, lunge);

  // 2. Eyes go UNDER the head so its edge crops them — that tucked-in look is a
  //    signature of the reference, and the wedge shape is drawn to be cropped.
  drawEyes(ctx, L, col);

  // 3. the head — FLAT. One solid fill, no gradient, no bloom, no rim darkening.
  //    The crown mark that follows is the only blend allowed to touch it.
  ctx.beginPath();
  ctx.ellipse(L.head.x, 0, L.head.rx, L.head.ry, 0, 0, TAU);
  ctx.fillStyle = col.shell;
  ctx.fill();
  drawCrownMark(ctx, L, col);

  // 4. face furniture, in front of the head
  drawAntennae(ctx, L, col, phase);
  drawMandibles(ctx, L, col, state, lunge, pat);

  // 5/6/7. the trunk, ordered by whether the bug has wings
  const trunk = L.parts.filter((p) => p !== L.thorax);

  /** The abdomen group: segment masses, elytra, speckle, seam. Moves as one. */
  const drawTrunkAbdomen = () => {
    for (const p of trunk) segmentMass(ctx, p, col);
    drawElytra(ctx, L, col);                     // covers lie on the abdomen
    for (let i = 0; i < trunk.length; i++) speckle(ctx, trunk[i], col, L.shimmer, i * 17 + 3);
    // abdominal seam — one thin darker sliver, no outline. Absent with no abdomen.
    const ab = L.abdomen;
    if (ab && L.wingType !== 'elytra') {
      ctx.fillStyle = col.seam;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(ab.x - ab.rx * 0.88, -Math.max(0.5, L.unit * 0.010), ab.rx * 1.76, Math.max(1, L.unit * 0.020));
      ctx.globalAlpha = 1;
    }
  };

  /** The thorax and its own speckle. */
  const drawTrunkThorax = () => {
    segmentMass(ctx, L.thorax, col);
    speckle(ctx, L.thorax, col, L.shimmer, L.parts.length * 17 + 3);
  };

  if (L.wingPairs > 0) {
    drawTrunkAbdomen();
    drawTrunkThorax();
  } else {
    drawTrunkThorax();
    drawTrunkAbdomen();
  }

  // 8. the horn, which grows OUT of the thorax and so has to sit over it
  drawHorn(ctx, L, col, pat);

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
