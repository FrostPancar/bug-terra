// The link between the main UI, the things you can place, and the dirt zone.
//
// Three systems already existed and none of them could reach each other: the HUD
// (index.html), the object catalog (src/sim/objects.js) and the shared world
// (src/world/). This module is the path between them, written as one state
// machine so that "how do I get underground" has exactly one answer.
//
//     WATCH ──[Build]──▶ BUILD ──[pick a thing]──▶ PLACE ──[tap the floor]──┐
//       ▲                  │  ▲                      │                      │
//       │                  │  └──────[Back]──────────┘   (stays armed, so   │
//       │                  │                              you can place     │
//       │                  │                              several)          │
//       ├──────[Done]──────┴──────────────────────────────────────────◀─────┘
//       │
//       │                  ┌── requires: a placed Burrow Entrance, and a bug
//       └──[Surface]── BURROW ◀──[Burrow]── WATCH / BUILD
//
// The rule the diagram encodes: you cannot enter burrow mode until you have
// BUILT the thing that goes underground. The catalog is not decoration on the
// way to the dirt zone — it is the gate.
//
// Presentation only. No gene, no stat, no number about an animal passes through
// here; `tests/hidden.test.js` scans this directory to keep it honest.

import { ENTRANCE_ID } from './build.js';
import { CATALOG } from '../sim/objects.js';

/** What the panel shows. The scene has its own narrower idea — see below. */
export const UI_MODES = ['watch', 'build', 'place', 'burrow'];

/**
 * @param {object} o
 * @param {object} o.scene    the terrarium scene (owns placement + burrow)
 * @param {object} o.dom      the elements this machine moves around
 * @param {object} o.build    the build menu from ./build.js
 * @param {(text: string, tone?: string) => void} o.toast
 * @param {{expand: Function, isSheet: Function}} o.sheet
 */
export function createModes({ scene, dom, build, toast, sheet }) {
  let mode = 'watch';

  const screens = {
    watch: dom.screenWatch,
    build: dom.screenBuild,
    place: dom.screenBuild,      // placing is still the build screen, armed
    burrow: dom.screenBurrow,
  };

  const nameOf = (id) => CATALOG[id]?.name ?? String(id ?? '').replace(/_/g, ' ');

  /** Paint the chrome for whichever mode we are in. */
  function apply() {
    // `place` shares the build screen with `build`, so a screen shows whenever
    // the current mode points at it.
    for (const el of new Set(Object.values(screens))) el.hidden = screens[mode] !== el;

    // The dock and the mode banner occupy the same spot and are never both up.
    const banner = mode === 'place' || mode === 'burrow';
    dom.dock.hidden = banner;
    dom.modeBar.hidden = !banner;

    if (mode === 'place') {
      dom.modeText.innerHTML = `<b>Placing</b>${nameOf(scene.armed)} — tap the floor`;
      dom.modeDone.textContent = 'Done';
    } else if (mode === 'burrow') {
      dom.modeText.innerHTML = '<b>Underground</b>Drag to steer';
      dom.modeDone.textContent = 'Surface';
    }

    dom.build.setAttribute('aria-pressed', String(mode === 'build' || mode === 'place'));
    dom.burrow.setAttribute('aria-pressed', String(mode === 'burrow'));
    document.body.classList.toggle('is-underground', mode === 'burrow');
  }

  /* ------------------------------------------------------------ transitions */

  function toWatch() {
    if (mode === 'burrow') scene.exitBurrow();
    scene.disarm();
    mode = 'watch';
    apply();
  }

  function toBuild() {
    if (mode === 'burrow') scene.exitBurrow();
    scene.disarm();
    mode = 'build';
    build.reset();
    if (sheet.isSheet()) sheet.expand();
    apply();
  }

  /** Hold something. The scene decides where it may actually land. */
  function toPlace(id) {
    scene.arm(id);
    mode = 'place';
    apply();
  }

  /**
   * Go under — but only through a door you built, carrying an animal you picked.
   * A refusal here is the machine explaining itself, not a dead end: if there is
   * no entrance, it drops the player into the build menu already holding one.
   */
  function toBurrow(bug) {
    if (!scene.entrances().length) {
      toBuild();
      toPlace(ENTRANCE_ID);
      toast('Place a burrow entrance first — tap the floor.', 'bad');
      return false;
    }
    const rider = bug ?? scene.selected;
    if (!rider || !rider.alive) {
      toWatch();
      toast('Pick a bug to send down.', 'bad');
      return false;
    }
    const res = scene.enterBurrow(rider);
    if (!res.ok) { toast(res.reason, 'bad'); return false; }
    mode = 'burrow';
    if (sheet.isSheet()) sheet.expand();
    apply();
    return true;
  }

  /**
   * Follow the scene if it changed modes without us — `forgetRun` surfacing a
   * burrow, a console call, a future trigger in the sim. Only the underground
   * flag is reconciled: a scene sitting in 'watch' while the panel shows the
   * build menu is not a disagreement, it is what browsing the catalog looks
   * like.
   */
  function sync(sceneMode) {
    if (sceneMode === 'burrow' && mode !== 'burrow') { mode = 'burrow'; apply(); }
    else if (sceneMode !== 'burrow' && mode === 'burrow') { mode = 'watch'; apply(); }
  }

  return {
    get mode() { return mode; },
    toWatch, toBuild, toPlace, toBurrow, sync,
    /** Re-paint after the scene changed something underneath us. */
    refresh: apply,
  };
}
