// Classification layer.
//
// The governing rule of this project is that stats are a PURE function of genes.
// Classification is a second, equally pure read off the same vector: no time, no
// randomness, no world state, no history. Two genomes with identical genes always
// classify identically, forever.
//
// Two things are computed here and they are deliberately different in kind:
//
//   1. CLADE BRACKETS (`cladeOf`) — mechanical partitions on a handful of
//      keystone genes. Every genome always lands in one bracket per axis. No
//      authoring required, no gaps, no overlaps.
//
//   2. THE CHASSIS TREE (`CLASS_TREE`) — hand-authored gene windows arranged in
//      a parent/child tree. A genome matches the deepest node whose window it
//      satisfies. Most genomes match nothing below Larva, and that is correct:
//      a taxon is supposed to be an achievement.
//
// The interesting part is the seam between them. Chassis windows never constrain
// `leg_count`, so breeding a Beetle from six legs to eight does not turn it into
// a Spider — it keeps Beetle's armour windows while its clade bracket flips to
// arachnid, and the result reads as an "Armoured Arachnid". Hybrids fall out of
// the two systems disagreeing rather than from a special case.

import { GENE_SPECS } from './genes.js';

/* ------------------------------------------------------------------ windows */

/**
 * A window is `{ gene: [min, max] }`. A bare number means an exact value.
 * Doc shorthand maps in: `x ≥ 0.5` -> `[0.5, 1]`, `x ≤ 0.3` -> `[0, 0.3]`,
 * `x = 4` -> `4`, `x ∈ [4,6]` -> `[4, 6]`.
 */
function bounds(spec, range) {
  if (typeof range === 'number') return [range, range];
  return [range[0], range[1]];
}

/** Does a genome satisfy every constraint in a window? Total, never throws. */
export function matchesWindow(genome, window) {
  for (const [gene, range] of Object.entries(window ?? {})) {
    const spec = GENE_SPECS[gene];
    if (!spec) return false;
    const [lo, hi] = bounds(spec, range);
    const v = genome[gene];
    if (!(v >= lo && v <= hi)) return false;
  }
  return true;
}

/**
 * How far outside a window a genome sits, in gene-range units summed over the
 * constraints it misses. 0 means it matches. Used to answer "what is this bug
 * closest to becoming" without ever showing the player a number.
 */
export function windowDistance(genome, window) {
  let d = 0;
  const missing = [];
  for (const [gene, range] of Object.entries(window ?? {})) {
    const spec = GENE_SPECS[gene];
    if (!spec) continue;
    const [lo, hi] = bounds(spec, range);
    const span = (spec.max - spec.min) || 1;
    const v = genome[gene];
    let gap = 0;
    if (v < lo) gap = (lo - v) / span;
    else if (v > hi) gap = (v - hi) / span;
    if (gap > 0) {
      d += gap;
      missing.push({ gene, need: v < lo ? 'more' : 'less', gap });
    }
  }
  return { distance: d, missing };
}

/** Constraint count — a tie-break so a tighter sibling wins over a looser one. */
function specificity(window) {
  return Object.keys(window ?? {}).length;
}

/* ---------------------------------------------------------- keystone axes -- */

/**
 * §4 of the taxonomy doc: a few unclaimed genes partition the whole population
 * on their own. These brackets are total — every genome is in exactly one
 * bracket per axis — so they never need authoring or maintenance as taxa grow.
 */
export const CLADE_AXES = {
  legPlan: {
    gene: 'leg_count',
    brackets: [
      // leg_count widened to 2..12; the brackets stretch to stay total, so a
      // two-legger is still a hexapod-bracket bug and a twelve-legger a myriapod.
      { key: 'hexapod',  label: 'Hexapod',  range: [2, 6] },
      { key: 'arachnid', label: 'Arachnid', range: [8, 8] },
      { key: 'myriapod', label: 'Myriapod', range: [10, 12] },
    ],
  },
  wingPlan: {
    gene: 'wing_count',
    brackets: [
      { key: 'apterous',     label: 'Wingless',   range: [0, 0] },
      { key: 'dipterous',    label: 'One pair',   range: [2, 2] },
      { key: 'tetrapterous', label: 'Two pairs',  range: [4, 6] },
    ],
  },
  massClass: {
    gene: 'body_mass',
    brackets: [
      { key: 'micro',    label: 'Micro',    range: [0, 0.18] },
      { key: 'standard', label: 'Standard', range: [0.18, 0.80] },
      { key: 'titan',    label: 'Titan',    range: [0.80, 1] },
    ],
  },
};

