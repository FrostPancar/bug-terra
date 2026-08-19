// Boot + HUD wiring.

import { TerrariumScene, WORLD } from './sim/terrarium.js';
import { computeWorld, tierSettings, isTouchDevice, setViewport } from './sim/viewport.js';
import { GENE_ORDER } from './core/genes.js';
import { STAT_KEYS, FITNESS } from './core/stats.js';
import { glassify, supportsLensBackdrop } from './ui/glass.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 1) => Number(n).toFixed(d);

const stage = $('stage');
const canvasHost = $('canvasHost');
const touch = isTouchDevice();

/* Size the world to the stage's real box, not the window — the bottom sheet
   and the notch both eat into it. */
function stageSize() {
  const r = canvasHost.getBoundingClientRect();
  return {
    w: Math.max(320, Math.round(r.width || window.innerWidth)),
    h: Math.max(320, Math.round(r.height || window.innerHeight)),
  };
}

const first = stageSize();
setViewport(first.w, first.h);
const w0 = computeWorld(first.w, first.h);
WORLD.w = w0.w;
WORLD.h = w0.h;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'canvasHost',
  width: WORLD.w,
  height: WORLD.h,
  backgroundColor: '#120d09',
  physics: { default: 'matter', matter: { gravity: { y: 0 }, debug: false } },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // iOS Safari reports stale sizes right after an orientation flip
    expandParent: false,
  },
  // A phone doesn't need 3x pixels for a stylised 2D scene, and the fill rate
  // costs real frames.
  render: { antialias: true, powerPreference: 'low-power' },
  scene: [TerrariumScene],
});

let scene = null;
game.events.once('ready', () => {
  scene = game.scene.getScene('terrarium');
  // handy in the console, and the viewport test reads the playable box from it
  window.__terrarium = { game, scene, WORLD };
  scene.events.on('state', render);
  scene.events.on('selected', () => { if (isSheetMode()) expandSheet(); });
  wire();
  wireViewport();
});

/* ------------------------------------------------------------ render ---- */

