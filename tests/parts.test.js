import test from 'node:test';
import assert from 'node:assert/strict';

import { GENE_SPECS, GENE_ORDER, normalizeGenome, randomGenome } from '../src/core/genes.js';
import { makeRng } from '../src/core/rng.js';
import { classify, CLASS_TREE } from '../src/core/classification.js';
import { buildForTaxon, TAXON_MENU, mergedWindow } from '../src/core/taxonBuild.js';
import { drawBug, layout, palette, wingShape, wingShapeCoefficient, wingSweep } from '../src/render/bugArt.js';
import {
  PARTS, PART_IDS, PART_GROUPS, GENE_INFO, SIM_ONLY, partById, isPresent,
  addPart, removePart, setVariant, variantOf, isSimOnly,
} from '../src/render/partLibrary.js';

/* ------------------------------------------------------------ a fake ctx -- */

/**
 * drawBug() only ever talks to a 2D context, so a recorder standing in for one
 * turns "does this gene change the sprite" into a string comparison. Property
 * writes are recorded too — the pattern genes change nothing but fill colours.
 */
function trace(genome, opts = {}) {
  const log = [];
  const gradient = { addColorStop: (o, c) => log.push(`stop ${o} ${c}`) };
  const methods = {
    save: 0, restore: 0, beginPath: 0, closePath: 0, fill: 0, stroke: 0, clip: 0,
    translate: 0, rotate: 0, scale: 0, moveTo: 0, lineTo: 0, quadraticCurveTo: 0,
    arc: 0, ellipse: 0, fillRect: 0, setTransform: 0, clearRect: 0,
    // The wing blades are closed two-curve outlines, so the recorder has to
    // speak cubics as well as the quadratics the limbs and horns use.
    bezierCurveTo: 0,
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
  // Horn and mandible fills take a linear gradient base→tip when `pattern`
  // selects the gradient treatment, so the recorder has to speak that too.
  target.createLinearGradient = (...args) => {
    log.push(`lgrad(${args.map((a) => a.toFixed(2)).join(',')})`);
    return gradient;
  };
  const ctx = new Proxy(target, {
    set(o, k, v) { log.push(`${String(k)}=${String(v)}`); o[k] = v; return true; },
  });
  drawBug(ctx, genome, opts);
  return log.join('\n');
}

const BASE = normalizeGenome({
  body_width: 0.60, head_width: 0.48, head_length: 0.48, leg_count: 6,
  leg_length: 0.55, leg_thickness: 0.55, wing_count: 0,
  wing_area: 0, horn_size: 0, mandible_size: 0.4, tail_length: 0, stinger_size: 0,
  eye_count: 2, eye_size: 0.8, antenna_length: 0, setae: 0,
  hue: 0.015, saturation: 0.55, lightness: 0.55, pattern_leg: 0.2, spikyness: 0,
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

test('all genes are accounted for — a part, a sim note, or both', () => {
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

/* ------------------------------------------------------- the art contract -- */

/** Where in the call log a part's own ellipse is drawn. */
function partAt(log, part) {
  const key = `ellipse(${part.x.toFixed(3)},${(part.y ?? 0).toFixed(3)},` +
              `${part.rx.toFixed(3)},${part.ry.toFixed(3)}`;
  const i = log.findIndex((l) => l.startsWith(key));
  assert.ok(i >= 0, 'that part was never drawn');
  return i;
}

test('the head carries no lighting at all — one flat fill, no gradient', () => {
  // body_segments 1 leaves exactly one trunk mass (the thorax), so the blob it
  // paints is the ONLY radial gradient the whole sprite is allowed to contain.
  // The head used to add a second one; that is the thing this pins down.
  const g = normalizeGenome({ ...BASE, body_segments: 1, head_width: 0.9, head_length: 0.9, crown_mark_style: 0 });
  // `grad(` only — `lgrad(` is a different primitive and the mandibles use it.
  const radials = trace(g).split('\n').filter((l) => l.startsWith('grad(')).length;
  assert.equal(radials, 1,
    'the head is drawing a gradient again — it must be a single flat fill');
});

test('the crown mark is the only blend allowed on the head', () => {
  const flat = normalizeGenome({ ...BASE, head_width: 0.9, head_length: 0.9, crown_mark_style: 1 });
  const blend = normalizeGenome({ ...BASE, head_width: 0.9, head_length: 0.9, crown_mark_style: 2 });
  const lgrads = (g) => trace(g).split('\n').filter((l) => l.startsWith('lgrad(')).length;
  const solidGrads = lgrads(flat);
  const blendGrads = lgrads(blend);
  assert.ok(blendGrads > solidGrads,
    'the blended crown mark must add a gradient the solid one does not');
});

test('abdomen over thorax without wings, thorax over abdomen with them', () => {
  const wingless = normalizeGenome({ ...BASE, body_segments: 2, wing_count: 0, wing_area: 0 });
  const winged = normalizeGenome({ ...BASE, body_segments: 2, wing_count: 2, wing_area: 0.7, wing_type: 0 });

  for (const [label, g, abdomenOnTop] of [['wingless', wingless, true], ['winged', winged, false]]) {
    const L = layout(g);
    assert.ok(L.abdomen && L.thorax, `${label}: this fixture needs both masses`);
    const lines = trace(g).split('\n');
    const ab = partAt(lines, L.abdomen);
    const th = partAt(lines, L.thorax);
    assert.equal(ab > th, abdomenOnTop,
      `${label}: the abdomen is on the wrong side of the thorax`);
  }
});

/* ----------------------------------------------------------------- wings -- */

const WINGED = normalizeGenome({
  ...BASE, body_segments: 2, wing_count: 2, wing_area: 0.7, wing_type: 0, horn_size: 0.8,
});

test('wings are drawn above everything else, including the thorax and the horn', () => {
  for (const wing_count of [2, 4, 6]) {
    const g = normalizeGenome({ ...WINGED, wing_count });
    const lines = trace(g).split('\n');
    const L = layout(g);
    // Blades are the only cubics on the sprite, so the first one marks where
    // the wing pass begins.
    const firstBlade = lines.findIndex((l) => l.startsWith('bezierCurveTo('));
    assert.ok(firstBlade >= 0, `${wing_count}: no wing was drawn at all`);
    assert.ok(firstBlade > partAt(lines, L.thorax),
      `${wing_count}: wings must be drawn AFTER the thorax, not under it`);
    assert.ok(firstBlade > partAt(lines, L.abdomen),
      `${wing_count}: wings must be drawn after the abdomen`);
    // Nothing at all may be drawn after the last blade.
    const lastFill = lines.length - 1 - [...lines].reverse().findIndex((l) => l === 'fill()');
    assert.ok(lastFill > firstBlade, `${wing_count}: something painted over the wings`);
  }
});

test('one blade per wing per side — wing_count drives the blade count directly', () => {
  const cubics = (wing_count) => trace(normalizeGenome({ ...WINGED, wing_count }))
    .split('\n').filter((l) => l.startsWith('bezierCurveTo(')).length;
  // 2 curves per leaf/crescent blade, 3 per oval; whatever the family, the
  // count has to scale exactly with the number of wings.
  assert.equal(cubics(4), cubics(2) * 2, 'four wings must draw twice the blades of two');
  assert.equal(cubics(6), cubics(2) * 3, 'six wings must draw three times the blades of two');
  assert.equal(cubics(0), 0, 'a wingless bug must draw no blades');
});

test('the wing membrane is a fixed grey at 0.70 alpha, whatever the body colour', () => {
  const seen = new Set();
  for (const hue of [0.04, 0.3, 0.55, 0.8, 0.97]) {
    for (const saturation of [0, 1]) {
      const c = palette(normalizeGenome({ ...WINGED, hue, saturation, lightness: saturation }));
      seen.add(`${c.wing}|${c.wingLo}`);
      for (const tone of [c.wing, c.wingLo]) {
        const [r, g2, b, a] = tone.match(/[\d.]+/g).map(Number);
        assert.equal(a, 0.70, `wing alpha must be exactly 0.70, got ${a}`);
        assert.ok(r === g2 - 3 || Math.max(r, g2, b) - Math.min(r, g2, b) < 20,
          `wing tone ${tone} is not a neutral grey`);
      }
    }
  }
  assert.equal(seen.size, 1, 'the wing membrane changed with the genome — it must not');
});

test('the wing tip defaults to white and takes a reference-palette colour', () => {
  assert.match(palette(normalizeGenome({ ...WINGED, wing_tip_hue: 0 })).wingTip,
    /^rgba\(255,255,255,/, 'tip 0 must be white — it is not a palette slot');
  const seen = new Set();
  for (let i = 0; i <= 10; i++) seen.add(palette(normalizeGenome({ ...WINGED, wing_tip_hue: i })).wingTip);
  assert.equal(seen.size, 11, 'all 11 tip states must be distinct colours');
});

test('the shape coefficient picks the family exactly where partLibrary says it does', () => {
  const at = (wing_length, wing_width, wing_roundness) =>
    normalizeGenome({ ...WINGED, wing_length, wing_width, wing_roundness });
  // The formula, restated independently of the implementation.
  for (const [l, w, r] of [[0.55, 0.46, 0.55], [1, 0, 0], [0, 1, 1], [0.7, 0.25, 0.3]]) {
    const expected = Math.min(1, Math.max(0, 0.5 + 0.50 * l - 0.70 * w - 0.30 * r));
    assert.ok(Math.abs(wingShapeCoefficient(at(l, w, r)) - expected) < 1e-9,
      `coefficient drifted from the documented formula at ${l}/${w}/${r}`);
    assert.equal(wingShape(at(l, w, r)),
      expected < 0.34 ? 'leaf' : expected < 0.62 ? 'oval' : 'crescent');
  }
  // All three families must be reachable, and each must render differently.
  const renders = new Map();
  for (const [name, l, w, r] of [['leaf', 0.55, 0.46, 0.55], ['oval', 0.7, 0.25, 0.3], ['crescent', 1, 0.1, 0.1]]) {
    const g = at(l, w, r);
    assert.equal(wingShape(g), name, `${name} is unreachable through its own genes`);
    const key = trace(g);
    assert.ok(!renders.has(key), `${name} renders identically to ${renders.get(key)}`);
    renders.set(key, name);
  }
});

test('length, width and roundness move independent axes of the blade', () => {
  // WITHIN A FAMILY. Crossing a shape threshold re-proportions the blade on
  // purpose — that is what the coefficient is for — so these fixtures are all
  // chosen to stay inside `leaf`, where "independent" is the real claim.
  const wing = (patch) => {
    const g = normalizeGenome({ ...WINGED, wing_length: 0.3, wing_width: 0.5, wing_roundness: 0.6, ...patch });
    assert.equal(wingShape(g), 'leaf', 'fixture drifted out of the leaf family');
    return layout(g).wing;
  };
  const base = wing({});
  // Longer wing, same family: length grows, the aspect ratio does not move.
  const longer = wing({ wing_length: 0.6 });
  assert.ok(longer.len > base.len, 'wing_length must change length');
  assert.ok(Math.abs(longer.wid / longer.len - base.wid / base.len) < 1e-9,
    'wing_length leaked into the aspect ratio — it must only scale length');
  // Wider wing: width grows, length is untouched.
  const wider = wing({ wing_width: 0.62 });
  assert.ok(wider.wid > base.wid, 'wing_width must change width');
  assert.equal(wider.len, base.len, 'wing_width leaked into length');
  // Roundness moves the outline only; it may not touch the bounding box.
  const rounder = wing({ wing_roundness: 0.52 });
  assert.equal(rounder.len, base.len, 'wing_roundness must not change length');
  assert.equal(rounder.wid, base.wid, 'wing_roundness must not change width');
  // wing_area is the pure size knob: it scales both and changes no ratio.
  const bigger = layout(normalizeGenome({
    ...WINGED, wing_length: 0.3, wing_width: 0.5, wing_roundness: 0.6, wing_area: 0.95,
  })).wing;
  assert.ok(bigger.len > base.len && bigger.wid > base.wid, 'wing_area must scale both axes');
  assert.ok(Math.abs(bigger.wid / bigger.len - base.wid / base.len) < 1e-9,
    'wing_area must not change the aspect ratio');
});

test('wing_angle reaches 126°–165° at rest, and flight swings it forward', () => {
  // The 35°-165° MAPPING is unchanged; what changed is the window the gene can
  // reach. It is 0.7-1.0 now, so a resting wing is always swept well back the
  // way the reference sheet draws it, and the old "0.50 renders the 100° median"
  // claim is no longer sayable — 0.50 is not a legal wing_angle.
  const at = (wing_angle) => layout(normalizeGenome({ ...WINGED, wing_angle })).wing.sweep * 180 / Math.PI;
  assert.ok(Math.abs(at(0.85) - 145.5) < 0.5, `the 0.85 default should render ~145.5°, got ${at(0.85).toFixed(1)}°`);
  // Out-of-range values clamp INTO the window rather than reaching below it.
  assert.ok(Math.abs(at(0.7) - 126.0) < 0.5, 'the gene floor must render 126°');
  assert.ok(Math.abs(at(0) - at(0.7)) < 1e-9, 'below 0.7 must clamp up to the floor');
  assert.ok(Math.abs(at(1) - 165) < 0.5, 'the gene ceiling must render 165°');

  // Flight subtracts 0.3 — 39° forward — in walk and attack, and nowhere else.
  const g = normalizeGenome({ ...WINGED, wing_angle: 0.85 });
  assert.ok(Math.abs(wingSweep(g, 'idle') - wingSweep(g, 'walk')) > 0.6,
    'walking must swing the blades visibly forward of the resting angle');
  assert.equal(wingSweep(g, 'walk'), wingSweep(g, 'attack'),
    'attack is a flight state too — the same two states that beat the wings');
  assert.equal(wingSweep(g, 'idle'), layout(g).wing.sweep,
    'the resting sweep is what layout() measures');
  // Even at the bottom of the window the offset stays inside the mapping's own
  // 0-1 domain, so the sweep can never come out negative or extrapolated.
  const low = normalizeGenome({ ...WINGED, wing_angle: 0.7 });
  const flying = wingSweep(low, 'walk') * 180 / Math.PI;
  assert.ok(flying > 34.9 && flying < 165.1, `flight sweep escaped the mapping: ${flying}`);
  assert.ok(Math.abs(flying - 87.0) < 0.5, `0.7 - 0.3 should render ~87°, got ${flying.toFixed(1)}°`);
});

test('wings are exactly symmetric about the body centreline', () => {
  for (const wing_count of [2, 4]) {
    const rots = trace(normalizeGenome({ ...WINGED, wing_count })).split('\n')
      .filter((l) => l.startsWith('rotate(')).slice(-wing_count)
      .map((l) => Number(l.match(/-?[\d.]+/)[0]));
    const left = rots.filter((r) => r < 0).map(Math.abs).sort();
    const right = rots.filter((r) => r > 0).sort();
    assert.deepEqual(left, right, `${wing_count}: the two sides are not mirror images`);
  }
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