/** Venom bracket — reads two genes, so it isn't a simple range table. */
function venomClass(g) {
  if (g.stinger_size < 0.08) return 'none';
  const score = g.stinger_size * 0.7 + g.tail_length * 0.3;
  if (score < 0.45) return 'mild';
  if (score < 0.75) return 'potent';
  return 'lethal';
}

/** Concealment axis — whichever surface strategy the genome commits to. */
function surfaceClass(g) {
  const candidates = [
    ['ghost',   g.translucency],
    ['radiant', g.iridescence],
    ['furred',  g.setae],
  ];
  let best = candidates[0];
  for (const c of candidates) if (c[1] > best[1]) best = c;
  return best[1] < 0.40 ? 'ironclad' : best[0];
}

function bracketFor(axis, value) {
  for (const b of axis.brackets) {
    if (value >= b.range[0] && value <= b.range[1]) return b.key;
  }
  return axis.brackets[axis.brackets.length - 1].key;
}

/** Pure: genome -> its bracket on every keystone axis. Total for any genome. */
export function cladeOf(genome) {
  return {
    legPlan:   bracketFor(CLADE_AXES.legPlan,   genome.leg_count),
    wingPlan:  bracketFor(CLADE_AXES.wingPlan,  genome.wing_count),
    massClass: bracketFor(CLADE_AXES.massClass, genome.body_mass),
    venomClass: venomClass(genome),
    surfaceClass: surfaceClass(genome),
  };
}

export const CLADE_LABEL = {
  hexapod: 'Hexapod', arachnid: 'Arachnid', myriapod: 'Myriapod',
};

/* ------------------------------------------------------------ chassis tree */

/**
 * Node shape (per the doc): { taxon, tier, parent, window, locks, unlocks,
 * specialty }. Added here:
 *
 *   order      flavour grouping; the real-world Order this sits in
 *   clade      the leg bracket this chassis natively belongs to. NOT part of
 *              the window — a mismatch produces a hybrid, not a rejection
 *   adjective  used to name hybrids ("Armoured" + "Arachnid")
 *   status     'coded' (was already in classification.js in the design doc),
 *              'drafted' (window sketched in §3b, now live)
 *
 * `locks` are genes a lineage sitting on this node holds steady through
 * breeding; `unlocks` are genes whose mutation range widens. Both are consumed
 * by `breedingMask()` — nothing here mutates a genome itself.
 */
