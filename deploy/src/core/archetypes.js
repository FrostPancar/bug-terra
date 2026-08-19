// Archetype seeding.
//
// A uniformly random genome is a bug with every gene near 0.5 — the population
// converges to identical mid-range blobs and generation 0 looks like one animal
// repeated. Archetypes give the GA a spread of distinct body plans to start
// from: each is a set of gene biases plus a per-gene jitter, so two "wasps"
// differ but both read as wasps.
//
// These are STARTING POINTS, not classes. Nothing tracks which archetype a bug
// came from; after one crossover the lineages blend freely.

import { GENE_SPECS, GENE_ORDER, normalizeGenome, clampGene } from './genes.js';
import { makeRng } from './rng.js';

/**
 * `bias` holds target values for the genes that define the plan. Anything not
 * listed is drawn uniformly. `spread` scales the jitter applied to the biased
 * genes (a fraction of each gene's range).
 */
export const ARCHETYPES = [
  {
    key: 'beetle',
    name: 'Beetle',
    blurb: 'Armoured bruiser. Thick carapace, horn, short legs — slow, very hard to kill.',
    spread: 0.10,
    bias: {
      body_segments: 3, body_length: 0.5, body_width: 0.72, body_mass: 0.80,
      carapace_thickness: 0.88, head_size: 0.42, thorax_ratio: 0.55, abdomen_taper: 0.25,
      leg_count: 6, leg_length: 0.28, leg_thickness: 0.72, leg_joints: 3, claw_size: 0.5,
      wing_count: 2, wing_area: 0.20, wing_beat: 0.35,
      mandible_size: 0.55, mandible_serration: 0.45, horn_size: 0.85,
      spine_density: 0.30, tail_length: 0.10, stinger_size: 0.02,
      eye_count: 2, eye_size: 0.30, antenna_length: 0.35,
      metabolism: 0.30, aggression: 0.55,
      saturation: 0.30, lightness: 0.22, setae: 0.15, iridescence: 0.45, translucency: 0.05,
    },
  },
  {
    key: 'wasp',
    name: 'Wasp',
    blurb: 'Fast flier with a stinger. Light, aggressive, venomous, almost no armour.',
    spread: 0.10,
    bias: {
      body_segments: 3, body_length: 0.62, body_width: 0.24, body_mass: 0.18,
      carapace_thickness: 0.18, head_size: 0.45, thorax_ratio: 0.45, abdomen_taper: 0.85,
      leg_count: 6, leg_length: 0.55, leg_thickness: 0.22, leg_joints: 3, claw_size: 0.30,
      wing_count: 4, wing_area: 0.80, wing_beat: 0.90,
      mandible_size: 0.30, mandible_serration: 0.30, horn_size: 0.02,
      spine_density: 0.10, tail_length: 0.55, stinger_size: 0.90,
      eye_count: 2, eye_size: 0.62, antenna_length: 0.50,
      metabolism: 0.85, aggression: 0.85,
      hue: 0.14, saturation: 0.92, lightness: 0.55,
      pattern: 0.15, pattern_contrast: 0.95, setae: 0.25, iridescence: 0.20, translucency: 0.15,
    },
  },
  {
    key: 'spider',
    name: 'Spider',
    blurb: 'Eight legs, many eyes, no wings. Big vision radius, ambushes with venomous fangs.',
    spread: 0.10,
    bias: {
      body_segments: 2, body_length: 0.42, body_width: 0.62, body_mass: 0.35,
      carapace_thickness: 0.32, head_size: 0.30, thorax_ratio: 0.35, abdomen_taper: 0.20,
      leg_count: 8, leg_length: 0.92, leg_thickness: 0.28, leg_joints: 3, claw_size: 0.65,
      wing_count: 0, wing_area: 0.0, wing_beat: 0.0,
      mandible_size: 0.62, mandible_serration: 0.70, horn_size: 0.05,
      spine_density: 0.25, tail_length: 0.15, stinger_size: 0.55,
      eye_count: 8, eye_size: 0.45, antenna_length: 0.12,
      metabolism: 0.45, aggression: 0.70,
      saturation: 0.25, lightness: 0.18, setae: 0.70, iridescence: 0.10, translucency: 0.05,
    },
  },
  {
    key: 'roach',
    name: 'Roach',
    blurb: 'Flat, fast, drab. Survives on speed, stamina and camouflage rather than force.',
    spread: 0.11,
    bias: {
      body_segments: 3, body_length: 0.68, body_width: 0.50, body_mass: 0.30,
      carapace_thickness: 0.40, head_size: 0.25, thorax_ratio: 0.40, abdomen_taper: 0.35,
      leg_count: 6, leg_length: 0.62, leg_thickness: 0.35, leg_joints: 3, claw_size: 0.55,
      wing_count: 2, wing_area: 0.35, wing_beat: 0.45,
      mandible_size: 0.25, mandible_serration: 0.25, horn_size: 0.02,
      spine_density: 0.45, tail_length: 0.45, stinger_size: 0.05,
      eye_count: 2, eye_size: 0.35, antenna_length: 0.95,
      metabolism: 0.55, aggression: 0.25,
      hue: 0.08, saturation: 0.35, lightness: 0.24,
      pattern: 0.9, setae: 0.30, iridescence: 0.30, translucency: 0.10,
    },
  },
  {
    key: 'mantis',
    name: 'Mantis',
    blurb: 'Long body, hooked forelimbs. Slow to move, devastating in reach — a duelist.',
    spread: 0.10,
    bias: {
      body_segments: 3, body_length: 0.92, body_width: 0.26, body_mass: 0.32,
      carapace_thickness: 0.28, head_size: 0.38, thorax_ratio: 0.75, abdomen_taper: 0.60,
      leg_count: 6, leg_length: 0.78, leg_thickness: 0.32, leg_joints: 3, claw_size: 0.95,
      wing_count: 2, wing_area: 0.45, wing_beat: 0.30,
      mandible_size: 0.70, mandible_serration: 0.85, horn_size: 0.10,
      spine_density: 0.55, tail_length: 0.25, stinger_size: 0.05,
      eye_count: 2, eye_size: 0.85, antenna_length: 0.45,
      metabolism: 0.40, aggression: 0.80,
      hue: 0.30, saturation: 0.55, lightness: 0.42, setae: 0.10, translucency: 0.12,
    },
  },
  {
    key: 'moth',
    name: 'Moth',
    blurb: 'Enormous soft wings, furred body. Great lift and stamina, hopeless in a fight.',
    spread: 0.11,
    bias: {
      body_segments: 3, body_length: 0.45, body_width: 0.45, body_mass: 0.15,
      carapace_thickness: 0.10, head_size: 0.32, thorax_ratio: 0.50, abdomen_taper: 0.45,
      leg_count: 6, leg_length: 0.38, leg_thickness: 0.20, leg_joints: 2, claw_size: 0.25,
      wing_count: 4, wing_area: 0.98, wing_beat: 0.55,
      mandible_size: 0.08, mandible_serration: 0.05, horn_size: 0.02,
      spine_density: 0.05, tail_length: 0.20, stinger_size: 0.02,
      eye_count: 2, eye_size: 0.72, antenna_length: 0.80,
      metabolism: 0.60, aggression: 0.10,
      saturation: 0.20, lightness: 0.62,
      pattern: 0.45, setae: 0.95, iridescence: 0.35, translucency: 0.30,
    },
  },
  {
    key: 'centipede',
    name: 'Centipede',
    blurb: 'Ten legs on a long segmented body. Quick, spiny, venomous, poorly armoured.',
    spread: 0.10,
    bias: {
      body_segments: 4, body_length: 0.98, body_width: 0.20, body_mass: 0.28,
      carapace_thickness: 0.22, head_size: 0.22, thorax_ratio: 0.30, abdomen_taper: 0.70,
      leg_count: 10, leg_length: 0.48, leg_thickness: 0.18, leg_joints: 2, claw_size: 0.45,
      wing_count: 0, wing_area: 0.0, wing_beat: 0.0,
      mandible_size: 0.48, mandible_serration: 0.60, horn_size: 0.05,
      spine_density: 0.80, tail_length: 0.75, stinger_size: 0.65,
      eye_count: 4, eye_size: 0.25, antenna_length: 0.70,
      metabolism: 0.70, aggression: 0.65,
      hue: 0.06, saturation: 0.70, lightness: 0.35, setae: 0.20, translucency: 0.10,
    },
  },
  {
    key: 'weevil',
    name: 'Weevil',
    blurb: 'Small, round, absurdly long snout. Tanky for its size and hard to spot.',
    spread: 0.11,
    bias: {
      body_segments: 2, body_length: 0.30, body_width: 0.58, body_mass: 0.55,
      carapace_thickness: 0.70, head_size: 0.30, thorax_ratio: 0.40, abdomen_taper: 0.15,
      leg_count: 6, leg_length: 0.30, leg_thickness: 0.45, leg_joints: 2, claw_size: 0.40,
      wing_count: 2, wing_area: 0.15, wing_beat: 0.25,
      mandible_size: 0.20, mandible_serration: 0.15, horn_size: 0.95,
      spine_density: 0.35, tail_length: 0.08, stinger_size: 0.02,
      eye_count: 2, eye_size: 0.28, antenna_length: 0.55,
      metabolism: 0.28, aggression: 0.30,
      saturation: 0.30, lightness: 0.20,
      pattern: 0.5, setae: 0.45, iridescence: 0.55, translucency: 0.05,
    },
  },
];

