// Procedural placeholder art. Draws a top-down bug straight from the gene
// vector onto a 2D canvas — no sprite assets. Swap this whole module for the
// anyCreature/GLB pipeline later; nothing outside it knows how a bug looks.
//
// Every structural gene has to be READABLE here. If two genomes score
// differently they should look different, otherwise the breeding UI is a wall
// of numbers attached to identical blobs.

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
  const alpha = 1 - g.translucency * 0.45;
  return {
    shell:     hsl(h, s, l, alpha),
    shellHi:   hsl(h, s * 0.9, Math.min(0.92, l + 0.16), alpha),
    shellLo:   hsl(h, s, Math.max(0.04, l - 0.13), alpha),
    limb:      hsl((h + 0.03) % 1, s * 0.8, Math.max(0.06, l - 0.08), alpha),
    // marking colour: contrast gene pushes it away from the shell
    mark:      hsl((h + 0.5) % 1, s * 0.85, Math.min(0.95, l + 0.12 + g.pattern_contrast * 0.35)),
    iris:      hsl((h + 0.35) % 1, 0.85, 0.62),
    eye:       hsl((h + 0.12) % 1, 0.15, 0.06),
    eyeShine:  'rgba(255,255,255,0.85)',
    outline:   hsl(h, s * 0.6, Math.max(0.03, l - 0.16), alpha),
    setae:     hsl((h + 0.02) % 1, s * 0.5, Math.min(0.8, l + 0.22), 0.55),
    alpha,
  };
}

/* ---------------------------------------------------------- geometry ----- */

/**
 * Layout in local pixel space, origin at the bug's centre, +x = facing.
 * This is also the skeleton a future anyCreature spec would be built from.
 */
export function layout(g, ppu = 26) {
  const m = morphology(g);
  const bodyLen = m.length * ppu;
  const bodyWid = m.width * ppu;

  // Head / thorax / abdomen split. thorax_ratio trades thorax against abdomen.
  const headLen = (0.10 + g.head_size * 0.22) * bodyLen;
  const thoraxLen = (0.16 + g.thorax_ratio * 0.34) * bodyLen;
  const abdomenLen = Math.max(0.12 * bodyLen, bodyLen * 0.86 - headLen - thoraxLen);

  const headX = bodyLen * 0.5 - headLen * 0.5;
  const thoraxX = headX - headLen * 0.5 - thoraxLen * 0.5;
  const abdomenX = thoraxX - thoraxLen * 0.5 - abdomenLen * 0.5;

  const seg = {
    head:    { x: headX,    rx: headLen * 0.5,    ry: bodyWid * (0.26 + g.head_size * 0.24) },
    thorax:  { x: thoraxX,  rx: thoraxLen * 0.5,  ry: bodyWid * 0.50 },
    abdomen: { x: abdomenX, rx: abdomenLen * 0.5, ry: bodyWid * (0.50 - g.abdomen_taper * 0.12) },
  };

  // abdominal segmentation — body_segments draws as visible tergites
  const segments = g.body_segments;

  // legs attach along the thorax
  const pairs = g.leg_count / 2;
  const legLen = m.legLen * ppu * 0.62;
  const legW = (0.6 + g.leg_thickness * 2.4) * (ppu / 26);
  const legs = [];
  for (let p = 0; p < pairs; p++) {
    const t = pairs === 1 ? 0.5 : p / (pairs - 1);
    const ax = thoraxX + (0.5 - t) * (thoraxLen + abdomenLen * 0.5);
    const splay = (0.35 + g.leg_spread * 0.75) * (0.6 + t * 0.8);
    for (const side of [-1, 1]) {
      legs.push({
        ax, ay: side * bodyWid * 0.34, side, pair: p, splay,
        len: legLen, w: legW, joints: g.leg_joints,
        claw: g.claw_size * legW * 2.2,
      });
    }
  }

  const tail = g.tail_length * bodyLen * 0.55;
  const stinger = g.stinger_size * bodyLen * 0.22;

  return {
    m, ppu, bodyLen, bodyWid, seg, legs, pairs, segments,
    mandible: g.mandible_size * bodyLen * 0.22,
    serration: g.mandible_serration,
    horn: g.horn_size * bodyLen * 0.42,
    spines: g.spine_density,
    tail, stinger,
    antenna: g.antenna_length * bodyLen * 0.55,
    eye: (0.10 + g.eye_size * 0.24) * bodyWid,
    eyeCount: g.eye_count,
    wingPairs: g.wing_count / 2,
    wing: g.wing_area,
    setae: g.setae,
    // Frame size: tight around the real extent. Legs reach furthest in y, horn
    // and tail in x; padding beyond that is wasted texture on every bug.
    half: Math.ceil(
      Math.max(
        bodyLen * 0.5 + Math.max(g.horn_size * bodyLen * 0.42, tail + stinger) + 4,
        bodyWid * 0.5 + legLen * 0.92 + legW + 4
      )
    ),
  };
}