export const CLASS_TREE = {
  /* ---- tier 0 ---- */
  larva: {
    taxon: 'Larva', tier: 0, parent: null, order: null,
    clade: null, adjective: 'Larval', status: 'coded',
    window: {}, locks: [], unlocks: [], specialty: null,
    blurb: 'Undifferentiated. Everything starts here and most things stay here.',
  },

  /* ---- tier 1: orders ---- */
  beetle: {
    taxon: 'Beetle', tier: 1, parent: 'larva', order: 'Coleoptera',
    clade: 'hexapod', adjective: 'Armoured', status: 'coded',
    // The wing_area ceiling is the named hard wall from §4: Beetle and Moth now
    // constrain the same gene in opposite directions, so a lineage crossing
    // between them must pass through a stretch of gene-space satisfying neither.
    window: {
      carapace_thickness: [0.55, 1],
      horn_size: [0.50, 1],
      leg_length: [0, 0.45],
      wing_area: [0, 0.35],
    },
    locks: ['wing_area', 'wing_beat'],
    unlocks: ['spine_density', 'leg_thickness'],
    specialty: null,
    blurb: 'Shell first. Short legs, heavy front end, wings kept folded away.',
  },
  wasp: {
    taxon: 'Wasp', tier: 1, parent: 'larva', order: 'Hymenoptera',
    clade: 'hexapod', adjective: 'Venom', status: 'coded',
    window: { wing_count: 4, stinger_size: [0.60, 1], carapace_thickness: [0, 0.30] },
    locks: ['carapace_thickness', 'body_mass'],
    unlocks: ['wing_beat', 'tail_length'],
    specialty: null,
    blurb: 'Four wings and a delivery system. Nothing spare anywhere else.',
  },
  roach: {
    taxon: 'Roach', tier: 1, parent: 'larva', order: 'Blattodea',
    clade: 'hexapod', adjective: 'Skittering', status: 'coded',
    // `pattern` split three ways; this window wanted the LIMB reading — a drab
    // roach with black legs — so it moved to `pattern_leg` at the same numbers.
    window: { antenna_length: [0.75, 1], pattern_leg: [0.7, 1], aggression: [0, 0.4] },
    locks: [], unlocks: ['metabolism'], specialty: null,
    blurb: 'Feels the room before it sees it. Avoids every fight it can.',
  },
  mantis: {
    taxon: 'Mantis', tier: 1, parent: 'larva', order: 'Mantodea',
    clade: 'hexapod', adjective: 'Hooked', status: 'coded',
    // `foot_size` is gone (every bug now wears the maximum pad), so the reach
    // this window was really describing is stated with the two genes that still
    // carry it: a long body on long legs, held in a wide stance.
    window: { leg_spread: [0.70, 1], body_length: [0.75, 1], leg_length: [0.60, 1] },
    locks: [], unlocks: ['leg_spread'], specialty: null,
    blurb: 'Reach as a weapon. Waits, then closes the distance once.',
  },
  moth: {
    taxon: 'Moth', tier: 1, parent: 'larva', order: 'Lepidoptera',
    clade: 'hexapod', adjective: 'Winged', status: 'coded',
    window: { wing_area: [0.85, 1], setae: [0.75, 1], mandible_size: [0, 0.20] },
    locks: ['mandible_size'], unlocks: ['wing_area', 'setae'], specialty: null,
    blurb: 'All surface, no bite. Drifts more than it flies.',
  },
  odonata: {
    taxon: 'Dragonfly', tier: 1, parent: 'larva', order: 'Odonata',
    clade: 'hexapod', adjective: 'Hawking', status: 'drafted',
    // §3b: nothing else claims high eye_count and high wing_area together.
    window: {
      wing_area: [0.7, 1], eye_count: [6, 8], eye_size: [0.6, 1], aggression: [0.5, 1],
    },
    locks: ['eye_count'], unlocks: ['wing_beat'], specialty: null,
    blurb: 'Eyes built for interception. Hunts on the wing and nowhere else.',
  },
  diptera: {
    taxon: 'Fly', tier: 1, parent: 'larva', order: 'Diptera',
    clade: 'hexapod', adjective: 'Darting', status: 'drafted',
    window: {
      wing_count: 2, wing_beat: [0.72, 1], body_mass: [0, 0.30], mandible_size: [0, 0.25],
    },
    locks: ['wing_count'], unlocks: ['wing_beat', 'metabolism'], specialty: null,
    blurb: 'One pair of wings beaten absurdly fast. Impossible to corner.',
  },
  hemiptera: {
    taxon: 'True Bug', tier: 1, parent: 'larva', order: 'Hemiptera',
    clade: 'hexapod', adjective: 'Beaked', status: 'drafted',
    window: {
      // horn_type 2 was `rostrum`, the long snout. The horn redesign replaced
      // that shape with `y_shaped` and left no snout in the set, so the beaked
      // taxa keep the index they always pinned and inherit the fork instead.
      // The window is unchanged; only the shape behind index 2 is.
      horn_type: 2,                      // y_shaped (was rostrum)
      horn_size: [0.35, 0.78],
      mandible_size: [0, 0.30],
      carapace_thickness: [0.25, 0.65],
    },
    locks: ['horn_type'], unlocks: ['horn_size'], specialty: null,
    blurb: 'A beak instead of jaws. Feeds without ever opening its mouth.',
  },
  orthoptera: {
    taxon: 'Grasshopper', tier: 1, parent: 'larva', order: 'Orthoptera',
    clade: 'hexapod', adjective: 'Springing', status: 'drafted',
    window: {
      leg_length: [0.70, 1], leg_thickness: [0.55, 1],
      antenna_length: [0.45, 1], body_length: [0.45, 1],
    },
    locks: [], unlocks: ['leg_thickness', 'leg_spread'], specialty: null,
    blurb: 'Back legs loaded like a spring. Travels in jumps, not steps.',
  },

  /* ---- tier 1: the two non-hexapod brackets ----
     §5 asked for these to be pure leg_count brackets rather than hand-authored
     windows, so that any chassis can drift into them symmetrically. Their
     windows are empty on purpose: membership is decided by the clade axis. */
  arachnid: {
    taxon: 'Arachnid', tier: 1, parent: 'larva', order: 'Arachnida',
    clade: 'arachnid', adjective: 'Eight-legged', status: 'coded',
    window: {}, locks: [], unlocks: [], specialty: null, bracketNode: true,
    blurb: 'Eight legs. Whatever else it is, it is this first.',
  },
  myriapod: {
    taxon: 'Myriapod', tier: 1, parent: 'larva', order: 'Myriapoda',
    clade: 'myriapod', adjective: 'Many-legged', status: 'coded',
    window: {}, locks: [], unlocks: [], specialty: null, bracketNode: true,
    blurb: 'Ten legs on a body built in repeating parts.',
  },

  /* ---- Coleoptera: tier 2 under Beetle, except the Firefly ----
     The Firefly is grouped here because its ORDER is Coleoptera, but it hangs
     off Larva at tier 1 — see the note on the node. Order and parent are
     allowed to disagree; that is the same seam hybrids fall out of. */
  armored_beetle: {
    taxon: 'Armoured Beetle', tier: 2, parent: 'beetle', order: 'Coleoptera',
    clade: 'hexapod', adjective: 'Ironclad', status: 'coded',
    window: {
      carapace_thickness: [0.75, 1], spine_density: [0.45, 1], leg_thickness: [0.50, 1],
    },
    locks: ['body_length'], unlocks: ['horn_size'],
    specialty: { key: 'armor_plating', name: 'Armour Plating', mods: { defense: 1.15 } },
    blurb: 'Shell thickened past the point of grace.',
  },
  thorax_goliath: {
    taxon: 'Thorax Goliath', tier: 2, parent: 'beetle', order: 'Coleoptera',
    clade: 'hexapod', adjective: 'Titanic', status: 'coded',
    window: { body_mass: [0.75, 1], leg_thickness: [0.60, 1], body_length: [0.50, 1] },
    locks: ['antenna_length'], unlocks: ['leg_count', 'body_segments'],
    specialty: {
      key: 'overwhelming_mass', name: 'Overwhelming Mass',
      mods: { attack: 1.10, health: 1.08 },
    },
    blurb: 'Wins by being more animal than the other animal.',
  },
  dynastinae: {
    taxon: 'Rhinoceros Beetle', tier: 2, parent: 'beetle', order: 'Coleoptera',
    clade: 'hexapod', adjective: 'Horned', status: 'drafted',
    window: {
      horn_type: 0, horn_size: [0.85, 1], body_mass: [0.70, 1],    // nose (was rhino)
      carapace_thickness: [0.60, 1],
    },
    locks: ['horn_type'], unlocks: ['horn_size', 'body_mass'],
    specialty: { key: 'leverage', name: 'Leverage', mods: { attack: 1.12 } },
    blurb: 'Max horn over max shell. Fights by getting underneath things.',
  },
  lucanidae: {
    taxon: 'Stag Beetle', tier: 2, parent: 'beetle', order: 'Coleoptera',
    clade: 'hexapod', adjective: 'Antlered', status: 'drafted',
    window: {
      horn_type: 1, mandible_size: [0.80, 1], mandible_serration: [0.5, 1],   // pincer (was stag)
      carapace_thickness: [0.4, 0.7],
    },
    locks: ['horn_type'], unlocks: ['mandible_size', 'mandible_serration'],
    specialty: { key: 'locking_jaws', name: 'Locking Jaws', mods: { attack: 1.14, attackRate: 0.92 } },
    blurb: 'Jaw-weapon build. Trades shell for something to grab with.',
  },
  buprestidae: {
    taxon: 'Jewel Beetle', tier: 2, parent: 'beetle', order: 'Coleoptera',
    clade: 'hexapod', adjective: 'Radiant', status: 'drafted',
    window: {
      iridescence: [0.75, 1], saturation: [0.6, 1], carapace_thickness: [0.3, 0.6],
    },
    locks: ['iridescence'], unlocks: ['hue', 'saturation'],
    specialty: { key: 'dazzle', name: 'Dazzle', mods: { agility: 1.08, camouflage: 0.88 } },
    blurb: 'Beauty over brawn. Visible from across the terrarium, and knows it.',
  },
  carabidae: {
    taxon: 'Ground Beetle', tier: 2, parent: 'beetle', order: 'Coleoptera',
    clade: 'hexapod', adjective: 'Coursing', status: 'drafted',
    // Carabidae is a beetle family, so this stays under Coleoptera — the same
    // call §5 made for the Weevil. That means the window has to fit INSIDE
    // Beetle's rather than argue with it: the blurb already says "quick FOR A
    // BEETLE", and long-for-a-beetle is the top of Beetle's leg range, not a
    // mantis's legs. Drafted as leg_length [0.60, 1] against a parent capped at
    // 0.45, which is a contradiction and made the taxon unreachable.
    //
    // Carapace was drafted at [0.35, 0.6] too, which merged with Beetle's
    // [0.55, 1] down to a 0.05-wide slice — legal, but so narrow that nothing
    // would ever breed into it. Widened to a real "moderate armour" band.
    window: {
      leg_length: [0.34, 0.45], aggression: [0.6, 1], carapace_thickness: [0.55, 0.75],
    },
    locks: [], unlocks: ['leg_length', 'aggression'],
    specialty: { key: 'run_down', name: 'Run Down', mods: { speed: 1.10 } },
    blurb: 'Predatory and quick for a beetle. Chases rather than waits.',
  },
  lampyridae: {
    // Re-parented off Beetle. Its whole idea is the negation of its parent's:
    // "gave up its shell" against a chassis whose single defining gene is
    // carapace >= 0.55. Narrowing it to fit would delete the concept, and
    // loosening Beetle's floor would delete Beetle. So it hangs off Larva and
    // keeps `order: Coleoptera` — the order field carries the real-world
    // relationship while the chassis tree parents by gene compatibility, the
    // same split §5 already made for Arachnid and Myriapod.
    //
    // Tightened while moving. Standing at tier 1 on three loose genes, it
    // started taking genomes off the Wasp — and a bug with a stinger is better
    // described by the stinger than by its markings. `wing_type: 1` is elytra,
    // the hard wing cases, which is what still makes this a beetle underneath
    // the soft body and what a wasp categorically does not have. A kind gene
    // carrying the taxonomic weight, the same way the Rhinoceros Beetle pins
    // horn_type.
    taxon: 'Firefly', tier: 1, parent: 'larva', order: 'Coleoptera',
    clade: 'hexapod', adjective: 'Glimmering', status: 'drafted',
    window: {
      wing_count: [2, 4], wing_type: 1, carapace_thickness: [0, 0.35],
      pattern_contrast: [0.7, 1],
    },
    locks: [], unlocks: ['pattern_contrast', 'wing_area'],
    specialty: { key: 'cold_light', name: 'Cold Light', mods: { vision: 1.15, camouflage: 0.85 } },
    blurb: 'A beetle that gave up its shell to fly at night.',
  },
  coccinellidae: {
    taxon: 'Ladybird', tier: 2, parent: 'beetle', order: 'Coleoptera',
    clade: 'hexapod', adjective: 'Spotted', status: 'drafted',
    window: {
      carapace_thickness: [0.4, 0.65], pattern_contrast: [0.8, 1], aggression: [0, 0.3],
    },
    // Spotted: the surface treatments, both of them, on their own genes now.
    locks: ['pattern_contrast'], unlocks: ['pattern_horn', 'pattern_mandible'],
    specialty: { key: 'aposematic', name: 'Warning Colours', mods: { defense: 1.10 } },
    blurb: 'Warning colouration instead of armour. Nothing wants to bite it twice.',
  },
  // §5 resolved: Weevil is Curculionidae, a beetle family. It was a stray
  // Tier-1 root; it now sits where it belongs, under Coleoptera.
  weevil: {
    taxon: 'Weevil', tier: 2, parent: 'beetle', order: 'Coleoptera',
    clade: 'hexapod', adjective: 'Snouted', status: 'coded',
    // The doc drafted [0.80, 0.45, 0.55]. Widened slightly: those thresholds
    // predate the weevil archetype's spread, and against it roughly a third of
    // draws fell outside their own taxon. A starting archetype should read as
    // the thing it was drawn for.
    window: {
      horn_type: 2, horn_size: [0.72, 1], body_width: [0.42, 1],   // y_shaped (was rostrum)
      carapace_thickness: [0.52, 1],
    },
    locks: ['horn_type'], unlocks: ['horn_size'],
    specialty: { key: 'boring_snout', name: 'Boring Snout', mods: { attack: 1.06, defense: 1.06 } },
    blurb: 'Small, round, and absurdly long in the face.',
  },

  /* ---- tier 2: Hymenoptera ---- */
  venom_striker: {
    taxon: 'Venom Striker', tier: 2, parent: 'wasp', order: 'Hymenoptera',
    clade: 'hexapod', adjective: 'Envenomed', status: 'coded',
    window: { stinger_size: [0.80, 1], tail_length: [0.60, 1] },
    locks: ['carapace_thickness'], unlocks: ['aggression'],
    specialty: { key: 'concentrated_venom', name: 'Concentrated Venom', mods: { venom: 1.20 } },
    blurb: 'The whole abdomen is a syringe.',
  },
  swift_flier: {
    taxon: 'Swift Flier', tier: 2, parent: 'wasp', order: 'Hymenoptera',
    clade: 'hexapod', adjective: 'Fleet', status: 'coded',
    window: { wing_beat: [0.75, 1], wing_area: [0.70, 1], body_mass: [0, 0.25] },
    locks: ['stinger_size'], unlocks: ['leg_spread'],
    specialty: { key: 'aerial_mastery', name: 'Aerial Mastery', mods: { speed: 1.10, flight: 1.15 } },
    blurb: 'Gave up mass for airspeed and never looked back.',
  },
  // §5 resolved: Hornet reads as "aggressive Wasp", so it nests under Wasp
  // rather than sitting beside it as a Hymenoptera sibling.
  vespidae: {
    taxon: 'Hornet', tier: 2, parent: 'wasp', order: 'Hymenoptera',
    clade: 'hexapod', adjective: 'Furious', status: 'drafted',
    window: {
      aggression: [0.80, 1], body_mass: [0.25, 0.55], mandible_size: [0.40, 1],
    },
    locks: [], unlocks: ['aggression', 'mandible_size'],
    specialty: { key: 'harrying', name: 'Harrying', mods: { attackRate: 1.12 } },
    blurb: 'Stings and bites. Starts fights it has no reason to start.',
  },

  /* ---- tier 2: Arachnida ---- */
  spider: {
    taxon: 'Spider', tier: 2, parent: 'arachnid', order: 'Arachnida',
    clade: 'arachnid', adjective: 'Stalking', status: 'coded',
    window: { wing_count: 0, eye_count: [6, 8] },
    locks: ['wing_count'], unlocks: ['eye_size', 'setae'], specialty: null,
    blurb: 'Sees in every direction at once and never leaves the ground.',
  },
  scorpiones: {
    taxon: 'Scorpion', tier: 2, parent: 'arachnid', order: 'Arachnida',
    clade: 'arachnid', adjective: 'Barbed', status: 'drafted',
    window: {
      // `foot_size` dropped with the gene. The remaining three are what
      // actually made a scorpion a scorpion — armoured AND venomous at once.
      stinger_size: [0.7, 1], tail_length: [0.6, 1],
      carapace_thickness: [0.5, 1],
    },
    locks: ['tail_length'], unlocks: ['stinger_size', 'carapace_thickness'],
    specialty: { key: 'pincer_and_tail', name: 'Pincer and Tail', mods: { venom: 1.12, defense: 1.08 } },
    blurb: 'Armoured and venomous at once, which is rare and unfair.',
  },

  /* ---- tier 2: Myriapoda ---- */
  centipede: {
    taxon: 'Centipede', tier: 2, parent: 'myriapod', order: 'Myriapoda',
    clade: 'myriapod', adjective: 'Rippling', status: 'coded',
    window: { spine_density: [0.65, 1], stinger_size: [0.15, 1] },
    locks: [], unlocks: ['tail_length', 'spine_density'], specialty: null,
    blurb: 'Predatory and fast for something with that many legs to coordinate.',
  },
  diplopoda: {
    taxon: 'Millipede', tier: 2, parent: 'myriapod', order: 'Myriapoda',
    clade: 'myriapod', adjective: 'Coiling', status: 'drafted',
    window: { spine_density: [0.7, 1], stinger_size: [0, 0.1] },
    locks: ['stinger_size'], unlocks: ['carapace_thickness'],
    specialty: { key: 'curl', name: 'Curl', mods: { defense: 1.14, speed: 0.92 } },
    blurb: 'Defence-curl instead of venom. The inverse of a centipede.',
  },

  /* ---- Lepidoptera: the Butterfly, now a sibling of the Moth rather than a
     child of it. Same order, incompatible surface — see the note on the node. */
  butterfly: {
    // Re-parented off Moth, for the same reason the Firefly left Beetle: the
    // blurb promises "opposite surface entirely" and Moth's identity includes
    // setae >= 0.75, so smooth-and-under-a-furred-parent cannot both be true.
    //
    // "Same chassis as a moth" is now STATED rather than inherited — wing_area
    // and mandible_size are copied onto this node explicitly. That keeps the
    // promise the blurb makes, and it keeps the §4 hard wall intact: a Butterfly
    // still sits on the far side of wing_area >= 0.85, so no Beetle lineage can
    // reach it without crossing the same gap it always had to.
    taxon: 'Butterfly', tier: 1, parent: 'larva', order: 'Lepidoptera',
    clade: 'hexapod', adjective: 'Painted', status: 'drafted',
    window: {
      wing_area: [0.85, 1], mandible_size: [0, 0.20], setae: [0, 0.3],
      pattern_contrast: [0.75, 1], saturation: [0.65, 1],
    },
    locks: [], unlocks: ['hue', 'pattern_horn'],
    specialty: { key: 'flash_colour', name: 'Flash Colour', mods: { agility: 1.10, camouflage: 0.85 } },
    blurb: 'Same chassis as a moth, opposite surface entirely.',
  },

  /* ---- tier 3 ---- */
  siege_tank_rhinoceros: {
    taxon: 'Siege-Tank Rhinoceros', tier: 3, parent: 'armored_beetle', order: 'Coleoptera',
    clade: 'hexapod', adjective: 'Siege', status: 'coded',
    window: { carapace_thickness: [0.90, 1], horn_size: [0.80, 1], leg_count: [4, 6] },
    locks: [], unlocks: [],
    specialty: {
      key: 'siege_plating', name: 'Siege Plating',
      mods: { defense: 1.25 }, replacesParent: true,
    },
    blurb: 'Stops being a bug and starts being terrain.',
  },
  apex_venom_wyrm: {
    taxon: 'Apex Venom Wyrm', tier: 3, parent: 'venom_striker', order: 'Hymenoptera',
    clade: 'hexapod', adjective: 'Apex', status: 'coded',
    window: { stinger_size: [0.90, 1], tail_length: [0.75, 1], aggression: [0.70, 1] },
    locks: [], unlocks: [],
    specialty: { key: 'apex_toxin', name: 'Apex Toxin', mods: { venom: 1.35 } },
    blurb: 'The end of the venom line. Nothing survives a second hit.',
  },
};

