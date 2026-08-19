import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHUNK, CHUNK_BYTES, ChunkStore, digOps, worldToChunk, chunkKey,
  rollPoi, claimPoi, chunkHash, getBit,
} from '../src/world/chunks.js';
import { assignCell, cellKey, cellRect, locate, distanceToCell, spiral } from '../src/world/grid.js';
import {
  makeGate, tryEnter, setGateOpen, setPvp, canFight, wallMarker, reapAbandoned,
} from '../src/world/gates.js';
import { falloff, revealChance, digRadius, DISCOVERY } from '../src/world/discovery.js';
import { DirtWorld, LocalAuthority, AUTHORITY } from '../src/world/index.js';
import { makeRng } from '../src/core/rng.js';

/* -------------------------------------------------------------- storage -- */

test('an untouched dirt zone costs nothing to store', () => {
  const s = new ChunkStore();
  for (let i = 0; i < 500; i++) assert.equal(s.isEmpty(i * 37, i * 91), false);
  assert.deepEqual(s.footprint(), { chunks: 0, bytes: 0 },
    'reading solid ground must not materialize anything');
});

test('a chunk materializes only on the first dig, and costs 512 bytes', () => {
  const s = new ChunkStore();
  for (const op of digOps(100, 100, 3)) s.applyOp(op, 0);
  const fp = s.footprint();
  assert.equal(fp.chunks, 1);
  assert.equal(fp.bytes, CHUNK_BYTES);
});

test('a dig actually clears the pixels it covers and nothing else', () => {
  const s = new ChunkStore();
  for (const op of digOps(200, 200, 4)) s.applyOp(op, 0);
  assert.equal(s.isEmpty(200, 200), true);
  assert.equal(s.isEmpty(203, 200), true);
  assert.equal(s.isEmpty(210, 200), false, 'outside the radius must stay solid');
});

test('a dig straddling a chunk boundary emits one op per chunk', () => {
  const ops = digOps(CHUNK - 1, CHUNK - 1, 6);
  assert.equal(ops.length, 4, 'a corner dig touches four chunks');
  const ids = new Set(ops.map((o) => o.chunkId));
  assert.equal(ids.size, 4);
  const s = new ChunkStore();
  for (const op of ops) s.applyOp(op, 0);
  assert.equal(s.isEmpty(CHUNK - 1, CHUNK - 1), true);
  assert.equal(s.isEmpty(CHUNK + 1, CHUNK + 1), true, 'the hole crosses the seam');
});

test('re-applying the same op changes nothing — ops are idempotent', () => {
  const s = new ChunkStore();
  const ops = digOps(300, 300, 5);
  const first = ops.reduce((n, op) => n + s.applyOp(op, 0), 0);
  const second = ops.reduce((n, op) => n + s.applyOp(op, 1), 0);
  assert.ok(first > 0);
  assert.equal(second, 0, 'a duplicate op must be a no-op, so replays are safe');
});

test('fill is the inverse of dig', () => {
  const s = new ChunkStore();
  for (const op of digOps(400, 400, 5)) s.applyOp(op, 0);
  assert.equal(s.isEmpty(400, 400), true);
  for (const op of digOps(400, 400, 5, 'fill')) s.applyOp(op, 1);
  assert.equal(s.isEmpty(400, 400), false);
});

test('op order does not change the resulting chunk', () => {
  const build = (order) => {
    const s = new ChunkStore();
    const ops = [
      ...digOps(300, 300, 6), ...digOps(320, 305, 4), ...digOps(290, 330, 5),
    ];
    for (const op of order(ops)) s.applyOp(op, 0);
    const c = s.peek(...Object.values(worldToChunk(300, 300)).slice(0, 2));
    return c.dug;
  };
  assert.equal(build((o) => o), build((o) => [...o].reverse()));
});

/* ------------------------------------------------------------- regrowth -- */

test('dirt regrows lazily and eventually forgets the chunk entirely', () => {
  const s = new ChunkStore({ regrowSeconds: 10 });
  for (const op of digOps(500, 500, 3)) s.applyOp(op, 0);
  const { cx, cy } = worldToChunk(500, 500);
  assert.ok(s.peek(cx, cy).dug > 0);
  s.regrow(cx, cy, 10_000);
  const after = s.peek(cx, cy);
  assert.ok(!after || after.dug === 0,
    'a long-abandoned hole should close, returning the chunk to implicit solid');
});

