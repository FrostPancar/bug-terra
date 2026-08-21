import test from 'node:test';
import assert from 'node:assert/strict';

import { GENE_SPECS, GENE_ORDER, randomGenome, normalizeGenome } from '../src/core/genes.js';
import { ARCHETYPES, genomeFromArchetype } from '../src/core/archetypes.js';
import { makeRng } from '../src/core/rng.js';
import { computeStats } from '../src/core/stats.js';
import {
  CLASS_TREE, TAXON_IDS, TRAITS, classify, cladeOf, matchesWindow,
  windowedGenes, applySpecialties, breedingMask, nearestNodes, childrenOf,
} from '../src/core/classification.js';

/* -------------------------------------------------------------- integrity */

test('every window references a real gene', () => {
  for (const gene of windowedGenes()) {
    assert.ok(GENE_SPECS[gene], `window references unknown gene: ${gene}`);
  }
});

test('every window range sits inside its gene range', () => {
  for (const id of TAXON_IDS) {
    for (const [gene, range] of Object.entries(CLASS_TREE[id].window)) {
      const spec = GENE_SPECS[gene];
      const [lo, hi] = typeof range === 'number' ? [range, range] : range;
      assert.ok(lo >= spec.min && hi <= spec.max,
        `${id}.${gene} window [${lo},${hi}] escapes gene range [${spec.min},${spec.max}]`);
      assert.ok(lo <= hi, `${id}.${gene} window is inverted`);
    }
  }
});

test('every node has a reachable parent and the tree has no cycles', () => {
  for (const id of TAXON_IDS) {
    const node = CLASS_TREE[id];
    if (id === 'larva') { assert.equal(node.parent, null); continue; }
    assert.ok(CLASS_TREE[node.parent], `${id} has unknown parent ${node.parent}`);
    let hops = 0;
    let cur = node.parent;
    while (cur) { cur = CLASS_TREE[cur].parent; if (++hops > 16) break; }
    assert.ok(hops <= 16, `${id} does not terminate at the root`);
  }
});

test('a child is always at least one tier below its parent', () => {
  for (const id of TAXON_IDS) {
    const node = CLASS_TREE[id];
    if (!node.parent) continue;
    assert.ok(node.tier > CLASS_TREE[node.parent].tier,
      `${id} (tier ${node.tier}) is not below ${node.parent}`);
  }
});

/* ------------------------------------------------------------- the rules */

test('classification is a PURE function of genes', () => {
  const rng = makeRng(4242);
  for (let i = 0; i < 25; i++) {
    const g = randomGenome(rng);
    const first = JSON.stringify(classify(g));
    for (let k = 0; k < 20; k++) {
      assert.equal(JSON.stringify(classify(g)), first,
        'classify() returned a different answer for the same genome');
    }
  }
});

test('classification is total — any legal genome lands somewhere', () => {
  const rng = makeRng(99);
  for (let i = 0; i < 400; i++) {
    const c = classify(randomGenome(rng));
    assert.ok(CLASS_TREE[c.id], 'classified to a node that does not exist');
    assert.equal(c.path[0], 'larva');
    assert.ok(typeof c.name === 'string' && c.name.length > 0);
    assert.ok(['hexapod', 'arachnid', 'myriapod'].includes(c.clade.legPlan));
  }
});

test('clade brackets are total and mutually exclusive', () => {
  const rng = makeRng(7);
  for (let i = 0; i < 300; i++) {
    const g = randomGenome(rng);
    const c = cladeOf(g);
    assert.equal(c.legPlan, g.leg_count <= 6 ? 'hexapod' : g.leg_count === 8 ? 'arachnid' : 'myriapod');
    assert.equal(c.wingPlan, g.wing_count === 0 ? 'apterous' : g.wing_count === 2 ? 'dipterous' : 'tetrapterous');
    if (g.stinger_size < 0.08) assert.equal(c.venomClass, 'none');
  }
});

