// Procedural placeholder art. Draws a top-down bug straight from the gene
// vector onto a 2D canvas — no sprite assets. Swap this whole module for the
// anyCreature/GLB pipeline later; nothing outside it knows how a bug looks.

import { morphology } from '../core/stats.js';

const TAU = Math.PI * 2;

/* ------------------------------------------------------------- colour ---- */

function hsl(h, s, l, a = 1) {
  return `hsla(${(h * 360).toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%, ${a})`;
}

export function palette(g) {
  const h = g.hue;
  const s = 0.15 + g.saturation * 0.7;
  const l = 0.18 + g.lightness * 0.5;
  return {
    shell:     hsl(h, s, l),
    shellHi:   hsl(h, s * 0.9, Math.min(0.92, l + 0.16)),
    shellLo:   hsl(h, s, Math.max(0.04, l - 0.13)),
    limb:      hsl((h + 0.03) % 1, s * 0.8, Math.max(0.06, l - 0.08)),
    mark:      hsl((h + 0.5) % 1, s * 0.85, Math.min(0.9, l + 0.28)),
    eye:       hsl((h + 0.12) % 1, 0.15, 0.06),
    eyeShine:  'rgba(255,255,255,0.85)',
    outline:   hsl(h, s * 0.6, Math.max(0.03, l - 0.16)),
  };
}

/* ---------------------------------------------------------- geometry ----- */

/**
 * Layout in local pixel space, origin at the bug's centre, +x = facing.
 * PPU (pixels per morphology unit) sets the base drawing size.
 */
export function layout(g, ppu = 26) {
  const m = morphology(g);
  const bodyLen = m.length * ppu;
  const bodyWid = m.width * ppu;
  const seg = {
    head:   { x: bodyLen * 0.40, rx: bodyLen * 0.16, ry: bodyWid * 0.38 },
    thorax: { x: bodyLen * 0.08, rx: bodyLen * 0.22, ry: bodyWid * 0.50 },
    abdomen:{ x: -bodyLen * 0.32, rx: bodyLen * 0.30, ry: bodyWid * 0.46 },
  };
  const pairs = g.leg_count / 2;
  const legLen = m.legLen * ppu * 0.62;
  const legW = (0.6 + g.leg_thickness * 2.4) * (ppu / 26);
  const legs = [];
  for (let p = 0; p < pairs; p++) {
    const t = pairs === 1 ? 0.5 : p / (pairs - 1);          // 0 = front pair
    const ax = seg.thorax.x + (0.5 - t) * bodyLen * 0.46;    // attach along thorax
    const splay = (0.35 + g.leg_spread * 0.75) * (0.6 + t * 0.8);
    for (const side of [-1, 1]) {
      legs.push({ ax, ay: side * bodyWid * 0.34, side, pair: p, splay, len: legLen, w: legW });
    }
  }
  return {
    m, ppu, bodyLen, bodyWid, seg, legs, pairs,
    mandible: g.mandible_size * bodyLen * 0.26,
    serration: g.mandible_serration,
    antenna: g.antenna_length * bodyLen * 0.55,
    eye: (0.10 + g.eye_size * 0.26) * bodyWid,
    wing: g.wing_area,
    // canvas frame size with room for legs at full extension
    half: Math.ceil(bodyLen * 0.62 + legLen + legW * 2 + 6),
  };
}

/* ----------------------------------------------------------- drawing ----- */

