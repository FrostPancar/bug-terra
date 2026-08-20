// Default builds for the taxonomy.
//
// `classify()` reads a genome and names it. This goes the other way: given a
// taxon, produce a genome that classifies as it. That inverse is what a builder
// needs — "show me a Stag Beetle" — and it is not a search. A chassis is a set
// of gene windows down a path, so the build is: start from the archetype that
// is already closest, then push only the genes that miss their window.
//
// Still pure. Same taxon in, deep-equal genome out, every time.
//
// The honest part is what it reports back. Two things can go wrong and both are
// returned rather than hidden:
//
//   conflicts  a node whose window contradicts its parent's is UNREACHABLE.
//              Butterfly asks for setae ≤ 0.30 under a Moth that asks for
//              ≥ 0.75, so no genome is ever a Butterfly. The builder says so.
//   achieved   the snapped genome may satisfy a CHILD window too and classify
//              deeper than asked. That is the tree working correctly, so the
//              result reports where it actually landed.

import { GENE_SPECS, normalizeGenome, clampGene } from './genes.js';
import { CLASS_TREE, TAXON_IDS, matchesWindow, classify } from './classification.js';
import { ARCHETYPES, genomeFromArchetype } from './archetypes.js';
import { makeRng } from './rng.js';

const asRange = (r) => (typeof r === 'number' ? [r, r] : [r[0], r[1]]);

/** Root → node. */
export function pathTo(taxonId) {
  const path = [];
  let id = taxonId;
  while (id) {
    path.unshift(id);
    id = CLASS_TREE[id]?.parent ?? null;
  }
  return path;
}

/**
 * Every window down the path, intersected. A gene constrained twice keeps the
 * overlap; an empty overlap is a conflict and the taxon cannot be built.
 */
export function mergedWindow(taxonId) {
  const window = {};
  const conflicts = [];
  const sources = {};
  for (const id of pathTo(taxonId)) {
    const node = CLASS_TREE[id];
    if (!node) continue;
    for (const [gene, range] of Object.entries(node.window ?? {})) {
      const [lo, hi] = asRange(range);
      const prev = window[gene];
      if (!prev) {
        window[gene] = [lo, hi];
        sources[gene] = [{ id, taxon: node.taxon, range: [lo, hi] }];
        continue;
      }
      const next = [Math.max(prev[0], lo), Math.min(prev[1], hi)];
      sources[gene].push({ id, taxon: node.taxon, range: [lo, hi] });
      if (next[0] > next[1]) {
        conflicts.push({ gene, ranges: sources[gene].map((s) => ({ taxon: s.taxon, range: s.range })) });
        continue;                       // keep the tighter parent, report the clash
      }
      window[gene] = next;
    }
  }
  return { window, conflicts, sources };
}

const CLADE_LEGS = { hexapod: 6, arachnid: 8, myriapod: 10 };

/** Nearest legal value inside [lo,hi] for a gene, honouring integer steps. */
function snap(gene, value, lo, hi) {
  const spec = GENE_SPECS[gene];
  const loC = Math.max(lo, spec.min);
  const hiC = Math.min(hi, spec.max);
  if (value >= loC && value <= hiC) return clampGene(gene, value);
  if (spec.integer) {
    const step = spec.step ?? 1;
    // walk the legal values and take the closest one that lands in the window
    let best = null;
    for (let v = spec.min; v <= spec.max + 1e-9; v += step) {
      if (v < loC - 1e-9 || v > hiC + 1e-9) continue;
      if (best === null || Math.abs(v - value) < Math.abs(best - value)) best = v;
    }
    return clampGene(gene, best ?? (value < loC ? loC : hiC));
  }
  // Land in the middle of the window rather than on its edge: an edge value is
  // one breeding step from falling out of the taxon it was built for.
  return clampGene(gene, (loC + hiC) / 2);
}

/**
 * Push one gene of `window` outside it without leaving `keep` (the target's own
 * merged window) or moving a gene in `frozen`. Returns a patch, or null when
 * there is no room anywhere — which means the two windows genuinely overlap.
 */
function escapePatch(genome, window, keep, frozen) {
  for (const [gene, range] of Object.entries(window)) {
    if (frozen.has(gene)) continue;
    const spec = GENE_SPECS[gene];
    const [lo, hi] = asRange(range);
    const [klo, khi] = keep[gene] ? keep[gene] : [spec.min, spec.max];
    const step = spec.integer ? (spec.step ?? 1) : 0.04;
    const below = lo - step;
    if (below >= klo - 1e-9 && below >= spec.min - 1e-9) {
      const v = clampGene(gene, below);
      if (v < lo - 1e-9 && v >= klo - 1e-9) return { [gene]: v };
    }
    const above = hi + step;
    if (above <= khi + 1e-9 && above <= spec.max + 1e-9) {
      const v = clampGene(gene, above);
      if (v > hi + 1e-9 && v <= khi + 1e-9) return { [gene]: v };
    }
  }
  return null;
}

