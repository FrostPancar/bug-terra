// Boot + HUD wiring.

import { TerrariumScene, WORLD } from './sim/terrarium.js';
import { computeWorld, tierSettings, isTouchDevice, setViewport } from './sim/viewport.js';
import { FITNESS } from './core/stats.js';
import { pressable, setPaused, bump, makeToaster } from './ui/chrome.js';
import { makeBuildMenu } from './ui/build.js';
import { createModes } from './ui/modes.js';
import { DIRT_URI } from './assets/dirt.js';

// NOTE: this module deliberately imports no gene list and no stat list. The
// panel is not given the vocabulary to print a gene value or a stat, so it
// cannot drift back into being a spreadsheet. `tests/hidden.test.js` fails the
// build if either import reappears here or anywhere under src/ui.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const stage = $('stage');
const canvasHost = $('canvasHost');
const touch = isTouchDevice();

// The stage sits behind the canvas and shows through wherever FIT letterboxes.
// Painting it with the same floor photograph makes that band disappear instead
// of reading as a flat strip of the wrong brown.
stage.style.backgroundImage = `url("${DIRT_URI}")`;

const toast = makeToaster($('toasts'));

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
  backgroundColor: '#a37a4f',
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
let modes = null;
let build = null;

game.events.once('ready', () => {
  scene = game.scene.getScene('terrarium');
  // handy in the console, and the viewport test reads the playable box from it
  window.__terrarium = { game, scene, WORLD };
  scene.events.on('state', render);
  scene.events.on('selected', () => { if (isSheetMode() && modes?.mode === 'watch') expandSheet(); });
  // Finds in the dirt and refused placements are news, not state.
  scene.events.on('burrowNote', ({ text, tone }) => toast(text, tone === 'common' ? '' : tone));
  // The door on the floor does what the Burrow button does.
  scene.events.on('entranceTap', () => modes?.toBurrow(scene.selected));
  scene.events.on('placed', (res) => {
    if (res.ok) toast(`${res.name} placed.`);
    else toast(res.reason, 'bad');
  });
  // `ready` fires when the GAME boots, which is now before the scene has
  // created — the floor photograph put create() behind the loader. Wiring the
  // HUD against a scene with no world yet resized a terrarium that did not
  // exist, so wait for create() unless it has already run.
  const boot = () => { wire(); wireViewport(); };
  if (scene.terrariumBounds) boot();
  else scene.events.once('create', boot);
});

/* ------------------------------------------------------------ render ---- */

let lastSel = null;
let lastVet = null;
let lastGen = null;
let lastBuilt = null;
let lastFinds = -1;

