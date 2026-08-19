// Placeable terrarium objects.
//
// Everything here is DECLARATIVE. An object is a spec plus a position; it has
// no update method and no privileged access to anything. The sim reads the
// aggregate field at a point (`fieldAt`) or the aggregate breeding modifiers
// for a structure (`breedingModifiers`) and acts on that.
//
// The one hard rule, restated from the objects doc: no object ever writes a
// gene or a stat. A Grass Patch does not make a bug grow faster by editing it —
// it contributes a growth multiplier that the breeding call reads at the moment
// it runs. The Glass Dome comes closest, and even it only produces an edit
// SPEC that breeding applies to the CHILD genome; the edited bug is untouched.

export const CATEGORIES = ['breeding', 'gene', 'stat', 'traversal', 'environment', 'plant'];

/**
 * spec fields:
 *   radius      influence radius in world px (0 = only where it stands)
 *   footprint   collision circle radius; 0 means bugs walk over it
 *   provides    per-second contribution to plant meters inside `radius`
 *   breeding    { rate, selection, mutation, pairing } modifiers, read at breed time
 *   gene        { mutationScale, lockChoice, expressIn } — never applied here
 *   trains      stat keys a bug can train against, with a per-session gain
 *   env         { light, warmth } shifts to the local day/night read
 *   traversal   pathing hints; behaviour only, no genes, no stats
 */
export const OBJECT_SPECS = {
  /* ------------------------------------------------------------ breeding -- */
  hive: {
    id: 'hive', name: 'Hive', category: 'breeding', radius: 120, footprint: 26,
    blurb: 'Queen-populated. Fast breeding cadence.',
    breeding: { rate: 1.6 },
  },
  cave: {
    id: 'cave', name: 'Cave', category: 'breeding', radius: 140, footprint: 34,
    blurb: 'Slow, but works for any bug at all.',
    breeding: { rate: 0.65, universal: true },
  },
  pond: {
    id: 'pond', name: 'Pond', category: 'breeding', radius: 170, footprint: 0,
    blurb: 'Enables breeding for water-based bugs. Keeps nearby plants watered.',
    breeding: { rate: 1.0, aquatic: true },
    provides: { hydration: 0.055 },
  },
  nest: {
    id: 'nest', name: 'Nest', category: 'breeding', radius: 90, footprint: 18,
    blurb: 'Bonds two chosen bugs. Guaranteed offspring, no tournament.',
    breeding: { rate: 1.0, pairing: 'manual', bypassSelection: true },
  },
  compost_heap: {
    id: 'compost_heap', name: 'Compost Heap', category: 'breeding', radius: 150, footprint: 22,
    // Open question in the doc was whether to split this in two. Kept as one
    // object: the dual purpose IS the idea — you park your worst bugs next to
    // the thing that feeds your garden.
    blurb: 'Breeds from the weakest of the pool, preserving diversity. Feeds the soil.',
    breeding: { rate: 0.85, selection: 'inverse' },
    provides: { soil: 0.05 },
  },
  amber_chamber: {
    id: 'amber_chamber', name: 'Amber Chamber', category: 'breeding', radius: 0, footprint: 20,
    blurb: 'Freezes a genome. It cannot breed while stored, and revives unchanged.',
    breeding: { rate: 0, storage: true },
  },
  pollen_bloom: {
    id: 'pollen_bloom', name: 'Pollen Bloom', category: 'breeding', radius: 130, footprint: 0,
    blurb: 'A hive for fliers. Only helps things that pollinate.',
    breeding: { rate: 1.45, requires: 'winged' },
    provides: { soil: 0.02 },
  },

  /* -------------------------------------------------------- gene modifiers */
  glass_dome: {
    id: 'glass_dome', name: 'Glass Dome', category: 'gene', radius: 0, footprint: 30,
    blurb: 'Edit a gene by hand. The change shows up in the children, never in the bug you edited.',
    gene: { expressIn: 'offspring', edits: 1 },
  },
  crucible: {
    id: 'crucible', name: 'Crucible', category: 'gene', radius: 110, footprint: 24,
    blurb: 'Everything bred here mutates hard. High variance, and you asked for it.',
    gene: { mutationScale: 3.2 },
  },
  prism_chamber: {
    id: 'prism_chamber', name: 'Prism Chamber', category: 'gene', radius: 110, footprint: 24,
    blurb: 'Pin one gene against mutation and keep breeding everything else.',
    gene: { lockChoice: 1 },
  },

  /* -------------------------------------------------------- stat modifiers */
  training_rock: {
    id: 'training_rock', name: 'Training Rock', category: 'stat', radius: 70, footprint: 28,
    blurb: 'Trains base stats directly. Genes stay exactly where they were.',
    trains: { attack: 0.9, defense: 0.9 }, sessionSeconds: 45,
  },
  feeding_trough: {
    id: 'feeding_trough', name: 'Feeding Trough', category: 'stat', radius: 80, footprint: 20,
    blurb: 'A full bug is a better bug, until it is hungry again.',
    trains: { stamina: 1.4, recovery: 0.6 }, temporary: true, decaySeconds: 300,
  },
  obstacle_course: {
    id: 'obstacle_course', name: 'Obstacle Course', category: 'stat', radius: 150, footprint: 0,
    blurb: 'Has to be physically run. Trains agility and speed, nothing else.',
    trains: { agility: 1.1, speed: 0.8 }, sessionSeconds: 60, requiresTraversal: true,
  },
  root_tangle: {
    id: 'root_tangle', name: 'Root Tangle', category: 'stat', radius: 120, footprint: 0,
    blurb: 'Slows anything crossing it. Cross it enough and that stops being true.',
    trains: { defense: 0.7, grip: 1.2 }, sessionSeconds: 60, requiresTraversal: true,
    traversal: { speedMultiplier: 0.55 },
  },

  /* ------------------------------------------------------------ traversal */
  wormway: {
    id: 'wormway', name: 'Wormway', category: 'traversal', radius: 60, footprint: 22,
    blurb: 'Fast travel between explored sections.',
    traversal: { link: 'pair', instant: true },
  },
  bridge: {
    id: 'bridge', name: 'Bridge / Tunnel', category: 'traversal', radius: 0, footprint: 0,
    blurb: 'A permanent connection between two zones. Cheaper than a Wormway, no jump.',
    traversal: { link: 'pair', instant: false },
  },
  beacon: {
    id: 'beacon', name: 'Beacon', category: 'traversal', radius: 260, footprint: 12,
    blurb: 'Bugs drift toward it when idle. Steering, not commanding.',
    traversal: { attract: 0.45 },
  },
  vine_trellis: {
    id: 'vine_trellis', name: 'Vine Trellis', category: 'traversal', radius: 0, footprint: 0,
    blurb: 'Climbable. Changes where climbers can go, and shades what is under it.',
    traversal: { climbable: true },
    env: { light: -0.25 },
  },

  /* ---------------------------------------------------------- environment */
  heat_lamp: {
    id: 'heat_lamp', name: 'Heat Lamp', category: 'environment', radius: 190, footprint: 14,
    blurb: 'A local daytime that ignores the real clock.',
    env: { light: 0.55, warmth: 0.6 },
    provides: { light: 0.06, hydration: -0.02 },
  },
  shade_tree: {
    id: 'shade_tree', name: 'Shade Tree', category: 'environment', radius: 200, footprint: 30,
    blurb: 'The same hook as the Heat Lamp, pulling the other way.',
    env: { light: -0.45, warmth: -0.35 },
    provides: { light: -0.04, hydration: 0.02 },
  },
  filter_stone: {
    id: 'filter_stone', name: 'Filter Stone', category: 'environment', radius: 150, footprint: 18,
    blurb: 'Slowly improves a Pond. Aquatic breeding gets better the longer you leave it.',
    breeding: { aquaticBonus: 0.35 },
    provides: { hydration: 0.02, soil: 0.02 },
  },
  mushroom_ring: {
    id: 'mushroom_ring', name: 'Mushroom Ring', category: 'environment', radius: 130, footprint: 0,
    blurb: 'Bugs that linger inside it do better at selection time.',
    breeding: { fitnessBonus: 0.12 },
    provides: { soil: 0.035, light: -0.01 },
  },
};

