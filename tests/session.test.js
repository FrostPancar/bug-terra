// The session layer: persistence, the training channel, and the breeding
// modifiers that terrarium objects feed in at breed time.
//
// These cover the four things that were specified in the docs but not wired:
// a run that survives a reload, `Knowledge.trained()` having a caller, the
// seven breeding fields that used to be computed and discarded, and lineage
// locks applying without needing a Prism Chamber that cannot be placed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRng } from '../src/core/rng.js';
import { randomGenome, normalizeGenome, GENE_ORDER } from '../src/core/genes.js';
import { breedGeneration, randomPopulation, rank, mutate } from '../src/core/breeding.js';
import { placeObject, trainerAt, breedingModifiers } from '../src/sim/objects.js';
import { Knowledge, CHANNEL_COST } from '../src/sim/knowledge.js';
import { allImpressions } from '../src/core/impressions.js';

/* ------------------------------------------------- a fake localStorage --- */

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get size() { return map.size; },
  };
}

async function withStorage(store, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const prev = globalThis.localStorage;
  globalThis.localStorage = store;
  try {
    // Fresh import each time so `canPersist()` re-probes the storage we just
    // installed rather than a cached answer.
    const mod = await import(`../src/sim/save.js?t=${store === null ? 'none' : Math.random()}`);
    return await fn(mod);
  } finally {
    if (had) globalThis.localStorage = prev;
    else delete globalThis.localStorage;
  }
}

/* --------------------------------------------------------- persistence --- */

test('a run round-trips through storage', async () => {
  const store = fakeStorage();
  await withStorage(store, ({ writeSave, loadSave }) => {
    const rng = makeRng(9);
    const state = {
      seed: 4242,
      rngState: 991,
      generation: 7,
      preset: 'brawler',
      popSize: 9,
      clock: 123.5,
      population: [randomGenome(rng), randomGenome(rng)],
      knowledge: { abc: { id: 'abc', exposure: { watch: 40, combat: 2, training: 1, vet: 0 } } },
    };
    assert.equal(writeSave(state), true);
    const back = loadSave();
    assert.equal(back.seed, 4242);
    assert.equal(back.generation, 7);
    assert.equal(back.preset, 'brawler');
    assert.equal(back.rngState, 991);
    assert.equal(back.population.length, 2);
    assert.deepEqual(back.population[0], state.population[0]);
    assert.equal(back.knowledge.abc.exposure.watch, 40);
  });
});

test('a corrupt save starts a fresh terrarium instead of crashing into one', async () => {
  const store = fakeStorage();
  await withStorage(store, ({ SAVE_KEY, loadSave }) => {
    store.setItem(SAVE_KEY, '{not json at all');
    assert.equal(loadSave(), null);
    // and it clears itself, so the next load isn't the same failure again
    assert.equal(store.getItem(SAVE_KEY), null);
  });
});

test('a save from another version is ignored', async () => {
  const store = fakeStorage();
  await withStorage(store, ({ SAVE_KEY, loadSave }) => {
    store.setItem(SAVE_KEY, JSON.stringify({ version: 999, population: [{}] }));
    assert.equal(loadSave(), null);
  });
});

test('no storage is a supported state, not an error', async () => {
  await withStorage(undefined, ({ canPersist, writeSave, loadSave }) => {
    assert.equal(canPersist(), false);
    assert.equal(writeSave({ seed: 1 }), false);
    assert.equal(loadSave(), null);
  });
});

test('the rng resumes the exact stream it was saved at', () => {
  const a = makeRng(1337);
  for (let i = 0; i < 25; i++) a();
  const resumed = makeRng(a.state());
  const expected = Array.from({ length: 10 }, () => a());
  const actual = Array.from({ length: 10 }, () => resumed());
  assert.deepEqual(actual, expected);
});

test('a restored genome is re-validated, so a hand-edited save cannot smuggle one in', () => {
  const bad = { ...randomGenome(makeRng(3)), leg_count: 99, hue: 4.7, body_mass: 12 };
  const fixed = normalizeGenome(bad);
  assert.ok(fixed.leg_count <= 12 && fixed.leg_count % 2 === 0);
  assert.ok(fixed.hue >= 0 && fixed.hue <= 1);
  assert.ok(fixed.body_mass <= 1);
  for (const k of GENE_ORDER) assert.ok(Number.isFinite(fixed[k]), `${k} is not finite`);
});

/* ------------------------------------------------------------ training --- */

