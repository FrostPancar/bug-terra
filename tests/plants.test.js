import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Plot, Plant, PlantBed, TIMINGS, PLANT_STATES } from '../src/sim/plants.js';
import { placeObject, fieldAt, breedingModifiers, CATALOG_IDS, CATALOG } from '../src/sim/objects.js';
import { makeRng } from '../src/core/rng.js';

/** Run a plant forward without waiting for real time. */
function advance(target, seconds, env = { light: 0.8 }, step = 1) {
  for (let t = 0; t < seconds; t += step) {
    target.meters.decay(step, env);
    target.advanceLifecycle(step, env);
  }
  return target.state;
}

/* ------------------------------------------------------------- the line -- */

test('plants.js never imports the gene or stat layers', () => {
  const src = readFileSync(new URL('../src/sim/plants.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import[^;]+from\s+'([^']+)'/gm)].map((m) => m[1]);
  for (const spec of imports) {
    assert.ok(!/core\/(genes|stats|classification|breeding)\.js$/.test(spec),
      `plant code reaches into ${spec}, which it must never do`);
  }
});

test('nothing a plant does can produce a gene or a stat name', () => {
  const src = readFileSync(new URL('../src/sim/plants.js', import.meta.url), 'utf8');
  for (const forbidden of ['computeStats', 'clampGene', 'GENE_ORDER', 'genome']) {
    assert.ok(!src.includes(forbidden),
      `plants.js mentions ${forbidden} — the upkeep loop must stay out of genetics`);
  }
});

/* ---------------------------------------------------------- the lifecycle */

test('a well-kept seed walks the whole state machine', () => {
  const plot = new Plot(0, 0);
  const plant = new Plant('grass_patch', plot);
  const seen = new Set([plant.state]);
  const env = { light: 0.9, field: { hydration: 0.02, soil: 0.02 } };
  for (let t = 0; t < 900; t++) {
    plot.decay(1, env);
    plant.advanceLifecycle(1, env);
    seen.add(plant.state);
  }
  for (const s of ['seed', 'sprout', 'growing', 'mature']) {
    assert.ok(seen.has(s), `never reached ${s} (saw ${[...seen].join(', ')})`);
  }
  assert.ok(!seen.has('dead'), 'a maintained plant should not die');
});

test('state is always one of the declared states', () => {
  const plot = new Plot(0, 0);
  const plant = new Plant('berry_bush', plot);
  for (let t = 0; t < 500; t++) {
    plot.decay(1, { light: 0.5 });
    plant.advanceLifecycle(1, { light: 0.5 });
    assert.ok(PLANT_STATES.includes(plant.state), `illegal state ${plant.state}`);
  }
});

test('a seed that never gets light gives up rather than waiting forever', () => {
  const plot = new Plot(0, 0);
  plot.light = 0;
  const plant = new Plant('grass_patch', plot);
  advance(plant, TIMINGS.seedFail + 40, { light: 0 });
  assert.equal(plant.state, 'dead');
});

/* -------------------------------------------------------------- neglect -- */

test('one exhausted meter starts a decline, not an instant death', () => {
  const plot = new Plot(0, 0);
  const plant = new Plant('moss_bed', plot, { state: 'mature' });
  plant.progress = 1;
  plot.hydration = 0;
  plant.advanceLifecycle(1, { light: 0.8 });
  assert.equal(plant.state, 'declining');
  assert.ok(plant.alive, 'one dead meter should not kill it outright');
});

test('all three exhausted kills it immediately', () => {
  const plot = new Plot(0, 0);
  const plant = new Plant('moss_bed', plot, { state: 'mature' });
  plot.hydration = 0; plot.light = 0; plot.soil = 0;
  plant.advanceLifecycle(1, { light: 0 });
  assert.equal(plant.state, 'dead');
});

test('two exhausted meters kill faster than one', () => {
  const run = (zeros) => {
    const plot = new Plot(0, 0);
    const plant = new Plant('moss_bed', plot, { state: 'mature' });
    for (const k of zeros) plot[k] = 0;
    let t = 0;
    while (plant.state !== 'dead' && t < 4000) {
      for (const k of zeros) plot[k] = 0;      // hold them at zero
      plant.advanceLifecycle(1, { light: 0.5 });
      t++;
    }
    return t;
  };
  assert.ok(run(['hydration', 'light']) < run(['hydration']),
    'a doubly-neglected plant should not outlive a singly-neglected one');
});

test('a plant rescued mid-decline goes back to living', () => {
  const plot = new Plot(0, 0);
  const plant = new Plant('fern_cluster', plot, { state: 'mature' });
  plant.progress = 1;
  plot.hydration = 0;
  plant.advanceLifecycle(1, { light: 0.8 });
  assert.equal(plant.state, 'declining');
  plot.water(0.8);
  plant.advanceLifecycle(1, { light: 0.8 });
  assert.equal(plant.state, 'mature');
});

/* ------------------------------------------------------------- the plot -- */

test('a dead plant frees its plot and leaves residue, not a new seed', () => {
  const bed = new PlantBed({ rng: makeRng(5) });
  const plant = bed.plant('grass_patch', 100, 100, { state: 'mature' });
  const plot = plant.plot;
  plant.setState('dead');
  bed.clearPlot(plant);
  assert.equal(plot.occupant, null, 'the plot should be cleared');
  assert.ok(plot.residue > 0, 'a grave should be worse soil than fresh ground');
  assert.equal(bed.plants.filter((p) => p.plot === plot && p.alive).length, 0,
    'clearing a plot must not plant anything');
});

test('an empty plot slowly recovers soil', () => {
  const plot = new Plot(0, 0);
  plot.soil = 0.2;
  const before = plot.soil;
  for (let t = 0; t < 60; t++) plot.decay(1, { light: 0.6 });
  assert.ok(plot.soil > before, 'fallow ground should improve');
});

test('crowding drains soil faster', () => {
  const lonely = new Plot(0, 0);
  const crowded = new Plot(0, 0);
  crowded.crowding = 4;
  for (let t = 0; t < 80; t++) {
    lonely.occupant = crowded.occupant = {};      // occupied, so no fallow bonus
    lonely.decay(1, { light: 0.6 });
    crowded.decay(1, { light: 0.6 });
  }
  assert.ok(crowded.soil < lonely.soil);
});

/* -------------------------------------------------------------- spread --- */

test('spreading is deterministic under a seeded rng', () => {
  const run = () => {
    const bed = new PlantBed({ rng: makeRng(1234) });
    bed.plant('seed_pod', 300, 300, { state: 'mature' });
    for (let t = 0; t < 1200; t++) bed.tick(1, { light: 0.85, field: { hydration: 0.02, soil: 0.02 } });
    return bed.plants.map((p) => `${p.id}@${p.x},${p.y}`).sort().join('|');
  };
  assert.equal(run(), run());
});

test('spreading does not consume the parent', () => {
  const bed = new PlantBed({ rng: makeRng(9) });
  const parent = bed.plant('seed_pod', 400, 400, { state: 'mature' });
  parent.progress = 1;
  for (let t = 0; t < 400; t++) {
    bed.tick(1, { light: 0.9, field: { hydration: 0.05, soil: 0.05 } });
  }
  assert.ok(parent.alive, 'the parent should survive spreading');
});

/* ------------------------------------------------------------- objects -- */

test('every catalog entry has the fields the sim reads', () => {
  for (const id of CATALOG_IDS) {
    const s = CATALOG[id];
    assert.equal(s.id, id, `${id} has a mismatched id field`);
    assert.ok(typeof s.name === 'string' && s.name.length);
    assert.ok(typeof s.blurb === 'string' && s.blurb.length);
    assert.ok(Number.isFinite(s.radius) && s.radius >= 0, `${id} radius`);
    assert.ok(Number.isFinite(s.footprint) && s.footprint >= 0, `${id} footprint`);
  }
});

test('fieldAt only counts objects whose radius actually reaches the point', () => {
  const objs = [placeObject('pond', 0, 0)];
  const near = fieldAt(objs, 10, 10);
  const far = fieldAt(objs, 5000, 5000);
  assert.ok(near.hydration > 0);
  assert.equal(far.hydration, 0);
});

test('a Pond keeps a nearby plant alive that would otherwise dry out', () => {
  const dry = new Plot(9000, 9000);
  const wet = new Plot(0, 0);
  const objs = [placeObject('pond', 0, 0)];
  for (let t = 0; t < 400; t++) {
    dry.occupant = wet.occupant = {};
    dry.decay(1, { light: 0.6, field: fieldAt(objs, dry.x, dry.y) });
    wet.decay(1, { light: 0.6, field: fieldAt(objs, wet.x, wet.y) });
  }
  assert.ok(wet.hydration > dry.hydration);
});

test('breeding modifiers are read at a point and never stored on anything', () => {
  const objs = [placeObject('crucible', 0, 0), placeObject('compost_heap', 20, 20)];
  const here = breedingModifiers(objs, 0, 0);
  assert.ok(here.mutationScale > 1, 'the Crucible should raise variance');
  assert.equal(here.selection, 'inverse', 'the Compost Heap should invert selection');
  const away = breedingModifiers(objs, 9000, 9000);
  assert.equal(away.mutationScale, 1);
  assert.equal(away.selection, null);
  // Calling it twice must not accumulate.
  assert.deepEqual(breedingModifiers(objs, 0, 0), here);
});

test('the Glass Dome expresses in offspring, never in the edited bug', () => {
  assert.equal(CATALOG.glass_dome.gene.expressIn, 'offspring');
});

test('the plant bed refuses to stack plants on top of each other', () => {
  const bed = new PlantBed({ rng: makeRng(3) });
  assert.ok(bed.plant('grass_patch', 100, 100));
  assert.equal(bed.plant('moss_bed', 102, 101), null, 'too close should be refused');
  assert.ok(bed.plant('moss_bed', 400, 400));
});