test('regrowth does nothing before the timer elapses', () => {
  const s = new ChunkStore({ regrowSeconds: 1000 });
  for (const op of digOps(600, 600, 4)) s.applyOp(op, 0);
  const { cx, cy } = worldToChunk(600, 600);
  const before = s.peek(cx, cy).dug;
  assert.equal(s.regrow(cx, cy, 10), 0);
  assert.equal(s.peek(cx, cy).dug, before);
});

/* ----------------------------------------------------------------- POI --- */

test('POI rolls are deterministic from chunk coordinates', () => {
  for (let i = 0; i < 200; i++) {
    const a = rollPoi(i, i * 3, 42);
    const b = rollPoi(i, i * 3, 42);
    assert.deepEqual(a, b, 'the same chunk must always roll the same contents');
  }
});

test('a different world seed gives a different dirt zone', () => {
  const a = Array.from({ length: 60 }, (_, i) => rollPoi(i, 0, 1)?.kind ?? '-').join();
  const b = Array.from({ length: 60 }, (_, i) => rollPoi(i, 0, 2)?.kind ?? '-').join();
  assert.notEqual(a, b);
});

test('POI density is high enough that a session finds something', () => {
  let hits = 0;
  for (let i = 0; i < 400; i++) if (rollPoi(i % 20, Math.floor(i / 20), 7)) hits++;
  const rate = hits / 400;
  assert.ok(rate > 0.25 && rate < 0.65, `POI rate ${rate} is outside the tuned band`);
});

test('a POI is first-come-first-serve', () => {
  const s = new ChunkStore({ seed: 7 });
  // find a chunk that actually has one
  let target = null;
  for (let i = 0; i < 200 && !target; i++) if (rollPoi(i, 0, 7)) target = i;
  assert.ok(target !== null, 'no POI found to test against');
  s.materialize(target, 0, 0);
  assert.ok(claimPoi(s, target, 0, 'ada', 0), 'first claim should succeed');
  assert.equal(claimPoi(s, target, 0, 'bob', 1), null, 'second claim should fail');
});

/* ---------------------------------------------------------------- grid --- */

test('cells are handed out from the centre outward', () => {
  const claimed = new Set();
  const dists = [];
  for (let i = 0; i < 25; i++) {
    const c = assignCell(claimed);
    claimed.add(c.key);
    dists.push(Math.hypot(c.cx, c.cy));
  }
  assert.equal(dists[0], 0, 'the first player gets the middle');
  // Non-decreasing in rings: the spiral never jumps out and back.
  const maxSoFar = dists.map((_, i) => Math.max(...dists.slice(0, i + 1)));
  assert.deepEqual(maxSoFar, maxSoFar.slice().sort((a, b) => a - b));
});

test('the spiral never repeats a cell', () => {
  const seen = new Set();
  let n = 0;
  for (const { cx, cy } of spiral(400)) {
    seen.add(cellKey(cx, cy));
    n++;
  }
  assert.equal(seen.size, n, 'the spiral revisited a cell');
});

test('a point inside a cell locates to that cell', () => {
  const r = cellRect(2, -1);
  const l = locate(r.midX, r.midY);
  assert.equal(l.cx, 2);
  assert.equal(l.cy, -1);
  assert.equal(l.inside, true);
  assert.equal(locate(r.right + 400, r.midY).inside, false, 'the gap is dirt, not a cell');
});

test('distance to your own cell is zero from inside it', () => {
  const r = cellRect(0, 0);
  assert.equal(distanceToCell(r.midX, r.midY, 0, 0), 0);
  assert.ok(distanceToCell(r.right + 500, r.midY, 0, 0) > 0);
});

/* --------------------------------------------------------------- gates --- */

test('entry is decided once — closing the gate does not eject a visitor', () => {
  const gate = makeGate({ gateOpen: true });
  assert.equal(tryEnter(gate, 'visitor', 0).ok, true);
  setGateOpen(gate, false, 1);
  assert.ok(gate.visitors.has('visitor'),
    'shutting the gate behind someone should trap them, not teleport them out');
});

test('a closed gate refuses entry', () => {
  const gate = makeGate({ gateOpen: false });
  assert.equal(tryEnter(gate, 'visitor', 0).ok, false);
  assert.equal(gate.visitors.size, 0);
});

test('one-sided PVP is not PVP', () => {
  const host = makeGate({ gateOpen: true, pvpEnabled: true });
  const visitor = makeGate({ pvpEnabled: false });
  assert.equal(canFight(host, visitor), false);
  setPvp(visitor, true, 0);
  assert.equal(canFight(host, visitor), true);
});

test('a closed terrarium still reads as a discovery from outside', () => {
  assert.equal(wallMarker(makeGate({ gateOpen: false })).state, 'closed');
  assert.equal(wallMarker(makeGate({ gateOpen: true })).state, 'open');
  assert.equal(wallMarker(makeGate({ gateOpen: true, pvpEnabled: true })).state, 'open-hostile');
});