/* ------------------------------------------------------------- plant specs */

/**
 * Plants are objects too, but they have a lifecycle, so their specs carry the
 * extra fields `sim/plants.js` reads. They still live in the same catalog —
 * placement, footprint and radius all work identically.
 */
export const PLANT_SPECS = {
  grass_patch: {
    id: 'grass_patch', name: 'Grass Patch', category: 'plant', radius: 110, footprint: 0,
    blurb: 'Increases growth rate nearby.',
    growth: 1.0, lifespan: 1.0, spreadChance: 0.35,
    breeding: { growthRate: 1.25 },
    provides: { soil: 0.015 },
  },
  moss_bed: {
    id: 'moss_bed', name: 'Moss Bed', category: 'plant', radius: 110, footprint: 0,
    blurb: 'Slows growth and extends lifespan. The inverse trade to grass.',
    growth: 0.6, lifespan: 1.9, spreadChance: 0.18,
    breeding: { growthRate: 0.78, lifespan: 1.3 },
    provides: { hydration: 0.02, soil: 0.01 },
  },
  flowering_bush: {
    id: 'flowering_bush', name: 'Flowering Bush', category: 'plant', radius: 90, footprint: 10,
    blurb: 'Drops nectar. Eating one gives a short burst of growth.',
    growth: 0.9, lifespan: 1.0, spreadChance: 0.25,
    yields: { kind: 'nectar', everySeconds: 70, effect: { growthRate: 1.5, seconds: 40 } },
  },
  fern_cluster: {
    id: 'fern_cluster', name: 'Fern Cluster', category: 'plant', radius: 120, footprint: 0,
    blurb: 'Speeds juvenile growth only. Does nothing for an adult.',
    growth: 0.85, lifespan: 1.2, spreadChance: 0.30,
    breeding: { juvenileGrowth: 1.45 },
    provides: { hydration: 0.015 },
  },
  berry_bush: {
    id: 'berry_bush', name: 'Berry Bush', category: 'plant', radius: 90, footprint: 12,
    blurb: 'Renewable food. A berry is a small temporary buff.',
    growth: 0.8, lifespan: 1.1, spreadChance: 0.22,
    yields: { kind: 'berry', everySeconds: 90, effect: { stamina: 1.2, seconds: 120 } },
  },
  seed_pod: {
    id: 'seed_pod', name: 'Seed Pod', category: 'plant', radius: 60, footprint: 8,
    blurb: 'Exists to spread. Germinates a new plant elsewhere on a timer.',
    growth: 1.0, lifespan: 0.8, spreadChance: 0.85,
  },
};