test('trainerAt finds only objects that actually train, and only in range', () => {
  const objects = [
    placeObject('training_rock', 100, 100),   // radius 70
    placeObject('pond', 400, 400),            // no `trains`
    placeObject('compost_heap', 105, 105),    // no `trains`
  ];
  const hit = trainerAt(objects, 110, 110);
  assert.equal(hit?.id, 'training_rock');
  assert.equal(trainerAt(objects, 400, 400), null, 'a pond is not a trainer');
  assert.equal(trainerAt(objects, 900, 900), null, 'out of range is not training');
});

test('the nearest trainer wins when two overlap', () => {
  const objects = [
    placeObject('obstacle_course', 100, 100),  // radius 150
    placeObject('training_rock', 180, 100),    // radius 70
  ];
  assert.equal(trainerAt(objects, 175, 100)?.id, 'training_rock');
  assert.equal(trainerAt(objects, 60, 100)?.id, 'obstacle_course');
});

test('training is the only channel that can reveal grip', () => {
  const rng = makeRng(41);
  let sawGrip = false;
  for (let i = 0; i < 120 && !sawGrip; i++) {
    for (const imp of allImpressions(randomGenome(rng))) {
      if (imp.key?.startsWith('grip') || imp.channel === 'training') {
        assert.equal(imp.channel, 'training', 'grip must sit on the training channel');
        sawGrip = true;
      }
    }
  }
  assert.ok(sawGrip, 'no training-channel impression exists to earn');
});

test('a completed session advances the training channel and nothing else', () => {
  const k = new Knowledge();
  const genome = randomGenome(makeRng(5));
  const before = { ...k.recordFor(genome).exposure };
  k.trained(genome, 'worked the training rock');
  const after = k.recordFor(genome).exposure;
  assert.equal(after.training, before.training + 1);
  assert.equal(after.watch, before.watch, 'training is not watching');
  assert.equal(after.combat, before.combat, 'training is not fighting');
  assert.ok(k.recordFor(genome).moments.includes('worked the training rock'));
});

test('enough sessions actually unlock a training phrase', () => {
  const rng = makeRng(77);
  // find a genome that has something to say on the training channel
  let genome = null;
  for (let i = 0; i < 400 && !genome; i++) {
    const g = randomGenome(rng);
    if (allImpressions(g).some((imp) => imp.channel === 'training')) genome = g;
  }
  assert.ok(genome, 'no genome in 400 draws had a training impression');

  const k = new Knowledge();
  assert.equal(k.known(genome).some((i) => i.channel === 'training'), false);
  for (let i = 0; i < CHANNEL_COST.training.base; i++) k.trained(genome);
  assert.ok(k.known(genome).some((i) => i.channel === 'training'),
    'a full run of sessions should buy at least one training phrase');
});

/* -------------------------------------------------- breeding modifiers --- */

const pop = () => randomPopulation(12, makeRng(11));

test('rate 1 is exactly the behaviour that existed before', () => {
  const a = breedGeneration(pop(), { rng: makeRng(2) });
  const b = breedGeneration(pop(), { rng: makeRng(2), rate: 1 });
  assert.deepEqual(a.population, b.population);
  assert.equal(a.report.turnover, 1);
});

test('a slow cadence carries part of the pool through unchanged', () => {
  const p = pop();
  const slow = breedGeneration(p, { rng: makeRng(2), rate: 0.65, immigrants: 0 });
  const fast = breedGeneration(p, { rng: makeRng(2), rate: 1, immigrants: 0 });
  const survives = (out) => out.population.filter(
    (child) => p.some((parent) => GENE_ORDER.every((k) => parent[k] === child[k]))).length;
  assert.ok(survives(slow) > survives(fast),
    'a Cave should replace less of the pool per generation than open ground');
  assert.equal(slow.report.turnover, 0.65);
});

test('a fast cadence breeds out the elites', () => {
  const p = pop();
  const hive = breedGeneration(p, { rng: makeRng(2), rate: 1.6, immigrants: 0, elitism: 2 });
  const plain = breedGeneration(p, { rng: makeRng(2), rate: 1.0, immigrants: 0, elitism: 2 });
  const survives = (out) => out.population.filter(
    (child) => p.some((parent) => GENE_ORDER.every((k) => parent[k] === child[k]))).length;
  assert.ok(survives(hive) < survives(plain), 'a Hive should turn the pool over faster');
});

test('the population still comes out the requested size at every rate', () => {
  for (const rate of [0, 0.4, 0.65, 1, 1.45, 1.6, 2]) {
    const out = breedGeneration(pop(), { rng: makeRng(3), rate, size: 12 });
    assert.equal(out.population.length, 12, `rate ${rate} produced the wrong size`);
  }
});

