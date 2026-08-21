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
      body_segments: 2, body_width: 0.72, body_mass: 0.80,
      head_width: 0.343, head_length: 0.343, thorax_width: 0.494, thorax_length: 0.494,
      abdomen_width: 0.41, abdomen_length: 0.41, abdomen_taper: 0.25,
      leg_count: 6, leg_length: 0.28, leg_thickness: 0.72, leg_joints: 1,
      wing_count: 2, wing_type: 1, wing_area: 0.20, wing_beat: 0.35,
      mandible_size: 0.55, mandible_serration: 0.45, horn_size: 0.85, horn_type: 0, eye_type: 1, mandible_type: 0, crown_mark_style: 1,
      spikyness: 0.30, tail_length: 0.10, stinger_size: 0.02,
      eye_count: 2, eye_size: 0.30, antenna_length: 0.35,
      metabolism: 0.30, aggression: 0.55,
      saturation: 0.30, lightness: 0.22, setae: 0.15, translucency: 0.05,
    },
  },
  {
    key: 'wasp',
    name: 'Wasp',
    blurb: 'Fast flier with a stinger. Light, aggressive, venomous, almost no armour.',
    spread: 0.10,
    bias: {
      body_segments: 2, body_width: 0.24, body_mass: 0.18,
      head_width: 0.363, head_length: 0.363, thorax_width: 0.431, thorax_length: 0.431,
      abdomen_width: 0.41, abdomen_length: 0.41, abdomen_taper: 0.85,
      leg_count: 6, leg_length: 0.55, leg_thickness: 0.22, leg_joints: 1,
      wing_count: 4, wing_type: 0, wing_area: 0.80, wing_beat: 0.90,
      // slender crescent blades, swept well back, gold-tipped (coefficient 0.80)
      wing_length: 0.85, wing_width: 0.12, wing_roundness: 0.15, wing_angle: 0.95, wing_tip_hue: 5,
      mandible_size: 0.30, mandible_serration: 0.30, horn_size: 0.02, horn_type: 4, eye_type: 0, mandible_type: 2,
      spikyness: 0.10, tail_length: 0.55, stinger_size: 0.90,
      eye_count: 2, eye_size: 0.62, antenna_length: 0.50,
      metabolism: 0.85, aggression: 0.85,
      hue: 0.14, saturation: 0.92, lightness: 0.55,
      pattern_leg: 0, pattern_contrast: 0.95, setae: 0.25, translucency: 0.15,
    },
  },
  {
    key: 'spider',
    name: 'Spider',
    blurb: 'Eight legs, many eyes, no wings. Big vision radius, ambushes with venomous fangs.',
    // TIGHTER than the rest. A spider is defined by two COUNTS — eight legs and
    // eight eyes — and at 0.10 the jitter on a 2–12 count gene is a full leg
    // pair of sigma, so half the draws walked off the arachnid plan entirely
    // and classified as something else. 0.06 keeps the counts while leaving the
    // continuous genes plenty of room.
    spread: 0.06,
    bias: {
      body_segments: 2, body_width: 0.62, body_mass: 0.35,
      head_width: 0.262, head_length: 0.262, thorax_width: 0.369, thorax_length: 0.369,
      abdomen_width: 0.41, abdomen_length: 0.41, abdomen_taper: 0.20,
      leg_count: 8, leg_length: 0.92, leg_thickness: 0.28, leg_joints: 1,
      wing_count: 0, wing_type: 0, wing_area: 0.0, wing_beat: 0.0,
      mandible_size: 0.62, mandible_serration: 0.70, horn_size: 0.05, horn_type: 1, eye_type: 1, mandible_type: 2, crown_mark_style: 2,
      spikyness: 0.25, tail_length: 0.15, stinger_size: 0.55,
      eye_count: 8, eye_size: 0.45, antenna_length: 0.12,
      metabolism: 0.45, aggression: 0.70,
      saturation: 0.25, lightness: 0.18, setae: 0.70, translucency: 0.05,
    },
  },
  {
    key: 'roach',
    name: 'Roach',
    blurb: 'Flat, fast, drab. Survives on speed, stamina and camouflage rather than force.',
    spread: 0.11,
    bias: {
      body_segments: 3, body_width: 0.50, body_mass: 0.30,
      head_width: 0.228, head_length: 0.228, thorax_width: 0.4, thorax_length: 0.4,
      abdomen_width: 0.41, abdomen_length: 0.41, abdomen_taper: 0.35,
      leg_count: 6, leg_length: 0.62, leg_thickness: 0.35, leg_joints: 1,
      wing_count: 2, wing_type: 1, wing_area: 0.35, wing_beat: 0.45,
      mandible_size: 0.25, mandible_serration: 0.25, horn_size: 0.02, horn_type: 3, eye_type: 2, mandible_type: 2,
      spikyness: 0.45, tail_length: 0.45, stinger_size: 0.05,
      eye_count: 2, eye_size: 0.35, antenna_length: 0.95,
      metabolism: 0.55, aggression: 0.25,
      hue: 0.08, saturation: 0.35, lightness: 0.24,
      pattern_leg: 1, setae: 0.30, translucency: 0.10,
    },
  },
  {
    key: 'mantis',
    name: 'Mantis',
    blurb: 'Long body, hooked forelimbs. Slow to move, devastating in reach — a duelist.',
    spread: 0.10,
    bias: {
      body_segments: 3, body_width: 0.26, body_mass: 0.32,
      head_width: 0.316, head_length: 0.316, thorax_width: 0.62, thorax_length: 0.62,
      abdomen_width: 0.41, abdomen_length: 0.41, abdomen_taper: 0.60,
      // leg_spread is pinned rather than left to the random draw: the Mantis
      // window asks for a wide stance now that `foot_size` is gone, and "reach
      // as a weapon" is exactly what a wide stance on long legs describes.
      leg_count: 6, leg_length: 0.78, leg_thickness: 0.32, leg_joints: 1, leg_spread: 0.88,
      wing_count: 2, wing_type: 0, wing_area: 0.45, wing_beat: 0.30,
      // mid-slenderness oval blades held close to the body (coefficient 0.59)
      wing_length: 0.70, wing_width: 0.25, wing_roundness: 0.30, wing_angle: 0.80, wing_tip_hue: 0,
      mandible_size: 0.70, mandible_serration: 0.85, horn_size: 0.10, horn_type: 3, eye_type: 0, mandible_type: 2,
      spikyness: 0.55, tail_length: 0.25, stinger_size: 0.05,
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
      body_segments: 2, body_width: 0.45, body_mass: 0.15,
      head_width: 0.275, head_length: 0.275, thorax_width: 0.463, thorax_length: 0.463,
      abdomen_width: 0.41, abdomen_length: 0.41, abdomen_taper: 0.45,
      leg_count: 6, leg_length: 0.38, leg_thickness: 0.20, leg_joints: 0,
      wing_count: 4, wing_type: 0, wing_area: 0.98, wing_beat: 0.55,
      // huge broad leaf blades, cream-tipped (coefficient -0.03 -> leaf)
      wing_length: 0.60, wing_width: 0.82, wing_roundness: 0.85, wing_angle: 0.70, wing_tip_hue: 8,
      mandible_size: 0.08, mandible_serration: 0.05, horn_size: 0.02, horn_type: 4, eye_type: 2, mandible_type: 2,
      spikyness: 0.05, tail_length: 0.20, stinger_size: 0.02,
      eye_count: 2, eye_size: 0.72, antenna_length: 0.80,
      metabolism: 0.60, aggression: 0.10,
      saturation: 0.20, lightness: 0.62,
      pattern_leg: 0, setae: 0.95, translucency: 0.30,
    },
  },
  {
    key: 'centipede',
    name: 'Centipede',
    blurb: 'Ten legs on a long segmented body. Quick, spiny, venomous, poorly armoured.',
    spread: 0.10,
    bias: {
      body_segments: 8, body_width: 0.20, body_mass: 0.28,
      head_width: 0.208, head_length: 0.208, thorax_width: 0.337, thorax_length: 0.337,
      abdomen_width: 0.41, abdomen_length: 0.41, abdomen_taper: 0.70,
      leg_count: 10, leg_length: 0.48, leg_thickness: 0.18, leg_joints: 0,
      wing_count: 0, wing_type: 0, wing_area: 0.0, wing_beat: 0.0,
      mandible_size: 0.48, mandible_serration: 0.60, horn_size: 0.05, horn_type: 1, eye_type: 2, mandible_type: 1,
      spikyness: 0.80, tail_length: 0.75, stinger_size: 0.65,
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
      // body_mass raised 0.55 -> 0.75: it now also carries the Weevil window's
      // old carapace_thickness floor (>= 0.52), and 0.55 sat too close to that
      // floor for an 11%-spread jitter to reliably clear it.
      body_segments: 2, body_width: 0.58, body_mass: 0.75,
      head_width: 0.262, head_length: 0.262, thorax_width: 0.4, thorax_length: 0.4,
      abdomen_width: 0.41, abdomen_length: 0.41, abdomen_taper: 0.15,
      leg_count: 6, leg_length: 0.30, leg_thickness: 0.45, leg_joints: 0,
      wing_count: 2, wing_type: 1, wing_area: 0.15, wing_beat: 0.25,
      mandible_size: 0.20, mandible_serration: 0.15, horn_size: 0.95, horn_type: 2, eye_type: 1, mandible_type: 2,
      spikyness: 0.35, tail_length: 0.08, stinger_size: 0.02,
      eye_count: 2, eye_size: 0.28, antenna_length: 0.55,
      metabolism: 0.28, aggression: 0.30,
      saturation: 0.30, lightness: 0.20,
      pattern_leg: 0, setae: 0.45, translucency: 0.05,
    },
  },
];

