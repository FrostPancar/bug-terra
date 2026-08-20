import test from 'node:test';
import assert from 'node:assert/strict';

import { GENE_SPECS, GENE_ORDER, normalizeGenome, randomGenome } from '../src/core/genes.js';
import { makeRng } from '../src/core/rng.js';
import { classify, CLASS_TREE } from '../src/core/classification.js';
import { buildForTaxon, TAXON_MENU, mergedWindow } from '../src/core/taxonBuild.js';
import { drawBug } from '../src/render/bugArt.js';
import {
  PARTS, PART_IDS, PART_GROUPS, GENE_INFO, SIM_ONLY, partById, isPresent,
  addPart, removePart, setVariant, variantOf, isSimOnly,
} from '../src/render/partLibrary.js';

/* ------------------------------------------------------------ a fake ctx -- */

/**
 * drawBug() only ever talks to a 2D context, so a recorder standing in for one
 * turns "does this gene change the sprite" into a string comparison. Property
 * writes are recorded too — `pattern` changes nothing but fill colours.
 */
function trace(genome, opts = {}) {
  const log = [];
  const gradient = { addColorStop: (o, c) => log.push(`stop ${o} ${c}`) };
  const methods = {
    save: 0, restore: 0, beginPath: 0, closePath: 0, fill: 0, stroke: 0, clip: 0,
    translate: 0, rotate: 0, scale: 0, moveTo: 0, lineTo: 0, quadraticCurveTo: 0,
    arc: 0, ellipse: 0, fillRect: 0, setTransform: 0, clearRect: 0,
  };
  const target = {};
  for (const name of Object.keys(methods)) {
    target[name] = (...args) => log.push(`${name}(${args.map((a) =>
      typeof a === 'number' ? a.toFixed(3) : String(a)).join(',')})`);
  }
  target.createRadialGradient = (...args) => {
    log.push(`grad(${args.map((a) => a.toFixed(2)).join(',')})`);
    return gradient;
  };
  const ctx = new Proxy(target, {
    set(o, k, v) { log.push(`${String(k)}=${String(v)}`); o[k] = v; return true; },
  });
  drawBug(ctx, genome, opts);
  return log.join('\n');
}

const BASE = normalizeGenome({
  body_length: 0.42, body_width: 0.60, head_size: 0.62, leg_count: 6,
  leg_length: 0.55, leg_thickness: 0.55, claw_size: 0.2, wing_count: 0,
  wing_area: 0, horn_size: 0, mandible_size: 0.4, tail_length: 0, stinger_size: 0,
  eye_count: 2, eye_size: 0.8, antenna_length: 0, setae: 0, iridescence: 0,
  hue: 0.015, saturation: 0.55, lightness: 0.55, pattern: 0.2, spine_density: 0,
});

/* ------------------------------------------------------------- the wiring -- */

test('every gene a part names actually exists', () => {
  for (const part of PARTS) {
    for (const entry of part.genes) {
      assert.ok(GENE_SPECS[entry.gene], `${part.id} names an unknown gene: ${entry.gene}`);
      assert.ok(entry.effect?.length > 3, `${part.id}.${entry.gene} has no effect line`);
    }
    assert.ok(PART_GROUPS.some((g) => g.key === part.group), `${part.id} is in no group`);
  }
});

test('all 41 genes are accounted for — a part, a sim note, or both', () => {
  for (const gene of GENE_ORDER) {
    const row = GENE_INFO[gene];
    assert.ok(row, `${gene} is missing from GENE_INFO`);
    assert.ok(row.parts.length || row.simOnly,
      `${gene} claims neither a part nor a reason for existing`);
  }
  for (const gene of Object.keys(SIM_ONLY)) {
    assert.ok(GENE_SPECS[gene], `SIM_ONLY names an unknown gene: ${gene}`);
  }
});

test('part ids are unique', () => {
  assert.equal(new Set(PART_IDS).size, PART_IDS.length);
});

/* --------------------------------------------------------- add and remove -- */

