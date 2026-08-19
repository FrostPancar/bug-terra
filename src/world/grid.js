// World topology: a grid of cells, one terrarium per player.
//
// A grid rather than free continuous placement, because it gives one tunable
// knob — cell spacing in pixels — that everything downstream reads: travel
// time, discovery rate, and the total pixel-storage budget. Continuous
// placement would need per-neighbourhood density tuning to get the same feel.
//
// Cells are handed out as the nearest unclaimed cell to world centre, spiralling
// outward, so the map fills from the middle. That bounds the storage footprint
// as the player base grows and stops average inter-player distance from
// drifting upward forever.

/** Cell size matches the terrarium WORLD box; the gap between is dirt zone. */
export const CELL = { w: 1280, h: 800 };

/**
 * Deliberately wide: a straight-line tunnel between neighbours should not be
 * the obvious play. Discovery is meant to reward wandering (see discovery.js).
 */
export const GAP = { x: 1600, y: 1200 };

export const PITCH = { x: CELL.w + GAP.x, y: CELL.h + GAP.y };

export const cellKey = (cx, cy) => `${cx},${cy}`;

/** Cell coords -> the world-space rect that cell's terrarium occupies. */
export function cellRect(cx, cy) {
  const x = cx * PITCH.x;
  const y = cy * PITCH.y;
  return { x, y, w: CELL.w, h: CELL.h, right: x + CELL.w, bottom: y + CELL.h,
           midX: x + CELL.w / 2, midY: y + CELL.h / 2 };
}

/** The square spiral out from (0,0): 0,0 · 1,0 · 1,1 · 0,1 · -1,1 · … */
export function* spiral(limit = 100000) {
  let x = 0, y = 0, dx = 1, dy = 0, leg = 1, step = 0, turns = 0;
  for (let i = 0; i < limit; i++) {
    yield { cx: x, cy: y };
    x += dx; y += dy; step++;
    if (step === leg) {
      step = 0;
      [dx, dy] = [-dy, dx];        // turn left
      turns++;
      if (turns % 2 === 0) leg++;
    }
  }
}

/**
 * Nearest unclaimed cell to world centre. `claimed` is anything with a `.has`
 * taking a cell key — a Set locally, a table lookup on the server.
 */
export function assignCell(claimed, { limit = 100000 } = {}) {
  for (const { cx, cy } of spiral(limit)) {
    if (!claimed.has(cellKey(cx, cy))) return { cx, cy, key: cellKey(cx, cy) };
  }
  return null;
}

/** Which cell a world point sits in, and whether it is inside the terrarium. */
export function locate(x, y) {
  const cx = Math.round(x / PITCH.x);
  const cy = Math.round(y / PITCH.y);
  const r = cellRect(cx, cy);
  const inside = x >= r.x && x <= r.right && y >= r.y && y <= r.bottom;
  return { cx, cy, key: cellKey(cx, cy), inside, rect: r };
}

/** Distance from a point to the nearest edge of a cell's terrarium box. */
export function distanceToCell(x, y, cx, cy) {
  const r = cellRect(cx, cy);
  const dx = Math.max(r.x - x, 0, x - r.right);
  const dy = Math.max(r.y - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

/** Cells within `radius` of a point, nearest first. Used to scope work. */
export function cellsNear(x, y, radius) {
  const out = [];
  const span = Math.ceil(radius / Math.min(PITCH.x, PITCH.y)) + 1;
  const c = locate(x, y);
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const cx = c.cx + dx;
      const cy = c.cy + dy;
      const d = distanceToCell(x, y, cx, cy);
      if (d <= radius) out.push({ cx, cy, key: cellKey(cx, cy), distance: d });
    }
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}
