// Procedural bug art — cute, minimal, geometric.
//
// Design rules this file is built around:
//   • Round or semicircular masses. No long flat slabs — every proportion is
//     clamped into a friendly range before anything is drawn.
//   • Big eyes on the SIDES of the head, breaking the silhouette. This is the
//     single biggest cuteness lever.
//   • Long curved legs that emerge from BEHIND the body, so limbs can never
//     visually collide with the shell.
//   • Bright Bauhaus-ish colour: a curated set of saturated hues rather than a
//     continuous wheel, which is what made the old renders muddy.
//   • Every appendage points where it should — legs fan front-to-back, claws
//     hook forward, antennae sweep forward, stingers and wings trail back.
//
// Three body plans are constructed differently, because forcing a centipede
// through a beetle's geometry is what made them read as sausages:
//   insect    head + thorax + abdomen, legs on the thorax
//   arachnid  cephalothorax + abdomen, four leg pairs up front
//   myriapod  head + 6-10 repeating segments, ONE leg pair per segment
//
// Swap this module for the anyCreature/GLB pipeline later; nothing outside it
// knows how a bug looks.

import { morphology } from '../core/stats.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* ============================================================== colour ==== */

/**
 * Bauhaus palette — saturated, primary-leaning, deliberately discrete.
 * A continuous hue wheel spends most of its range in olive and brown; snapping
 * to these keeps every bug poster-bright.
 */
const BAUHAUS = [
  { h: 0.010, s: 0.78, l: 0.55 },  // vermilion
  { h: 0.055, s: 0.85, l: 0.57 },  // orange
  { h: 0.108, s: 0.88, l: 0.58 },  // amber
  { h: 0.145, s: 0.82, l: 0.60 },  // yellow
  { h: 0.255, s: 0.55, l: 0.48 },  // leaf
  { h: 0.410, s: 0.62, l: 0.46 },  // jade
  { h: 0.495, s: 0.68, l: 0.50 },  // teal
  { h: 0.570, s: 0.72, l: 0.53 },  // cobalt
  { h: 0.660, s: 0.60, l: 0.56 },  // periwinkle
  { h: 0.760, s: 0.55, l: 0.54 },  // violet
  { h: 0.880, s: 0.62, l: 0.58 },  // magenta
  { h: 0.955, s: 0.70, l: 0.60 },  // rose
];

const hsl = (h, s, l, a = 1) =>
  `hsla(${(((h % 1) + 1) % 1 * 360).toFixed(1)}, ${(clamp(s, 0, 1) * 100).toFixed(1)}%, ${(clamp(l, 0, 1) * 100).toFixed(1)}%, ${a})`;

export function palette(g) {
  const swatch = BAUHAUS[Math.floor(clamp(g.hue, 0, 0.999) * BAUHAUS.length)];
  // Genes still matter, but only as a nudge — the swatch keeps it bright.
  const h = swatch.h + (g.pattern_scale - 0.5) * 0.04;
  const s = clamp(swatch.s * (0.72 + g.saturation * 0.45), 0.30, 0.95);
  const l = clamp(swatch.l * (0.80 + g.lightness * 0.42), 0.34, 0.74);
  const alpha = 1 - g.translucency * 0.28;

  // Accent sits a third of the wheel away — Bauhaus liked a hard colour break.
  const accentH = swatch.h + (g.pattern > 0.5 ? 0.33 : -0.33);

  return {
    shell:    hsl(h, s, l, alpha),
    shellHi:  hsl(h - 0.02, s * 0.85, Math.min(0.88, l + 0.20), alpha),
    shellLo:  hsl(h + 0.02, s * 1.05, Math.max(0.16, l - 0.16), alpha),
    limb:     hsl(h + 0.01, s * 0.95, Math.max(0.16, l - 0.19), alpha),
    limbDark: hsl(h + 0.01, s * 0.9, Math.max(0.13, l - 0.22), alpha),
    accent:   hsl(accentH, 0.78, 0.62),
    accentLo: hsl(accentH, 0.72, 0.44),
    horn:     hsl(h + 0.03, s * 0.5, Math.max(0.22, l - 0.08)),
    hornHi:   hsl(h + 0.03, s * 0.4, Math.min(0.86, l + 0.24)),
    eye:      '#15121b',
    eyeRim:   hsl(h, s * 0.7, Math.max(0.12, l - 0.26)),
    shine:    'rgba(255,255,255,0.92)',
    outline:  hsl(h + 0.01, s * 0.55, Math.max(0.10, l - 0.30), alpha),
    setae:    hsl(h, s * 0.45, Math.min(0.82, l + 0.26), 0.5),
    wing:     hsl(h - 0.04, s * 0.45, Math.min(0.90, l + 0.28)),
    baseH: h, baseS: s, baseL: l, alpha,
  };
}

/* ========================================================== body plan ==== */