/* ----------------------------------------------------------- drawing ----- */

function ellipse(ctx, x, y, rx, ry, fill, stroke, lw = 1.2) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

/** Two- or three-segment leg, `phase` 0..1 drives the stance/swing cycle. */
function drawLeg(ctx, leg, phase, col) {
  const swing = Math.sin(phase * TAU) * 0.55;
  const lift = Math.max(0, Math.cos(phase * TAU)) * 0.18;
  const dir1 = leg.side * (Math.PI / 2) - leg.side * (0.55 * leg.splay) + swing;

  const n = leg.joints;                 // 2 or 3 limb sections
  const sect = leg.len / n;
  const pts = [{ x: leg.ax, y: leg.ay }];
  let dir = dir1;
  for (let i = 0; i < n; i++) {
    if (i > 0) dir += leg.side * (0.55 + lift * 1.8) / (n - 1 || 1);
    const prev = pts[pts.length - 1];
    pts.push({ x: prev.x + Math.cos(dir) * sect, y: prev.y + Math.sin(dir) * sect });
  }

  ctx.strokeStyle = col.limb;
  ctx.lineCap = 'round';
  ctx.lineWidth = leg.w;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();

  // tarsal claw — a hook at the foot, scaled by claw_size
  const foot = pts[pts.length - 1];
  const knee = pts[pts.length - 2];
  ctx.fillStyle = col.outline;
  ctx.beginPath();
  ctx.arc(foot.x, foot.y, leg.w * 0.55, 0, TAU);
  ctx.fill();
  if (leg.claw > 0.6) {
    const a = Math.atan2(foot.y - knee.y, foot.x - knee.x);
    ctx.strokeStyle = col.outline;
    ctx.lineWidth = Math.max(0.8, leg.w * 0.6);
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(foot.x + Math.cos(a + 0.9) * leg.claw, foot.y + Math.sin(a + 0.9) * leg.claw);
    ctx.stroke();
  }
}

function drawMarkings(ctx, g, L, col) {
  const { seg, bodyWid } = L;
  if (g.pattern_contrast < 0.08) return;
  ctx.save();
  ctx.globalAlpha = 0.30 + g.pattern_contrast * 0.55;
  const style = g.pattern;
  const density = 0.35 + g.pattern_scale * 0.65;
  if (style < 0.33) {
    const n = Math.max(2, Math.round((2 + density * 8)));
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / (n + 1);
      const x = seg.abdomen.x + (t - 0.5) * seg.abdomen.rx * 1.7;
      const ry = seg.abdomen.ry * Math.sqrt(Math.max(0, 1 - ((x - seg.abdomen.x) / seg.abdomen.rx) ** 2));
      ctx.strokeStyle = col.mark;
      ctx.lineWidth = Math.max(1, bodyWid * 0.09 * density);
      ctx.beginPath();
      ctx.moveTo(x, -ry * 0.92);
      ctx.lineTo(x, ry * 0.92);
      ctx.stroke();
    }
  } else if (style < 0.66) {
    const n = Math.max(3, Math.round(3 + density * 16));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU * 1.6;
      const r = 0.3 + ((i * 7) % 5) / 9;
      ctx.fillStyle = col.mark;
      ctx.beginPath();
      ctx.arc(seg.abdomen.x + Math.cos(a) * seg.abdomen.rx * r,
              Math.sin(a) * seg.abdomen.ry * r,
              bodyWid * 0.06 * (0.6 + density), 0, TAU);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = col.mark;
    ctx.lineWidth = Math.max(1, bodyWid * 0.12 * density);
    ctx.beginPath();
    ctx.moveTo(seg.head.x, 0);
    ctx.lineTo(seg.abdomen.x - seg.abdomen.rx * 0.7, 0);
    ctx.stroke();
  }
  ctx.restore();
}

