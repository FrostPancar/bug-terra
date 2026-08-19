import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRng } from '../src/core/rng.js';
import { randomGenome, normalizeGenome, GENE_ORDER, GENE_SPECS, toVector, fromVector, genomeId } from '../src/core/genes.js';
import { computeStats, assertFinite, evaluate, FITNESS } from '../src/core/stats.js';
import { ARCHETYPES, genomeFromArchetype, seededPopulation, nearestArchetype } from '../src/core/archetypes.js';
import { breedGeneration, evolve, randomPopulation, geneDiversity, mutate, blendCrossover } from '../src/core/breeding.js';

test('rng is deterministic for a seed', () => {
  const a = Array.from({ length: 5 }, makeRng(7));
  const r1 = makeRng(7), r2 = makeRng(7);
  assert.deepEqual(Array.from({ length: 5 }, r1), Array.from({ length: 5 }, r2));
  assert.equal(a.length, 5);
});

test('random genomes are always in range and legal', () => {
  const rng = makeRng(3);
  for (let i = 0; i < 500; i++) {
    const g = randomGenome(rng);
    for (const k of GENE_ORDER) {
      const s = GENE_SPECS[k];
      assert.ok(g[k] >= s.min && g[k] <= s.max, `${k}=${g[k]} out of range`);
      if (s.integer) assert.equal(g[k] % (s.step ?? 1), s.min % (s.step ?? 1));
    }
    assert.equal(g.leg_count % 2, 0, 'leg_count must be even');
  }
});

test('out-of-range input is clamped, not accepted', () => {
  const g = normalizeGenome({ leg_length: 99, carapace_thickness: -4, leg_count: 33 });
  assert.equal(g.leg_length, 1);
  assert.equal(g.carapace_thickness, 0);
  assert.equal(g.leg_count, 10);
});

test('vector round-trip preserves the genome', () => {
  const g = randomGenome(makeRng(11));
  assert.deepEqual(fromVector(toVector(g)), g);
});

test('stats are pure: same genes -> identical stats, every time', () => {
  const g = randomGenome(makeRng(21));
  const a = computeStats(g);
  for (let i = 0; i < 50; i++) assert.deepEqual(computeStats(g), a);
});

test('stats are finite and bounded for any legal genome', () => {
  const rng = makeRng(5);
  for (let i = 0; i < 2000; i++) {
    const s = computeStats(randomGenome(rng));
    assertFinite(s);
    for (const k of ['speed', 'agility', 'defense', 'attack', 'health', 'stamina', 'camouflage']) {
      assert.ok(s[k] >= 0 && s[k] <= 100, `${k} = ${s[k]}`);
    }
    assert.ok(s.flight >= 0 && s.flight <= 100);
  }
});

test('every archetype produces a legal genome', () => {
  const rng = makeRng(19);
  for (const a of ARCHETYPES) {
    for (let i = 0; i < 60; i++) {
      const g = genomeFromArchetype(a, rng);
      for (const k of GENE_ORDER) {
        const spec = GENE_SPECS[k];
        assert.ok(g[k] >= spec.min && g[k] <= spec.max, `${a.key}.${k} = ${g[k]}`);
      }
      assertFinite(computeStats(g));
    }
  }
});

test('archetypes are actually distinguishable from each other', () => {
  const rng = makeRng(23);
  const profiles = ARCHETYPES.map((a) => computeStats(genomeFromArchetype(a, rng)));
  // every headline stat must vary meaningfully across the set
  for (const k of ['speed', 'defense', 'attack', 'flight', 'venom', 'camouflage', 'grip']) {
    const vs = profiles.map((p) => p[k]);
    assert.ok(Math.max(...vs) - Math.min(...vs) > 25,
      `${k} only spans ${Math.max(...vs) - Math.min(...vs)} across archetypes`);
  }
  // and no two archetypes should collapse onto the same profile
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const d = ['speed','defense','attack','flight','venom','camouflage']
        .reduce((acc, k) => acc + (profiles[i][k] - profiles[j][k]) ** 2, 0) ** 0.5;
      assert.ok(d > 20, `${ARCHETYPES[i].key} and ${ARCHETYPES[j].key} are near-identical (d=${d.toFixed(1)})`);
    }
  }
});

test('a seeded population is diverse and legal', () => {
  const pop = seededPopulation(16, makeRng(29));
  assert.equal(pop.length, 16);
  assert.ok(geneDiversity(pop) > 0.12, 'seeded pool is too uniform');
  for (const g of pop) {
    for (const k of GENE_ORDER) {
      const spec = GENE_SPECS[k];
      assert.ok(g[k] >= spec.min && g[k] <= spec.max);
    }
  }
});

test('a seeded pool beats a uniform-random pool on diversity', () => {
  const seeded = geneDiversity(seededPopulation(24, makeRng(31)));
  const uniform = geneDiversity(randomPopulation(24, makeRng(31)));
  assert.ok(seeded > uniform * 0.9,
    `seeded ${seeded.toFixed(3)} should be comparable to or better than uniform ${uniform.toFixed(3)}`);
});

test('nearestArchetype recovers the archetype it came from', () => {
  const rng = makeRng(37);
  let hits = 0, total = 0;
  for (const a of ARCHETYPES) {
    for (let i = 0; i < 25; i++) {
      const g = genomeFromArchetype(a, rng);
      if (nearestArchetype(g).archetype.key === a.key) hits++;
      total++;
    }
  }
  assert.ok(hits / total > 0.85, `only ${((hits / total) * 100).toFixed(0)}% classified back correctly`);
});

