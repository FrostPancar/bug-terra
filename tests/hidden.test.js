import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { normalizeGenome, randomGenome } from '../src/core/genes.js';
import { makeRng } from '../src/core/rng.js';
import { genomeFromArchetype, ARCHETYPES } from '../src/core/archetypes.js';
import {
  allImpressions, physicalReadout, vetReadout, shortImpression,
  IMPRESSION_SPECS, IMPRESSION_KEYS,
} from '../src/core/impressions.js';
import {
  Knowledge, sendToVet, vetStatus, isAway, VET, blankRecord,
} from '../src/sim/knowledge.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/* -------------------------------------------------- the rule, enforced --- */

test('the HUD is not given the vocabulary to print a stat or a gene', () => {
  const uiFiles = ['../src/main.js',
    ...readdirSync(new URL('../src/ui', import.meta.url)).map((f) => `../src/ui/${f}`)];
  const forbidden = ['GENE_ORDER', 'GENE_SPECS', 'STAT_KEYS', 'computeStats', 'classify('];
  for (const rel of uiFiles) {
    const src = read(rel);
    for (const token of forbidden) {
      assert.ok(!src.includes(token),
        `${rel} references ${token} — the panel must not be able to render numbers`);
    }
  }
});

test('the player-facing snapshot carries no genome and no stat block', () => {
  const src = read('../src/sim/bug.js');
  const body = src.slice(src.indexOf('  snapshot()'), src.indexOf('  debugSnapshot()'));
  assert.ok(body.length > 40, 'could not find the snapshot body to check');
  assert.ok(!body.includes('genome:'), 'snapshot() leaks the genome');
  assert.ok(!body.includes('stats:'), 'snapshot() leaks the stat block');
  assert.ok(!/\bhp:/.test(body), 'snapshot() leaks raw hit points');
  assert.ok(body.includes('condition'), 'condition should be a word instead');
});

test('the state event sends no fitness numbers to the panel', () => {
  const src = read('../src/sim/terrarium.js');
  const emit = src.slice(src.indexOf('emitState() {'));
  assert.ok(!emit.includes('bestFitness'), 'emitState leaks a fitness score');
  assert.ok(!emit.includes('meanFitness'), 'emitState leaks a fitness score');
  assert.ok(emit.includes('trend'), 'the pool should be described, not scored');
});

test('impressions are words, never numbers', () => {
  const rng = makeRng(17);
  for (let i = 0; i < 200; i++) {
    for (const imp of allImpressions(randomGenome(rng))) {
      assert.equal(typeof imp.phrase, 'string');
      assert.ok(!/\d/.test(imp.phrase), `phrase leaks a digit: "${imp.phrase}"`);
    }
  }
});

test('the vet readout is physical description, never performance', () => {
  const rng = makeRng(23);
  for (let i = 0; i < 80; i++) {
    const r = vetReadout(randomGenome(rng));
    const text = JSON.stringify(r);
    assert.ok(!/\d+\.\d+/.test(text.replace(/"tier":\d/, '')),
      `vet readout leaks a measurement: ${text}`);
    for (const line of r.physical) assert.ok(!/\d/.test(line), `physical line has a digit: ${line}`);
  }
});

/* ----------------------------------------------------------- the bands -- */

test('every impression spec is ordered low to high', () => {
  for (const key of IMPRESSION_KEYS) {
    const bands = IMPRESSION_SPECS[key].bands;
    for (let i = 1; i < bands.length; i++) {
      assert.ok(bands[i][0] > bands[i - 1][0], `${key} bands are out of order`);
    }
    assert.equal(bands[0][0], 0, `${key} must cover the bottom of its range`);
  }
});

test('an unremarkable bug produces very little to say', () => {
  const middling = normalizeGenome({});          // every gene at its midpoint
  const notable = allImpressions(middling);
  assert.ok(notable.length <= 4,
    `an average bug produced ${notable.length} impressions — the middle should be quiet`);
});

test('an extreme bug is loud about the thing it is extreme at', () => {
  const brick = normalizeGenome({
    carapace_thickness: 1, spine_density: 1, body_mass: 1, body_width: 1,
    leg_length: 0.05, leg_count: 6,
  });
  const top = allImpressions(brick)[0];
  assert.ok(top, 'an extreme genome should say something');
  assert.ok(top.salience > 0.5, 'the loudest trait should be clearly salient');
});

test('a flightless bug is described by its body, not by a zero', () => {
  const grounded = normalizeGenome({ wing_count: 0, wing_area: 0 });
  const phrases = allImpressions(grounded).map((i) => i.key);
  assert.ok(!phrases.includes('flight'), 'no wings means nothing to say about flying');
  assert.ok(physicalReadout(grounded).includes('no wings'),
    'the absence should be visible on the body instead');
});

test('physical readout is free and always says something', () => {
  const rng = makeRng(88);
  for (let i = 0; i < 100; i++) {
    const p = physicalReadout(randomGenome(rng));
    assert.ok(p.length >= 4, 'legs, wings, bulk and surface are always visible');
  }
});

/* ------------------------------------------------------- earning it ----- */

