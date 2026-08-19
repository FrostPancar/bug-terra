// Impressions — the player-facing read of a bug.
//
// The concept doc is blunt about this: "There's no menu that says 'Attack: 74.'"
// Stats still exist and are still a pure function of genes; they are simply not
// the interface. This module is the translation layer between the numbers the
// simulation needs and the language the player gets.
//
// Two rules it enforces:
//
//   1. NO NUMBERS OUT. Every export here returns words. If a caller wants a
//      number it has to go to `computeStats` directly, and the UI never does.
//   2. NOTHING MID-RANGE IS WORTH SAYING. An average bug produces very few
//      impressions, because "it's fine at everything" is not something you'd
//      notice about an animal. Extremes are what you notice.
//
// A phrase is also gated on HAVING SEEN IT (see `sim/knowledge.js`) — the
// vocabulary lives here, the earning of it lives there.

import { computeStats } from './stats.js';
import { classify, applySpecialties } from './classification.js';

/**
 * How a stat becomes words.
 *
 *   scale    the value at which the stat is "maxed" for banding purposes
 *   channel  what kind of experience reveals this. 'watch' is free — you get it
 *            by leaving the terrarium open. 'combat' and 'training' cost
 *            something. 'vet' is only ever the physical read, never performance.
 *   bands    ordered low -> high. `null` means "unremarkable, say nothing".
 */
export const IMPRESSION_SPECS = {
  speed: {
    channel: 'watch', scale: 100,
    bands: [
      [0.00, 'barely moves — you keep checking whether it is alive'],
      [0.22, 'plods'],
      [0.42, null],
      [0.70, 'covers ground quickly'],
      [0.86, 'freakishly fast, for no reason you can point at'],
    ],
  },
  agility: {
    channel: 'watch', scale: 100,
    bands: [
      [0.00, 'turns like a barge'],
      [0.24, 'commits to a direction and stays committed'],
      [0.44, null],
      [0.72, 'changes its mind mid-stride'],
      [0.88, 'impossible to corner'],
    ],
  },
  defense: {
    channel: 'combat', scale: 100,
    bands: [
      [0.00, 'comes apart if anything touches it'],
      [0.24, 'bruises easily'],
      [0.45, null],
      [0.72, 'shrugs off hits that should land'],
      [0.88, 'you have watched things bounce off it'],
    ],
  },
  attack: {
    channel: 'combat', scale: 100,
    bands: [
      [0.00, 'cannot hurt anything'],
      [0.24, 'hits without conviction'],
      [0.45, null],
      [0.72, 'hits hard'],
      [0.88, 'ends fights in one motion'],
    ],
  },
  attackRate: {
    channel: 'combat', scale: 2.6,
    bands: [
      [0.00, 'winds up forever between bites'],
      [0.28, 'slow to swing'],
      [0.50, null],
      [0.74, 'bites in flurries'],
      [0.88, 'never seems to stop biting'],
    ],
  },
  health: {
    channel: 'combat', scale: 100,
    bands: [
      [0.00, 'fragile'],
      [0.26, 'does not last long in a scrap'],
      [0.46, null],
      [0.72, 'keeps going long past when it should stop'],
      [0.88, 'you have not yet seen it go down'],
    ],
  },
  stamina: {
    channel: 'watch', scale: 100,
    bands: [
      [0.00, 'runs out of steam almost immediately'],
      [0.26, 'tires quickly'],
      [0.48, null],
      [0.74, 'still going when everything else has settled'],
      [0.88, 'seems not to need rest at all'],
    ],
  },
  recovery: {
    channel: 'watch', scale: 8,
    bands: [
      [0.00, 'takes forever to get its wind back'],
      [0.24, 'slow to recover'],
      [0.46, null],
      [0.72, 'back on its feet almost at once'],
      [0.88, 'barely acknowledges having been tired'],
    ],
  },
  flight: {
    channel: 'watch', scale: 100,
    bands: [
      [0.00, null],                       // flightless is read off the body, not the stat
      [0.15, 'gets off the ground, briefly'],
      [0.42, 'flies competently'],
      [0.70, 'prefers the air to the floor'],
      [0.88, 'genuinely at home in the air'],
    ],
  },
  vision: {
    channel: 'watch', scale: 340,
    bands: [
      [0.00, 'blunders into things'],
      [0.22, 'has to be close to notice you'],
      [0.42, null],
      [0.70, 'reacts to things across the terrarium'],
      [0.86, 'sees everything, all the time'],
    ],
  },
  camouflage: {
    channel: 'watch', scale: 100,
    bands: [
      [0.00, 'impossible to miss'],
      [0.24, 'stands out'],
      [0.46, null],
      [0.72, 'you lose it against the substrate'],
      [0.88, 'you only find it again when it moves'],
    ],
  },
  venom: {
    channel: 'combat', scale: 100,
    bands: [
      [0.00, null],                       // no stinger is a physical fact, not a tell
      [0.10, 'leaves the other one unwell'],
      [0.42, 'its bites keep working after the fight'],
      [0.70, 'whatever it stings does not recover'],
      [0.88, 'one hit is the whole fight'],
    ],
  },
  grip: {
    channel: 'training', scale: 100,
    bands: [
      [0.00, 'slides around'],
      [0.24, 'loses its footing'],
      [0.46, null],
      [0.72, 'plants itself and does not move'],
      [0.88, 'you could tip the terrarium and it would stay put'],
    ],
  },
};