export const TAXON_IDS = Object.keys(CLASS_TREE);

/** children[parentId] -> [childId, ...], built once at module load. */
const CHILDREN = (() => {
  const map = {};
  for (const id of TAXON_IDS) map[id] = [];
  for (const id of TAXON_IDS) {
    const p = CLASS_TREE[id].parent;
    if (p) map[p].push(id);
  }
  return map;
})();

export function childrenOf(id) {
  return CHILDREN[id] ?? [];
}

/* ------------------------------------------------------------------ traits */

/**
 * Flat and stackable — orthogonal to the chassis. A bug can be a Ladybird that
 * is also Venomous and Camouflaged; nothing about the tree changes.
 * `appliesTo: null` means any chassis.
 */
export const TRAITS = {
  venomous: {
    name: 'Venomous', appliesTo: null,
    window: { stinger_size: [0.60, 1], tail_length: [0.40, 1] },
    unlocks: ['tail_length', 'aggression'],
    tell: 'moves like it expects one hit to be enough',
  },
  winged: {
    name: 'Winged',
    // Only remarkable on a chassis that normally stays on the ground.
    appliesTo: ['beetle', 'armored_beetle', 'thorax_goliath', 'weevil', 'spider', 'centipede', 'diplopoda'],
    window: { wing_count: [2, 4], wing_area: [0.45, 1] },
    unlocks: ['wing_beat'],
    tell: 'gets airborne when it has no business doing so',
  },
  camouflaged: {
    name: 'Camouflaged', appliesTo: null,
    window: { saturation: [0, 0.25], translucency: [0.55, 1] },
    unlocks: ['setae'],
    tell: 'you lose track of it against the substrate',
  },
};

