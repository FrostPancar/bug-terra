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
  const volume = length * width * width;           // rough ellipsoid proxy
  const shellVolume = volume * (0.05 + g.carapace_thickness * 0.45);
  const density = 0.5 + g.body_mass * 1.1;         // 0.5 .. 1.6
  const mass = volume * density + shellVolume * 1.4;
  const legLen = (0.3 + g.leg_length * 1.7) * length;
  const legs = g.leg_count;
  const strideLoad = mass / legs;                  // mass each leg must carry
  const wingLoad = g.wing_area > 0.08 ? mass / (g.wing_area * 3.2) : Infinity;
  return { length, width, volume, shellVolume, density, mass, legLen, legs, strideLoad, wingLoad };
}

/**
 * Gameplay stats. All on a 0..100 scale except where noted.
 * Every formula is deterministic and total — any legal genome yields finite numbers.
 */
export function computeStats(g) {
  const m = morphology(g);

  // SPEED — long legs and more of them move you faster; mass per leg drags.
  const stride = m.legLen * (0.55 + 0.45 * Math.log2(m.legs) / Math.log2(10));
  const cadence = 1 / (0.35 + m.strideLoad * 0.55);
  const speed = clamp(stride * cadence * 26, 1, 100);

  // AGILITY — turning and acceleration. Short bodies, wide stance, low mass.
  const agility = clamp(
    (100 * sig(0.55 * (1 - g.body_length) + 0.25 * g.leg_spread + 0.20 * (1 - g.body_mass), 5.5)) *
      (0.6 + 0.4 * (1 - clamp01(g.carapace_thickness))),
    1, 100
  );

  // DEFENSE — carapace over surface area; heavier shell on a small body is denser cover.
  const coverage = m.shellVolume / (m.volume * 0.5 + 0.4);
  const defense = clamp(100 * sig(coverage * 0.9 + g.carapace_thickness * 0.45, 5), 1, 100);

  // ATTACK — mandible mass, serration, and the body behind the bite.
  const bite = g.mandible_size * (0.6 + 0.6 * g.mandible_serration);
  const attack = clamp(100 * sig(bite * 0.85 + Math.min(m.mass, 3) * 0.12, 5), 1, 100);

  // ATTACK SPEED — bites per second. Big jaws swing slower.
  const attackRate = clamp(2.4 - g.mandible_size * 1.35 + (1 - g.body_mass) * 0.35, 0.45, 2.6);

  // HEALTH — bulk plus shell.
  const health = clamp(30 + m.volume * 26 + g.carapace_thickness * 34, 10, 100);

  // STAMINA — energy pool. Mass helps store it, metabolism burns it.
  const stamina = clamp(25 + m.volume * 22 + (1 - g.metabolism) * 42, 5, 100);

  // RECOVERY — stamina regained per second, in stamina points.
  const recovery = clamp(1.2 + g.metabolism * 6.5 - m.mass * 0.35, 0.2, 8);

  // FLIGHT — 0 means flightless; the wing must beat fast enough for the load.
  const flight = m.wingLoad === Infinity
    ? 0
    : clamp(100 * sig((1.9 / m.wingLoad) * (0.4 + g.wing_beat) - 0.15, 4.5), 0, 100);

  // VISION — sight radius in world units.
  const vision = clamp(40 + g.eye_size * 190 + g.antenna_length * 45, 30, 280);

  // CAMOUFLAGE — dark, desaturated, small bugs hide better.
  const camouflage = clamp(
    100 * sig(0.45 * (1 - g.saturation) + 0.35 * (1 - g.lightness) + 0.30 * (1 - m.volume / 3.4), 5),
    1, 100
  );

  // SIZE — display scale, ~0.55 .. 1.9
  const size = clamp(0.5 + m.volume * 0.42, 0.5, 2.0);

  return {
    speed, agility, defense, attack, attackRate, health,
    stamina, recovery, flight, vision, camouflage, size,
    mass: m.mass, legs: m.legs,
  };
}

export const STAT_KEYS = [
  'speed', 'agility', 'defense', 'attack', 'attackRate',
  'health', 'stamina', 'recovery', 'flight', 'vision', 'camouflage', 'size',
];

/**
 * Fitness presets used by the breeding layer's selection step.
 * Each is a pure function of stats -> number (higher is better).
 */
export const FITNESS = {
  balanced: (s) => 0.22 * s.speed + 0.20 * s.attack + 0.20 * s.defense + 0.18 * s.health + 0.20 * s.stamina,
  brawler:  (s) => 0.45 * s.attack + 0.25 * s.health + 0.20 * s.defense + 0.10 * s.attackRate * 20,
  sprinter: (s) => 0.55 * s.speed + 0.25 * s.agility + 0.20 * s.stamina,
  tank:     (s) => 0.50 * s.defense + 0.35 * s.health - 0.10 * s.speed + 0.25 * s.stamina,
  flier:    (s) => 0.60 * s.flight + 0.20 * s.agility + 0.20 * s.stamina,
  ghost:    (s) => 0.50 * s.camouflage + 0.25 * s.agility + 0.25 * s.vision * 0.35,
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