test('the path is genuinely a chain of parents', () => {
  const rng = makeRng(31);
  for (let i = 0; i < 200; i++) {
    const c = classify(randomGenome(rng));
    for (let k = 1; k < c.path.length; k++) {
      assert.equal(CLASS_TREE[c.path[k]].parent, c.path[k - 1],
        `${c.path[k]} is not a child of ${c.path[k - 1]}`);
    }
  }
});

test('a matched node really does match its own window', () => {
  const rng = makeRng(555);
  for (let i = 0; i < 250; i++) {
    const g = randomGenome(rng);
    const c = classify(g);
    for (const id of c.path) {
      assert.ok(matchesWindow(g, CLASS_TREE[id].window),
        `classified as ${id} without satisfying its window`);
    }
  }
});

/* -------------------------------------------------------- the archetypes */

test('each archetype classifies to the taxon it was drawn for', () => {
  const expected = {
    beetle: 'beetle', wasp: 'wasp', spider: 'spider', roach: 'roach',
    mantis: 'mantis', moth: 'moth', centipede: 'centipede', weevil: 'weevil',
  };
  // ONE RNG PER ARCHETYPE, and more draws than before. A single stream shared
  // across all eight made every archetype's sample depend on how many numbers
  // the archetypes before it happened to consume, so adding or removing a gene
  // anywhere reshuffled all eight samples and this test failed for reasons that
  // had nothing to do with classification. Per-archetype seeds make each row
  // independent, and 200 draws puts the sampling error well inside the margin
  // the 0.6 bar leaves — measured rates sit at 0.61–0.92 across seeds.
  for (const a of ARCHETYPES) {
    const rng = makeRng(2024);
    let hits = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      const c = classify(genomeFromArchetype(a, rng));
      if (c.path.includes(expected[a.key])) hits++;
    }
    // Jitter is meant to push some draws off the node entirely — that is the
    // GA having somewhere to go. A clear majority is the bar, not all of them.
    assert.ok(hits / n >= 0.6,
      `${a.key} only landed on ${expected[a.key]} ${hits}/${n} times`);
  }
});

/* ------------------------------------------------------------ the wall -- */

test('Beetle and Moth constrain wing_area in opposite directions', () => {
  const beetle = CLASS_TREE.beetle.window.wing_area;
  const moth = CLASS_TREE.moth.window.wing_area;
  assert.ok(beetle && moth, 'both need a wing_area constraint for the wall to exist');
  assert.ok(beetle[1] < moth[0],
    'Beetle\'s ceiling must sit below Moth\'s floor or the jump is one hop');
});

test('no genome can be both Beetle and Moth', () => {
  const rng = makeRng(818);
  for (let i = 0; i < 500; i++) {
    const g = randomGenome(rng);
    const both = matchesWindow(g, CLASS_TREE.beetle.window)
              && matchesWindow(g, CLASS_TREE.moth.window);
    assert.equal(both, false, 'a genome satisfied both windows at once');
  }
});

test('crossing from Beetle to Moth requires passing through neither', () => {
  // Walk wing_area up from a Beetle to a Moth and confirm there is a stretch
  // in between that satisfies no chassis on that line — the metamorphosis gap.
  const beetleish = normalizeGenome({
    body_mass: 0.8, horn_size: 0.7, leg_length: 0.3, wing_area: 0.2,
    setae: 0.8, mandible_size: 0.1,
  });
  assert.ok(matchesWindow(beetleish, CLASS_TREE.beetle.window));
  let sawGap = false;
  for (let w = 0.36; w < 0.85; w += 0.02) {
    const g = { ...beetleish, wing_area: w };
    if (!matchesWindow(g, CLASS_TREE.beetle.window)
     && !matchesWindow(g, CLASS_TREE.moth.window)) sawGap = true;
  }
  assert.ok(sawGap, 'there is no gene-space gap between Beetle and Moth');
});

/* ------------------------------------------------------------- hybrids -- */

