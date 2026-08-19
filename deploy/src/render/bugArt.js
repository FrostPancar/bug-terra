// Procedural bug art — flat vector, vertical, minimal.
//
// STYLE CONTRACT (matched to the reference designs):
//   • Canonical pose is HEAD UP. Everything is mirror-symmetric about the
//     vertical axis. The sim compensates by adding 90° to sprite rotation.
//   • ZERO outlines. Forms separate by value and overlap, never by stroke.
//   • Limbs are capsules: uniform width, round caps, smooth single arcs. No
//     tapering, no joints drawn as separate bones.
//   • Masses are circles and stadiums carrying a soft radial gradient that
//     lightens toward the upper middle — an airbrush bloom, not a shaded ball.
//   • Restrained palette: one dominant hue, black, white, and a single bright
//     complementary accent. Three colours plus neutrals, never more.
//   • Big white eyes with a coloured iris, set wide on the head and partly
//     tucked behind it.
//   • Iridescence reads as a fine granular speckle, not glitter stars.
//
// Three body plans, because forcing a centipede through a beetle's geometry is
// what made them read as sausages:
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
  const inkLimbs = g.pattern > 0.5;

  return {
    shell:   hsl(h, s, l),
    bloom:   hsl(h, s * 0.72, Math.min(0.86, l + 0.22)),   // gradient centre
    deep:    hsl(h, s * 1.02, Math.max(0.20, l - 0.14)),   // gradient edge
    seam:    hsl(h, s * 1.05, Math.max(0.16, l - 0.20)),
    limb:    inkLimbs ? '#17161c' : hsl(h, s * 0.92, Math.max(0.24, l - 0.16)),
    limbLo:  inkLimbs ? '#0e0d11' : hsl(h, s * 0.95, Math.max(0.18, l - 0.24)),
    accent:  hsl(accentH, 0.72, 0.60),
    horn:    hsl(h, s * 0.90, Math.max(0.26, l - 0.10)),
    sclera:  '#ffffff',
    iris:    hsl(accentH, 0.70, 0.56),
    pupil:   '#14131a',
    wing:    'rgba(196,199,206,0.62)',
    wingLo:  'rgba(160,164,174,0.50)',
    h, s, l, inkLimbs,
  };
}

/* ========================================================== body plan ==== */

export function bodyPlan(g) {
  if (g.leg_count >= 8 && g.body_length > 0.70) return 'myriapod';
  if (g.leg_count >= 8) return 'arachnid';
  return 'insect';
}

export const HORN_TYPES = ['rhino', 'stag', 'rostrum', 'crown'];
export const WING_TYPES = ['membranous', 'elytra', 'broad', 'narrow'];

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
    wingType: WING_TYPES[g.wing_type ?? 0],
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
  bump(L.head.x + L.head.rx + L.hornLen, L.hornLen * 0.7);
  bump(L.tailTip?.x ?? 0, L.tailTip?.y ?? 0);
  if (L.wingPairs > 0) bump(L.wingSpan.x, L.wingSpan.y);

  L.half = Math.ceil(Math.max(maxX, maxY) + unit * 0.05 + 3);
  return L;
}

/* ---------------------------------------------------------------- trunk -- */

function buildTrunk(L) {
  const { g, plan, bodyWid } = L;

  if (plan === 'myriapod') {
    const n = clamp(Math.round(6 + g.body_length * 4), 6, 10);
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
    return;
  }

  if (plan === 'arachnid') {
    const abR = bodyWid * 0.56;
    const cephR = bodyWid * 0.42;
    const gap = (abR + cephR) * 0.74;
    L.parts.push({ x: -gap * 0.5, y: 0, rx: abR * (1 - g.abdomen_taper * 0.08), ry: abR, kind: 'abdomen' });
    L.parts.push({ x: gap * 0.5, y: 0, rx: cephR, ry: cephR, kind: 'thorax' });
    L.trunkFrontX = gap * 0.5 + cephR;
    return;
  }

  const abR = bodyWid * 0.54;
  const thR = bodyWid * lerp(0.34, 0.44, g.thorax_ratio);
  const abLen = abR * lerp(1.02, 1.24, g.body_length);
  const gap = abLen * 0.60 + thR * 0.74;
  L.parts.push({ x: -gap * 0.44, y: 0, rx: abLen, ry: abR * (1 - g.abdomen_taper * 0.10), kind: 'abdomen' });
  L.parts.push({ x: gap * 0.56, y: 0, rx: thR * 1.04, ry: thR, kind: 'thorax' });
  L.trunkFrontX = gap * 0.56 + thR;
}