/** Which construction to use. Derived, so no extra gene is needed. */
export function bodyPlan(g) {
  if (g.leg_count >= 8 && g.body_length > 0.70) return 'myriapod';
  if (g.leg_count >= 8) return 'arachnid';
  return 'insect';
}

export const HORN_TYPES = ['rhino', 'stag', 'rostrum', 'crown'];
export const WING_TYPES = ['membranous', 'elytra', 'broad', 'narrow'];

/* ============================================================ layout ===== */

/**
 * Build the whole skeleton in local pixel space. Origin is the bug's centre,
 * +x is facing. Everything downstream just draws what this returns, so all
 * spacing and anti-overlap logic lives in one place.
 */
export function layout(g, ppu = 26) {
  const m = morphology(g);
  const plan = bodyPlan(g);

  // --- proportion guards -------------------------------------------------
  // Cute means round. Clamp the length:width ratio hard so nothing reads as a
  // plank or a worm (except myriapods, which earn a longer allowance).
  const maxRatio = plan === 'myriapod' ? 3.4 : 1.85;
  const minRatio = 0.95;
  let bodyLen = m.length * ppu * 0.86;
  let bodyWid = m.width * ppu * 1.25;
  const ratio = bodyLen / bodyWid;
  if (ratio > maxRatio) bodyWid = bodyLen / maxRatio;
  if (ratio < minRatio) bodyLen = bodyWid * minRatio;

  const unit = (bodyLen + bodyWid) * 0.5;      // scale reference for details

  const L = {
    g, m, plan, ppu, bodyLen, bodyWid, unit,
    parts: [],      // filled ellipses/circles making the trunk, rear-to-front
    legs: [],
    eyes: [],
    antennae: [],
    hornType: HORN_TYPES[g.horn_type ?? 0],
    wingType: WING_TYPES[g.wing_type ?? 0],
    wingPairs: g.wing_count / 2,
    wingArea: g.wing_area,
    setae: g.setae,
    shimmer: g.iridescence,
  };

  buildTrunk(L);
  buildLegs(L);
  buildHead(L);

  // --- extents -----------------------------------------------------------
  let maxX = 0, maxY = 0;
  const bump = (x, y) => { maxX = Math.max(maxX, Math.abs(x)); maxY = Math.max(maxY, Math.abs(y)); };
  for (const p of L.parts) { bump(p.x + p.rx, p.ry); bump(p.x - p.rx, p.ry); }
  for (const leg of L.legs) { bump(leg.foot.x, leg.foot.y); bump(leg.knee.x, leg.knee.y); }
  for (const e of L.eyes) bump(e.x + e.r, e.y + e.r);
  bump(L.head.x + L.head.rx + L.hornLen, 0);
  bump(L.tailTip?.x ?? 0, L.tailTip?.y ?? 0);
  if (L.wingPairs > 0) bump(L.wingSpan.x, L.wingSpan.y);

  L.half = Math.ceil(Math.max(maxX, maxY) + unit * 0.06 + 3);
  return L;
}

/* ---------------------------------------------------------------- trunk -- */

function buildTrunk(L) {
  const { g, plan, bodyLen, bodyWid } = L;

  if (plan === 'myriapod') {
    // A real centipede: a head plus a train of near-identical round segments,
    // each carrying exactly one leg pair. 6-10 segments by body length.
    const n = clamp(Math.round(6 + g.body_length * 4), 6, 10);
    const segR = bodyWid * 0.46;
    const pitch = segR * 1.42;                 // overlap slightly, like tergites
    const total = pitch * (n - 1);
    const frontX = total * 0.5;
    L.segCount = n;
    for (let i = n - 1; i >= 0; i--) {         // rear first so front overlaps
      const t = i / (n - 1);
      // gentle taper toward the tail keeps it from reading as a tube
      const r = segR * lerp(0.74, 1.0, Math.sin(t * Math.PI * 0.85 + 0.35));
      L.parts.push({ x: frontX - pitch * i, y: 0, rx: r * 1.02, ry: r, kind: 'seg', t });
    }
    L.trunkFrontX = frontX;
    L.trunkFrontR = segR;
    return;
  }

  if (plan === 'arachnid') {
    // Two round masses: a big abdomen and a slightly smaller cephalothorax.
    const abR = bodyWid * 0.54;
    const cephR = bodyWid * 0.44;
    const gap = (abR + cephR) * 0.80;
    L.parts.push({ x: -gap * 0.5, y: 0, rx: abR * (1 - g.abdomen_taper * 0.10), ry: abR, kind: 'abdomen' });
    L.parts.push({ x: gap * 0.5, y: 0, rx: cephR, ry: cephR * 0.96, kind: 'thorax' });
    L.trunkFrontX = gap * 0.5 + cephR;
    L.trunkFrontR = cephR;
    return;
  }

  // insect — abdomen, thorax, then the head is added in buildHead
  const abR = bodyWid * 0.52;
  const thR = bodyWid * lerp(0.36, 0.46, g.thorax_ratio);
  const abLen = abR * lerp(1.05, 1.35, g.body_length);
  const gap = abLen * 0.62 + thR * 0.78;
  L.parts.push({
    x: -gap * 0.46, y: 0,
    rx: abLen, ry: abR * (1 - g.abdomen_taper * 0.14),
    kind: 'abdomen',
  });
  L.parts.push({ x: gap * 0.54, y: 0, rx: thR * 1.06, ry: thR, kind: 'thorax' });
  L.trunkFrontX = gap * 0.54 + thR;
  L.trunkFrontR = thR;
}