export const TRAIT_IDS = Object.keys(TRAITS);

/** Pure: which flat traits a genome carries, given its chassis. */
export function traitsOf(genome, chassisId = null) {
  const out = [];
  for (const id of TRAIT_IDS) {
    const t = TRAITS[id];
    if (t.appliesTo && chassisId && !t.appliesTo.includes(chassisId)) continue;
    if (matchesWindow(genome, t.window)) out.push(id);
  }
  return out;
}

/* -------------------------------------------------------------- classify -- */

/**
 * Walk down from the root picking, at each level, the child that leads to the
 * DEEPEST identity the genome can actually reach — then, among equals, the
 * tightest window, then the one the genome sits furthest inside.
 *
 * Depth-first rather than greedy-first matters. A max-armour nose-horned
 * beetle matches both Rhinoceros Beetle (a leaf) and Armoured Beetle (which
 * has Siege-Tank Rhinoceros under it). Greedy specificity picks the leaf and
 * the tier-3 node becomes unreachable; preferring depth lets the lineage finish
 * the climb it qualified for.
 */
function bestPathFrom(genome, id, legPlan) {
  let best = null;
  for (const childId of childrenOf(id)) {
    const node = CLASS_TREE[childId];
    if (!matchesWindow(genome, node.window)) continue;
    // Bracket nodes only claim a genome whose clade actually matches.
    if (node.bracketNode && legPlan !== node.clade) continue;
    const sub = bestPathFrom(genome, childId, legPlan);
    const cand = {
      path: [childId, ...sub.path],
      depth: 1 + sub.depth,
      spec: specificity(node.window),
      margin: insideMargin(genome, node.window),
    };
    if (!best
      || cand.depth > best.depth
      || (cand.depth === best.depth && cand.spec > best.spec)
      || (cand.depth === best.depth && cand.spec === best.spec && cand.margin > best.margin)) {
      best = cand;
    }
  }
  return best ?? { path: [], depth: 0, spec: 0, margin: 0 };
}

