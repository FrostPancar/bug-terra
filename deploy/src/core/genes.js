// Genetics layer.
// A genome is a plain object of scalar genes. GENE_ORDER is the canonical
// vector order — crossover, serialization and any future GLB mapping all use it.

import { makeRng } from './rng.js';

/** @typedef {Record<string, number>} Genome */

export const GENE_SPECS = {
  leg_count:          { min: 4, max: 10, integer: true, step: 2 },
  leg_length:         { min: 0, max: 1 },
  leg_thickness:      { min: 0, max: 1 },
  leg_spread:         { min: 0, max: 1 },
  body_length:        { min: 0, max: 1 },
  body_width:         { min: 0, max: 1 },
  body_mass:          { min: 0, max: 1 },
  carapace_thickness: { min: 0, max: 1 },
  wing_area:          { min: 0, max: 1 },
  wing_beat:          { min: 0, max: 1 },
  mandible_size:      { min: 0, max: 1 },
  mandible_serration: { min: 0, max: 1 },
  antenna_length:     { min: 0, max: 1 },
  eye_size:           { min: 0, max: 1 },
  metabolism:         { min: 0, max: 1 },
  aggression:         { min: 0, max: 1 },
  hue:                { min: 0, max: 1, circular: true },
  saturation:         { min: 0, max: 1 },
  lightness:          { min: 0, max: 1 },
  pattern:            { min: 0, max: 1 },
};

export const GENE_ORDER = Object.keys(GENE_SPECS);

/** Force a gene value back into its legal range/quantisation. */
export function clampGene(name, value) {
  const spec = GENE_SPECS[name];
  if (!spec) throw new Error(`unknown gene: ${name}`);
  let v = value;
  if (spec.circular) {
    // hue wraps rather than clamps
    v = ((v - spec.min) % (spec.max - spec.min) + (spec.max - spec.min)) % (spec.max - spec.min) + spec.min;
  } else {
    v = Math.min(spec.max, Math.max(spec.min, v));
  }
  if (spec.integer) {
    const step = spec.step ?? 1;
    v = Math.round((v - spec.min) / step) * step + spec.min;
    v = Math.min(spec.max, Math.max(spec.min, v));
  }
  return v;
}

/** Sanitize an arbitrary object into a valid genome (missing genes get midpoints). */
export function normalizeGenome(partial = {}) {
  const g = {};
  for (const name of GENE_ORDER) {
    const spec = GENE_SPECS[name];
    const raw = partial[name] ?? (spec.min + spec.max) / 2;
    g[name] = clampGene(name, raw);
  }
  return g;
}

/** Uniformly random genome. */
export function randomGenome(rng = makeRng(Date.now())) {
  const g = {};
  for (const name of GENE_ORDER) {
    const spec = GENE_SPECS[name];
    g[name] = clampGene(name, rng.range(spec.min, spec.max));
  }
  return g;
}

export function toVector(genome) {
  return GENE_ORDER.map((k) => genome[k]);
}

export function fromVector(vec) {
  const g = {};
  GENE_ORDER.forEach((k, i) => { g[k] = clampGene(k, vec[i]); });
  return g;
}

/** Stable id for a genome — same genes always produce the same id. */
export function genomeId(genome) {
  const s = toVector(genome).map((v) => v.toFixed(4)).join(',');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(0, 7);
}

const SYLL_A = ['ka', 'mo', 'thi', 'ver', 'sar', 'lu', 'nyx', 'ob', 'gra', 'pel', 'zi', 'dre'];
const SYLL_B = ['dra', 'lith', 'mus', 'nex', 'phon', 'tarn', 'vex', 'wick', 'yar', 'zen'];

/** Deterministic pronounceable name from the genome id. */
export function genomeName(genome) {
  const id = genomeId(genome);
  // id is base36 and can exceed 2^31 — keep the arithmetic in float space so
  // bit ops can't wrap negative and index off the end of the syllable tables.
  const n = Math.abs(parseInt(id, 36)) || 1;
  const a = SYLL_A[Math.floor(n) % SYLL_A.length];
  const b = SYLL_B[Math.floor(n / 32) % SYLL_B.length];
  return (a + b).replace(/^./, (c) => c.toUpperCase());
}