test('a bug you have never watched tells you nothing', () => {
  const k = new Knowledge();
  const g = genomeFromArchetype(ARCHETYPES[0], makeRng(1));
  assert.equal(k.known(g).length, 0, 'a stranger should be a stranger');
  assert.equal(k.familiarity(g), 'a stranger');
});

test('watching reveals watch-channel tells and nothing else', () => {
  const k = new Knowledge();
  const g = genomeFromArchetype(ARCHETYPES.find((a) => a.key === 'wasp'), makeRng(4));
  k.observe(g, 600);
  const known = k.known(g);
  assert.ok(known.length > 0, 'ten minutes of watching should teach you something');
  for (const imp of known) {
    assert.equal(imp.channel, 'watch',
      `${imp.key} came from ${imp.channel} without any ${imp.channel} happening`);
  }
});

test('combat tells need fights, not patience', () => {
  const k = new Knowledge();
  const g = genomeFromArchetype(ARCHETYPES.find((a) => a.key === 'beetle'), makeRng(6));
  k.observe(g, 100000);
  assert.equal(k.known(g).some((i) => i.channel === 'combat'), false,
    'you cannot learn how hard something hits by staring at it');
  for (let i = 0; i < 10; i++) k.fought(g, { won: true });
  assert.ok(k.known(g).some((i) => i.channel === 'combat'),
    'ten fights should reveal how it fights');
});

test('the loudest traits are noticed first', () => {
  const k = new Knowledge();
  const g = genomeFromArchetype(ARCHETYPES.find((a) => a.key === 'moth'), makeRng(8));
  k.observe(g, 40);
  const early = k.known(g);
  k.observe(g, 400);
  const late = k.known(g);
  assert.ok(late.length >= early.length, 'knowledge should not go backwards');
  for (const e of early) {
    assert.ok(late.some((l) => l.key === e.key), 'a learned tell should stay learned');
  }
});

test('familiarity is a phrase, never a percentage', () => {
  const k = new Knowledge();
  const g = genomeFromArchetype(ARCHETYPES[2], makeRng(11));
  for (const seconds of [0, 30, 200, 2000, 100000]) {
    k.observe(g, seconds);
    const f = k.familiarity(g);
    assert.equal(typeof f, 'string');
    assert.ok(!/\d/.test(f), `familiarity leaked a number: ${f}`);
  }
});

test('moments do not stutter and stay bounded', () => {
  const k = new Knowledge();
  const g = genomeFromArchetype(ARCHETYPES[1], makeRng(13));
  for (let i = 0; i < 50; i++) k.remember(g, 'won a fight');
  assert.equal(k.recordFor(g).moments.length, 1, 'repeats should collapse');
  for (let i = 0; i < 50; i++) k.remember(g, `thing ${i}`);
  assert.ok(k.recordFor(g).moments.length <= 12, 'the log must stay readable');
});

test('knowledge exports to plain JSON and survives a round trip', () => {
  const k = new Knowledge();
  const g = genomeFromArchetype(ARCHETYPES[3], makeRng(15));
  k.observe(g, 500);
  k.fought(g, { won: true });
  const saved = JSON.parse(JSON.stringify(k.export()));
  const restored = new Knowledge(saved);
  assert.deepEqual(restored.known(g).map((i) => i.key), k.known(g).map((i) => i.key));
});

/* ------------------------------------------------------- the vet ------- */

test('a vet visit costs you the bug, then makes you wait again', () => {
  const k = new Knowledge();
  const g = genomeFromArchetype(ARCHETYPES[0], makeRng(2));
  const rec = k.recordFor(g);

  assert.equal(vetStatus(rec, 0).state, 'available');
  assert.equal(sendToVet(k, g, 0), true);
  assert.equal(isAway(rec, 1), true, 'the bug should be out of the terrarium');
  assert.equal(sendToVet(k, g, 1), false, 'you cannot send it twice');

  // Visit elapses -> cooldown, not straight back to available.
  const mid = vetStatus(rec, VET.visitSeconds + 1);
  assert.equal(mid.state, 'cooldown');
  assert.equal(isAway(rec, VET.visitSeconds + 1), false, 'it comes home after the visit');
  assert.equal(sendToVet(k, g, VET.visitSeconds + 1), false, 'still cooling down');

  const later = VET.visitSeconds + VET.cooldownSeconds + 2;
  assert.equal(vetStatus(rec, later).state, 'available');
  assert.equal(sendToVet(k, g, later), true);
});

test('a vet visit is recorded as a moment', () => {
  const k = new Knowledge();
  const g = genomeFromArchetype(ARCHETYPES[4], makeRng(3));
  sendToVet(k, g, 0);
  assert.ok(k.recordFor(g).moments.some((m) => /look-over/.test(m)));
});

test('a blank record has no knowledge and an available vet', () => {
  const r = blankRecord('abc');
  assert.deepEqual(r.exposure, { watch: 0, combat: 0, training: 0, vet: 0 });
  assert.equal(r.vet.state, 'available');
});

test('shortImpression always returns a sentence', () => {
  const rng = makeRng(21);
  for (let i = 0; i < 60; i++) {
    const s = shortImpression(randomGenome(rng));
    assert.equal(typeof s, 'string');
    assert.ok(s.length > 0);
  }
});
