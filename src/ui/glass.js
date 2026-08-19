/**
 * Liquid glass — vanilla port.
 *
 * Ported from @samasante/liquid-glass v0.1.1 (MIT, © 2026 Sam Asante)
 * https://github.com/samasante/liquid-glass
 *
 * The upstream package is a React component and this app has no React, so the
 * framework-free half — the signed-distance-field displacement map in
 * `src/displacement.ts` and the SVG filter chain in `src/Glass.tsx` — is ported
 * here as plain DOM. The optics vocabulary, default values, dome/meniscus maths,
 * quadrant mirroring and RGB-split dispersion all follow the original; see
 * THIRD-PARTY.md for the licence.
 *
 * How it works: a rounded-rect SDF is rasterized to a displacement map (R/G
 * encode X/Y displacement around 128, B carries a specular mask). That map
 * drives feDisplacementMap over the element's BACKDROP via
 * `backdrop-filter: url(#id)`, in three passes with slightly different scales
 * for chromatic aberration. Because it filters the backdrop rather than the
 * element, the button's own icon and label stay perfectly crisp on top.
 */

/* ------------------------------------------------------------------ optics */

/** Upstream's balanced default look. */
export const DEFAULT_OPTICS = {
  strength: 0.06,
  depth: 0.65,
  curvature: 0.6,
  splay: 0,
  dispersion: 0.5,
  bend: 0,
  bendWidth: 0.16,
  frost: 0.5,
  brightness: 0.1,
  specular: 1,
  sheenAngle: 45,
  sheen: 0.3,
  sheenWidth: 3,
  sheenFalloff: 1.5,
  glow: 0.12,
  glowSpread: 1,
  glowFalloff: 0.5,
  clipToShape: true,
  softEdge: true,
};

/** R is displaced this much more than B; G sits at the base. */
const DISPERSION_SPREAD = 0.22;

const ERF_K = Math.sqrt(Math.PI);
const erf = (x) => Math.tanh(ERF_K * x);

const encodeAxis = (signed) => ((0.5 + signed) * 255 + 0.5) | 0;
const encodeSpec = (spec) => (127 * spec + 128 + 0.5) | 0;

const domeGradientMean = (radius, halfExtent) =>
  halfExtent > 0
    ? (radius - Math.sqrt(radius * radius - halfExtent * halfExtent)) / halfExtent
    : 0;

/** Spherical-cap radius from chord half-width `a` and cap height `h`. */
function computeDomeConstants(capDepth, halfW, halfH) {
  const cap = Math.max(0.01, Math.min(capDepth, Math.min(halfW, halfH) - 1));
  const Rx = (halfW * halfW + cap * cap) / (2 * cap);
  const Ry = (halfH * halfH + cap * cap) / (2 * cap);
  const meanX = domeGradientMean(Rx, halfW);
  const meanY = domeGradientMean(Ry, halfH);
  return {
    Rx, Ry,
    scaleX: meanX > 0 ? 0.5 / meanX : 1,
    scaleY: meanY > 0 ? 0.5 / meanY : 1,
  };
}

function domeGradient(distance, radius, scale) {
  const inside = Math.min(distance, radius * (1 - 1e-3));
  return (inside / Math.sqrt(radius * radius - inside * inside)) * scale;
}

/* --------------------------------------------------------- the lens map ---- */

/**
 * Rasterize the displacement map for one lens shape.
 * Only the top-left quadrant is computed; the rest is mirrored, with the
 * displacement signs flipped and the specular axis swapped per quadrant.
 *
 * @returns {string} PNG data URL
 */
