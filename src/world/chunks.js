// Dirt-zone storage.
//
// A flat bitmap over the whole dirt zone would be almost entirely the same
// value forever, so this is the standard destructible-terrain arrangement:
//
//   * The zone is divided into 64x64-pixel chunks.
//   * A chunk with no modifications is IMPLICIT SOLID — it does not exist. No
//     row in a table, no bytes on disk, no network traffic. Absence IS solid.
//   * The first dig materializes a chunk: a 512-byte bitmask (1 bit per pixel)
//     plus a short sparse list for the few pixels carrying metadata.
//
// Changes travel as OPS, not as chunk dumps: `{chunkId, localX, localY, radius,
// action}`. Traffic is proportional to activity near a chunk, not to chunk
// size, and two players digging the same tunnel converge without either side
// resending anything.
//
// This module is the pure core. It has no networking and no clock of its own —
// every function that cares about time takes `now` as an argument, so the
// client, the server and the tests all run the identical code.

export const CHUNK = 64;
export const CHUNK_BYTES = (CHUNK * CHUNK) / 8;    // 512

export const chunkKey = (cx, cy) => `${cx},${cy}`;

export function parseChunkKey(key) {
  const [cx, cy] = key.split(',').map(Number);
  return { cx, cy };
}

/** World pixel -> chunk coords + the pixel's position inside that chunk. */
export function worldToChunk(x, y) {
  const cx = Math.floor(x / CHUNK);
  const cy = Math.floor(y / CHUNK);
  return { cx, cy, lx: x - cx * CHUNK, ly: y - cy * CHUNK, key: chunkKey(cx, cy) };
}

export const chunkOrigin = (cx, cy) => ({ x: cx * CHUNK, y: cy * CHUNK });

/* --------------------------------------------------------------- a chunk -- */

/**
 * bits: 1 = empty (dug out), 0 = solid. A fresh chunk is all zeroes, which is
 * exactly what an implicit chunk means, so materializing one never changes what
 * the world looks like.
 */
export function makeChunk(cx, cy, now = 0) {
  return {
    cx, cy, key: chunkKey(cx, cy),
    bits: new Uint8Array(CHUNK_BYTES),
    meta: [],              // [{ lx, ly, kind, claimedBy }]
    dug: 0,                // empty pixel count, kept incrementally
    materializedAt: now,
    lastActivity: now,
    lastRegrow: now,
    poi: null,             // rolled once, at materialization
  };
}

const bitIndex = (lx, ly) => ly * CHUNK + lx;

export function getBit(chunk, lx, ly) {
  const i = bitIndex(lx, ly);
  return (chunk.bits[i >> 3] >> (i & 7)) & 1;
}

function setBit(chunk, lx, ly, value) {
  const i = bitIndex(lx, ly);
  const byte = i >> 3;
  const mask = 1 << (i & 7);
  const was = (chunk.bits[byte] & mask) !== 0;
  if (value) chunk.bits[byte] |= mask;
  else chunk.bits[byte] &= ~mask;
  if (value && !was) { chunk.dug++; return 1; }
  if (!value && was) { chunk.dug--; return -1; }
  return 0;
}

/* ---------------------------------------------------------------- store --- */

/**
 * The client and the server hold the same shape. The client's copy is a cache
 * of what the server has sent plus its own unconfirmed predictions; the
 * server's is authoritative. Neither needs a different class.
 */
export class ChunkStore {
  constructor({ seed = 1, regrowSeconds = 900 } = {}) {
    this.seed = seed >>> 0;
    /** @type {Map<string, ReturnType<typeof makeChunk>>} */
    this.chunks = new Map();
    // How long a chunk must sit untouched before dirt starts creeping back.
    this.regrowSeconds = regrowSeconds;
    this.ops = [];              // append-only log, for reconciliation
  }

  has(key) { return this.chunks.has(key); }

  /** Read-only peek. Never materializes — absence is a legitimate answer. */
  peek(cx, cy) { return this.chunks.get(chunkKey(cx, cy)) ?? null; }

  /** Materialize on demand. This is the only place a chunk comes into being. */
  materialize(cx, cy, now = 0) {
    const key = chunkKey(cx, cy);
    let c = this.chunks.get(key);
    if (c) return c;
    c = makeChunk(cx, cy, now);
    c.poi = rollPoi(cx, cy, this.seed);
    this.chunks.set(key, c);
    return c;
  }

  /** True if the world pixel is dug out. Unmaterialized chunks read as solid. */
  isEmpty(x, y) {
    const { cx, cy, lx, ly } = worldToChunk(x, y);
    const c = this.peek(cx, cy);
    return c ? getBit(c, lx, ly) === 1 : false;
  }

