// Stats layer.
// PURE functions: genes in, numbers out. No simulation, no randomness, no time.
// The physics layer consumes these; it never feeds back into them.

import { GENE_ORDER } from './genes.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
/** 0..1 -> 0..1, S-curve. k>1 sharpens the middle. */
const sig = (x, k = 6) => 1 / (1 + Math.exp(-k * (clamp01(x) - 0.5)));

/**
 * Morphology: physical quantities implied by the genes, in arbitrary but
 * consistent units. Kept separate from stats so both the renderer and the
 * stat formulas can read the same derived body.
 */
export function morphology(g) {
  const length = 0.4 + g.body_length * 1.6;        // 0.4 .. 2.0
  const width = 0.25 + g.body_width * 1.05;        // 0.25 .. 1.3
  // A tapered abdomen carries less volume than a round one of the same extent.
  const taper = 1 - 0.28 * g.abdomen_taper;
  // More segments = a longer body for the same body_length gene.
  const segments = g.body_segments;
  const segmentStretch = 1 + (segments - 2) * 0.18;
  const bodyLen = length * segmentStretch;
  const volume = bodyLen * width * width * taper;  // rough ellipsoid proxy
  const shellVolume = volume * (0.05 + g.carapace_thickness * 0.45);
  const density = 0.5 + g.body_mass * 1.1;         // 0.5 .. 1.6
  const mass = volume * density + shellVolume * 1.4;
  const legLen = (0.3 + g.leg_length * 1.7) * length;
  const legs = g.leg_count;
  const joints = g.leg_joints;
  const strideLoad = mass / legs;                  // mass each leg must carry
  // Wings only lift if there ARE wings; four small wings beat two large ones of
  // the same total area at low speed.
  const wingPairs = g.wing_count / 2;
  const totalWing = wingPairs > 0 ? g.wing_area * (1 + (wingPairs - 1) * 0.35) : 0;
  const wingLoad = totalWing > 0.08 ? mass / (totalWing * 3.2) : Infinity;
  return {
    length: bodyLen, width, volume, shellVolume, density, mass,
    legLen, legs, joints, strideLoad, wingLoad, totalWing, segments, taper,
  };
}

/**
 * Gameplay stats. All on a 0..100 scale except where noted.
 * Every formula is deterministic and total — any legal genome yields finite numbers.
 */