/* ----------------------------------------------------------------- legs -- */

function buildLegs(L) {
  const { g, plan, unit } = L;
  const pairs = plan === 'myriapod' ? L.segCount : g.leg_count / 2;
  const len = unit * lerp(0.80, 1.40, g.leg_length) * (plan === 'myriapod' ? 0.50 : 1);
  // Capsule limbs want real weight — thin lines look like hair, not design.
  const w = clamp(unit * (0.070 + g.leg_thickness * 0.075), 2.6, 13);

  for (let i = 0; i < pairs; i++) {
    const t = pairs === 1 ? 0.5 : i / (pairs - 1);
    let ax, ay;
    if (plan === 'myriapod') {
      const host = L.parts[L.parts.length - 1 - i] ?? L.parts[0];
      ax = host.x; ay = host.ry * 0.80;
    } else if (plan === 'arachnid') {
      const c = L.parts[1];
      ax = c.x + lerp(c.rx * 0.46, -c.rx * 0.54, t); ay = c.ry * 0.76;
    } else {
      const th = L.parts[1];
      ax = th.x + lerp(th.rx * 0.54, -th.rx * 0.62, t); ay = th.ry * 0.80;
    }
    const fan = lerp(-0.52, 0.78, t) * (0.60 + g.leg_spread * 0.55);
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
  const headR = bodyWid * (plan === 'arachnid' ? 0.32 : lerp(0.36, 0.48, g.head_size));
  const hx = L.trunkFrontX + headR * (plan === 'arachnid' ? 0.06 : 0.54);
  L.head = { x: hx, y: 0, rx: headR * 1.0, ry: headR, kind: 'head' };

  // Big almond eyes, set wide, tucked slightly under the head edge.
  const er = headR * lerp(0.74, 1.02, g.eye_size);
  for (const side of [-1, 1]) {
    L.eyes.push({
      x: hx + headR * 0.10,
      y: side * headR * 0.94,
      rx: er * 0.62, ry: er, side,
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

  const antLen = unit * lerp(0.10, 0.58, g.antenna_length);
  if (antLen > unit * 0.15) for (const side of [-1, 1]) L.antennae.push({ side, len: antLen });

  const hornMax = L.hornType === 'rostrum' ? 0.52 : L.hornType === 'stag' ? 0.78 : 0.64;
  L.hornLen = g.horn_size < 0.14 ? 0 : unit * lerp(0.16, hornMax, g.horn_size);
  L.mandible = g.mandible_size < 0.10 ? 0 : headR * lerp(0.34, 0.62, g.mandible_size);

  const rear = L.parts[0];
  const tailLen = unit * lerp(0, 0.44, g.tail_length);
  if (tailLen > unit * 0.08) {
    L.tail = { len: tailLen, x0: rear.x - rear.rx * 0.62, sting: g.stinger_size };
    L.tailTip = { x: rear.x - rear.rx * 0.62 - tailLen, y: 0 };
  }

  if (L.wingPairs > 0 && L.wingArea > 0.05) {
    const wl = unit * lerp(0.90, 1.70, L.wingArea);
    L.wingSpan = { x: Math.abs(L.parts[0].x) + wl * 0.85, y: bodyWid * 0.5 + wl * 0.72 };
  } else {
    L.wingPairs = 0;
    L.wingSpan = { x: 0, y: 0 };
  }
}

/* ============================================================ drawing ==== */

function fillEllipse(ctx, x, y, rx, ry, fill) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** The airbrush bloom: light in the upper middle, deepening to the rim. */
function bloomFill(ctx, part, col) {
  const gr = ctx.createRadialGradient(
    part.x + part.rx * 0.10, -part.ry * 0.22, Math.max(part.rx, part.ry) * 0.06,
    part.x, 0, Math.max(part.rx, part.ry) * 1.10
  );
  gr.addColorStop(0, col.bloom);
  gr.addColorStop(0.46, col.shell);
  gr.addColorStop(1, col.deep);
  return gr;
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

/* ---------------------------------------------------------------- wings -- */

function drawSoftWings(ctx, L, col, phase, state) {
  if (L.wingPairs < 1 || L.wingType === 'elytra') return;
  const { g } = L;
  const flap = state === 'walk' || state === 'attack'
    ? Math.sin(phase * TAU * (1 + g.wing_beat * 2.5)) * 0.14 : 0.02;
  const type = L.wingType;
  const wl = L.unit * lerp(0.90, 1.70, L.wingArea) * (type === 'broad' ? 1.12 : 1);
  const anchor = L.parts[L.parts.length - 1];

  for (let p = L.wingPairs - 1; p >= 0; p--) {
    const scale = 1 - p * 0.22;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(anchor.x - L.unit * 0.06, side * anchor.ry * 0.28);
      ctx.rotate(side * (0.96 + flap + p * 0.30));
      const len = wl * scale;
      const wid = len * (type === 'narrow' ? 0.20 : type === 'broad' ? 0.42 : 0.28);
      // Flat rounded blade — a stadium, matching the reference's grey wings.
      ctx.fillStyle = p === 0 ? col.wing : col.wingLo;
      ctx.beginPath();
      ctx.ellipse(len * 0.46, side * wid * 0.42, len * 0.52, wid, side * 0.30, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawElytra(ctx, L, col) {
  if (L.wingPairs < 1 || L.wingType !== 'elytra') return;
  const body = L.parts.find((p) => p.kind === 'abdomen') ?? L.parts[0];
  const cover = lerp(0.76, 1.0, L.wingArea);
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

function drawHorn(ctx, L, col) {
  if (!L.hornLen) return;
  const h = L.head;
  const x0 = h.x + h.rx * 0.30;
  const len = L.hornLen;
  const w = Math.max(2, L.unit * 0.075);

  if (L.hornType === 'rhino') {
    // one thick capsule sweeping up and forward
    capsule(ctx, x0, 0, x0 + len * 0.62, -h.ry * 0.10, x0 + len, -h.ry * 0.34, w * 1.15, col.horn);
  } else if (L.hornType === 'stag') {
    // paired antlers with an inward hook and one notch — the reference's pincer
    for (const side of [-1, 1]) {
      capsule(ctx, x0, side * h.ry * 0.34,
              x0 + len * 0.62, side * h.ry * 0.92,
              x0 + len, side * h.ry * 0.34, w, col.horn);
      capsule(ctx, x0 + len * 0.60, side * h.ry * 0.72,
              x0 + len * 0.70, side * h.ry * 0.46,
              x0 + len * 0.72, side * h.ry * 0.22, w * 0.62, col.horn);
    }
  } else if (L.hornType === 'rostrum') {
    capsule(ctx, x0, 0, x0 + len * 0.6, 0, x0 + len, 0, w * 0.85, col.horn);
  } else {
    for (const dy of [-0.62, 0, 0.62]) {
      const sc = dy === 0 ? 1 : 0.76;
      capsule(ctx, x0, dy * h.ry * 0.44,
              x0 + len * 0.5 * sc, dy * h.ry * 0.80,
              x0 + len * sc, dy * h.ry * 0.96, w * 0.8, col.horn);
    }
  }
}

/* ------------------------------------------------------------- mandible -- */

function drawMandibles(ctx, L, col, state, lunge) {
  if (!L.mandible) return;
  const h = L.head;
  const open = state === 'attack' ? 0.30 + lunge * 0.7 : 0.18;
  const m = L.mandible;
  const w = Math.max(1.6, L.unit * 0.050);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(h.x + h.rx * 0.66, side * h.ry * 0.30);
    ctx.rotate(side * open);
    capsule(ctx, 0, 0, m * 0.72, side * m * 0.34, m * 1.02, side * m * -0.06, w, col.limbLo);
    ctx.restore();
  }
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

function drawEyes(ctx, L, col) {
  for (const e of L.eyes) {
    if (e.minor) {
      fillEllipse(ctx, e.x, e.y, e.rx, e.ry, col.pupil);
      continue;
    }
    // white almond, long axis along the body — reads as a big cartoon eye
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.side * -0.22);
    fillEllipse(ctx, 0, 0, e.ry, e.rx, col.sclera);
    fillEllipse(ctx, e.ry * 0.22, e.side * e.rx * 0.10, e.rx * 0.58, e.rx * 0.58, col.iris);
    fillEllipse(ctx, e.ry * 0.26, e.side * e.rx * 0.10, e.rx * 0.30, e.rx * 0.30, col.pupil);
    ctx.restore();
  }
}

/* ---------------------------------------------------------------- setae -- */

function drawSetae(ctx, L, col) {
  if (L.setae < 0.35) return;
  const body = L.parts.find((p) => p.kind === 'abdomen') ?? L.parts[0];
  const n = Math.round(10 + L.setae * 16);
  const len = body.ry * (0.10 + L.setae * 0.16);
  const w = Math.max(1, L.unit * 0.026);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const x = body.x + Math.cos(a) * body.rx * 0.96;
    const y = Math.sin(a) * body.ry * 0.96;
    capsule(ctx, x, y, x + Math.cos(a) * len * 0.6, y + Math.sin(a) * len * 0.6,
            x + Math.cos(a) * len, y + Math.sin(a) * len, w, col.limb);
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
  const breathe = state === 'idle' ? 1 + Math.sin(phase * TAU) * 0.018 : 1;
  const lunge = state === 'attack' ? Math.sin(Math.min(1, phase) * Math.PI) : 0;

  ctx.save();
  ctx.rotate(-Math.PI / 2);                 // head up
  ctx.translate(lunge * L.unit * 0.12, 0);
  ctx.scale(breathe, breathe);

  // behind the shell
  drawSoftWings(ctx, L, col, phase, state);
  drawSetae(ctx, L, col);
  drawLegs(ctx, L, col, phase);
  drawTail(ctx, L, col, state, lunge);

  // Eyes go UNDER the head so its edge crops them — that tucked-in look is a
  // signature of the reference. Everything else on the face goes ON TOP, or the
  // head silhouette swallows the horns entirely.
  drawEyes(ctx, L, col);

  // the shell itself
  for (const p of L.parts) {
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, TAU);
    ctx.fillStyle = bloomFill(ctx, p, col);
    ctx.fill();
  }
  drawElytra(ctx, L, col);
  for (let i = 0; i < L.parts.length; i++) speckle(ctx, L.parts[i], col, L.shimmer, i * 17 + 3);

  // abdominal seam — one thin darker sliver, no outline
  const ab = L.parts.find((p) => p.kind === 'abdomen');
  if (ab && L.wingType !== 'elytra') {
    ctx.fillStyle = col.seam;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(ab.x - ab.rx * 0.88, -Math.max(0.5, L.unit * 0.010), ab.rx * 1.76, Math.max(1, L.unit * 0.020));
    ctx.globalAlpha = 1;
  }

  // head over the eyes
  ctx.beginPath();
  ctx.ellipse(L.head.x, 0, L.head.rx, L.head.ry, 0, 0, TAU);
  ctx.fillStyle = bloomFill(ctx, L.head, col);
  ctx.fill();

  // face furniture, in front of the head
  drawHorn(ctx, L, col);
  drawAntennae(ctx, L, col, phase);
  drawMandibles(ctx, L, col, state, lunge);

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