/**
 * MIGRATION NOTE — `mandible_type` 3 no longer exists.
 *
 * `chelicerae_teeth` (2) and `chelicerae_smooth` (3) merged into one
 * `chelicerae` at index 2, with the fang moved onto `mandible_serration ≥ 1`.
 * Every archetype that pinned 3 now pins 2, and each one keeps the jaw it was
 * drawn with, because their serration values already fall on the right side:
 * Wasp .30, Roach .25, Moth .05 and Weevil .15 all bucket to 0 and stay
 * fang-less exactly as `smooth` was, while Spider .70 and Mantis .85 — the two
 * that pinned the toothed variant — bucket to 2 and keep their fang.
 *
 * `pattern` was likewise split three ways. Every archetype that set it set it
 * for the LIMB reading (a roach at 0.9 is a drab bug with black legs, not a bug
 * asking for an oval highlight on its jaws), so each moved to `pattern_leg` at
 * the same value; none of them ever expressed an opinion about horn or jaw
 * surface, so they take the flat default.
 */
export const ARCHETYPE_KEYS = ARCHETYPES.map((a) => a.key);

/**
 * Genes ending in `_type` are CATEGORICAL, not continuous — horn_type 2 isn't
 * "between" 1 and 3, it's a different horn. Gaussian jitter on them turned
 * wasps into nose-horned wasps, so they hold their archetype's value with only
 * an occasional jump to a neighbouring kind.
 */
const isCategorical = (name) => name.endsWith('_type');

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
    if (isCategorical(name)) {
      // 12% of the time, step to an adjacent kind — enough variety that a
      // lineage can drift, not so much that the archetype stops reading.
      const drift = rng() < 0.12 ? (rng() < 0.5 ? -1 : 1) : 0;
      g[name] = clampGene(name, target + drift);
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