/* ----------------------------------------------------------------- legs -- */

/**
 * Legs are placed along the trunk with guaranteed spacing, and fan from
 * forward-pointing at the front to backward-pointing at the rear. They are
 * drawn behind the body, so they can never overlap the shell.
 */
function buildLegs(L) {
  const { g, plan, bodyWid, unit } = L;
  const pairs = plan === 'myriapod' ? L.segCount : g.leg_count / 2;
  const len = unit * lerp(0.72, 1.32, g.leg_length) * (plan === 'myriapod' ? 0.52 : 1);
  const w = clamp(unit * (0.055 + g.leg_thickness * 0.075), 2.0, 10);

  for (let i = 0; i < pairs; i++) {
    const t = pairs === 1 ? 0.5 : i / (pairs - 1);   // 0 = front pair

    let ax, ay, host;
    if (plan === 'myriapod') {
      host = L.parts[L.parts.length - 1 - i] ?? L.parts[0];
      ax = host.x;
      ay = host.ry * 0.86;
    } else if (plan === 'arachnid') {
      const ceph = L.parts[1];
      ax = ceph.x + lerp(ceph.rx * 0.50, -ceph.rx * 0.58, t);
      ay = ceph.ry * 0.82;
    } else {
      const th = L.parts[1];
      ax = th.x + lerp(th.rx * 0.58, -th.rx * 0.66, t);
      ay = th.ry * 0.86;
    }

    // Fan: front legs reach forward, rear legs sweep back. This is the single
    // change that stops legs reading as a symmetrical millipede blur.
    const fan = lerp(-0.50, 0.72, t) * (0.60 + g.leg_spread * 0.55);
    const droop = lerp(0.10, 0.04, t);   // near-perpendicular: legs go OUT

    for (const side of [-1, 1]) {
      L.legs.push(buildLeg({
        ax, ay: ay * side, side, pair: i, t,
        len: len * lerp(1.06, 0.92, t), w, fan, droop,
        joints: g.leg_joints, claw: g.claw_size,
      }));
    }
  }
}

function buildLeg(o) {
  // Built in components rather than polar angles, so the lateral term is ALWAYS
  // outward: cos(tilt) > 0 for any |tilt| < 90°, which makes it geometrically
  // impossible for a leg to swing back across the shell. `tilt` only leans the
  // limb forward or backward; it can never flip it over the body.
  const tilt = clamp(o.fan, -0.75, 0.95);          // −forward … +backward
  const bend = 0.34;                               // extra sweep past the knee
  const out = o.side;

  const kx = o.ax - Math.sin(tilt) * o.len * 0.50;
  const ky = o.ay + out * Math.cos(tilt) * o.len * 0.50;
  const fx = kx - Math.sin(tilt + bend) * o.len * 0.58;
  const fy = ky + out * Math.cos(tilt + bend) * o.len * 0.58;

  return {
    ...o, tilt,
    attach: { x: o.ax, y: o.ay },
    knee: { x: kx, y: ky },
    foot: { x: fx, y: fy },
  };
}

/* ----------------------------------------------------------------- head -- */