function descend(genome, legPlan) {
  const best = bestPathFrom(genome, 'larva', legPlan);
  return { id: best.path[best.path.length - 1] ?? 'larva', path: ['larva', ...best.path] };
}

/** How comfortably a genome sits inside a window it already matches. */
function insideMargin(genome, window) {
  let total = 0;
  let n = 0;
  for (const [gene, range] of Object.entries(window ?? {})) {
    const spec = GENE_SPECS[gene];
    if (!spec) continue;
    const [lo, hi] = bounds(spec, range);
    const span = (spec.max - spec.min) || 1;
    const v = genome[gene];
    total += Math.min(v - lo, hi - v) / span;
    n++;
  }
  return n ? total / n : 0;
}

/**
 * The full read. Pure, total, and free of randomness — call it a thousand times
 * on the same genome and get a deep-equal result every time.
 */
export function classify(genome) {
  const clade = cladeOf(genome);
  const { id, path } = descend(genome, clade.legPlan);
  const node = CLASS_TREE[id];

  // A chassis whose native leg bracket disagrees with the genome's actual one
  // is a hybrid: it kept the specialised genes and changed body plan underneath.
  const hybrid = Boolean(node.clade) && node.clade !== clade.legPlan && !node.bracketNode;
  const traits = traitsOf(genome, id);

  return {
    id,
    taxon: node.taxon,
    tier: node.tier,
    order: node.order,
    path,
    clade,
    hybrid,
    name: hybrid ? `${node.adjective} ${CLADE_LABEL[clade.legPlan]}` : node.taxon,
    blurb: node.blurb,
    traits,
    specialties: specialtiesAlong(path),
    locks: collect(path, 'locks'),
    unlocks: unionUnlocks(path, traits),
    status: node.status,
  };
}