export function computeStats(g) {
  const m = morphology(g);

  // GRIP — traction. Claws and an extra leg joint let a bug push off harder.
  const grip = clamp(100 * sig(0.55 * g.claw_size + 0.25 * (m.joints - 2)
                             + 0.20 * g.leg_thickness, 5), 1, 100);

  // SPEED — long legs and more of them move you faster; mass per leg drags,
  // grip converts effort into motion.
  const stride = m.legLen * (0.55 + 0.45 * Math.log2(m.legs) / Math.log2(10));
  const cadence = 1 / (0.35 + m.strideLoad * 0.55);
  const speed = clamp(stride * cadence * 19 * (0.82 + grip / 100 * 0.30), 1, 100);

  // AGILITY — turning and acceleration. Short bodies, wide stance, low mass.
  const agility = clamp(
    (100 * sig(0.55 * (1 - g.body_length) + 0.25 * g.leg_spread + 0.20 * (1 - g.body_mass), 5.5)) *
      (0.6 + 0.4 * (1 - clamp01(g.carapace_thickness))),
    1, 100
  );

  // DEFENSE — carapace over surface area, plus spines that punish contact.
  const coverage = m.shellVolume / (m.volume * 0.5 + 0.4);
  const defense = clamp(
    100 * sig(coverage * 0.9 + g.carapace_thickness * 0.45 + g.spine_density * 0.35, 5),
    1, 100
  );

  // ATTACK — mandibles, plus horn and claws, plus the body behind the blow.
  const bite = g.mandible_size * (0.6 + 0.6 * g.mandible_serration);
  const horn = g.horn_size * 0.55;
  const claws = g.claw_size * 0.30;
  const attack = clamp(
    100 * sig(bite * 0.85 + horn + claws + Math.min(m.mass, 3) * 0.12, 5), 1, 100
  );

  // VENOM — damage over time, independent of raw attack. A long metasoma gives
  // the stinger reach; without a stinger there's nothing to deliver.
  const venom = g.stinger_size < 0.08
    ? 0
    : clamp(100 * sig(g.stinger_size * 0.85 + g.tail_length * 0.35, 5), 0, 100);

  // ATTACK SPEED — bites per second. Big jaws swing slower.
  const attackRate = clamp(2.4 - g.mandible_size * 1.35 + (1 - g.body_mass) * 0.35, 0.45, 2.6);

  // HEALTH — bulk plus shell; extra segments are extra body to damage.
  const health = clamp(
    30 + m.volume * 26 + g.carapace_thickness * 34 + (m.segments - 2) * 5, 10, 100
  );

  // STAMINA — energy pool. Mass helps store it, metabolism burns it.
  const stamina = clamp(25 + m.volume * 22 + (1 - g.metabolism) * 42, 5, 100);

  // RECOVERY — stamina regained per second, in stamina points.
  const recovery = clamp(1.2 + g.metabolism * 6.5 - m.mass * 0.35, 0.2, 8);

  // FLIGHT — 0 with no wings at all; otherwise wing loading vs. beat rate.
  const flight = m.wingLoad === Infinity
    ? 0
    : clamp(100 * sig((1.25 / m.wingLoad) * (0.35 + g.wing_beat) - 0.30, 4.5), 0, 100);

  // VISION — sight radius in world units. More eyes widen the field; antennae
  // pick up what the eyes miss.
  const eyeGain = 1 + (g.eye_count - 2) * 0.11;
  const vision = clamp(40 + g.eye_size * 170 * eyeGain + g.antenna_length * 55, 30, 340);

  // CAMOUFLAGE — dark, desaturated, small bugs hide better. Fur breaks up an
  // outline and translucency helps; iridescence is a liability.
  const camouflage = clamp(
    100 * sig(
      0.38 * (1 - g.saturation) + 0.28 * (1 - g.lightness) + 0.24 * (1 - m.volume / 3.4)
      + 0.18 * g.setae + 0.22 * g.translucency - 0.30 * g.iridescence, 5),
    1, 100
  );

  // SIZE — display scale, ~0.55 .. 1.9
  const size = clamp(0.5 + m.volume * 0.42, 0.5, 2.0);

  return {
    speed, agility, defense, attack, attackRate, health,
    stamina, recovery, flight, vision, camouflage, size,
    venom, grip,
    mass: m.mass, legs: m.legs, segments: m.segments,
  };
}

export const STAT_KEYS = [
  'speed', 'agility', 'defense', 'attack', 'attackRate',
  'health', 'stamina', 'recovery', 'flight', 'vision', 'camouflage',
  'venom', 'grip', 'size',
];

/**
 * Fitness presets used by the breeding layer's selection step.
 * Each is a pure function of stats -> number (higher is better).
 */
export const FITNESS = {
  balanced: (s) => 0.20 * s.speed + 0.18 * s.attack + 0.18 * s.defense + 0.16 * s.health
                 + 0.18 * s.stamina + 0.10 * s.venom,
  brawler:  (s) => 0.42 * s.attack + 0.24 * s.health + 0.18 * s.defense + 0.10 * s.attackRate * 20,
  sprinter: (s) => 0.48 * s.speed + 0.22 * s.agility + 0.16 * s.stamina + 0.14 * s.grip,
  tank:     (s) => 0.50 * s.defense + 0.35 * s.health - 0.10 * s.speed + 0.25 * s.stamina,
  flier:    (s) => 0.60 * s.flight + 0.20 * s.agility + 0.20 * s.stamina,
  ghost:    (s) => 0.50 * s.camouflage + 0.25 * s.agility + 0.25 * s.vision * 0.35,
  venomous: (s) => 0.52 * s.venom + 0.22 * s.speed + 0.16 * s.agility + 0.10 * s.attackRate * 20,
};

/** Convenience: genome -> { stats, fitness } under a named preset. */
export function evaluate(genome, preset = 'balanced') {
  const stats = computeStats(genome);
  const fn = FITNESS[preset] ?? FITNESS.balanced;
  return { stats, fitness: fn(stats) };
}

/** Sanity guard used by tests: every stat finite for any genome. */
export function assertFinite(stats) {
  for (const k of Object.keys(stats)) {
    if (!Number.isFinite(stats[k])) throw new Error(`stat ${k} is not finite: ${stats[k]}`);
  }
  return true;
}

export { GENE_ORDER };