export const ARCHETYPE_KEYS = ARCHETYPES.map((a) => a.key);

/** One genome drawn around an archetype's biases. */
export function genomeFromArchetype(archetype, rng = makeRng(1)) {
  const g = {};
  for (const name of GENE_ORDER) {
    const spec = GENE_SPECS[name];
    const target = archetype.bias[name];
    if (target === undefined) {
      g[name] = clampGene(name, rng.range(spec.min, spec.max));
      continue;
    }
    const span = spec.max - spec.min;
    const jitter = rng.normal() * span * (archetype.spread ?? 0.1);
    g[name] = clampGene(name, target + jitter);
  }
  return normalizeGenome(g);
}

export function archetypeByKey(key) {
  return ARCHETYPES.find((a) => a.key === key) ?? null;
}

/**
 * A starting population that walks the archetype list round-robin, so a pool of
 * 7 gets 7 different plans rather than 7 samples of the same distribution.
 * `wildcards` is the fraction drawn uniformly at random instead, to keep genes
 * in play that no archetype uses.
 */
export function seededPopulation(size, rng = makeRng(1), { wildcards = 0.15 } = {}) {
  const order = [...ARCHETYPES];
  // shuffle so a small pool isn't always beetle-first
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const pop = [];
  for (let i = 0; i < size; i++) {
    if (rng() < wildcards) {
      const g = {};
      for (const name of GENE_ORDER) {
        const spec = GENE_SPECS[name];
        g[name] = clampGene(name, rng.range(spec.min, spec.max));
      }
      pop.push(normalizeGenome(g));
    } else {
      pop.push(genomeFromArchetype(order[i % order.length], rng));
    }
  }
  return pop;
}

/**
 * Best-guess archetype for an evolved genome — purely for the HUD label, it has
 * no effect on the simulation. Nearest neighbour over the biased genes only.
 */
export function nearestArchetype(genome) {
  let best = null;
  let bestD = Infinity;
  for (const a of ARCHETYPES) {
    let d = 0;
    let n = 0;
    for (const [k, target] of Object.entries(a.bias)) {
      const spec = GENE_SPECS[k];
      const span = spec.max - spec.min || 1;
      d += ((genome[k] - target) / span) ** 2;
      n++;
    }
    d = Math.sqrt(d / Math.max(1, n));
    if (d < bestD) { bestD = d; best = a; }
  }
  // beyond this the genome isn't really any of them any more
  return { archetype: best, distance: bestD, confident: bestD < 0.26 };
}