/** Abdominal tergites — the visible segment lines. */
function drawSegments(ctx, L, col) {
  if (L.segments < 2) return;
  const a = L.seg.abdomen;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = col.outline;
  ctx.lineWidth = Math.max(0.8, L.bodyWid * 0.035);
  for (let i = 1; i < L.segments; i++) {
    const t = i / L.segments;
    const x = a.x + a.rx - t * a.rx * 2;
    const ry = a.ry * Math.sqrt(Math.max(0, 1 - ((x - a.x) / a.rx) ** 2));
    ctx.beginPath();
    ctx.moveTo(x, -ry * 0.95);
    ctx.lineTo(x, ry * 0.95);
    ctx.stroke();
  }
  ctx.restore();
}

/** Defensive spines along the abdomen edge. */
function drawSpines(ctx, L, col) {
  if (L.spines < 0.12) return;
  const a = L.seg.abdomen;
  const n = Math.round(2 + L.spines * 9);
  const len = L.bodyWid * (0.10 + L.spines * 0.26);
  ctx.strokeStyle = col.outline;
  ctx.lineWidth = Math.max(0.9, L.bodyWid * 0.05);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = a.x + a.rx - t * a.rx * 2;
    const ry = a.ry * Math.sqrt(Math.max(0, 1 - ((x - a.x) / a.rx) ** 2));
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, side * ry * 0.95);
      ctx.lineTo(x - len * 0.35, side * (ry + len));
      ctx.stroke();
    }
  }
}

/** Fine hairs around the silhouette. */
function drawSetae(ctx, L, col) {
  if (L.setae < 0.15) return;
  const n = Math.round(10 + L.setae * 46);
  const len = L.bodyWid * (0.12 + L.setae * 0.30);
  ctx.strokeStyle = col.setae;
  ctx.lineWidth = Math.max(0.5, L.bodyWid * 0.022);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rx = L.bodyLen * 0.34, ry = L.bodyWid * 0.46;
    const x = Math.cos(a) * rx - L.bodyLen * 0.08;
    const y = Math.sin(a) * ry;
    const nx = Math.cos(a), ny = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + nx * len, y + ny * len);
    ctx.stroke();
  }
}