test('breeding a Beetle up to eight legs makes an Armoured Arachnid, not a Spider', () => {
  const beetle = normalizeGenome({
    body_mass: 0.85, horn_size: 0.7, leg_length: 0.3, wing_area: 0.2,
    leg_count: 6, eye_count: 2, wing_count: 2,
  });
  const before = classify(beetle);
  assert.ok(before.path.includes('beetle'));
  assert.equal(before.hybrid, false);

  const eight = normalizeGenome({ ...beetle, leg_count: 8 });
  const after = classify(eight);
  assert.equal(after.hybrid, true, 'eight-legged beetle should read as a hybrid');
  assert.ok(after.path.includes('beetle'), 'it keeps the beetle chassis');
  assert.equal(after.clade.legPlan, 'arachnid');
  assert.match(after.name, /Arachnid/);
  assert.notEqual(after.name, 'Spider');
});

/* ------------------------------------------------------- traits & mods -- */

test('traits are flat and stack independently of the chassis', () => {
  const g = normalizeGenome({
    stinger_size: 0.8, tail_length: 0.7,       // venomous
    saturation: 0.1, translucency: 0.8,        // camouflaged
    leg_count: 6, wing_count: 0,
  });
  const c = classify(g);
  assert.ok(c.traits.includes('venomous'));
  assert.ok(c.traits.includes('camouflaged'));
});

test('the Winged trait only fires on chassis that normally stay down', () => {
  assert.ok(TRAITS.winged.appliesTo.includes('beetle'));
  assert.ok(!TRAITS.winged.appliesTo.includes('wasp'),
    'a winged wasp is not a remarkable fact about a wasp');
});

test('specialties multiply stats without ever touching genes', () => {
  const g = normalizeGenome({
    body_mass: 0.95, spikyness: 0.6, leg_thickness: 0.7,
    horn_size: 0.9, leg_length: 0.3, wing_area: 0.1, leg_count: 6,
  });
  const frozen = JSON.stringify(g);
  const c = classify(g);
  const base = computeStats(g);
  const buffed = applySpecialties(base, c);
  assert.equal(JSON.stringify(g), frozen, 'applySpecialties mutated the genome');
  assert.ok(c.specialties.length > 0, 'expected an armoured line to carry a specialty');
  assert.ok(buffed.defense >= base.defense);
  for (const k of Object.keys(base)) assert.ok(Number.isFinite(buffed[k]));
});

test('a tier-3 specialty replaces its parent rather than stacking', () => {
  const siege = normalizeGenome({
    body_mass: 1, horn_size: 0.95, horn_type: 0, leg_count: 6,
    spikyness: 0.8, leg_thickness: 0.8, leg_length: 0.2, wing_area: 0.1,
  });
  const c = classify(siege);
  assert.equal(c.id, 'siege_tank_rhinoceros');
  assert.equal(c.specialties.length, 1, 'Siege Plating should not stack on Armour Plating');
  assert.equal(c.specialties[0].key, 'siege_plating');
});

/* ------------------------------------------------------------ plumbing -- */

test('breedingMask returns plain gene names that actually exist', () => {
  const rng = makeRng(12);
  for (let i = 0; i < 60; i++) {
    const m = breedingMask(classify(randomGenome(rng)));
    for (const g of [...m.locked, ...m.unlocked]) {
      assert.ok(GENE_ORDER.includes(g), `mask names a non-gene: ${g}`);
    }
  }
});

test('nearestNodes never suggests something already reached', () => {
  const rng = makeRng(64);
  for (let i = 0; i < 40; i++) {
    const g = randomGenome(rng);
    const c = classify(g);
    for (const n of nearestNodes(g)) {
      assert.ok(!c.path.includes(n.id), `suggested ${n.id}, which it already is`);
    }
  }
});

test('bracket nodes are pure leg_count brackets with no authored window', () => {
  for (const id of ['arachnid', 'myriapod']) {
    assert.deepEqual(CLASS_TREE[id].window, {},
      `${id} should be a bracket, not a hand-authored window`);
    assert.ok(CLASS_TREE[id].bracketNode);
    assert.ok(childrenOf(id).length > 0, `${id} bracket has nothing under it`);
  }
});