test('a gate nothing satisfies refuses instead of quietly breeding anyway', () => {
  const p = pop();
  const out = breedGeneration(p, { rng: makeRng(2), eligible: [] });
  assert.equal(typeof out.report.refused, 'string');
  assert.deepEqual(out.population, p, 'a refusal must leave the pool exactly as it was');
});

test('an eligibility gate restricts who can parent, not who survives', () => {
  const p = pop();
  const out = breedGeneration(p, {
    rng: makeRng(2), eligible: [0, 1], elitism: 0, immigrants: 0, size: 8,
  });
  assert.equal(out.report.refused, null);
  assert.equal(out.population.length, 8);
});

test('the Nest breeds the pair it was given, with no tournament in front of it', () => {
  const p = pop();
  const pair = [p[0], p[1]];
  const a = breedGeneration(p, {
    rng: makeRng(2), bypassSelection: true, pair, elitism: 0, immigrants: 0, tournamentK: 3,
  });
  const b = breedGeneration(p, {
    // A different tournament size cannot change the outcome if the tournament
    // is genuinely bypassed.
    rng: makeRng(2), bypassSelection: true, pair, elitism: 0, immigrants: 0, tournamentK: 7,
  });
  assert.equal(a.report.bonded, true);
  assert.deepEqual(a.population, b.population);
});

test('a fitness bonus lifts only the bugs that were standing in it', () => {
  const p = pop();
  const plain = rank(p, 'balanced');
  const lifted = rank(p, 'balanced', { fitnessBonus: 0.5, favoured: new Set([plain[plain.length - 1].index]) });
  const worst = plain[plain.length - 1].index;
  const before = plain.find((e) => e.index === worst).fitness;
  const after = lifted.find((e) => e.index === worst).fitness;
  assert.ok(after > before, 'the favoured bug should rank higher than it did');
  for (const e of lifted) {
    if (e.index === worst) continue;
    assert.equal(e.fitness, plain.find((x) => x.index === e.index).fitness,
      'everyone else must be untouched — a uniform lift would cancel out');
  }
});

test('a bonus with nobody favoured cannot reorder the pool', () => {
  const p = pop();
  const plain = rank(p, 'balanced').map((e) => e.index);
  const lifted = rank(p, 'balanced', { fitnessBonus: 0.5, favoured: new Set() }).map((e) => e.index);
  assert.deepEqual(lifted, plain);
});

test('the modifiers a Hive and a Compost Heap produce are what breeding now reads', () => {
  const objects = [placeObject('hive', 100, 100), placeObject('compost_heap', 110, 110)];
  const m = breedingModifiers(objects, 105, 105);
  assert.equal(m.rate, 1.6 * 0.85);
  assert.equal(m.selection, 'inverse');
  // every field breeding consumes is present and a real value
  for (const k of ['rate', 'mutationScale', 'fitnessBonus', 'growthRate']) {
    assert.ok(Number.isFinite(m[k]), `${k} is not a number`);
  }
});

/* ------------------------------------------------------- lineage locks --- */

test('a locked gene rides through breeding untouched', () => {
  const p = pop();
  const locked = ['body_mass', 'horn_type'];
  const held = p[0];
  const out = breedGeneration(p, {
    rng: makeRng(8), locked, elitism: 0, immigrants: 0,
    bypassSelection: true, pair: [held, held], size: 10,
  });
  for (const child of out.population) {
    for (const k of locked) {
      assert.equal(child[k], held[k], `${k} drifted despite being locked`);
    }
  }
});

test('unlocked genes are the ones a Prism Chamber pins', () => {
  // The scene passes `unlocked: []` when a Prism Chamber is present, so the
  // widened mutation range collapses back to the ordinary one. Measured on
  // `mutate` directly and aggregated over many seeds — a single generation is
  // too noisy to read, because a mutation that fires also consumes extra draws.
  let wide = 0;
  let pinned = 0;
  const changed = (a, b) => GENE_ORDER.filter((k) => a[k] !== b[k]).length;
  for (let s = 0; s < 200; s++) {
    const g = randomGenome(makeRng(s + 1));
    wide += changed(g, mutate(g, makeRng(s + 5000), { unlocked: GENE_ORDER }));
    pinned += changed(g, mutate(g, makeRng(s + 5000), { unlocked: [] }));
  }
  assert.ok(wide > pinned,
    `widening every gene should drift more than pinning them (${wide} vs ${pinned})`);
});