test('new genes drive their stats', () => {
  const base = normalizeGenome({});

  const noStinger = computeStats({ ...base, stinger_size: 0 });
  assert.equal(noStinger.venom, 0, 'no stinger must mean no venom');
  const stung = computeStats({ ...base, stinger_size: 0.9, tail_length: 0.8 });
  assert.ok(stung.venom > 50, 'a big stinger must deliver venom');

  const bare = computeStats({ ...base, spine_density: 0 });
  const spiky = computeStats({ ...base, spine_density: 1 });
  assert.ok(spiky.defense > bare.defense, 'spines must raise defense');

  const hornless = computeStats({ ...base, horn_size: 0 });
  const horned = computeStats({ ...base, horn_size: 1 });
  assert.ok(horned.attack > hornless.attack, 'a horn must raise attack');

  const smooth = computeStats({ ...base, claw_size: 0 });
  const clawed = computeStats({ ...base, claw_size: 1 });
  assert.ok(clawed.grip > smooth.grip, 'claws must raise grip');

  const twoEyes = computeStats({ ...base, eye_count: 2 });
  const eightEyes = computeStats({ ...base, eye_count: 8 });
  assert.ok(eightEyes.vision > twoEyes.vision, 'more eyes must widen vision');

  const wingless = computeStats({ ...base, wing_count: 0, wing_area: 0.9 });
  assert.equal(wingless.flight, 0, 'no wings must mean no flight');

  const shiny = computeStats({ ...base, iridescence: 1 });
  const dull = computeStats({ ...base, iridescence: 0 });
  assert.ok(dull.camouflage > shiny.camouflage, 'iridescence must cost camouflage');
});

test('stat formulas respond monotonically to their driving gene', () => {
  const base = normalizeGenome({});
  const thin = computeStats({ ...base, carapace_thickness: 0.05 });
  const thick = computeStats({ ...base, carapace_thickness: 0.95 });
  assert.ok(thick.defense > thin.defense, 'thicker carapace must raise defense');

  const small = computeStats({ ...base, mandible_size: 0.05 });
  const big = computeStats({ ...base, mandible_size: 0.95 });
  assert.ok(big.attack > small.attack, 'bigger mandibles must raise attack');
  assert.ok(big.attackRate < small.attackRate, 'bigger mandibles must swing slower');

  const stub = computeStats({ ...base, leg_length: 0.05 });
  const stilt = computeStats({ ...base, leg_length: 0.95 });
  assert.ok(stilt.speed > stub.speed, 'longer legs must raise speed');
});

test('flightless genomes report zero flight', () => {
  const g = normalizeGenome({ wing_area: 0 });
  assert.equal(computeStats(g).flight, 0);
});

test('crossover children stay legal', () => {
  const rng = makeRng(31);
  for (let i = 0; i < 300; i++) {
    const c = blendCrossover(randomGenome(rng), randomGenome(rng), rng);
    for (const k of GENE_ORDER) {
      const s = GENE_SPECS[k];
      assert.ok(c[k] >= s.min && c[k] <= s.max, `${k} escaped range`);
    }
  }
});

test('mutation stays legal and actually changes something', () => {
  const rng = makeRng(41);
  const g = randomGenome(rng);
  let changed = 0;
  for (let i = 0; i < 100; i++) {
    const m = mutate(g, rng, { rate: 0.5, scale: 0.2 });
    for (const k of GENE_ORDER) {
      const s = GENE_SPECS[k];
      assert.ok(m[k] >= s.min && m[k] <= s.max);
      if (m[k] !== g[k]) changed++;
    }
  }
  assert.ok(changed > 0, 'mutation never fired');
});

test('elitism means best fitness never regresses', () => {
  for (const preset of Object.keys(FITNESS)) {
    let pop = randomPopulation(20, makeRng(9));
    const rng = makeRng(77);
    let prevBest = -Infinity;
    for (let i = 0; i < 25; i++) {
      const step = breedGeneration(pop, { preset, rng, elitism: 2, immigrants: 0 });
      const best = step.report.best;
      assert.ok(best >= prevBest - 1e-9, `${preset}: best fell ${prevBest} -> ${best}`);
      prevBest = best;
      pop = step.population;
    }
  }
});

test('selection improves mean fitness over 40 generations', () => {
  const pop0 = randomPopulation(24, makeRng(13));
  const before = pop0.reduce((a, g) => a + evaluate(g, 'brawler').fitness, 0) / pop0.length;
  const { population } = evolve(pop0, 40, { preset: 'brawler', rng: makeRng(2), immigrants: 1 });
  const after = population.reduce((a, g) => a + evaluate(g, 'brawler').fitness, 0) / population.length;
  assert.ok(after > before * 1.15, `mean fitness ${before} -> ${after}`);
});

test('evolution is reproducible from a seed', () => {
  const run = () => evolve(randomPopulation(16, makeRng(4)), 12,
    { preset: 'sprinter', rng: makeRng(1234) }).population.map(genomeId);
  assert.deepEqual(run(), run());
});

test('immigrants keep the population from collapsing to clones', () => {
  const { population } = evolve(randomPopulation(20, makeRng(6)), 60,
    { preset: 'tank', rng: makeRng(5), immigrants: 2 });
  assert.ok(geneDiversity(population) > 0.02, 'population collapsed');
});
