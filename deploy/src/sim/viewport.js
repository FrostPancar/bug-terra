// Viewport policy — one place that decides how the terrarium sizes itself and
// how heavy it's allowed to be. Both the scene and the HUD read from here so
// they can't disagree about what "mobile" means.

/** Play area held roughly constant so bugs stay the same relative size. */
const TARGET_AREA = 1280 * 800;

/** Aspect clamps — beyond these the world stops following the window. */
// 0.45 rather than 0.5 so the current crop of tall phones lands INSIDE the
// clamp: 430x932, 393x852, 375x812 and 412x915 are all ~0.46, and at 0.5 every
// one of them got letterboxed against the stage instead of filling it.
const MIN_ASPECT = 0.45;  // taller than ~1:2.2 (very narrow phone) stops here
const MAX_ASPECT = 2.4;   // wider than 12:5 (ultrawide) stops here

/**
 * World size matched to the viewport's aspect ratio, at constant area.
 * A portrait phone gets a tall terrarium instead of a letterboxed strip.
 */
export function computeWorld(vw, vh) {
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, vw / Math.max(1, vh)));
  const w = Math.round(Math.sqrt(TARGET_AREA * aspect));
  const h = Math.round(TARGET_AREA / w);
  return { w, h, aspect };
}

/**
 * The real CSS viewport of the play area, in device-independent pixels.
 * Kept here because the scene only ever sees WORLD units — asking Phaser for
 * its game size would tell you how big the terrarium is, not how big the
 * screen is, and those are deliberately different numbers.
 */
export const VIEWPORT = { w: 1280, h: 800 };

export function setViewport(w, h) {
  VIEWPORT.w = w;
  VIEWPORT.h = h;
}

/**
 * Coarse device tier, used for default population and decor density.
 * Keyed on the SHORT edge so orientation doesn't change a device's tier:
 * a phone is a phone whether it's 393x852 or 852x393.
 */
export function deviceTier(vw, vh) {
  const min = Math.min(vw, vh);
  if (min < 480) return 'phone';    // covers large phones like Pixel 7 (412px)
  if (min < 900) return 'tablet';   // iPad portrait is 820px
  return 'desktop';
}

/**
 * `rocks`, `food` and `speckles` used to live here to size a procedural decor
 * scatter. The floor is a photograph now and already carries all three, so the
 * only densities left are the ones that are still actually drawn: how many
 * animals, and how big a starter garden.
 */
export const TIER_DEFAULTS = {
  phone:   { population: 7,  garden: 3 },
  tablet:  { population: 10, garden: 4 },
  desktop: { population: 12, garden: 5 },
};

/** Defaults to the real viewport — pass explicit dimensions only to override. */
export function tierSettings(vw = VIEWPORT.w, vh = VIEWPORT.h) {
  const tier = deviceTier(vw, vh);
  return { tier, ...TIER_DEFAULTS[tier] };
}

/** True when the primary input is touch — widens hit targets, drops hover FX. */
export function isTouchDevice() {
  return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
      || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
}

/**
 * Tap radius in world units. Fingers are blunt; a 60px desktop radius is far
 * too tight once the canvas is scaled down to a phone.
 */
export function pickRadius(world, touch) {
  const base = Math.min(world.w, world.h) * (touch ? 0.11 : 0.075);
  return Math.max(touch ? 60 : 40, Math.min(150, base));
}

/**
 * Aspect changed enough to be worth rebuilding the world for. Ignores the
 * small height jitters iOS Safari produces when its toolbars slide away.
 */
export function aspectChangedMeaningfully(prev, next) {
  if (!prev) return true;
  return Math.abs(prev - next) / Math.max(prev, next) > 0.12;
}