function buildHead(L) {
  const { g, plan, bodyWid, unit } = L;

  // Big round head. Arachnids fold it into the cephalothorax, so it is small
  // and sits proud of the front edge instead of being its own mass.
  const headR = bodyWid * (plan === 'arachnid' ? 0.34 : lerp(0.40, 0.54, g.head_size));
  const hx = L.trunkFrontX + headR * (plan === 'arachnid' ? 0.10 : 0.62);
  L.head = { x: hx, y: 0, rx: headR * 1.02, ry: headR, kind: 'head' };

  // --- eyes -------------------------------------------------------------
  // ONE big eye per side, mounted on the head's flank so it bulges past the
  // silhouette. This is the whole cuteness budget; extra eyes from eye_count
  // become small ocelli on the brow rather than more giant orbs.
  // Sized and spaced so the shell always shows between them — two separate
  // eyes read as a face; two touching eyes read as one black blob.
  const eyeR = headR * lerp(0.40, 0.56, g.eye_size);
  for (const side of [-1, 1]) {
    L.eyes.push({
      x: hx + headR * 0.26,
      y: side * (headR * 0.88),
      r: eyeR, side, main: true,
    });
  }
  const extra = clamp(Math.round(g.eye_count / 2) - 1, 0, 3);
  for (let i = 0; i < extra; i++) {
    const t = extra === 1 ? 0.5 : i / (extra - 1);
    L.eyes.push({
      x: hx + headR * lerp(0.52, 0.18, t),
      y: (i % 2 === 0 ? -1 : 1) * headR * lerp(0.10, 0.34, t),
      r: eyeR * 0.22, side: 0, main: false,
    });
  }

  // --- antennae: sweep forward and outward --------------------------------
  const antLen = unit * lerp(0.10, 0.62, g.antenna_length);
  if (antLen > unit * 0.14) {
    for (const side of [-1, 1]) L.antennae.push({ side, len: antLen, r: headR });
  }

  // --- horn ---------------------------------------------------------------
  const hornMax = HORN_TYPES[g.horn_type ?? 0] === 'rostrum' ? 0.46 : 0.56;
  L.hornLen = g.horn_size < 0.14 ? 0 : unit * lerp(0.14, hornMax, g.horn_size);
  L.mandible = g.mandible_size < 0.08 ? 0 : headR * lerp(0.42, 0.88, g.mandible_size);

  // --- tail / stinger -----------------------------------------------------
  const rear = L.parts[0];
  const tailLen = unit * lerp(0, 0.5, g.tail_length);
  if (tailLen > unit * 0.06) {
    L.tail = { len: tailLen, x0: rear.x - rear.rx * 0.7, sting: g.stinger_size };
    L.tailTip = { x: rear.x - rear.rx * 0.7 - tailLen, y: -tailLen * 0.28 };
  }

  // --- wing extent for framing -------------------------------------------
  if (L.wingPairs > 0 && L.wingArea > 0.05) {
    const wl = unit * lerp(0.85, 1.75, L.wingArea);
    L.wingSpan = { x: Math.abs(L.parts[0].x) + wl * 0.85, y: bodyWid * 0.5 + wl * 0.80 };
  } else {
    L.wingPairs = 0;
    L.wingSpan = { x: 0, y: 0 };
  }
}

/* ============================================================ drawing ==== */

function ellipse(ctx, x, y, rx, ry, fill, stroke, lw) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

/** Soft top-left lit fill for a round mass. */
function shadeFill(ctx, part, col) {
  const gr = ctx.createRadialGradient(
    part.x - part.rx * 0.34, -part.ry * 0.40, part.ry * 0.10,
    part.x, 0, Math.max(part.rx, part.ry) * 1.18
  );
  gr.addColorStop(0, col.shellHi);
  gr.addColorStop(0.52, col.shell);
  gr.addColorStop(1, col.shellLo);
  return gr;
}

/**
 * Jewel shimmer — a hue sweep across the shell plus a couple of sparkles.
 * Only fires for high iridescence, so a shiny beetle really stands out.
 */
function drawShimmer(ctx, part, col, amount, seedX) {
  if (amount < 0.30) return;
  const k = (amount - 0.30) / 0.70;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(part.x, 0, part.rx, part.ry, 0, 0, TAU);
  ctx.clip();

  const gr = ctx.createLinearGradient(
    part.x - part.rx, -part.ry, part.x + part.rx, part.ry
  );
  const h = col.baseH;
  gr.addColorStop(0.00, hsl(h + 0.40, 0.85, 0.62, 0));
  gr.addColorStop(0.28, hsl(h + 0.40, 0.85, 0.66, 0.42 * k));
  gr.addColorStop(0.50, hsl(h + 0.62, 0.90, 0.72, 0.55 * k));
  gr.addColorStop(0.72, hsl(h + 0.84, 0.85, 0.66, 0.40 * k));
  gr.addColorStop(1.00, hsl(h + 0.84, 0.85, 0.62, 0));
  ctx.fillStyle = gr;
  ctx.fillRect(part.x - part.rx, -part.ry, part.rx * 2, part.ry * 2);
  ctx.restore();

  // sparkles: tiny four-point stars, the "jewelled" tell
  const n = 1 + Math.round(k * 2);
  for (let i = 0; i < n; i++) {
    const a = (i * 2.399 + seedX) % TAU;
    const rr = part.rx * 0.42 * (0.4 + ((i * 7) % 5) / 6);
    const sx = part.x + Math.cos(a) * rr;
    const sy = Math.sin(a) * part.ry * 0.42;
    const s = Math.max(1.4, part.ry * 0.13) * (0.7 + k * 0.6);
    ctx.fillStyle = `rgba(255,255,255,${0.55 + k * 0.35})`;
    ctx.beginPath();
    ctx.moveTo(sx, sy - s);
    ctx.quadraticCurveTo(sx + s * 0.22, sy - s * 0.22, sx + s, sy);
    ctx.quadraticCurveTo(sx + s * 0.22, sy + s * 0.22, sx, sy + s);
    ctx.quadraticCurveTo(sx - s * 0.22, sy + s * 0.22, sx - s, sy);
    ctx.quadraticCurveTo(sx - s * 0.22, sy - s * 0.22, sx, sy - s);
    ctx.fill();
  }
}