/**
 * Draw one frame, centred at (0,0) in the current transform, facing +x.
 * @param {object} opts { phase 0..1, state: 'idle'|'walk'|'attack', ppu }
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

  // --- wings, behind everything ---
  if (L.wingPairs > 0 && L.wing > 0.05) {
    const flap = state === 'walk' || state === 'attack'
      ? Math.sin(phase * TAU * (1 + g.wing_beat * 3)) * 0.25 : 0.04;
    for (let p = 0; p < L.wingPairs; p++) {
      const back = p * L.bodyLen * 0.14;
      const scale = 1 - p * 0.22;              // hindwings a touch smaller
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(L.seg.thorax.x - back, side * L.bodyWid * 0.22);
        ctx.rotate(side * (0.35 + flap + p * 0.18));
        ellipse(ctx,
          -L.bodyLen * 0.16, side * L.bodyWid * 0.5,
          L.bodyLen * 0.36 * (0.5 + L.wing) * scale,
          L.bodyWid * 0.34 * (0.5 + L.wing) * scale,
          hsl(g.hue, 0.25 + g.iridescence * 0.5, 0.85, 0.24 + g.iridescence * 0.16),
          'rgba(255,255,255,0.26)', 1);
        ctx.restore();
      }
    }
  }

  // --- setae behind the body ---
  drawSetae(ctx, L, col);

  // --- legs ---
  for (const leg of L.legs) {
    const off = (leg.pair * 0.37 + (leg.side > 0 ? 0.5 : 0)) % 1;
    drawLeg(ctx, leg, (phase + off) % 1, col);
  }

  // --- tail / stinger, behind the abdomen ---
  if (L.tail > 1) {
    const curl = Math.sin(phase * TAU) * 0.12 + (state === 'attack' ? -0.5 * lunge : 0);
    const bx = L.seg.abdomen.x - L.seg.abdomen.rx;
    ctx.strokeStyle = col.limb;
    ctx.lineWidth = Math.max(1, L.bodyWid * 0.13);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx, 0);
    ctx.quadraticCurveTo(bx - L.tail * 0.6, curl * L.tail * 0.5, bx - L.tail, curl * L.tail);
    ctx.stroke();
    if (L.stinger > 0.8) {
      const tipX = bx - L.tail, tipY = curl * L.tail;
      ctx.fillStyle = col.outline;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY - L.stinger * 0.4);
      ctx.lineTo(tipX - L.stinger * 1.5, tipY + curl * 2);
      ctx.lineTo(tipX, tipY + L.stinger * 0.4);
      ctx.closePath();
      ctx.fill();
    }
  }

  // --- body: abdomen -> thorax -> head ---
  ellipse(ctx, L.seg.abdomen.x, 0, L.seg.abdomen.rx, L.seg.abdomen.ry, col.shell, col.outline, 1.4);
  drawSpines(ctx, L, col);
  drawSegments(ctx, L, col);
  drawMarkings(ctx, g, L, col);
  ellipse(ctx, L.seg.thorax.x, 0, L.seg.thorax.rx, L.seg.thorax.ry, col.shellLo, col.outline, 1.4);
  ellipse(ctx, L.seg.head.x, 0, L.seg.head.rx, L.seg.head.ry, col.shell, col.outline, 1.4);

  // carapace highlight; iridescence adds a coloured sheen over it
  ctx.save();
  ctx.globalAlpha = 0.20 + g.carapace_thickness * 0.45;
  ellipse(ctx, L.seg.abdomen.x + L.seg.abdomen.rx * 0.15, -L.seg.abdomen.ry * 0.34,
          L.seg.abdomen.rx * 0.55, L.seg.abdomen.ry * 0.24, col.shellHi, null);
  ctx.restore();
  if (g.iridescence > 0.25) {
    ctx.save();
    ctx.globalAlpha = (g.iridescence - 0.25) * 0.5;
    ellipse(ctx, L.seg.abdomen.x - L.seg.abdomen.rx * 0.2, L.seg.abdomen.ry * 0.2,
            L.seg.abdomen.rx * 0.5, L.seg.abdomen.ry * 0.3, col.iris, null);
    ctx.restore();
  }

  // --- antennae (in front of the head) ---
  if (L.antenna > 1) {
    ctx.strokeStyle = col.limb;
    ctx.lineWidth = Math.max(0.8, (L.legs[0]?.w ?? 1) * 0.55);
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

  // --- horn / rostrum, forward off the head ---
  if (L.horn > 1.5) {
    const hx = L.seg.head.x + L.seg.head.rx * 0.7;
    ctx.fillStyle = col.shellLo;
    ctx.strokeStyle = col.outline;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(hx, -L.bodyWid * 0.13);
    ctx.quadraticCurveTo(hx + L.horn * 0.7, -L.bodyWid * 0.30, hx + L.horn, -L.bodyWid * 0.05);
    ctx.quadraticCurveTo(hx + L.horn * 0.7, L.bodyWid * 0.06, hx, L.bodyWid * 0.13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // --- eyes: eye_count laid out along the head ---
  const eyesPerSide = Math.max(1, L.eyeCount / 2);
  for (const side of [-1, 1]) {
    for (let i = 0; i < eyesPerSide; i++) {
      const t = eyesPerSide === 1 ? 0.5 : i / (eyesPerSide - 1);
      const ex = L.seg.head.x + L.seg.head.rx * (0.55 - t * 0.75);
      const ey = side * L.seg.head.ry * (0.62 - t * 0.16);
      const r = L.eye * (1 - t * 0.35);        // rear eyes smaller
      ellipse(ctx, ex, ey, r, r, col.eye, null);
      ellipse(ctx, ex + r * 0.3, ey - r * 0.3, r * 0.32, r * 0.32, col.eyeShine, null);
    }
  }

  // --- mandibles ---
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