export const IMPRESSION_KEYS = Object.keys(IMPRESSION_SPECS);
export const CHANNELS = ['watch', 'combat', 'training', 'vet'];

/** Index of the band a normalized 0..1 value falls into. */
function bandIndex(spec, norm) {
  let i = 0;
  for (let k = 0; k < spec.bands.length; k++) if (norm >= spec.bands[k][0]) i = k;
  return i;
}

/**
 * Everything that COULD be said about a bug, whether or not the player has
 * earned it yet. Pure: genes in, phrases out, no state, no randomness.
 */
export function allImpressions(genome) {
  const cls = classify(genome);
  const stats = applySpecialties(computeStats(genome), cls);
  const out = [];
  for (const key of IMPRESSION_KEYS) {
    const spec = IMPRESSION_SPECS[key];
    const norm = Math.min(1, Math.max(0, stats[key] / spec.scale));
    const idx = bandIndex(spec, norm);
    const phrase = spec.bands[idx][1];
    if (!phrase) continue;
    const mid = (spec.bands.length - 1) / 2;
    out.push({
      key,
      channel: spec.channel,
      phrase,
      // How striking this is — drives ordering, never shown as a value.
      salience: Math.abs(idx - mid) / mid,
      direction: idx > mid ? 'high' : 'low',
    });
  }
  out.sort((a, b) => b.salience - a.salience);
  return out;
}

/**
 * Physical facts you can see without any observation at all, because they are
 * literally drawn on the sprite. These are free — no channel, no gating.
 */
export function physicalReadout(genome) {
  const cls = classify(genome);
  const c = cls.clade;
  const legs = {
    hexapod: 'six legs', arachnid: 'eight legs', myriapod: 'ten legs',
  }[c.legPlan];
  const wings = {
    apterous: 'no wings', dipterous: 'one pair of wings', tetrapterous: 'two pairs of wings',
  }[c.wingPlan];
  const bulk = { micro: 'slight', standard: 'ordinary build', titan: 'heavy' }[c.massClass];
  const surface = {
    ghost: 'you can see light through it',
    radiant: 'the shell catches the light',
    furred: 'covered in fine hair',
    ironclad: 'plain hard shell',
  }[c.surfaceClass];
  const sting = {
    none: null, mild: 'a small stinger', potent: 'a serious stinger',
    lethal: 'a stinger it clearly intends to use',
  }[c.venomClass];

  return [legs, wings, bulk, surface, sting].filter(Boolean);
}

/**
 * The Vet Station read: everything physical, said plainly, with no performance
 * claims at all. This is deliberately the LEAST useful view for min-maxing and
 * the most useful one for knowing what your animal actually is.
 */
export function vetReadout(genome) {
  const cls = classify(genome);
  return {
    name: cls.name,
    taxon: cls.taxon,
    tier: cls.tier,
    order: cls.order,
    hybrid: cls.hybrid,
    blurb: cls.blurb,
    path: cls.path,
    traits: cls.traits,
    physical: physicalReadout(genome),
    // What it seems to be turning into — as a direction, never as a distance.
    drifting: cls.hybrid
      ? `carrying ${cls.taxon.toLowerCase()} traits on a ${cls.clade.legPlan} body`
      : null,
  };
}

/** One-line summary used on the roster, where there is no room for prose. */
export function shortImpression(genome) {
  const list = allImpressions(genome);
  return list.length ? list[0].phrase : 'nothing much stands out';
}