function collect(path, key) {
  const out = new Set();
  for (const id of path) for (const g of CLASS_TREE[id][key] ?? []) out.add(g);
  return [...out];
}

function unionUnlocks(path, traits) {
  const out = new Set(collect(path, 'unlocks'));
  for (const t of traits) for (const g of TRAITS[t].unlocks ?? []) out.add(g);
  return [...out];
}

/**
 * Specialties inherited down the path. A node marked `replacesParent` drops
 * everything above it — Siege Plating is not Armour Plating plus 25%, it is
 * what Armour Plating became.
 */
export function specialtiesAlong(path) {
  const out = [];
  for (const id of path) {
    const s = CLASS_TREE[id].specialty;
    if (!s) continue;
    if (s.replacesParent) out.length = 0;
    out.push(s);
  }
  return out;
}

/**
 * Apply a classification's specialty multipliers to a stat block.
 * Still pure: classification is a function of genes, stats are a function of
 * genes, so this composition is a function of genes too.
 */
export function applySpecialties(stats, classification) {
  const out = { ...stats };
  for (const s of classification.specialties ?? []) {
    for (const [k, mult] of Object.entries(s.mods ?? {})) {
      if (typeof out[k] === 'number') out[k] *= mult;
    }
  }
  return out;
}

/**
 * Genes the breeding layer should hold steady / vary harder for this lineage.
 * Returned as plain arrays — this module never touches a genome.
 */
