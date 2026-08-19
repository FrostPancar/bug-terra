// Time system — the terrarium runs on the player's real clock (Animal Crossing
// style). No in-game calendar; 3pm here is 3pm there.
//
// `timeScale` exists only so you can inspect a full cycle without waiting a day;
// at 1 it is exactly real time.

export const PHASES = [
  { key: 'night',    start: 0.00, label: 'Night'     },
  { key: 'dawn',     start: 0.22, label: 'Dawn'      },
  { key: 'morning',  start: 0.30, label: 'Morning'   },
  { key: 'day',      start: 0.42, label: 'Daylight'  },
  { key: 'dusk',     start: 0.75, label: 'Dusk'      },
  { key: 'evening',  start: 0.83, label: 'Evening'   },
  { key: 'night2',   start: 0.90, label: 'Night'     },
];

/** Keyframed ambient colours (RGB 0-255) and light levels by normalized day time. */
const KEYS = [
  { t: 0.00, rgb: [26, 32, 66],   light: 0.16 },  // deep night
  { t: 0.22, rgb: [78, 62, 96],   light: 0.30 },  // dawn
  { t: 0.30, rgb: [206, 142, 118], light: 0.62 }, // sunrise
  { t: 0.42, rgb: [255, 246, 224], light: 1.00 }, // midday
  { t: 0.66, rgb: [255, 238, 206], light: 0.95 },
  { t: 0.78, rgb: [240, 150, 96],  light: 0.66 }, // sunset
  { t: 0.86, rgb: [104, 76, 118],  light: 0.34 }, // evening
  { t: 1.00, rgb: [26, 32, 66],    light: 0.16 }, // wraps to night
];

const lerp = (a, b, t) => a + (b - a) * t;

/** Fraction of the day elapsed, 0 at local midnight. */
export function dayFraction(date = new Date(), timeScale = 1) {
  const secs = date.getHours() * 3600 + date.getMinutes() * 60
             + date.getSeconds() + date.getMilliseconds() / 1000;
  return ((secs / 86400) * timeScale) % 1;
}

export function phaseAt(t) {
  let cur = PHASES[0];
  for (const p of PHASES) if (t >= p.start) cur = p;
  return cur;
}

/** Ambient light state for a normalized time. */
export function ambientAt(t) {
  const x = ((t % 1) + 1) % 1;
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (x >= KEYS[i].t && x <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  }
  const span = b.t - a.t || 1;
  const k = (x - a.t) / span;
  const rgb = [0, 1, 2].map((i) => Math.round(lerp(a.rgb[i], b.rgb[i], k)));
  const light = lerp(a.light, b.light, k);
  const phase = phaseAt(x);
  return {
    t: x,
    rgb,
    tint: (rgb[0] << 16) | (rgb[1] << 8) | rgb[2],
    css: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    light,
    darkness: 1 - light,
    phase: phase.key,
    label: phase.label,
    isNight: light < 0.35,
  };
}

/** Behaviour multipliers the terrarium reads each frame. */
export function behaviourAt(t) {
  const a = ambientAt(t);
  return {
    ...a,
    // bugs are sluggish in the cold dark, restless at dusk
    activity: 0.35 + a.light * 0.65 + (a.phase === 'dusk' ? 0.2 : 0),
    // low light favours ambush: aggression climbs at night
    aggressionBias: a.isNight ? 1.35 : 1.0,
    // camouflage matters more in the dark
    stealthBonus: a.darkness,
  };
}

/** Clock string for the HUD. */
export function clockLabel(date = new Date(), timeScale = 1) {
  if (timeScale === 1) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const t = dayFraction(date, timeScale);
  const mins = Math.floor(t * 1440);
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}