test('tap-to-add turns a part on, and removing turns it back off', () => {
  for (const part of PARTS.filter((p) => !p.core)) {
    const on = addPart(BASE, part.id);
    assert.ok(isPresent(part, on), `addPart('${part.id}') did not satisfy its own gate`);
    const off = removePart(on, part.id);
    assert.ok(!isPresent(part, off), `removePart('${part.id}') left it present`);
  }
});

test('adding a part never produces an illegal genome', () => {
  const rng = makeRng(5);
  for (let i = 0; i < 40; i++) {
    let g = randomGenome(rng);
    for (const id of PART_IDS) g = addPart(g, id);
    for (const gene of GENE_ORDER) {
      const spec = GENE_SPECS[gene];
      assert.ok(g[gene] >= spec.min && g[gene] <= spec.max, `${gene} escaped its range`);
    }
  }
});

/* ------------------------------------------------- the gates are the truth -- */

test('every drawn part changes the sprite at the threshold this file claims', () => {
  for (const part of PARTS.filter((p) => !p.core && p.art !== false)) {
    const on = trace(addPart(BASE, part.id));
    const off = trace(removePart(BASE, part.id));
    assert.notEqual(on, off, `'${part.id}' says it is drawn, but the canvas calls are identical`);
  }
});

test('a part marked "stats only" really does draw nothing', () => {
  for (const part of PARTS.filter((p) => p.art === false)) {
    assert.equal(trace(addPart(BASE, part.id)), trace(removePart(BASE, part.id)),
      `'${part.id}' is marked stats-only but changes the sprite`);
  }
});

test('every variant of every part draws differently from its neighbours', () => {
  for (const part of PARTS.filter((p) => p.variants)) {
    const seen = new Map();
    for (const v of part.variants) {
      let g = setVariant(BASE, part.id, v.index);
      if (!isPresent(part, g)) g = addPart(g, part.id);
      assert.equal(variantOf(part, g), v.index, `${part.id} did not hold variant ${v.name}`);
      const key = trace(g);
      const clash = seen.get(key);
      assert.equal(clash, undefined,
        `${part.id}: '${v.name}' renders identically to '${clash}'`);
      seen.set(key, v.name);
    }
  }
});

test('genes with no art leave the sprite alone across their whole range', () => {
  for (const gene of GENE_ORDER.filter(isSimOnly)) {
    const spec = GENE_SPECS[gene];
    const lo = trace(normalizeGenome({ ...BASE, [gene]: spec.min }));
    const hi = trace(normalizeGenome({ ...BASE, [gene]: spec.max }));
    assert.equal(lo, hi, `${gene} is marked stats-only but moves the renderer`);
  }
});

/* --------------------------------------------------------- default builds -- */

test('every reachable taxon builds a genome that classifies as itself', () => {
  for (const t of TAXON_MENU) {
    const built = buildForTaxon(t.id);
    if (t.unreachable) {
      assert.ok(built.conflicts.length, `${t.id} is flagged unreachable with no conflict to show`);
      continue;
    }
    assert.equal(built.achieved.id, t.id,
      `${t.id} built a ${built.achieved.id} instead`);
  }
});

test('a taxon build is deterministic', () => {
  for (const t of TAXON_MENU) {
    assert.deepEqual(buildForTaxon(t.id).genome, buildForTaxon(t.id).genome);
  }
});

test('a conflict is a genuine contradiction, not a reporting artefact', () => {
  for (const t of TAXON_MENU.filter((x) => x.unreachable)) {
    const { conflicts } = mergedWindow(t.id);
    for (const c of conflicts) {
      const [a, b] = c.ranges.slice(-2);
      assert.ok(a.range[1] < b.range[0] || b.range[1] < a.range[0],
        `${t.id}: ${c.gene} ranges ${JSON.stringify(a.range)} and ${JSON.stringify(b.range)} do overlap`);
    }
    assert.ok(CLASS_TREE[t.id].parent, `${t.id} has no parent to conflict with`);
  }
});

test('a built genome is a legal genome', () => {
  for (const t of TAXON_MENU) {
    const g = buildForTaxon(t.id).genome;
    assert.deepEqual(normalizeGenome(g), g);
    assert.equal(typeof classify(g).name, 'string');
  }
});