function render(s) {
  // --- the status card: the only three numbers on screen ---
  $('clock').textContent = s.clock;
  $('phase').textContent = s.env.label;
  $('alive').textContent = `${s.alive}/${s.total}`;
  // The day/night phase reads as a colour on the card as well as a word.
  $('sunDot').style.background = s.env.css;

  // The generation squashes when it moves, so a fast-forward is something you
  // see rather than something you check.
  if (s.generation !== lastGen) {
    lastGen = s.generation;
    $('gen').textContent = s.generation;
    bump($('gen'));
  }

  // --- collapsed-sheet summary ---
  $('hGen').textContent = `gen ${s.generation}`;
  $('hAlive').textContent = `${s.alive}/${s.total}`;
  $('hHint').textContent = s.mode === 'burrow'
    ? 'underground'
    : (s.selected ? s.selected.name : 'tap a bug');

  // --- things that only earn their place once they say something ---
  // "too early to say" is not information at first launch, so the line is not
  // there at first launch.
  const trend = $('trend');
  const spread = $('spread');
  const hasHistory = s.generation > 1;
  trend.hidden = !hasHistory;
  spread.hidden = !hasHistory;
  if (hasHistory) {
    trend.textContent = s.trend;
    spread.textContent = s.diversity;
  }

  $('seedOut').textContent = s.seed;

  // A refused breed is a real outcome and says so; anything else clears it.
  const note = $('breedNote');
  note.hidden = !s.breedNote;
  if (s.breedNote) note.textContent = s.breedNote;

  renderSaveNote(s);
  renderBuilt(s);
  renderBurrow(s);
  renderVet(s);

  // The build menu needs to know what is armed and whether a way down exists,
  // and the mode machine follows the scene if it moved without being asked.
  build?.sync({ armedId: s.armed, entrance: s.canBurrow });
  modes?.sync(s.mode);

  const b = s.selected;
  // Only rebuild the inspect panel when something meaningful changed — on a
  // phone, re-rendering this markup 5x/sec is a measurable frame cost.
  const sig = b
    ? `${b.id}|${b.state}|${b.alive}|${b.condition}|${b.vigour}|${b.kills}|${b.impressions.length}`
    : 'none';
  if (sig === lastSel) return;
  lastSel = sig;

  $('bugActions').hidden = !b;
  if (!b) {
    $('inspect').innerHTML =
      `<p class="muted small">${touch ? 'Tap' : 'Click'} a bug to get to know it.</p>`;
    return;
  }

  // Physical facts are free — they are literally drawn on the sprite. Traits
  // are earned. Performance is only ever a phrase, and only once you've seen it.
  const facts = [
    ...b.physical.map((f) => `<span class="fact">${esc(f)}</span>`),
    ...b.traits.map((t) => `<span class="fact trait">${esc(t)}</span>`),
  ].join('');

  const tells = b.impressions.length
    ? `<ul class="tells">${b.impressions.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
    : `<p class="unknown">You haven't watched this one long enough to say
       anything about it yet. Leave it be, or put it in a fight.</p>`;

  const moments = b.moments?.length
    ? `<ul class="moments">${b.moments.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
    : '';

  $('inspect').innerHTML = `
    <h3>${esc(b.name)} <span class="kind">${esc(b.kind)}</span>${b.alive ? '' : ' <span class="dead">DOWN</span>'}</h3>
    <p class="line">#${esc(b.tag)} · gen ${b.generation} · ${esc(b.condition)} ·
       ${esc(b.vigour)}${b.envenomed ? ' · <span class="envenomed">envenomed</span>' : ''}</p>
    <div class="facts">${facts}</div>
    ${tells}
    <p class="familiar">${esc(b.familiarity)}</p>
    ${moments}`;
}

/**
 * Whether this run is being kept. Said plainly rather than assumed: private
 * browsing and a locked-down profile both leave storage unavailable, and
 * quietly losing an hour of watching would be the worst possible surprise.
 */
let lastSave = null;
function renderSaveNote(s) {
  const sig = `${s.persists}|${s.resumed}`;
  if (sig === lastSave) return;
  lastSave = sig;
  $('saveNote').textContent = !s.persists
    ? 'This browser will not let the terrarium save. Closing the tab loses it.'
    : s.resumed
      ? 'Picked up where you left off. It keeps itself saved from here.'
      : 'Kept automatically. Close the tab and it will be here when you get back.';
  $('forget').disabled = !s.persists;
}

/** What you have built, as a list of names. Bundled, not itemised on the HUD. */
function renderBuilt(s) {
  const sig = s.built.map((o) => o.id).join(',');
  if (sig === lastBuilt) return;
  lastBuilt = sig;
  $('builtList').innerHTML = s.built.length
    ? s.built.map((o) => `<span class="fact">${esc(o.name)}</span>`).join('')
    : '<span class="fact">nothing placed yet</span>';
}

/** The trip underground: who is down there and what they have turned up. */
function renderBurrow(s) {
  if (s.mode !== 'burrow') { lastFinds = -1; return; }
  const who = s.burrow.bug?.name ?? 'Underground';
  $('burrowWho').textContent = `${who} is digging`;
  if (s.burrow.finds.length === lastFinds) return;
  lastFinds = s.burrow.finds.length;
  $('burrowFinds').innerHTML = s.burrow.finds
    .map((f) => `<li>Turned up ${esc(f.said)}.</li>`).join('');
  $('burrowHint').hidden = s.burrow.finds.length > 0;
}

/** The vet block: who is away, how long, and whether this one can go in. */
function renderVet(s) {
  const b = s.selected;
  const away = s.atVet ?? [];
  const sig = `${b?.id ?? 'none'}|${b?.vet?.state ?? '-'}|${s.canBurrow}|${s.mode}|` +
    away.map((a) => `${a.id}:${a.remaining}`).join(',');
  if (sig === lastVet) return;
  lastVet = sig;

  const btn = $('vetSend');
  const down = $('sendDown');
  const state = $('vetState');
  if (!b) {
    btn.disabled = true;
    down.disabled = true;
    state.textContent = 'pick a bug first';
  } else if (b.vet.state === 'available') {
    btn.disabled = false;
    state.textContent = `The vet can look ${b.name} over. It costs you the bug for a while.`;
  } else if (b.vet.state === 'visiting') {
    btn.disabled = true;
    state.textContent = 'already at the vet';
  } else {
    btn.disabled = true;
    state.textContent = `${b.name} needs to settle before another visit`;
  }
  // Sending a bug down is only offered once there is somewhere for it to go.
  down.disabled = !b || !b.alive || s.mode === 'burrow';
  down.textContent = s.canBurrow ? 'Send down' : 'Dig a way down';

  const list = away.length
    ? `<p class="vet-away">Away: ${away.map((a) =>
        `${esc(a.name)} (~${Math.max(1, Math.ceil(a.remaining / 60))} min)`).join(', ')}</p>`
    : '';
  $('vetAway').innerHTML = list;
  if (vetCard) $('vetAway').appendChild(vetCard);
}

/* --------------------------------------------------------- vet portrait -- */

let vetCard = null;

/**
 * The look-over itself. The scene hands back a canvas and a few sentences; this
 * function has no access to the genome and no way to turn any of it into a
 * number, which is the point.
 */
function showVetPortrait(bug) {
  const out = scene.vetPortrait(bug);
  if (!out) return;
  const card = document.createElement('div');
  card.className = 'vet-card';
  const cv = out.canvas;
  cv.style.width = '100%';
  cv.style.maxWidth = '260px';
  cv.style.display = 'block';
  cv.style.margin = '8px auto';
  card.appendChild(cv);

  const r = out.readout;
  const facts = [...r.physical, ...r.traits]
    .map((f) => `<span class="fact">${esc(f)}</span>`).join('');
  const caption = document.createElement('div');
  caption.innerHTML = `
    <p class="muted small" style="text-align:center">
      ${esc(r.name)}${r.hybrid ? ' — an in-between thing' : ''}${r.order ? ` · ${esc(r.order)}` : ''}
    </p>
    <p class="unknown">${esc(r.blurb)}</p>
    <div class="facts">${facts}</div>
    ${r.drifting ? `<p class="familiar">${esc(r.drifting)}</p>` : ''}`;
  card.appendChild(caption);
  vetCard = card;
  lastVet = null;                 // force the block to redraw with the card in it
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

  // Only the sheet itself listens now — the multiply scrim it used to share
  // the gesture with is gone along with the dark panel it was built to hide.
  sheet.addEventListener('touchstart', start, { passive: true });
  sheet.addEventListener('touchmove', move, { passive: false });
  sheet.addEventListener('touchend', end, { passive: true });
  sheet.addEventListener('touchcancel', end, { passive: true });
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
  // A zero-size canvas means the page is not laid out at all — a hidden pane, a
  // backgrounded tab, a display:none ancestor. The CSS-px -> world-px conversion
  // below divides by that height, so measuring now would fence the terrarium
  // down to its 160 px floor and leave it there. Keep the last honest answer.
  if (c.width < 2 || c.height < 2) return scene.insetBottom;
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

  // The sheet's own transition ending is the one signal that is guaranteed to
  // mean "the panel has stopped moving". The ResizeObserver above fires DURING
  // the animation, so without this the bug fence can settle on a mid-transition
  // measurement and leave the play area the wrong height.
  document.querySelector('aside').addEventListener('transitionend', (e) => {
    if (e.propertyName === 'max-height') queueResize(0);
  });

  window.addEventListener('resize', onChange, { passive: true });
  window.addEventListener('orientationchange', () => queueResize(350), { passive: true });
  window.visualViewport?.addEventListener('resize', onChange, { passive: true });

  // Start collapsed whenever the panel is a sheet: the terrarium is the thing
  // worth looking at, and the summary row still carries the gen and the count.
  if (isSheetMode()) collapseSheet();
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

  /* ---- the three verbs, and the machine that links them ---- */

  build = makeBuildMenu({
    root: $('buildBody'),
    title: $('buildTitle'),
    back: $('buildBack'),
    onArm: (id) => modes.toPlace(id),
    onBurrow: () => modes.toBurrow(scene.selected),
  });

  modes = createModes({
    scene,
    build,
    toast,
    dom: {
      screenWatch: $('screenWatch'),
      screenBuild: $('screenBuild'),
      screenBurrow: $('screenBurrow'),
      dock: $('dock'),
      modeBar: $('modeBar'),
      modeText: $('modeText'),
      modeDone: $('modeDone'),
      build: $('build'),
      burrow: $('burrow'),
    },
    sheet: { expand: expandSheet, isSheet: isSheetMode },
  });

  $('breed').onclick = () => scene.breed();
  $('build').onclick = () => (modes.mode === 'watch' ? modes.toBuild() : modes.toWatch());
  $('burrow').onclick = () => modes.toBurrow(scene.selected);
  $('modeDone').onclick = () => modes.toWatch();
  $('surface').onclick = () => modes.toWatch();
  $('sendDown').onclick = () => modes.toBurrow(scene.selected);

  $('pause').onclick = (e) => {
    const running = scene.matter.world.enabled;
    scene.matter.world.enabled = !running;
    setPaused(e.currentTarget, running);
  };

  $('ff').onclick = () => scene.fastForward(Number($('ffN').value) || 10);
  $('reseed').onclick = () => scene.reseed();

  $('vetSend').onclick = () => {
    const bug = scene.selected;
    if (!bug) return;
    // Draw the portrait BEFORE the bug leaves — the look-over is the reason
    // it's gone, so the picture is what you get in exchange for the wait.
    showVetPortrait(bug);
    scene.sendToVet(bug);
  };

  // Starting over throws the saved run away, so it asks first — an hour of
  // watching is exactly the thing you cannot get back.
  $('forget').onclick = () => {
    const ok = window.confirm(
      'Start over? This clears the terrarium and everything you have learned about it.');
    if (!ok) return;
    modes.toWatch();
    scene.forgetRun();
    lastSel = null;
    lastVet = null;
    lastSave = null;
    lastBuilt = null;
    vetCard = null;
    $('vetAway').innerHTML = '';
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
      // Escape always means "put it down and come back up".
      if (ev.key === 'Escape' && modes.mode !== 'watch') modes.toWatch();
    });
  }

  // Pause the sim when the tab is hidden — a backgrounded phone tab that keeps
  // stepping physics just burns battery. The day/night cycle reads the real
  // clock, so it's correct again the instant we resume.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Backgrounding a tab is the most common way a run ends, so it is also
      // the most important moment to write it down.
      scene.flushSave();
      game.scene.pause('terrarium');
    } else {
      game.scene.resume('terrarium');
      queueResize();
    }
  });

  // pagehide fires on iOS where unload does not. Both are best-effort; the
  // periodic autosave is what actually guarantees the run survives.
  window.addEventListener('pagehide', () => scene.flushSave());
  window.addEventListener('beforeunload', () => scene.flushSave());

  // Belt and braces against iOS double-tap zoom on the canvas.
  stage.addEventListener('dblclick', (e) => e.preventDefault());
  stage.addEventListener('gesturestart', (e) => e.preventDefault());

  // Press feedback that survives a touch — see src/ui/chrome.js.
  pressable('.btn');
  modes.refresh();
}