export function generateLensMap({
  size = 256, halfW, halfH, borderRadius, ...opts
}) {
  const o = { ...DEFAULT_OPTICS, ...opts };
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;

  const half = size >> 1;
  const radius = Math.min(borderRadius, Math.min(halfW, halfH));
  const minHalf = Math.min(halfW, halfH);
  const depthPx = Math.min(o.depth * minHalf, minHalf - 1);
  const innerHalfW = Math.max(0, halfW - depthPx);
  const innerHalfH = Math.max(0, halfH - depthPx);
  const innerRadius = Math.max(0, Math.min(borderRadius, Math.min(innerHalfW, innerHalfH)));
  const falloff = depthPx > 0 ? Math.SQRT1_2 / depthPx : 1e6;

  const hasSpecular = o.glow > 0 || o.sheen > 0;
  const angle = (o.sheenAngle * Math.PI) / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const edgeInv = o.sheenWidth > 0 ? 1 / o.sheenWidth : 0;
  const glowReachInv = 1 / Math.max(2, o.glowSpread * minHalf);

  const stepX = (2 * halfW) / size;
  const stepY = (2 * halfH) / size;
  const invW = 1 / halfW;
  const invH = 1 / halfH;

  const hasDome = o.curvature > 0;
  const domeCap = o.curvature * minHalf;
  const dome = hasDome ? computeDomeConstants(domeCap, halfW, halfH) : null;
  const hasSplay = o.splay > 0;
  const hasEdgeRefract = o.bend > 0;
  const erInv = 1 / Math.max(2, o.bendWidth * minHalf);

  const splayHalf = 0.5 * minHalf;
  const splayInv = splayHalf > 0 ? 1 / splayHalf : 0;
  const sheenNorm = Math.SQRT1_2;

  // per-column dome LUT
  let lut = null;
  if (hasDome) {
    lut = new Float32Array(half);
    const r2 = dome.Rx * dome.Rx;
    const rMax = dome.Rx * (1 - 1e-3);
    for (let col = 0; col < half; col++) {
      const px = -((col + 0.5) * stepX - halfW);
      const clamped = px < rMax ? px : rMax;
      lut[col] = (clamped / Math.sqrt(r2 - clamped * clamped)) * dome.scaleX;
    }
  }

  const cornerDistance = (ox, oy) => (ox > 0 || oy > 0 ? Math.sqrt(ox * ox + oy * oy) : 0);

  for (let row = 0; row < half; row++) {
    const mirrorRow = size - 1 - row;
    const py = -((row + 0.5) * stepY - halfH);
    const edgeY = py - halfH + radius;
    const innerEdgeY = o.softEdge ? py - innerHalfH + innerRadius : 0;
    const dirYBase = hasDome
      ? domeGradient(py, dome.Ry, dome.scaleY)
      : (py * invH > 1 ? 1 : py * invH);
    const normY = py * invH > 1 ? 1 : py * invH;
    const splayY = hasSplay ? Math.max(0, 1 - (halfH - py) * splayInv) : 0;
    const rowBase = row * size;
    const mirrorRowBase = mirrorRow * size;

    for (let col = 0; col < half; col++) {
      const mirrorCol = size - 1 - col;
      const px = -((col + 0.5) * stepX - halfW);
      const edgeX = px - halfW + radius;
      const sdf =
        cornerDistance(edgeX > 0 ? edgeX : 0, edgeY > 0 ? edgeY : 0) +
        (edgeX > edgeY ? (edgeX > 0 ? 0 : edgeX) : edgeY > 0 ? 0 : edgeY) -
        radius;

      const i00 = (rowBase + col) * 4;
      const i01 = (rowBase + mirrorCol) * 4;
      const i10 = (mirrorRowBase + col) * 4;
      const i11 = (mirrorRowBase + mirrorCol) * 4;

      if (o.clipToShape && sdf >= 0) {
        for (const idx of [i00, i01, i10, i11]) {
          data[idx] = 128; data[idx + 1] = 128; data[idx + 2] = 128; data[idx + 3] = 255;
        }
        continue;
      }

      let dirX = lut ? lut[col] : (px * invW > 1 ? 1 : px * invW);
      let dirY = dirYBase;

      if (hasSplay) {
        const yAtt = splayY * o.splay;
        const xAtt = Math.max(0, 1 - (halfW - px) * splayInv) * o.splay;
        if (yAtt > 0.001 || xAtt > 0.001) {
          const prevX = dirX, prevY = dirY;
          dirX = prevX * (1 - yAtt);
          dirY = prevY * (1 - xAtt);
          const prevLen = Math.hypot(prevX, prevY);
          const nextLen = Math.hypot(dirX, dirY);
          if (nextLen > 0.001) {
            const restore = prevLen / nextLen;
            dirX *= restore; dirY *= restore;
          }
        }
      }

      let edgeOpacity = 1;
      if (o.softEdge) {
        const ix = px - innerHalfW + innerRadius;
        const innerSdf =
          cornerDistance(ix > 0 ? ix : 0, innerEdgeY > 0 ? innerEdgeY : 0) +
          (ix > innerEdgeY ? (ix > 0 ? 0 : ix) : innerEdgeY > 0 ? 0 : innerEdgeY) -
          innerRadius;
        edgeOpacity = 0.5 * (1 + erf(innerSdf * falloff));
      }

      let dx = 0.5 * dirX * edgeOpacity;
      let dy = 0.5 * dirY * edgeOpacity;

      if (hasEdgeRefract) {
        // Meniscus: a soft bump peaking ~1/3 of the band inside the contour.
        const s = sdf < 0 ? Math.max(0, 1 + sdf * erInv) : 0;
        if (s > 0) {
          const len = Math.hypot(dirX, dirY);
          if (len > 1e-4) {
            const m = 6.75 * s * s * (1 - s);
            const a = (0.5 * o.bend * m * edgeOpacity) / len;
            dx += dirX * a; dy += dirY * a;
          }
        }
      }

      let specMain = 0, specCross = 0;
      if (hasSpecular) {
        const normX = px * invW > 1 ? 1 : px * invW;
        const axisMain = Math.min(1, Math.abs(normX * cosA + normY * sinA) * sheenNorm);
        const axisCross = Math.min(1, Math.abs(normX * cosA - normY * sinA) * sheenNorm);
        if (o.sheen > 0) {
          const band = sdf < 0 ? Math.max(0, 1 + sdf * edgeInv) : 0;
          const b = o.sheen * Math.pow(band, o.sheenFalloff);
          specMain += b * (0.16 + 0.84 * Math.pow(axisMain, 1.6));
          specCross += b * (0.16 + 0.84 * Math.pow(axisCross, 1.6));
        }
        if (o.glow > 0) {
          const reach = sdf < 0 ? Math.min(1, -sdf * glowReachInv) : 1;
          const t = 1 - reach;
          const g = o.glow * Math.pow(t * t * (3 - 2 * t), o.glowFalloff) * edgeOpacity;
          specMain += g * (0.6 + 0.4 * axisMain);
          specCross += g * (0.6 + 0.4 * axisCross);
        }
        specMain = Math.max(-1, Math.min(1, specMain));
        specCross = Math.max(-1, Math.min(1, specCross));
      }

      const rPos = encodeAxis(dx), rNeg = encodeAxis(-dx);
      const gPos = encodeAxis(dy), gNeg = encodeAxis(-dy);
      const bMain = encodeSpec(specMain), bCross = encodeSpec(specCross);

      data[i00] = rPos; data[i00 + 1] = gPos; data[i00 + 2] = bMain; data[i00 + 3] = 255;
      data[i01] = rNeg; data[i01 + 1] = gPos; data[i01 + 2] = bCross; data[i01 + 3] = 255;
      data[i10] = rPos; data[i10 + 1] = gNeg; data[i10 + 2] = bCross; data[i10 + 3] = 255;
      data[i11] = rNeg; data[i11 + 1] = gNeg; data[i11 + 2] = bMain; data[i11 + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

/* ------------------------------------------------------- the SVG filter ---- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

function filterHost() {
  let host = document.getElementById('glass-filters');
  if (!host) {
    host = el('svg', { id: 'glass-filters', width: 0, height: 0, 'aria-hidden': 'true' });
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    document.body.appendChild(host);
  }
  return host;
}

/**
 * Build the filter chain for one lens and append it to the shared <svg>.
 * Mirrors LensFilterContents: flood → map → optional blur → RGB-split
 * displacement → specular composite.
 */
export function installLensFilter(id, { w, h, mapUrl, optics = {} }) {
  const o = { ...DEFAULT_OPTICS, ...optics };
  const host = filterHost();
  host.querySelector(`#${id}`)?.remove();

  // obb-style diagonal normalization, so `strength` keeps its meaning in px
  const dispNorm = Math.sqrt((w * w + h * h) / 2);
  const dispScale = o.strength * dispNorm;

  const f = el('filter', {
    id,
    filterUnits: 'objectBoundingBox',
    primitiveUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
    x: 0, y: 0, width: 1, height: 1,
  });

  f.appendChild(el('feFlood', { 'flood-color': 'rgb(128,128,128)', 'flood-opacity': 1, result: 'mapBg' }));
  f.appendChild(el('feImage', {
    href: mapUrl, x: 0, y: 0, width: w, height: h,
    preserveAspectRatio: 'none', result: 'rawMap',
  }));
  f.appendChild(el('feComposite', { in: 'rawMap', in2: 'mapBg', operator: 'over', result: 'map' }));

  const hasBlur = o.frost > 0;
  if (hasBlur) {
    f.appendChild(el('feGaussianBlur', {
      in: 'SourceGraphic', stdDeviation: o.frost, result: 'blurred',
    }));
  }
  const src = hasBlur ? 'blurred' : 'SourceGraphic';

  if (o.dispersion > 0) {
    // Symmetric split about the base bend: R outward, B inward, G at base — so
    // raising dispersion fringes the edges without shifting the whole field.
    const passes = [
      { scale: dispScale * (1 + DISPERSION_SPREAD * 0.5 * o.dispersion), m: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', out: 'refractR' },
      { scale: dispScale,                                                  m: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', out: 'refractG' },
      { scale: dispScale * (1 - DISPERSION_SPREAD * 0.5 * o.dispersion), m: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', out: 'refractB' },
    ];
    for (const p of passes) {
      f.appendChild(el('feDisplacementMap', {
        in: src, in2: 'map', scale: p.scale,
        xChannelSelector: 'R', yChannelSelector: 'G',
      }));
      f.appendChild(el('feColorMatrix', { type: 'matrix', values: p.m, result: p.out }));
    }
    f.appendChild(el('feComposite', {
      in: 'refractR', in2: 'refractG', operator: 'arithmetic',
      k1: 0, k2: 1, k3: 1, k4: 0, result: 'refractRG',
    }));
    f.appendChild(el('feComposite', {
      in: 'refractRG', in2: 'refractB', operator: 'arithmetic',
      k1: 0, k2: 1, k3: 1, k4: 0, result: 'lensOut',
    }));
  } else {
    f.appendChild(el('feDisplacementMap', {
      in: src, in2: 'map', scale: dispScale,
      xChannelSelector: 'R', yChannelSelector: 'G', result: 'lensOut',
    }));
  }

  if (o.glow > 0 || o.sheen > 0) {
    f.appendChild(el('feColorMatrix', {
      in: 'map', type: 'matrix',
      values: `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 ${-128 / 255}`,
      result: 'sheenMask',
    }));
    f.appendChild(el('feComposite', {
      in: 'sheenMask', in2: 'lensOut', operator: 'arithmetic',
      k1: 0, k2: o.specular, k3: 1, k4: 0, result: 'lensOut',
    }));
  }

  host.appendChild(f);
  return id;
}

/* ----------------------------------------------------------- application -- */

let _supported = null;

/**
 * `backdrop-filter: url()` is Chromium-only. Safari and Firefox still get the
 * frost, tint and rim light from CSS — it reads as glass, it just can't bend
 * the live page. This is a web-platform limit, not a shortcut.
 */
export function supportsLensBackdrop() {
  if (_supported !== null) return _supported;
  const ok = typeof CSS !== 'undefined' && CSS.supports
    && (CSS.supports('backdrop-filter', 'url(#a)')
     || CSS.supports('-webkit-backdrop-filter', 'url(#a)'));
  _supported = !!ok;
  return _supported;
}

const installed = new Map();

/**
 * Give an element a glass lens sized to its own box.
 * Re-uses one filter per (w, h, radius, optics) signature — every circular
 * button of the same size shares a single rasterized map.
 */
export function applyGlass(node, { radius, optics = {}, mapSize = 256 } = {}) {
  const r = node.getBoundingClientRect();
  const w = Math.round(r.width);
  const h = Math.round(r.height);
  if (!w || !h) return null;

  const rad = radius ?? Math.min(w, h) / 2;
  const key = `${w}x${h}r${Math.round(rad)}-${JSON.stringify(optics)}`;

  let id = installed.get(key);
  if (!id) {
    id = `glass-${installed.size}`;
    const mapUrl = generateLensMap({
      size: mapSize, halfW: w / 2, halfH: h / 2, borderRadius: rad, ...optics,
    });
    installLensFilter(id, { w, h, mapUrl, optics });
    installed.set(key, id);
  }

  if (supportsLensBackdrop()) {
    node.style.backdropFilter = `url(#${id})`;
    node.style.webkitBackdropFilter = `url(#${id})`;
    node.dataset.glass = 'lens';
  } else {
    const o = { ...DEFAULT_OPTICS, ...optics };
    const fallback = `blur(${(o.frost * 8).toFixed(1)}px) saturate(1.5)`;
    node.style.backdropFilter = fallback;
    node.style.webkitBackdropFilter = fallback;
    node.dataset.glass = 'frost';
  }
  return id;
}

/** Apply to every match, after layout has settled. */
export function glassify(selector, opts) {
  const nodes = [...document.querySelectorAll(selector)];
  for (const n of nodes) applyGlass(n, opts);
  return nodes;
}