/* ------------------------------------------------------------ markings -- */

function drawPattern(ctx, L, col) {
  const { g } = L;
  if (g.pattern_contrast < 0.12) return;
  const body = L.parts.find((p) => p.kind === 'abdomen') ?? L.parts[0];
  const style = Math.floor(g.pattern * 3);
  const alpha = 0.35 + g.pattern_contrast * 0.5;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(body.x, 0, body.rx, body.ry, 0, 0, TAU);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = col.accent;

  if (style === 0) {
    // fat bands — geometric, evenly spaced
    const n = clamp(Math.round(2 + g.pattern_scale * 3), 2, 5);
    const bw = (body.rx * 2) / (n * 2 + 1);
    for (let i = 0; i < n; i++) {
      const x = body.x - body.rx + bw * (i * 2 + 1);
      ctx.fillRect(x, -body.ry, bw, body.ry * 2);
    }
  } else if (style === 1) {
    // big dots
    const n = clamp(Math.round(2 + g.pattern_scale * 4), 2, 6);
    const r = body.ry * lerp(0.30, 0.17, g.pattern_scale);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.6;
      ctx.beginPath();
      ctx.arc(body.x + Math.cos(a) * body.rx * 0.42,
              Math.sin(a) * body.ry * 0.46, r, 0, TAU);
      ctx.fill();
    }
  } else {
    // half-moon: a single clean semicircle, the most Bauhaus of the three
    ctx.beginPath();
    ctx.arc(body.x, 0, body.ry * 0.92, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- wings -- */

/**
 * Soft wings (membranous / broad / narrow) trail BEHIND the body.
 * Elytra are different animals entirely — they are hard covers that sit ON the
 * abdomen, so they get their own pass after the trunk is filled.
 */
function drawSoftWings(ctx, L, col, phase, state) {
  if (L.wingPairs < 1 || L.wingType === 'elytra') return;
  const { g } = L;
  const flap = state === 'walk' || state === 'attack'
    ? Math.sin(phase * TAU * (1 + g.wing_beat * 2.5)) * 0.18 : 0.02;
  const type = L.wingType;
  const wl = L.unit * lerp(0.85, 1.75, L.wingArea) * (type === 'broad' ? 1.15 : 1);
  const anchor = L.parts[L.parts.length - 1];

  for (let p = L.wingPairs - 1; p >= 0; p--) {     // hindwings first
    const scale = 1 - p * 0.24;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(anchor.x - L.unit * 0.10, side * anchor.ry * 0.30);
      // Wings sweep BACK and OUT — rotate past 90° so they never point forward.
      ctx.rotate(side * (1.02 + flap + p * 0.30));

      const len = wl * scale;
      const wid = len * (type === 'narrow' ? 0.26 : type === 'broad' ? 0.62 : 0.40);

      const grad = ctx.createLinearGradient(0, 0, len * 0.2, side * wid);
      grad.addColorStop(0, hsl(col.baseH - 0.03, 0.30, 0.96, 0.62));
      grad.addColorStop(0.55, hsl(col.baseH + 0.06, 0.45, 0.86, 0.40));
      grad.addColorStop(1, hsl(col.baseH + 0.16, 0.60, 0.78, 0.26));

      ctx.beginPath();
      ctx.moveTo(0, 0);
      if (type === 'broad') {
        // full rounded moth wing — a big soft petal
        ctx.quadraticCurveTo(len * 0.10, side * wid * 1.30, len * 0.62, side * wid * 1.10);
        ctx.quadraticCurveTo(len * 1.02, side * wid * 0.80, len * 0.94, side * wid * 0.28);
        ctx.quadraticCurveTo(len * 0.60, side * wid * 0.02, 0, 0);
      } else {
        ctx.quadraticCurveTo(len * 0.16, side * wid * 1.12, len * 0.80, side * wid * 0.74);
        ctx.quadraticCurveTo(len * 1.00, side * wid * 0.40, len * 0.72, side * wid * 0.12);
        ctx.quadraticCurveTo(len * 0.40, side * wid * 0.02, 0, 0);
      }
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(1, L.unit * 0.020);
      ctx.stroke();

      // two clean veins, drawn inside the wing
      ctx.save();
      ctx.clip();
      ctx.globalAlpha = 0.30;
      ctx.strokeStyle = col.limb;
      ctx.lineWidth = Math.max(0.8, L.unit * 0.014);
      for (const k of [0.42, 0.72]) {
        ctx.beginPath();
        ctx.moveTo(len * 0.04, side * wid * 0.06);
        ctx.quadraticCurveTo(len * 0.50, side * wid * k, len * 0.88, side * wid * k * 0.75);
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
    }
  }
}

/**
 * Elytra — the beetle's hard wing cases. Two glossy half-shells laid over the
 * abdomen with a seam down the middle. Drawn on top of the trunk because that
 * is physically where they are.
 */
function drawElytra(ctx, L, col) {
  if (L.wingPairs < 1 || L.wingType !== 'elytra') return;
  const body = L.parts.find((p) => p.kind === 'abdomen') ?? L.parts[0];
  const cover = lerp(0.72, 1.02, L.wingArea);
  const rx = body.rx * cover;
  const ry = body.ry * cover;
  const outlineW = Math.max(1.1, L.unit * 0.030);

  for (const side of [-1, 1]) {
    ctx.save();
    ctx.beginPath();
    // half-ellipse per side, meeting at the seam
    ctx.ellipse(body.x, side * ry * 0.30, rx, ry * 0.74, 0, 0, TAU);
    ctx.fillStyle = side < 0 ? col.shell : col.shellLo;
    ctx.fill();
    ctx.strokeStyle = col.outline;
    ctx.lineWidth = outlineW;
    ctx.stroke();
    // gloss streak along the top shell only
    if (side < 0) {
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.ellipse(body.x - rx * 0.18, -ry * 0.10, rx * 0.46, ry * 0.20, -0.18, 0, TAU);
      ctx.fillStyle = col.shellHi;
      ctx.fill();
    }
    ctx.restore();
  }
  // seam
  ctx.strokeStyle = col.outline;
  ctx.lineWidth = outlineW * 0.9;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(body.x - rx * 0.94, 0);
  ctx.lineTo(body.x + rx * 0.88, 0);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/* ----------------------------------------------------------------- legs -- */

function drawLegs(ctx, L, col, phase) {
  for (const leg of L.legs) {
    const off = (leg.pair * 0.34 + (leg.side > 0 ? 0.5 : 0)) % 1;
    const ph = (phase + off) % 1;
    const swing = Math.sin(ph * TAU) * 0.13;
    const lift = Math.max(0, Math.cos(ph * TAU)) * 0.08;

    // rotate the whole limb a little around its attach point
    const rot = swing * leg.side * -1;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const rel = (p) => ({
      x: leg.attach.x + (p.x - leg.attach.x) * cos - (p.y - leg.attach.y) * sin,
      y: leg.attach.y + (p.x - leg.attach.x) * sin + (p.y - leg.attach.y) * cos,
    });
    const knee = rel(leg.knee);
    const foot = rel(leg.foot);
    foot.y += leg.side * lift * L.unit * 0.10;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // femur — thicker, from body to knee
    ctx.strokeStyle = col.limb;
    ctx.lineWidth = leg.w * 1.25;
    ctx.beginPath();
    ctx.moveTo(leg.attach.x, leg.attach.y);
    ctx.quadraticCurveTo(
      lerp(leg.attach.x, knee.x, 0.55), lerp(leg.attach.y, knee.y, 0.42),
      knee.x, knee.y
    );
    ctx.stroke();

    // tibia — thinner, curving out to the foot
    ctx.lineWidth = leg.w * 0.82;
    ctx.beginPath();
    ctx.moveTo(knee.x, knee.y);
    ctx.quadraticCurveTo(
      lerp(knee.x, foot.x, 0.42), lerp(knee.y, foot.y, 0.72),
      foot.x, foot.y
    );
    ctx.stroke();

    // tarsal claw — hooks FORWARD, toward the bug's facing
    if (leg.claw > 0.22) {
      const cl = leg.w * (0.9 + leg.claw * 2.0);
      ctx.strokeStyle = col.limbDark;
      ctx.lineWidth = leg.w * 0.62;
      ctx.beginPath();
      ctx.moveTo(foot.x, foot.y);
      ctx.quadraticCurveTo(foot.x + cl * 0.7, foot.y + leg.side * cl * 0.2,
                           foot.x + cl, foot.y - leg.side * cl * 0.18);
      ctx.stroke();
    }
  }
}

/* ----------------------------------------------------------------- horn -- */

function drawHorn(ctx, L, col) {
  if (!L.hornLen) return;
  const h = L.head;
  const x0 = h.x + h.rx * 0.62;
  const len = L.hornLen;
  const w = Math.max(1.6, L.unit * 0.05);

  ctx.strokeStyle = col.horn;
  ctx.fillStyle = col.horn;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (L.hornType === 'rhino') {
    // one thick tapered horn, curving up and forward
    ctx.beginPath();
    ctx.moveTo(x0, -h.ry * 0.16);
    ctx.quadraticCurveTo(x0 + len * 0.55, -h.ry * 0.42, x0 + len, -h.ry * 0.92);
    ctx.lineTo(x0 + len * 0.86, -h.ry * 0.52);
    ctx.quadraticCurveTo(x0 + len * 0.45, -h.ry * 0.06, x0, h.ry * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = col.outline;
    ctx.lineWidth = w * 0.5;
    ctx.stroke();
    // glint
    ctx.fillStyle = col.hornHi;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(x0 + len * 0.16, -h.ry * 0.20);
    ctx.quadraticCurveTo(x0 + len * 0.55, -h.ry * 0.44, x0 + len * 0.88, -h.ry * 0.74);
    ctx.lineTo(x0 + len * 0.80, -h.ry * 0.50);
    ctx.quadraticCurveTo(x0 + len * 0.48, -h.ry * 0.26, x0 + len * 0.14, -h.ry * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (L.hornType === 'stag') {
    // paired antlers that curve inward — reads as a pincer
    for (const side of [-1, 1]) {
      ctx.lineWidth = w * 1.15;
      ctx.strokeStyle = col.horn;
      ctx.beginPath();
      ctx.moveTo(x0 - h.rx * 0.1, side * h.ry * 0.44);
      ctx.quadraticCurveTo(x0 + len * 0.66, side * h.ry * 1.15,
                           x0 + len, side * h.ry * 0.30);
      ctx.stroke();
      // inner tine
      ctx.lineWidth = w * 0.7;
      ctx.beginPath();
      ctx.moveTo(x0 + len * 0.56, side * h.ry * 0.86);
      ctx.lineTo(x0 + len * 0.74, side * h.ry * 0.24);
      ctx.stroke();
    }
  } else if (L.hornType === 'rostrum') {
    // weevil snout: a long clean taper straight ahead
    ctx.beginPath();
    ctx.moveTo(x0, -h.ry * 0.17);
    ctx.quadraticCurveTo(x0 + len * 0.7, -h.ry * 0.10, x0 + len, -h.ry * 0.03);
    ctx.quadraticCurveTo(x0 + len * 0.7, h.ry * 0.10, x0, h.ry * 0.17);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = col.outline;
    ctx.lineWidth = w * 0.45;
    ctx.stroke();
    ctx.fillStyle = col.hornHi;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.ellipse(x0 + len * 0.5, -h.ry * 0.10, len * 0.34, h.ry * 0.06, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    // crown: three short prongs, symmetric and graphic
    for (const [dy, scale] of [[-0.62, 0.78], [0, 1], [0.62, 0.78]]) {
      ctx.lineWidth = w * 1.05;
      ctx.strokeStyle = col.horn;
      ctx.beginPath();
      ctx.moveTo(x0 - h.rx * 0.05, dy * h.ry * 0.55);
      ctx.quadraticCurveTo(x0 + len * 0.5 * scale, dy * h.ry * 0.95,
                           x0 + len * scale, dy * h.ry * 1.05);
      ctx.stroke();
    }
  }
}

/* ------------------------------------------------------------- mandible -- */

function drawMandibles(ctx, L, col, state, lunge) {
  if (!L.mandible) return;
  const h = L.head;
  const open = state === 'attack' ? 0.30 + lunge * 0.75 : 0.20;
  const m = L.mandible;

  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(h.x + h.rx * 0.74, side * h.ry * 0.26);
    ctx.rotate(side * open);
    // Cute mandible: a fat rounded comma, not a scythe.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(m * 0.95, side * m * 0.42, m * 1.05, side * m * -0.10);
    ctx.quadraticCurveTo(m * 0.70, side * m * 0.16, 0, side * m * 0.42);
    ctx.closePath();
    ctx.fillStyle = col.hornHi;
    ctx.fill();
    ctx.strokeStyle = col.outline;
    ctx.lineWidth = Math.max(0.9, L.unit * 0.022);
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }
}

/* ------------------------------------------------------------- antennae -- */

function drawAntennae(ctx, L, col, phase) {
  const h = L.head;
  for (const a of L.antennae) {
    const wag = Math.sin(phase * TAU + a.side) * 0.10;
    ctx.strokeStyle = col.limb;
    ctx.lineWidth = Math.max(1, L.unit * 0.030);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(h.x + h.rx * 0.45, a.side * h.ry * 0.52);
    ctx.quadraticCurveTo(
      h.x + a.len * 0.72, a.side * (h.ry * 1.05 + a.len * 0.10 + wag * a.len),
      h.x + a.len * 1.02, a.side * (h.ry * 0.55 + a.len * 0.34 + wag * a.len)
    );
    ctx.stroke();
    // club tip — a small dot reads as intentional and cute
    ctx.fillStyle = col.limbDark;
    ctx.beginPath();
    ctx.arc(h.x + a.len * 1.02, a.side * (h.ry * 0.55 + a.len * 0.34 + wag * a.len),
            Math.max(1.0, L.unit * 0.026), 0, TAU);
    ctx.fill();
  }
}

/* ----------------------------------------------------------------- tail -- */

function drawTail(ctx, L, col, phase, state, lunge) {
  if (!L.tail) return;
  const t = L.tail;
  const curl = Math.sin(phase * TAU) * 0.10 - (state === 'attack' ? lunge * 0.5 : 0);
  const tipX = t.x0 - t.len;
  const tipY = -t.len * (0.26 + curl);

  ctx.strokeStyle = col.limb;
  ctx.lineWidth = Math.max(1.4, L.unit * 0.055);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(t.x0, 0);
  ctx.quadraticCurveTo(t.x0 - t.len * 0.62, tipY * 0.35, tipX, tipY);
  ctx.stroke();

  if (t.sting > 0.18) {
    const s = L.unit * (0.05 + t.sting * 0.10);
    const ang = Math.atan2(tipY - tipY * 0.35, -t.len * 0.38);
    ctx.save();
    ctx.translate(tipX, tipY);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(-s * 1.7, 0);
    ctx.lineTo(s * 0.4, -s * 0.55);
    ctx.lineTo(s * 0.4, s * 0.55);
    ctx.closePath();
    ctx.fillStyle = col.accentLo;
    ctx.fill();
    ctx.restore();
  }
}

/* ----------------------------------------------------------------- eyes -- */

function drawEyes(ctx, L, col) {
  for (const e of L.eyes) {
    // white rim makes the eye pop off any shell colour
    ellipse(ctx, e.x, e.y, e.r, e.r, col.eyeRim, null);
    ellipse(ctx, e.x, e.y, e.r * 0.86, e.r * 0.86, col.eye, null);
    // two highlights: one big, one small — the classic cute read
    ctx.fillStyle = col.shine;
    ctx.beginPath();
    ctx.arc(e.x + e.r * 0.28, e.y - e.r * 0.32, e.r * 0.30, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(e.x - e.r * 0.26, e.y + e.r * 0.24, e.r * 0.14, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/* ---------------------------------------------------------------- setae -- */

function drawSetae(ctx, L, col) {
  if (L.setae < 0.25) return;
  const body = L.parts.find((p) => p.kind === 'abdomen') ?? L.parts[0];
  const n = Math.round(8 + L.setae * 18);
  const len = body.ry * (0.14 + L.setae * 0.22);
  ctx.strokeStyle = col.setae;
  ctx.lineWidth = Math.max(0.7, L.unit * 0.020);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const x = body.x + Math.cos(a) * body.rx;
    const y = Math.sin(a) * body.ry;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
}

/* ============================================================== render === */

/**
 * Draw one frame, centred at (0,0), facing +x.
 * Paint order is the anti-overlap strategy: everything that could collide with
 * the shell is drawn *under* it.
 */
export function drawBug(ctx, g, opts = {}) {
  const { phase = 0, state = 'idle', ppu = 26 } = opts;
  const L = layout(g, ppu);
  const col = palette(g);
  const breathe = state === 'idle' ? 1 + Math.sin(phase * TAU) * 0.020 : 1;
  const lunge = state === 'attack' ? Math.sin(Math.min(1, phase) * Math.PI) : 0;
  const outlineW = Math.max(1.1, L.unit * 0.030);

  ctx.save();
  ctx.translate(lunge * L.unit * 0.14, 0);
  ctx.scale(breathe, breathe);
  ctx.lineJoin = 'round';

  // 1. contact shadow — grounds the bug
  ctx.save();
  ctx.globalAlpha = 0.20;
  ctx.fillStyle = '#000';
  for (const p of L.parts) ellipse(ctx, p.x + L.unit * 0.05, L.unit * 0.10, p.rx * 0.95, p.ry * 0.80, '#000', null);
  ctx.restore();

  // 2. behind the body
  drawSoftWings(ctx, L, col, phase, state);
  drawSetae(ctx, L, col);
  drawLegs(ctx, L, col, phase);
  drawTail(ctx, L, col, phase, state, lunge);

  // 3. trunk, rear to front so the front mass overlaps cleanly
  for (const p of L.parts) {
    ellipse(ctx, p.x, p.y, p.rx, p.ry, shadeFill(ctx, p, col), col.outline, outlineW);
  }
  drawPattern(ctx, L, col);
  drawElytra(ctx, L, col);
  for (const p of L.parts) drawShimmer(ctx, p, col, L.shimmer, p.x);

  // segment seams for myriapods — draw after fill so they read as plates
  if (L.plan === 'myriapod') {
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = col.outline;
    ctx.lineWidth = outlineW * 0.8;
    for (const p of L.parts) {
      ctx.beginPath();
      ctx.arc(p.x, 0, p.ry * 0.99, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 4. head and face
  drawHorn(ctx, L, col);
  ellipse(ctx, L.head.x, 0, L.head.rx, L.head.ry, shadeFill(ctx, L.head, col), col.outline, outlineW);
  drawAntennae(ctx, L, col, phase);
  drawMandibles(ctx, L, col, state, lunge);
  drawEyes(ctx, L, col);

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