export function breedingMask(classification) {
  return {
    locked: [...(classification.locks ?? [])],
    unlocked: [...(classification.unlocks ?? [])],
  };
}

/**
 * Nearest taxa this genome has NOT reached, sorted by how close it is. The Vet
 * Station uses this to hint at what a lineage is drifting toward — as prose,
 * never as a distance readout.
 */
export function nearestNodes(genome, { limit = 3, fromPath = null } = {}) {
  const path = new Set(fromPath ?? classify(genome).path);
  const out = [];
  for (const id of TAXON_IDS) {
    if (path.has(id)) continue;
    const node = CLASS_TREE[id];
    if (!node.parent) continue;
    const { distance, missing } = windowDistance(genome, node.window);
    if (distance === 0 && !path.has(node.parent)) {
      // window satisfied but the parent chain isn't — still a real gap
      out.push({ id, taxon: node.taxon, distance: 0.001, missing: [], blockedBy: node.parent });
      continue;
    }
    if (distance === 0) continue;
    out.push({ id, taxon: node.taxon, distance, missing, blockedBy: null });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, limit);
}

/** Every gene name referenced by any window — used by tests to catch typos. */
export function windowedGenes() {
  const s = new Set();
  for (const id of TAXON_IDS) for (const g of Object.keys(CLASS_TREE[id].window)) s.add(g);
  for (const t of TRAIT_IDS) for (const g of Object.keys(TRAITS[t].window)) s.add(g);
  for (const axis of Object.values(CLADE_AXES)) s.add(axis.gene);
  return [...s];
}
