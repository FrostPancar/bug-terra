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

/**
 * Rank the population once; returns entries sorted best-first.
 *
 * `fitnessBonus` is the Mushroom Ring, and it is deliberately NOT a uniform
 * shift — a bonus every genome gets cancels out of a tournament and changes
 * nothing. `favoured` carries the indices of the bugs that were actually
 * standing in the ring, decided by the caller, which is the only thing that
 * knows where anything is.
 */
export function rank(population, preset = 'balanced', { fitnessBonus = 0, favoured = null } = {}) {
  return population
    .map((genome, index) => {
      const e = evaluate(genome, preset);
      const lifted = fitnessBonus && (!favoured || favoured.has(index));
      return { genome, index, ...e, fitness: lifted ? e.fitness * (1 + fitnessBonus) : e.fitness };
    })
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
    rate = 1,                // generational turnover: Hive 1.6, Cave 0.65
    fitnessBonus = 0,        // Mushroom Ring, applied only to `favoured`
    favoured = [],           // indices that were standing in the ring
    eligible = null,         // indices allowed to parent at all (Pollen Bloom)
    bypassSelection = false, // the Nest: this pair, no tournament
    pair = null,             // the two genomes the Nest bonded
  } = opts;

  const ranked = rank(population, preset, {
    fitnessBonus,
    favoured: favoured.length ? new Set(favoured) : null,
  });
  // Inverse selection preserves diversity by breeding what would otherwise be
  // discarded. Same tournament, reversed ordering — no special-cased path.
  const pool = selection === 'inverse' ? [...ranked].reverse() : ranked;
  const cross = CROSSOVERS[crossover] ?? blendCrossover;

  // The Pollen Bloom requires a trait; the Cave waives every requirement. The
  // caller decides who qualifies — it is the only thing that knows where each
  // bug is standing — and hands the indices down.
  const allow = eligible ? new Set(eligible) : null;
  const parents = allow ? pool.filter((e) => allow.has(e.index)) : pool;
  if (!parents.length) {
    // Refusing is the honest answer: a structure that gates breeding on a trait
    // nothing in the pool has should not quietly breed anyway.
    return {
      population: population.map((g) => ({ ...g })),
      report: { preset, refused: 'nothing in the pool can breed here', turnover: 0, diversity: geneDiversity(population) },
    };
  }

  // `rate` is generational turnover — how much of the pool a structure lets you
  // replace this generation. At 1 this is exactly the old behaviour. Below it,
  // part of the pool simply rides through unchanged (a slow cadence is fewer
  // new animals, not worse ones); above it, even the elites get bred out.
  const turnover = Math.max(0, Math.min(2, rate));
  const effElitism = Math.max(0, Math.round(elitism * (turnover > 1 ? 2 - turnover : 1)));
  const carried = Math.max(0, Math.round(size * (1 - Math.min(1, turnover))));

  const next = [];
  for (let i = 0; i < Math.min(effElitism, pool.length) && next.length < size; i++) {
    next.push({ ...pool[i].genome });
  }
  for (let i = 0; i < carried && next.length < size; i++) {
    next.push({ ...pool[(effElitism + i) % pool.length].genome });
  }
  for (let i = 0; i < immigrants && next.length < size; i++) {
    next.push(randomGenome(rng));
  }
  const bonded = bypassSelection && pair?.length === 2;
  while (next.length < size) {
    // The Nest bonds two chosen bugs: same crossover, same mutation, no
    // tournament in front of it.
    const a = bonded ? pair[0] : tournament(parents, rng, tournamentK);
    const b = bonded ? pair[1] : tournament(parents, rng, tournamentK);
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
      turnover,
      bonded,
      refused: null,
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
