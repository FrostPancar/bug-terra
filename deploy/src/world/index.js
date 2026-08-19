// The multiplayer layer, assembled.
//
// Nothing here talks to a network. `DirtWorld` implements the CLIENT half of
// the model exactly as it will run against a server — predict locally, apply
// ops, reconcile against an authority — and `LocalAuthority` is a stand-in for
// that server that runs in the same process. Swapping in a real transport means
// replacing one object, not rewriting the sim.
//
// The dividing line, restated: anything one player can see change because of
// another player's action (dirt pixels, gate state, POI claims) is server-owned
// and shared. The local terrarium's Matter.js physics stays client-authoritative
// and unsynced — this layer adds a shared world, it does not change how the
// terrarium sim itself runs.

import { ChunkStore, digOps, worldToChunk, claimPoi } from './chunks.js';
import { assignCell, cellKey, locate, cellRect } from './grid.js';
import { makeGate, tryEnter, leave, canFight, wallMarker } from './gates.js';
import { checkDiscovery, digRadius, digInterval } from './discovery.js';
import { makeRng } from '../core/rng.js';

/**
 * Who owns what. This table is the contract the server implements; it is
 * exported as data so tests and docs read the same thing the code does.
 */
export const AUTHORITY = {
  genes:            { owner: 'server', scope: 'per-player', sync: 'on-change' },
  terrariumContents:{ owner: 'server', scope: 'per-player', sync: 'snapshot+events' },
  gateFlags:        { owner: 'server', scope: 'per-player', sync: 'push-on-toggle' },
  dirtChunks:       { owner: 'server', scope: 'shared',     sync: 'lazy-pull + op-broadcast' },
  poiClaims:        { owner: 'server', scope: 'shared',     sync: 'deterministic-seed + claim' },
  burrowPosition:   { owner: 'client', scope: 'per-player', sync: 'predict + reconcile' },
  terrariumPhysics: { owner: 'client', scope: 'per-player', sync: 'none' },
};

/** In-process stand-in for the backend. Same method surface a transport will have. */
export class LocalAuthority {
  constructor({ seed = 20260819, regrowSeconds = 900 } = {}) {
    this.store = new ChunkStore({ seed, regrowSeconds });
    this.claimed = new Set();          // cell keys
    this.players = new Map();          // playerId -> { cell, gate, lastSeen }
    this.subscribers = new Map();      // chunkId -> Set<playerId>
    this.seed = seed;
  }

  join(playerId, now = 0) {
    if (this.players.has(playerId)) return this.players.get(playerId);
    const cell = assignCell(this.claimed);
    this.claimed.add(cell.key);
    const rec = { playerId, cell, gate: makeGate(), lastSeen: now, discovered: new Set() };
    this.players.set(playerId, rec);
    return rec;
  }

  subscribe(playerId, chunkId) {
    if (!this.subscribers.has(chunkId)) this.subscribers.set(chunkId, new Set());
    this.subscribers.get(chunkId).add(playerId);
  }

  /** Authoritative op application. Returns the ops to broadcast, and to whom. */
  submitOps(playerId, ops, now = 0) {
    const accepted = [];
    for (const op of ops) {
      const changed = this.store.applyOp(op, now);
      if (changed) accepted.push(op);
      this.subscribe(playerId, op.chunkId);
    }
    const rec = this.players.get(playerId);
    if (rec) rec.lastSeen = now;
    return {
      accepted,
      recipients: accepted.flatMap((op) =>
        [...(this.subscribers.get(op.chunkId) ?? [])].filter((id) => id !== playerId)),
    };
  }

  /** Lazy pull: regrow first, then hand back whatever is actually stored. */
  fetchChunk(cx, cy, now = 0) {
    this.store.regrow(cx, cy, now);
    return this.store.peek(cx, cy);     // null means implicit solid
  }

  claim(playerId, x, y, now = 0) {
    const { cx, cy } = worldToChunk(x, y);
    return claimPoi(this.store, cx, cy, playerId, now);
  }