function ellipse(ctx, x, y, rx, ry, fill, stroke, lw = 1.2) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function drawLeg(ctx, L, leg, phase, col) {
  // Two-segment leg. `phase` in 0..1 drives a stance/swing cycle.
  const swing = Math.sin(phase * TAU) * 0.55;
  const lift = Math.max(0, Math.cos(phase * TAU)) * 0.18;
  const base = leg.side * (Math.PI / 2) * leg.splay;
  const a1 = base * 0.75 + swing * 0.6 * leg.side * -1;
  const kneeX = leg.ax + Math.cos(a1 - Math.PI / 2 * leg.side * 0) * 0 + Math.sin(a1) * 0; // placeholder
  // compute in polar around attach point instead:
  const dir1 = leg.side * (Math.PI / 2) - leg.side * (0.55 * leg.splay) + swing;
  const kx = leg.ax + Math.cos(dir1) * leg.len * 0.55;
  const ky = leg.ay + Math.sin(dir1) * leg.len * 0.55;
  const dir2 = dir1 + leg.side * (0.7 + lift * 2.2);
  const fx = kx + Math.cos(dir2) * leg.len * 0.55;
  const fy = ky + Math.sin(dir2) * leg.len * 0.55;

  ctx.strokeStyle = col.limb;
  ctx.lineCap = 'round';
  ctx.lineWidth = leg.w;
  ctx.beginPath();
  ctx.moveTo(leg.ax, leg.ay);
  ctx.lineTo(kx, ky);
  ctx.lineTo(fx, fy);
  ctx.stroke();
  // foot
  ctx.fillStyle = col.outline;
  ctx.beginPath();
  ctx.arc(fx, fy, leg.w * 0.55, 0, TAU);
  ctx.fill();
  void kneeX;
}

function drawMarkings(ctx, g, L, col) {
  const { seg, bodyWid } = L;
  ctx.save();
  ctx.globalAlpha = 0.55;
  const style = g.pattern;
  if (style < 0.33) {
    // bands across the abdomen
    const n = 2 + Math.floor(g.pattern * 9);
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / (n + 1);
      const x = seg.abdomen.x + (t - 0.5) * seg.abdomen.rx * 1.7;
      const ry = seg.abdomen.ry * Math.sqrt(Math.max(0, 1 - ((x - seg.abdomen.x) / seg.abdomen.rx) ** 2));
      ctx.strokeStyle = col.mark;
      ctx.lineWidth = Math.max(1, bodyWid * 0.09);
      ctx.beginPath();
      ctx.moveTo(x, -ry * 0.92);
      ctx.lineTo(x, ry * 0.92);
      ctx.stroke();
    }
  } else if (style < 0.66) {
    // spots
    const n = 3 + Math.floor((g.pattern - 0.33) * 18);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU * 1.6;
      const r = 0.3 + ((i * 7) % 5) / 9;
      ctx.fillStyle = col.mark;
      ctx.beginPath();
      ctx.arc(seg.abdomen.x + Math.cos(a) * seg.abdomen.rx * r,
              Math.sin(a) * seg.abdomen.ry * r,
              bodyWid * 0.07, 0, TAU);
      ctx.fill();
    }
  } else {
    // dorsal stripe
    ctx.strokeStyle = col.mark;
    ctx.lineWidth = Math.max(1, bodyWid * 0.12);
    ctx.beginPath();
    ctx.moveTo(seg.head.x, 0);
    ctx.lineTo(seg.abdomen.x - seg.abdomen.rx * 0.7, 0);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw one frame, centred at (0,0) in the current transform, facing +x.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} g genome
 * @param {object} opts { phase 0..1, state: 'idle'|'walk'|'attack', t: 0..1 within state }
 */