  /**
   * Apply one op. Materializes the target chunk if needed and returns the
   * number of pixels it actually changed — 0 means the op was a no-op, which
   * is how a client detects that the server already had this dig.
   */
  applyOp(op, now = 0) {
    const { cx, cy } = parseChunkKey(op.chunkId);
    const chunk = this.materialize(cx, cy, now);
    const value = op.action === 'dig' ? 1 : 0;
    const r = Math.max(0, op.radius | 0);
    let changed = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const lx = op.localX + dx;
        const ly = op.localY + dy;
        if (lx < 0 || ly < 0 || lx >= CHUNK || ly >= CHUNK) continue;
        changed += Math.abs(setBit(chunk, lx, ly, value));
      }
    }
    if (changed) {
      chunk.lastActivity = now;
      this.ops.push({ ...op, at: now });
    }
    return changed;
  }

  /**
   * Lazy regrowth, checked when a chunk is loaded rather than ticked globally.
   * Dirt creeps back from the edges of a hole, so a long tunnel narrows before
   * it closes — a borrowed hole has a shelf life, which is what stops the map
   * from becoming Swiss cheese.
   */
  regrow(cx, cy, now) {
    const c = this.peek(cx, cy);
    if (!c || c.dug === 0) return 0;
    const idle = now - Math.max(c.lastActivity, c.lastRegrow);
    if (idle < this.regrowSeconds) return 0;
    // A hole 64 px across needs at most CHUNK passes to close from all sides;
    // anything beyond that is a chunk nobody has touched in a very long time.
    const passes = Math.min(CHUNK, Math.floor(idle / this.regrowSeconds));
    c.lastRegrow = now;
    let filled = 0;
    for (let p = 0; p < passes && c.dug > 0; p++) {
      // One erosion pass: dirt creeps in one pixel from every solid edge, so a
      // tunnel narrows before it closes and a wide cavern outlives a scratch.
      let pass = 0;
      const next = new Uint8Array(c.bits);
      for (let ly = 0; ly < CHUNK; ly++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          if (getBit(c, lx, ly) !== 1) continue;
          // Pixels beyond the chunk edge don't count as solid — otherwise a
          // tunnel would get pinched at every 64 px seam, which would look
          // like an artefact rather than like erosion.
          let solid = 0;
          if (lx > 0 && getBit(c, lx - 1, ly) === 0) solid++;
          if (lx < CHUNK - 1 && getBit(c, lx + 1, ly) === 0) solid++;
          if (ly > 0 && getBit(c, lx, ly - 1) === 0) solid++;
          if (ly < CHUNK - 1 && getBit(c, lx, ly + 1) === 0) solid++;
          if (solid >= 1) {
            const i = bitIndex(lx, ly);
            next[i >> 3] &= ~(1 << (i & 7));
            pass++;
          }
        }
      }
      c.bits = next;
      c.dug -= pass;
      filled += pass;
    }
    c.dug = Math.max(0, c.dug);
    // A fully regrown chunk with nothing else on it can be forgotten entirely,
    // returning it to implicit-solid and costing nothing again.
    if (c.dug === 0 && c.meta.length === 0 && !c.poi?.claimed) {
      this.chunks.delete(c.key);
    }
    return filled;
  }

  /** Bytes this store actually occupies — the number the storage budget cares about. */
  footprint() {
    let bytes = 0;
    for (const c of this.chunks.values()) bytes += CHUNK_BYTES + c.meta.length * 16;
    return { chunks: this.chunks.size, bytes };
  }
}

/* ------------------------------------------------------------------- ops -- */

/**
 * A dig of `radius` at a world point may straddle up to four chunks. This
 * splits it into per-chunk ops so each op is addressed to exactly one chunk,
 * which is what makes them broadcastable to that chunk's subscribers.
 */
export function digOps(x, y, radius, action = 'dig') {
  const r = Math.max(0, Math.round(radius));
  const seen = new Map();
  for (let cy = Math.floor((y - r) / CHUNK); cy <= Math.floor((y + r) / CHUNK); cy++) {
    for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++) {
      const key = chunkKey(cx, cy);
      seen.set(key, {
        chunkId: key,
        localX: Math.round(x) - cx * CHUNK,
        localY: Math.round(y) - cy * CHUNK,
        radius: r,
        action,
      });
    }
  }
  return [...seen.values()];
}

/* ------------------------------------------------------------------ POI --- */

/** 32-bit mix — deterministic, so a chunk's contents never depend on visit order. */
export function chunkHash(cx, cy, seed = 1) {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (cx | 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (cy | 0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * POI density is a tuning constant, not game logic. It is set high enough that
 * a normal session almost always turns up something, while any specific find
 * stays exhaustible.
 */
export const POI_TABLE = [
  { kind: 'seed_cache',   weight: 34, rarity: 'common' },
  { kind: 'mineral_vein', weight: 26, rarity: 'common' },
  { kind: 'old_burrow',   weight: 18, rarity: 'common' },
  { kind: 'amber_shard',  weight: 12, rarity: 'uncommon' },
  { kind: 'fossil_egg',   weight: 7,  rarity: 'rare' },
  { kind: 'deep_relic',   weight: 3,  rarity: 'rare' },
];

export const POI_CHANCE = 0.42;   // per chunk, rolled once at materialization

/** Rolled once per chunk materialization, seeded off chunk coordinates. */
export function rollPoi(cx, cy, seed = 1) {
  const h = chunkHash(cx, cy, seed);
  if ((h % 1000) / 1000 >= POI_CHANCE) return null;
  const pick = ((h >>> 10) % 1000) / 1000;
  const total = POI_TABLE.reduce((a, e) => a + e.weight, 0);
  let acc = 0;
  for (const e of POI_TABLE) {
    acc += e.weight / total;
    if (pick < acc) {
      return {
        kind: e.kind, rarity: e.rarity, claimed: false, claimedBy: null,
        lx: (h >>> 20) % CHUNK, ly: (h >>> 26) % CHUNK,
      };
    }
  }
  return null;
}

/** First-come-first-serve. Returns the POI if this call is the one that got it. */
export function claimPoi(store, cx, cy, playerId, now = 0) {
  const c = store.peek(cx, cy);
  if (!c?.poi || c.poi.claimed) return null;
  c.poi.claimed = true;
  c.poi.claimedBy = playerId;
  c.lastActivity = now;
  return c.poi;
}