/**
 * The snapped genome often satisfies a CHILD or a SIBLING'S child too, and
 * `descend()` always takes the deepest match — so asking for a Wasp hands back a
 * Swift Flier. This walks the genome back out of those deeper windows one gene
 * at a time, never touching a gene the target itself constrains. When there is
 * no way out, it stops and the caller reports where it landed.
 */
function disambiguate(genome, taxonId, keep, frozen) {
  let g = genome;
  const tried = new Set();
  for (let i = 0; i < 12; i++) {
    const got = classify(g);
    if (got.id === taxonId) return g;
    // the deepest node on the achieved path that is not on the requested path
    const wanted = new Set(pathTo(taxonId));
    const extra = got.path.filter((id) => !wanted.has(id));
    if (!extra.length) return g;                 // shallower, not deeper — no fix here
    const nodeId = extra[extra.length - 1];
    if (tried.has(nodeId)) return g;
    const patch = escapePatch(g, CLASS_TREE[nodeId].window ?? {}, keep, frozen);
    if (!patch) { tried.add(nodeId); continue; }
    g = normalizeGenome({ ...g, ...patch });
  }
  return g;
}

/**
 * A genome for a taxon.
 * @returns {{ genome: object, base: string, window: object, conflicts: object[],
 *             satisfied: boolean, achieved: object, requested: string }}
 */
export function buildForTaxon(taxonId, { seed = 7 } = {}) {
  const node = CLASS_TREE[taxonId];
  if (!node) throw new Error(`unknown taxon: ${taxonId}`);
  const { window, conflicts, sources } = mergedWindow(taxonId);

  // Pick the archetype that already misses the fewest constraints — a Stag
  // Beetle built off the beetle plan looks like a beetle, one built off the
  // moth plan looks like a mistake.
  let base = null;
  let bestMiss = Infinity;
  for (const a of ARCHETYPES) {
    const g = genomeFromArchetype(a, makeRng(seed));
    let miss = 0;
    for (const [gene, [lo, hi]] of Object.entries(window)) {
      const spec = GENE_SPECS[gene];
      const span = (spec.max - spec.min) || 1;
      const v = g[gene];
      if (v < lo) miss += (lo - v) / span;
      else if (v > hi) miss += (v - hi) / span;
    }
    if (miss < bestMiss) { bestMiss = miss; base = { key: a.key, name: a.name, genome: g }; }
  }

  const g = { ...base.genome };

  // The clade is not part of any window — it is the leg bracket the chassis
  // natively sits in. Honour it unless a window says otherwise, or the build
  // comes out as a hybrid of itself.
  const legs = CLADE_LEGS[node.clade ?? ''] ?? null;
  if (legs && !window.leg_count) g.leg_count = legs;
  // Ten legs alone is not a myriapod to the renderer; it wants the segment count
  // too. (This used to nudge body_length — that gene no longer reaches the
  // renderer at all, so the nudge moved to the gene that decides the skeleton.)
  if (node.clade === 'myriapod' && !window.body_segments) g.body_segments = Math.max(g.body_segments, 8);
  if (node.clade === 'arachnid' && !window.body_segments) g.body_segments = Math.min(g.body_segments, 3);

  for (const [gene, [lo, hi]] of Object.entries(window)) g[gene] = snap(gene, g[gene], lo, hi);

  const frozen = new Set(Object.keys(window));
  if (legs && !window.leg_count) frozen.add('leg_count');       // the clade bracket holds
  const genome = disambiguate(normalizeGenome(g), taxonId, window, frozen);
  return {
    requested: taxonId,
    genome,
    base: base.key,
    baseName: base.name,
    window,
    sources,
    conflicts,
    satisfied: conflicts.length === 0 && matchesWindow(genome, window),
    achieved: classify(genome),
  };
}

/** Taxa grouped by tier, for a menu. Unreachable ones are flagged, not hidden. */
export const TAXON_MENU = TAXON_IDS.map((id) => {
  const node = CLASS_TREE[id];
  const { conflicts } = mergedWindow(id);
  return {
    id,
    taxon: node.taxon,
    tier: node.tier,
    order: node.order,
    parent: node.parent,
    clade: node.clade,
    blurb: node.blurb,
    status: node.status,
    unreachable: conflicts.length > 0,
    conflicts,
  };
});