export function drawBug(ctx, g, opts = {}) {
  const { phase = 0, state = 'idle', ppu = 26 } = opts;
  const L = layout(g, ppu);
  const col = palette(g);
  const breathe = state === 'idle' ? 1 + Math.sin(phase * TAU) * 0.025 : 1;
  const lunge = state === 'attack' ? Math.sin(Math.min(1, phase) * Math.PI) : 0;

  ctx.save();
  ctx.translate(lunge * L.bodyLen * 0.18, 0);
  ctx.scale(breathe, breathe);

  // wings (behind body) — only if they're big enough to matter
  if (L.wing > 0.08) {
    const flap = state === 'walk' || state === 'attack'
      ? Math.sin(phase * TAU * (1 + g.wing_beat * 3)) * 0.25 : 0.04;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(L.seg.thorax.x - L.bodyLen * 0.05, side * L.bodyWid * 0.22);
      ctx.rotate(side * (0.35 + flap));
      ellipse(ctx, -L.bodyLen * 0.18 * 0.9, side * L.bodyWid * 0.5,
              L.bodyLen * 0.36 * (0.5 + L.wing), L.bodyWid * 0.34 * (0.5 + L.wing),
              hsl(g.hue, 0.25, 0.85, 0.30), 'rgba(255,255,255,0.28)', 1);
      ctx.restore();
    }
  }

  // legs
  for (const leg of L.legs) {
    const off = (leg.pair * 0.37 + (leg.side > 0 ? 0.5 : 0)) % 1;
    drawLeg(ctx, L, leg, (phase + off) % 1, col);
  }

  // antennae
  if (L.antenna > 1) {
    ctx.strokeStyle = col.limb;
    ctx.lineWidth = Math.max(0.8, L.legs[0]?.w * 0.55 || 1);
    for (const side of [-1, 1]) {
      const wag = Math.sin(phase * TAU + side) * 0.18;
      ctx.beginPath();
      ctx.moveTo(L.seg.head.x + L.seg.head.rx * 0.5, side * L.bodyWid * 0.16);
      ctx.quadraticCurveTo(
        L.seg.head.x + L.antenna * 0.7, side * (L.bodyWid * 0.5 + L.antenna * 0.25) + wag * 6,
        L.seg.head.x + L.antenna, side * (L.bodyWid * 0.4 + L.antenna * 0.55) + wag * 10
      );
      ctx.stroke();
    }
  }

  // body: abdomen -> thorax -> head
  ellipse(ctx, L.seg.abdomen.x, 0, L.seg.abdomen.rx, L.seg.abdomen.ry, col.shell, col.outline, 1.4);
  drawMarkings(ctx, g, L, col);
  ellipse(ctx, L.seg.thorax.x, 0, L.seg.thorax.rx, L.seg.thorax.ry, col.shellLo, col.outline, 1.4);
  ellipse(ctx, L.seg.head.x, 0, L.seg.head.rx, L.seg.head.ry, col.shell, col.outline, 1.4);

  // carapace highlight — thicker shell reads as a glossier plate
  ctx.save();
  ctx.globalAlpha = 0.20 + g.carapace_thickness * 0.45;
  ellipse(ctx, L.seg.abdomen.x + L.seg.abdomen.rx * 0.15, -L.seg.abdomen.ry * 0.34,
          L.seg.abdomen.rx * 0.55, L.seg.abdomen.ry * 0.24, col.shellHi, null);
  ctx.restore();

  // eyes
  for (const side of [-1, 1]) {
    const ex = L.seg.head.x + L.seg.head.rx * 0.35;
    const ey = side * L.seg.head.ry * 0.55;
    ellipse(ctx, ex, ey, L.eye, L.eye, col.eye, null);
    ellipse(ctx, ex + L.eye * 0.3, ey - L.eye * 0.3, L.eye * 0.32, L.eye * 0.32, col.eyeShine, null);
  }

  // mandibles
  if (L.mandible > 0.5) {
    const open = state === 'attack' ? 0.25 + lunge * 0.9 : 0.18 + Math.sin(phase * TAU) * 0.04;
    ctx.strokeStyle = col.outline;
    ctx.fillStyle = col.shellLo;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(L.seg.head.x + L.seg.head.rx * 0.85, side * L.seg.head.ry * 0.35);
      ctx.rotate(side * open);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(L.mandible * 0.8, side * L.mandible * 0.55, L.mandible, side * L.mandible * 0.08);
      ctx.quadraticCurveTo(L.mandible * 0.7, side * L.mandible * 0.05, 0, side * L.mandible * 0.22);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // serration teeth
      const teeth = Math.round(L.serration * 4);
      for (let i = 1; i <= teeth; i++) {
        const t = i / (teeth + 1);
        ctx.beginPath();
        ctx.moveTo(L.mandible * t, side * L.mandible * (0.30 - t * 0.2));
        ctx.lineTo(L.mandible * t, side * L.mandible * (0.30 - t * 0.2) + side * L.mandible * 0.22);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  ctx.restore();
}

/* ------------------------------------------------- spritesheet baking ---- */

export const ANIM_FRAMES = { idle: 4, walk: 8, attack: 6 };
export const ANIM_ORDER = ['idle', 'walk', 'attack'];

/**
 * Bake every animation frame for one genome into a single canvas strip.
 * Returns { canvas, frameW, frameH, frames: { idle:[i0..], walk:[...], attack:[...] } }
 * `makeCanvas` lets this run under Phaser, the DOM, or node-canvas in tests.
 */
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
