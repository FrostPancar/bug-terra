// The HUD's flat controls.
//
// This replaces the liquid-glass port. A lens that refracts the scene behind a
// button is a beautiful instrument for the wrong design: the terrarium is cut
// paper on a photograph — filled shapes, hard edges, hard shadows, no blur and
// no refraction anywhere — and a glass dome sitting in the middle of that reads
// as a control panel from a different app.
//
// Nothing here reads a gene or a stat. It is presentation only, and
// `tests/hidden.test.js` scans this directory to keep it that way.

const REDUCED = () => typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Press feedback that works on touch.
 *
 * `:active` is unreliable on iOS — it can stick after a scroll and it does not
 * fire at all if the tap starts on a child — so the pressed state is driven off
 * pointer events and cleared on cancel as well as release.
 */
export function pressable(selector, root = document) {
  const buttons = [...root.querySelectorAll(selector)];
  for (const el of buttons) {
    const down = () => el.classList.add('is-pressed');
    const up = () => el.classList.remove('is-pressed');
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('blur', up);
  }
  return buttons;
}

/** Swap the pause button between its two states — icon, label and ARIA. */
export function setPaused(button, paused) {
  const PAUSE = 'M9 4.5h2.6v15H9zM12.4 4.5H15v15h-2.6z';
  const PLAY = 'M7.5 4.2 19 12 7.5 19.8z';
  button.setAttribute('aria-pressed', String(paused));
  button.setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation');
  button.querySelector('svg path').setAttribute('d', paused ? PLAY : PAUSE);
  const label = button.querySelector('span');
  if (label) label.textContent = paused ? 'Resume' : 'Pause';
}

/**
 * A short squash when a readout changes. The generation counter is the one
 * number the terrarium does show, so it is worth noticing when it moves.
 */
export function bump(el) {
  if (!el || REDUCED()) return;
  el.classList.remove('is-bumped');
  // Force a reflow so the class re-triggers on a repeat change.
  void el.offsetWidth;
  el.classList.add('is-bumped');
}