/** Everything placeable, in one lookup. */
export const CATALOG = { ...OBJECT_SPECS, ...PLANT_SPECS };
export const CATALOG_IDS = Object.keys(CATALOG);

export function specOf(id) {
  const s = CATALOG[id];
  if (!s) throw new Error(`unknown terrarium object: ${id}`);
  return s;
}

export function objectsByCategory(category) {
  return CATALOG_IDS.map((id) => CATALOG[id]).filter((s) => s.category === category);
}

/* -------------------------------------------------------------- placement */

/** A placed instance. Plain data — `sim/plants.js` wraps plant instances. */
export function placeObject(id, x, y, extra = {}) {
  const spec = specOf(id);
  return { id, spec, x, y, ...extra };
}

/**
 * Free placement with a minimum-spacing check, matching how the rock decor
 * already avoids overlap. Grid placement was the alternative in the doc; free
 * placement keeps the terrarium reading as a terrarium rather than a board.
 */
export function canPlace(objects, id, x, y, { minGap = 8 } = {}) {
  const spec = specOf(id);
  for (const o of objects) {
    const gap = (spec.footprint ?? 0) + (o.spec.footprint ?? 0) + minGap;
    if (gap <= minGap) continue;                    // both are walk-over, ignore
    if ((o.x - x) ** 2 + (o.y - y) ** 2 < gap * gap) return false;
  }
  return true;
}

const within = (o, x, y) => {
  const r = o.spec.radius ?? 0;
  if (r <= 0) return false;
  return (o.x - x) ** 2 + (o.y - y) ** 2 <= r * r;
};

/**
 * Aggregate influence at a point. Contributions add; the caller clamps.
 * Objects that are dead or dormant should simply not be in the list — this
 * function has no concept of state, on purpose.
 */
export function fieldAt(objects, x, y) {
  const out = {
    hydration: 0, light: 0, soil: 0,
    envLight: 0, warmth: 0,
    speedMultiplier: 1, attract: 0, climbable: false,
  };
  for (const o of objects) {
    if (!within(o, x, y)) continue;
    const s = o.spec;
    for (const [k, v] of Object.entries(s.provides ?? {})) out[k] += v;
    if (s.env) {
      out.envLight += s.env.light ?? 0;
      out.warmth += s.env.warmth ?? 0;
    }
    if (s.traversal) {
      out.speedMultiplier *= s.traversal.speedMultiplier ?? 1;
      out.attract += s.traversal.attract ?? 0;
      out.climbable = out.climbable || Boolean(s.traversal.climbable);
    }
  }
  return out;
}

/**
 * The trainer this point is standing in, nearest first. Only objects that
 * actually declare `trains` count — everything else is scenery as far as
 * training is concerned.
 *
 * Training is the third way the concept doc says you learn a bug (watch, fight,
 * train), and it is the ONLY route to a `grip` phrase: you cannot learn how
 * well something plants itself by staring at it.
 */
export function trainerAt(objects, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const o of objects) {
    if (!o.spec.trains) continue;
    if (!within(o, x, y)) continue;
    const d = (o.x - x) ** 2 + (o.y - y) ** 2;
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

/**
 * Modifiers a breed call should read at the moment it runs. Returned as plain
 * multipliers — nothing here is stored on a bug, and nothing is a gene.
 */
export function breedingModifiers(objects, x, y) {
  const out = {
    rate: 1, mutationScale: 1, fitnessBonus: 0, growthRate: 1,
    selection: null, bypassSelection: false, lockChoices: 0,
    universal: false, aquatic: false, requires: null,
  };
  for (const o of objects) {
    const s = o.spec;
    const inRange = (s.radius ?? 0) > 0 ? within(o, x, y) : (o.x === x && o.y === y);
    if (!inRange) continue;
    const b = s.breeding ?? {};
    if (b.rate !== undefined) out.rate *= b.rate;
    if (b.fitnessBonus) out.fitnessBonus += b.fitnessBonus;
    if (b.selection) out.selection = b.selection;
    if (b.bypassSelection) out.bypassSelection = true;
    if (b.universal) out.universal = true;
    if (b.aquatic) out.aquatic = true;
    if (b.requires) out.requires = b.requires;
    if (b.growthRate) out.growthRate *= b.growthRate;
    const g = s.gene ?? {};
    if (g.mutationScale) out.mutationScale *= g.mutationScale;
    if (g.lockChoice) out.lockChoices += g.lockChoice;
  }
  return out;
}
