// Finding things in the dirt.
//
// Two different things get discovered and they are tuned against different
// targets, so they use different mechanisms on purpose:
//
//   * ANOTHER PLAYER'S TERRARIUM — a distance-decayed probability rolled per
//     dig-tick while burrowing. Low near your own cell (so a casual dig does
//     not stumble into a neighbour), rising with distance, and PLATEAUING
//     rather than climbing forever. The plateau is the whole point: without it
//     the optimal play is to tunnel due east as fast as possible.
//
//   * POINTS OF INTEREST — placed at chunk-materialization time, seeded off
//     chunk coordinates (see chunks.js). Rolled once, not re-rolled per visit.
//
// A successful terrarium roll does NOT teleport anyone. It tags a chunk near
// the neighbour's wall as discovered and hands back a direction, so reaching it
// is still a short deliberate dig. Discovery stays a moment rather than a lookup.

import { distanceToCell, cellsNear, cellRect, PITCH } from './grid.js';
import { worldToChunk, chunkHash } from './chunks.js';

export const DISCOVERY = {
  baseRate: 0.0125,        // per dig-tick, before falloff
  nearRadius: 0.35,        // in units of cell pitch: below this, essentially nil
  farRadius: 1.15,         // by here the curve has reached its ceiling
  plateau: 1.0,            // ceiling multiplier — the anti-tunnel-rush knob
  homeSuppression: 0.06,   // multiplier applied inside your own cell's near ring
  checkRadius: PITCH.x,    // no roll is paid for in chunks nowhere near anyone
};

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
};

/**
 * The falloff curve. Rises from ~0 at your own doorstep to `plateau` and then
 * stays there — digging further does not keep improving your odds.
 */
export function falloff(distanceFromOwnCell, opts = {}) {
  const o = { ...DISCOVERY, ...opts };
  const pitch = Math.min(PITCH.x, PITCH.y);
  const d = distanceFromOwnCell / pitch;
  const ramp = smoothstep(o.nearRadius, o.farRadius, d);
  const suppressed = d < o.nearRadius ? o.homeSuppression : 1;
  return o.plateau * ramp * suppressed;
}

/**
 * Probability that this dig-tick reveals a neighbouring terrarium. Pure: same
 * inputs, same number. The caller does the rolling, with its own rng.
 */
export function revealChance(digX, digY, ownCell, opts = {}) {
  const o = { ...DISCOVERY, ...opts };
  const fromHome = distanceToCell(digX, digY, ownCell.cx, ownCell.cy);
  return o.baseRate * falloff(fromHome, o);
}

/**
 * Candidate neighbours worth rolling against from this dig position. Returns
 * an empty array when nothing is in range, which is how the check costs nothing
 * in the vast middle of the dirt zone.
 */
export function candidates(digX, digY, ownCell, claimedCells, opts = {}) {
  const o = { ...DISCOVERY, ...opts };
  return cellsNear(digX, digY, o.checkRadius)
    .filter((c) => !(c.cx === ownCell.cx && c.cy === ownCell.cy))
    .filter((c) => claimedCells.has(c.key));
}

/**
 * One dig-tick's discovery check.
 *
 * @param rng      a seeded rng — the caller owns randomness, this module doesn't
 * @param known    Set of already-discovered cell keys; discovered cells are skipped
 * @returns null, or { cell, marker } where marker is a chunk near their wall
 */
export function checkDiscovery(digX, digY, ownCell, claimedCells, known, rng, opts = {}) {
  const near = candidates(digX, digY, ownCell, claimedCells, opts);
  if (!near.length) return null;
  const p = revealChance(digX, digY, ownCell, opts);
  if (p <= 0) return null;
  for (const c of near) {
    if (known.has(c.key)) continue;
    // Closer candidates are likelier, but every in-range neighbour gets a look.
    const weight = 1 - Math.min(0.85, c.distance / (opts.checkRadius ?? DISCOVERY.checkRadius));
    if (rng() < p * weight) {
      return { cell: c, marker: wallMarkerChunk(digX, digY, c.cx, c.cy) };
    }
  }
  return null;
}

/**
 * The partial reveal: the chunk on the neighbour's wall that faces the digger.
 * A direction and a place to aim at, not a destination handed over.
 */
export function wallMarkerChunk(fromX, fromY, cx, cy) {
  const r = cellRect(cx, cy);
  const px = Math.min(r.right, Math.max(r.x, fromX));
  const py = Math.min(r.bottom, Math.max(r.y, fromY));
  // Push the marker just outside the wall, on the side the digger is on.
  const ox = fromX < r.midX ? -2 : 2;
  const oy = fromY < r.midY ? -2 : 2;
  const wall = worldToChunk(px + (px === r.x || px === r.right ? ox : 0),
                            py + (py === r.y || py === r.bottom ? oy : 0));
  return {
    chunkId: wall.key,
    cx: wall.cx, cy: wall.cy,
    bearing: Math.atan2(r.midY - fromY, r.midX - fromX),
    distance: Math.hypot(r.midX - fromX, r.midY - fromY),
  };
}

/**
 * "Borrowed hole" detection — a tunnel segment the player did not dig. This
 * falls out of the shared-chunk model for free; no separate footprint system.
 * Returns the owner tag if the chunk carries one.
 */
export function borrowedFrom(store, x, y, playerId) {
  const { cx, cy, lx, ly } = worldToChunk(x, y);
  const c = store.peek(cx, cy);
  if (!c) return null;
  const tag = c.meta.find((m) => m.kind === 'tunnel' && m.lx === lx && m.ly === ly);
  if (!tag || tag.claimedBy === playerId) return null;
  return tag.claimedBy;
}

/**
 * Dig radius. The open question in the doc was whether burrowing needs a 15th
 * stat. It does not: `grip` already measures how well a bug can plant itself
 * and push, and `attack` already measures how hard it can move material. Reusing
 * them keeps the gene vector from growing for one feature, and keeps every
 * existing bug immediately meaningful underground.
 */
export function digRadius(stats) {
  const push = (stats.grip ?? 0) / 100;
  const bite = (stats.attack ?? 0) / 100;
  return Math.max(2, Math.round(2 + push * 4 + bite * 3));
}

/** Seconds between dig ticks — a heavier bug digs in slower, bigger bites. */
export function digInterval(stats) {
  const rate = stats.attackRate ?? 1;
  return Math.min(1.2, Math.max(0.18, 0.9 / Math.max(0.3, rate)));
}

/** Deterministic per-chunk flavour, so two clients describe the same dirt alike. */
export function chunkFlavour(cx, cy, seed = 1) {
  const h = chunkHash(cx, cy, seed);
  const kinds = ['loam', 'clay', 'gravel', 'root-mat', 'sand', 'chalk'];
  return kinds[h % kinds.length];
}
