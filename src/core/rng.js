// Seeded, deterministic RNG. Everything stochastic in the sim goes through this
// so a run can be reproduced exactly from its seed.

/** mulberry32 — small, fast, good enough for gameplay. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.int = (lo, hi) => Math.floor(rng.range(lo, hi + 1));
  rng.pick = (arr) => arr[rng.int(0, arr.length - 1)];
  // The whole generator IS `a`, so `makeRng(rng.state())` resumes the exact
  // same stream. That is what lets a saved run reload without the sequence
  // silently restarting from the seed.
  rng.state = () => a;
  // Box-Muller, unit normal.
  rng.normal = () => {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return rng;
}

/** Deterministic 32-bit hash of a string — for turning a name into a seed. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