function bar(label, value, max, unit = '') {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="row"><span class="k">${label}</span>
    <span class="track"><i style="width:${pct}%"></i></span>
    <span class="v">${fmt(value, value < 10 ? 2 : 0)}${unit}</span></div>`;
}

let lastSel = null;

function render(s) {
  $('clock').textContent = s.clock;
  $('phase').textContent = s.env.label;
  $('phase').style.color = s.env.css;
  $('gen').textContent = s.generation;
  $('alive').textContent = `${s.alive}/${s.total}`;
  $('seedOut').textContent = s.seed;
  $('bestFit').textContent = fmt(s.bestFitness);
  $('meanFit').textContent = fmt(s.meanFitness);
  $('sun').style.background = s.env.css;

  // collapsed-sheet summary
  $('hClock').textContent = s.clock;
  $('hPhase').textContent = s.env.label;
  $('hPhase').style.color = s.env.css;
  $('hGen').textContent = s.generation;
  $('hAlive').textContent = `${s.alive}/${s.total}`;

  const b = s.selected;
  // Only rebuild the inspect panel when something meaningful changed — on a
  // phone, re-rendering this markup 5x/sec is a measurable frame cost.
  const sig = b ? `${b.id}|${b.state}|${b.alive}|${Math.round(b.hp)}|${Math.round(b.energy)}|${b.kills}` : 'none';
  if (sig === lastSel) return;
  lastSel = sig;

  if (!b) { $('inspect').innerHTML = `<p class="muted">${touch ? 'Tap' : 'Click'} a bug.</p>`; return; }

  $('inspect').innerHTML = `
    <h3>${b.name} <span class="kind">${b.kind}</span>${b.alive ? '' : ' <span class="dead">DOWN</span>'}</h3>
    <p class="muted small">#${b.tag} · gen ${b.generation} · ${b.state} · ${b.kills} kills${b.poison > 0.5 ? ' · <span class="envenomed">envenomed</span>' : ''}</p>
    <div class="bars">
      ${bar('HP', b.hp, b.stats.health)}
      ${bar('Energy', b.energy, b.stats.stamina)}
    </div>
    <h4>Stats <span class="muted small">(pure f(genes))</span></h4>
    <div class="bars">
      ${STAT_KEYS.filter((k) => k !== 'size' && k !== 'attackRate' && k !== 'vision')
        .map((k) => bar(k, b.stats[k], 100)).join('')}
      ${bar('vision', b.stats.vision, 280)}
      ${bar('bites/s', b.stats.attackRate, 2.6)}
    </div>
    <h4>Genes</h4>
    <div class="genes">
      ${GENE_ORDER.map((k) => `<span class="gene"><b>${k}</b>${fmt(b.genome[k], 2)}</span>`).join('')}
    </div>`;
}

/* -------------------------------------------------- bottom sheet -------- */

const isSheetMode = () => getComputedStyle($('handle')).display !== 'none';

function collapseSheet() {
  document.body.classList.add('sheet-collapsed');
  $('handle').setAttribute('aria-expanded', 'false');
  queueResize();
}
function expandSheet() {
  document.body.classList.remove('sheet-collapsed');
  $('handle').setAttribute('aria-expanded', 'true');
  queueResize();
}
function toggleSheet() {
  document.body.classList.contains('sheet-collapsed') ? expandSheet() : collapseSheet();
}

/**
 * Swipe up to reveal the panel, down to dismiss it.
 * Only claims the gesture once it's clearly vertical and clearly a drag, so it
 * never fights the panel's own scrolling or a tap on a control.
 */
function wireSwipe() {
  const sheet = document.querySelector('aside');
  const body = $('sheetBody');
  let x0 = 0, y0 = 0, tracking = false, decided = false, claimed = false;

  const start = (e) => {
    if (!isSheetMode()) return;
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY;
    tracking = true; decided = false; claimed = false;
  };

  const move = (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    if (!decided) {
      if (Math.hypot(dx, dy) < 12) return;
      decided = true;
      // horizontal, or a downward drag inside already-scrolled content: not ours
      claimed = Math.abs(dy) > Math.abs(dx) * 1.4
        && !(dy > 0 && body.scrollTop > 2 && e.target !== $('handle'));
    }
    if (!claimed) return;
    e.preventDefault();
    if (dy < -34) { expandSheet(); tracking = false; }
    else if (dy > 34) { collapseSheet(); tracking = false; }
  };

  const end = () => { tracking = false; };

  for (const el of [sheet, $('scrim')]) {
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
  }
}

/* ---------------------------------------------------- viewport sync ----- */

let resizeTimer = null;
function queueResize(delay = 160) {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(syncViewport, delay);
}

/**
 * How much of the canvas the panel actually covers, in WORLD px.
 * Measured as a real rect intersection, so it's 0 in the side-panel and rail
 * layouts (where the panel sits beside the canvas) without special-casing them.
 */
function panelOverlap() {
  const canvas = document.querySelector('#canvasHost canvas');
  if (!canvas) return 0;
  const c = canvas.getBoundingClientRect();
  const a = document.querySelector('aside').getBoundingClientRect();
  const overlapX = Math.max(0, Math.min(a.right, c.right) - Math.max(a.left, c.left));
  if (overlapX < c.width * 0.5) return 0;      // beside, not over
  const overlapY = Math.max(0, c.bottom - Math.max(a.top, c.top));
  // CSS px -> world px (the canvas is FIT-scaled), plus a small margin so the
  // fence sits clear of the sheet's edge rather than exactly on it.
  return (overlapY + 24) * (WORLD.h / Math.max(1, c.height));
}

function syncViewport() {
  if (!scene) return;
  const s = stageSize();
  setViewport(s.w, s.h);
  scene.settings = tierSettings();

  // The scene reshapes only when the ASPECT moved enough to be worth rebuilding
  // terrain. A same-aspect size change (sheet toggle, window drag) still needs
  // the canvas refitted to its parent, so refresh either way.
  if (!scene.onResize({ width: s.w, height: s.h })) scene.scale.refresh();

  scene.setInsetBottom(panelOverlap());
}

function wireViewport() {
  const onChange = () => queueResize();

  // A ResizeObserver on the canvas host is the reliable signal: it fires for
  // window resizes, orientation flips, iOS toolbar slides, AND the tail of the
  // bottom-sheet transition. Watching `resize` alone measured the box mid-
  // animation and locked in the wrong aspect.
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(onChange);
    ro.observe(canvasHost);
    // The panel too: the bug fence is measured from its box, and that box is
    // still animating when the canvas has already settled. Without this the
    // fence lands wherever the sheet happened to be mid-transition.
    ro.observe(document.querySelector('aside'));
  }

  window.addEventListener('resize', onChange, { passive: true });
  window.addEventListener('orientationchange', () => queueResize(350), { passive: true });
  window.visualViewport?.addEventListener('resize', onChange, { passive: true });

  // start collapsed on a phone so the terrarium gets the screen
  if (isSheetMode() && window.innerHeight < 780) collapseSheet();
  syncViewport();
}

/* -------------------------------------------------------------- wire ---- */

function wire() {
  $('preset').innerHTML = Object.keys(FITNESS)
    .map((k) => `<option value="${k}">${k}</option>`).join('');
  $('preset').value = scene.preset;
  $('preset').onchange = (e) => { scene.preset = e.target.value; scene.emitState(); };

  $('handle').onclick = toggleSheet;
  wireSwipe();
  $('canvasHost').style.gridArea = '1 / 1';

  $('breed').onclick = () => scene.breed();
  $('ff').onclick = () => scene.fastForward(Number($('ffN').value) || 10);
  $('reseed').onclick = () => scene.reseed();
  const PAUSE_ICON = 'M9 5v14M15 5v14';
  const PLAY_ICON = 'M7 4l12 8-12 8z';
  $('pause').onclick = (e) => {
    const running = scene.matter.world.enabled;
    scene.matter.world.enabled = !running;
    const btn = e.currentTarget;
    btn.setAttribute('aria-pressed', String(running));
    btn.setAttribute('aria-label', running ? 'Resume simulation' : 'Pause simulation');
    btn.querySelector('svg path').setAttribute('d', running ? PLAY_ICON : PAUSE_ICON);
    btn.querySelector('span').textContent = running ? 'Resume' : 'Pause';
  };

  $('pop').value = scene.popSize;
  $('popOut').textContent = scene.popSize;
  $('pop').oninput = (e) => { $('popOut').textContent = e.target.value; };
  $('pop').onchange = (e) => {
    scene.popSize = Number(e.target.value);
    scene.popSizeExplicit = true;         // stop tier defaults overriding it
    scene.reseed(scene.seed);
  };

  $('tscale').oninput = (e) => {
    scene.timeScale = Number(e.target.value);
    $('tscaleOut').textContent = scene.timeScale === 1 ? 'real' : `${scene.timeScale}×`;
  };

  // Keyboard shortcuts only make sense with a keyboard.
  if (!touch) {
    document.addEventListener('keydown', (ev) => {
      if (ev.target.matches('input, select, textarea')) return;
      if (ev.key === 'b') scene.breed();
      if (ev.key === 'r') scene.reseed();
    });
  }

  // Pause the sim when the tab is hidden — a backgrounded phone tab that keeps
  // stepping physics just burns battery. The day/night cycle reads the real
  // clock, so it's correct again the instant we resume.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.scene.pause('terrarium');
    } else {
      game.scene.resume('terrarium');
      queueResize();
    }
  });

  // Belt and braces against iOS double-tap zoom on the canvas.
  stage.addEventListener('dblclick', (e) => e.preventDefault());
  stage.addEventListener('gesturestart', (e) => e.preventDefault());

  wireGlass();
}

/* ------------------------------------------------------------- glass ---- */

/**
 * Rasterizing a lens needs the button's real box, so this runs after layout.
 * Every button is the same circle, so all four share one filter and one map.
 */
function wireGlass() {
  // A 58px button is small, so push the bend and the rim past the library's
  // default — at this size the default reads as a flat tint.
  const OPTICS = { strength: 0.11, bend: 0.4, dispersion: 0.65, curvature: 0.55,
                   frost: 1.2, sheen: 0.42, glow: 0.16 };
  const install = () => glassify('.glass-btn', { optics: OPTICS });
  if (document.fonts?.ready) document.fonts.ready.then(install);
  requestAnimationFrame(() => requestAnimationFrame(install));

  // The dial's diameter changes between the sheet and rail layouts; re-fit when
  // it does, but only on a real size change — regenerating the map is not free.
  if (typeof ResizeObserver === 'function') {
    let last = '';
    const ro = new ResizeObserver((entries) => {
      const sig = entries.map((e) => `${Math.round(e.contentRect.width)}`).join(',');
      if (sig === last) return;
      last = sig;
      install();
    });
    for (const b of document.querySelectorAll('.glass-btn')) ro.observe(b);
  }

  if (!supportsLensBackdrop()) {
    // Not a failure — Safari/Firefox get frost + tint + rim, just no live bend.
    console.info('[glass] backdrop-filter: url() unsupported; using frost fallback');
  }
}