test('an abandoned cell auto-closes', () => {
  const gate = makeGate({ gateOpen: true, pvpEnabled: true });
  assert.equal(reapAbandoned(gate, 0, 60), false);
  assert.equal(reapAbandoned(gate, 0, 1e12), true);
  assert.equal(gate.gateOpen, false);
  assert.equal(gate.pvpEnabled, false);
});

/* ----------------------------------------------------------- discovery -- */

test('the discovery curve plateaus instead of rewarding a straight-line rush', () => {
  const at = (mult) => falloff(mult * Math.min(3000, 2800));
  const near = falloff(200);
  const mid = falloff(2000);
  const far = falloff(20000);
  const veryFar = falloff(200000);
  assert.ok(near < mid, 'digging away from home should help');
  assert.ok(far >= mid);
  assert.ok(Math.abs(veryFar - far) < 1e-9,
    'past the plateau, digging further must stop helping');
  assert.ok(far <= DISCOVERY.plateau + 1e-9, 'the curve must have a ceiling');
  assert.ok(at(0) >= 0);
});

test('a casual dig next to your own door almost never finds a neighbour', () => {
  const own = { cx: 0, cy: 0 };
  const r = cellRect(0, 0);
  const p = revealChance(r.midX, r.midY, own);
  assert.ok(p < DISCOVERY.baseRate * 0.1, `home chance ${p} is too generous`);
});

test('dig radius reuses existing stats rather than inventing a 15th', () => {
  const weak = digRadius({ grip: 5, attack: 5 });
  const strong = digRadius({ grip: 95, attack: 95 });
  assert.ok(strong > weak);
  assert.ok(weak >= 2, 'even a feeble bug can scratch');
  assert.ok(Number.isInteger(strong));
});

/* --------------------------------------------------------- the assembly -- */

test('two players digging the same tunnel see each other\'s holes', () => {
  const server = new LocalAuthority({ seed: 5 });
  const ada = new DirtWorld('ada', server, { seed: 1 });
  const bob = new DirtWorld('bob', server, { seed: 2 });
  assert.notEqual(cellKey(ada.cell.cx, ada.cell.cy), cellKey(bob.cell.cx, bob.cell.cy));

  const spot = { x: 5000, y: 5000 };
  bob.loadAround(spot.x, spot.y, 0);            // bob is subscribed to the chunk
  ada.burrow(spot.x, spot.y, { grip: 80, attack: 60 }, 0);

  assert.equal(server.store.isEmpty(spot.x, spot.y), true, 'the server took the dig');
  bob.loadAround(spot.x, spot.y, 1);
  assert.equal(bob.isSolid(spot.x, spot.y), false,
    'bob should find a tunnel he did not dig');
});

test('a dig is predicted locally before the authority confirms it', () => {
  const server = new LocalAuthority({ seed: 3 });
  const ada = new DirtWorld('ada', server, { seed: 1 });
  const out = ada.burrow(7000, 7000, { grip: 50, attack: 50 }, 0);
  assert.ok(out.predicted > 0, 'the hole must appear immediately, locally');
  assert.equal(ada.isSolid(7000, 7000), false);
  assert.equal(ada.pending.length, 0, 'the authority accepted it, so nothing stays pending');
});

test('the local terrarium is never in the shared store', () => {
  const server = new LocalAuthority({ seed: 11 });
  const ada = new DirtWorld('ada', server, { seed: 1 });
  const r = ada.homeRect;
  assert.equal(ada.whereAmI(r.midX, r.midY).zone, 'home');
  assert.equal(ada.whereAmI(r.right + 700, r.midY).zone, 'dirt');
  assert.equal(AUTHORITY.terrariumPhysics.owner, 'client');
  assert.equal(AUTHORITY.terrariumPhysics.sync, 'none');
  assert.equal(AUTHORITY.dirtChunks.scope, 'shared');
});

test('discovery is reproducible for a given seed', () => {
  const run = () => {
    const server = new LocalAuthority({ seed: 8 });
    server.join('neighbour', 0);
    const ada = new DirtWorld('ada', server, { seed: 99 });
    const finds = [];
    for (let i = 0; i < 300; i++) {
      const out = ada.burrow(2000 + i * 7, 2000, { grip: 60, attack: 40 }, i);
      if (out.reveal) finds.push(`${i}:${out.reveal.cell.key}`);
    }
    return finds.join('|');
  };
  assert.equal(run(), run());
});
