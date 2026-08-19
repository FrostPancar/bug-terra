// Breeding layer — a plain genetic algorithm over gene vectors.
// No neural nets, no simulation-derived fitness: selection reads the stat layer.

import { GENE_ORDER, GENE_SPECS, clampGene, randomGenome, normalizeGenome } from './genes.js';
import { evaluate } from './stats.js';
import { makeRng } from './rng.js';

/* ---------------------------------------------------------- crossover ---- */

/** Each gene taken from either parent, 50/50. */
export function uniformCrossover(a, b, rng) {
  const child = {};
  for (const k of GENE_ORDER) child[k] = rng() < 0.5 ? a[k] : b[k];
  return normalizeGenome(child);
}

/** Single cut point in the canonical vector order. */
export function onePointCrossover(a, b, rng) {
  const cut = rng.int(1, GENE_ORDER.length - 1);
  const child = {};
  GENE_ORDER.forEach((k, i) => { child[k] = i < cut ? a[k] : b[k]; });
  return normalizeGenome(child);
}

/** Blend (BLX-alpha): children may sit slightly outside the parents' interval. */
export function blendCrossover(a, b, rng, alpha = 0.25) {
  const child = {};
  for (const k of GENE_ORDER) {
    const spec = GENE_SPECS[k];
    if (spec.integer) { child[k] = rng() < 0.5 ? a[k] : b[k]; continue; }
    const lo = Math.min(a[k], b[k]);
    const hi = Math.max(a[k], b[k]);
    const d = (hi - lo) * alpha;
    child[k] = clampGene(k, rng.range(lo - d, hi + d));
  }
  return normalizeGenome(child);
}

export const CROSSOVERS = { uniform: uniformCrossover, onePoint: onePointCrossover, blend: blendCrossover };

/* ----------------------------------------------------------- mutation ---- */

/**
 * Gaussian creep. `rate` is per-gene probability, `scale` is sigma as a
 * fraction of each gene's full range.
 */
export function mutate(genome, rng, { rate = 0.12, scale = 0.10, locked = [], unlocked = [] } = {}) {
  const out = { ...genome };
  const lock = new Set(locked);
  const loose = new Set(unlocked);
  for (const k of GENE_ORDER) {
    // A locked gene is what a lineage has committed to. Classification hands
    // these down (see core/classification.js) and the Prism Chamber adds to
    // them; either way the gene rides through breeding untouched.
    if (lock.has(k)) continue;
    if (rng() >= (loose.has(k) ? rate * 1.8 : rate)) continue;
    const spec = GENE_SPECS[k];
    const span = spec.max - spec.min;
    const step = spec.integer ? (spec.step ?? 1) * (rng() < 0.5 ? -1 : 1)
                              : rng.normal() * span * scale;
    out[k] = clampGene(k, out[k] + step);
  }
  return out;
}

/* ---------------------------------------------------------- selection ---- */

/** Rank the population once; returns entries sorted best-first. */
export function rank(population, preset = 'balanced') {
  return population
    .map((genome, index) => ({ genome, index, ...evaluate(genome, preset) }))
    .sort((x, y) => y.fitness - x.fitness);
}

/** Tournament selection: sample k, take the best. Low k = more diversity. */
export function tournament(ranked, rng, k = 3) {
  let best = null;
  for (let i = 0; i < k; i++) {
    const pick = ranked[rng.int(0, ranked.length - 1)];
    if (!best || pick.fitness > best.fitness) best = pick;
  }
  return best.genome;
}

/** Fitness-proportionate selection over shifted-positive fitness. */
export function roulette(ranked, rng) {
  const min = ranked[ranked.length - 1].fitness;
  const shifted = ranked.map((e) => e.fitness - min + 1e-6);
  const total = shifted.reduce((a, b) => a + b, 0);
  let t = rng() * total;
  for (let i = 0; i < ranked.length; i++) {
    t -= shifted[i];
    if (t <= 0) return ranked[i].genome;
  }
  return ranked[0].genome;
}

/* ------------------------------------------------------------ the loop --- */

export function randomPopulation(size, rng = makeRng(1)) {
  return Array.from({ length: size }, () => randomGenome(rng));
}

/**
 * One generation. Returns the new population plus a stats record for the HUD.
 * @param {object[]} population
 * @param {object} opts
 */
export function breedGeneration(population, opts = {}) {
  const {
    preset = 'balanced',
    rng = makeRng(1),
    elitism = 2,
    crossover = 'blend',
    tournamentK = 3,
    mutationRate = 0.12,
    mutationScale = 0.10,
    immigrants = 1,          // fresh random genomes per generation, keeps diversity up
    size = population.length,
    // Terrarium objects feed these in at breed time (see sim/objects.js). None
    // of them writes a gene — they only change how the next draw is taken.
    selection = null,        // 'inverse' = the Compost Heap: breed from the worst
    locked = [],             // genes held steady (classification locks, Prism Chamber)
    unlocked = [],           // genes that mutate harder (classification unlocks)
  } = opts;

  const ranked = rank(population, preset);
  // Inverse selection preserves diversity by breeding what would otherwise be
  // discarded. Same tournament, reversed ordering — no special-cased path.
  const pool = selection === 'inverse' ? [...ranked].reverse() : ranked;
  const cross = CROSSOVERS[crossover] ?? blendCrossover;
  const next = [];

  for (let i = 0; i < Math.min(elitism, pool.length) && next.length < size; i++) {
    next.push({ ...pool[i].genome });
  }
  for (let i = 0; i < immigrants && next.length < size; i++) {
    next.push(randomGenome(rng));
  }
  while (next.length < size) {
    const a = tournament(pool, rng, tournamentK);
    const b = tournament(pool, rng, tournamentK);
    next.push(mutate(cross(a, b, rng), rng, {
      rate: mutationRate, scale: mutationScale, locked, unlocked,
    }));
  }

  const fits = ranked.map((e) => e.fitness);
  return {
    population: next,
    report: {
      preset,
      best: fits[0],
      worst: fits[fits.length - 1],
      mean: fits.reduce((a, b) => a + b, 0) / fits.length,
      bestGenome: ranked[0].genome,
      bestStats: ranked[0].stats,
      diversity: geneDiversity(population),
    },
  };
}

/** Mean per-gene standard deviation, normalized by gene range. 0 = clones. */
export function geneDiversity(population) {
  if (population.length < 2) return 0;
  let acc = 0;
  for (const k of GENE_ORDER) {
    const spec = GENE_SPECS[k];
    const span = spec.max - spec.min || 1;
    const vals = population.map((g) => g[k]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const varr = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    acc += Math.sqrt(varr) / span;
  }
  return acc / GENE_ORDER.length;
}

/** Run N generations headlessly — used by tests and by the "fast-forward" button. */
export function evolve(population, generations, opts = {}) {
  let pop = population;
  const history = [];
  for (let i = 0; i < generations; i++) {
    const step = breedGeneration(pop, opts);
    pop = step.population;
    history.push(step.report);
  }
  return { population: pop, history };
}