  gateOf(playerId) { return this.players.get(playerId)?.gate ?? null; }
}

/* ------------------------------------------------------------------ client */

export class DirtWorld {
  /**
   * @param authority anything with LocalAuthority's surface
   */
  constructor(playerId, authority, { seed = 1 } = {}) {
    this.playerId = playerId;
    this.authority = authority;
    this.rng = makeRng(seed);
    // The client's own cache. Absence of a chunk means solid — the client
    // renders it solid without asking, and only pulls chunks near the camera.
    this.cache = new ChunkStore({ seed: authority.seed ?? seed });
    this.me = authority.join(playerId, 0);
    this.discovered = new Set();
    this.pending = [];                 // ops sent but not yet confirmed
    this.digClock = 0;
  }

  get cell() { return this.me.cell; }
  get homeRect() { return cellRect(this.me.cell.cx, this.me.cell.cy); }

  /** Pull the chunks around a point into the local cache. */
  loadAround(x, y, now = 0, radiusChunks = 2) {
    const c = worldToChunk(x, y);
    for (let dy = -radiusChunks; dy <= radiusChunks; dy++) {
      for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
        const cx = c.cx + dx;
        const cy = c.cy + dy;
        const server = this.authority.fetchChunk(cx, cy, now);
        if (!server) { this.cache.chunks.delete(`${cx},${cy}`); continue; }
        const local = this.cache.materialize(cx, cy, now);
        local.bits = new Uint8Array(server.bits);
        local.dug = server.dug;
        local.poi = server.poi ? { ...server.poi } : null;
        local.meta = server.meta.map((m) => ({ ...m }));
      }
    }
  }

  /**
   * One burrow tick. Applies the dig locally FIRST so the hole appears the
   * instant the player asks for it, then submits to the authority and
   * reconciles. A rejected op simply loses on the next `loadAround`.
   */
  burrow(x, y, stats, now = 0) {
    const r = digRadius(stats);
    const ops = digOps(x, y, r, 'dig');
    let predicted = 0;
    for (const op of ops) predicted += this.cache.applyOp(op, now);
    const { accepted, recipients } = this.authority.submitOps(this.playerId, ops, now);
    this.pending = ops.filter((o) => !accepted.includes(o));

    const found = this.authority.claim(this.playerId, x, y, now);
    const reveal = checkDiscovery(
      x, y, this.me.cell, this.authority.claimed, this.discovered, this.rng
    );
    if (reveal) this.discovered.add(reveal.cell.key);

    return { predicted, accepted: accepted.length, recipients, found, reveal, radius: r };
  }

  /** Seconds until this bug can dig again. */
  digCooldown(stats) { return digInterval(stats); }

  isSolid(x, y) { return !this.cache.isEmpty(x, y); }

  /** Try to enter a neighbour's terrarium. Decided once, at the boundary. */
  enter(hostId, now = 0) {
    const gate = this.authority.gateOf(hostId);
    return tryEnter(gate, this.playerId, now);
  }

  exit(hostId, now = 0) {
    return leave(this.authority.gateOf(hostId), this.playerId, now);
  }

  mayFight(hostId) {
    return canFight(this.authority.gateOf(hostId), this.authority.gateOf(this.playerId));
  }

  /** What the dirt-zone-facing wall of a cell shows, before you commit to entering. */
  markerFor(hostId) { return wallMarker(this.authority.gateOf(hostId)); }

  /** Where a world point is: your terrarium, someone's terrarium, or dirt. */
  whereAmI(x, y) {
    const l = locate(x, y);
    if (!l.inside) return { zone: 'dirt', ...l };
    const mine = l.key === cellKey(this.me.cell.cx, this.me.cell.cy);
    return { zone: mine ? 'home' : 'terrarium', ...l };
  }
}

export { ChunkStore, digOps, cellRect, makeGate };
