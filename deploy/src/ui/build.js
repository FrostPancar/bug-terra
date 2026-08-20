// The build menu: two steps, never one long list.
//
// There are twenty-six placeable things in the catalog. Shown at once that is a
// catalogue and a player closes it; shown as six categories that open into four
// or five items each, it is a decision. So step one is "what kind of thing", and
// step two is "which one", and the only thing that ever leaves this module is an
// id somebody chose.
//
// Nothing here reads a gene or a stat — it reads names, blurbs and categories off
// the object catalog and paints them. `tests/hidden.test.js` scans this directory
// to keep it that way.

import { CATALOG, CATALOG_IDS } from '../sim/objects.js';

/** The id that leads out of the terrarium. Everything else is furniture. */
export const ENTRANCE_ID = 'burrow_entrance';

/**
 * How each category is presented, in the order a player is likely to want it.
 * The colours are the same ones the scene paints the objects with, so the tile
 * you tapped and the thing on the floor are recognisably the same object.
 */
const CATEGORIES = [
  { key: 'plant',       label: 'Plants',      sub: 'the garden itself',    colour: 'var(--leaf)' },
  { key: 'breeding',    label: 'Breeding',    sub: 'ways to make more',    colour: 'var(--blue)' },
  { key: 'stat',        label: 'Training',    sub: 'work a bug can do',    colour: 'var(--red)' },
  { key: 'environment', label: 'Weather',     sub: 'light, warmth, water', colour: 'var(--green)' },
  { key: 'traversal',   label: 'Ways around', sub: 'paths and shortcuts',  colour: 'var(--yellow)' },
  { key: 'gene',        label: 'Heredity',    sub: 'what gets passed on',  colour: 'var(--purple)' },
];

const COLOUR_OF = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.colour]));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const inCategory = (key) => CATALOG_IDS
  .map((id) => CATALOG[id])
  .filter((s) => s.category === key && s.id !== ENTRANCE_ID);

/**
 * @param {object} o
 * @param {HTMLElement} o.root    where the steps are painted
 * @param {HTMLElement} o.title   the crumb's label
 * @param {HTMLElement} o.back    the crumb's back button
 * @param {(id: string) => void} o.onArm     player picked something to place
 * @param {() => void} o.onBurrow            player asked to go underground
 */
export function makeBuildMenu({ root, title, back, onArm, onBurrow }) {
  let category = null;
  let armed = null;
  let hasEntrance = false;

  /* ------------------------------------------------------------- step 1 -- */

  function paintCategories() {
    title.textContent = 'What goes in?';
    back.hidden = true;

    // The way down gets its own tile at the top, because it is the only thing
    // in the catalog that is not furniture — it is the door to another mode.
    const feature = hasEntrance
      ? `<button class="tile feature" data-go="burrow" type="button">
           <i class="swatch" style="background:var(--yellow)"></i>
           <span class="col"><span class="t-name">Go underground</span>
             <span class="t-sub">your burrow entrance is open</span></span>
         </button>`
      : `<button class="tile feature" data-arm="${ENTRANCE_ID}" type="button">
           <i class="swatch" style="background:var(--yellow)"></i>
           <span class="col"><span class="t-name">Burrow entrance</span>
             <span class="t-sub">dig a way down into the dirt</span></span>
         </button>`;

    root.innerHTML = `<div class="tiles">${feature}${CATEGORIES.map((c) => `
      <button class="tile" data-cat="${c.key}" type="button">
        <i class="swatch" style="background:${c.colour}"></i>
        <span class="t-name">${esc(c.label)}</span>
        <span class="t-sub">${esc(c.sub)}</span>
      </button>`).join('')}</div>`;
  }

  /* ------------------------------------------------------------- step 2 -- */

  function paintItems(key) {
    const meta = CATEGORIES.find((c) => c.key === key);
    title.textContent = meta?.label ?? 'Pick one';
    back.hidden = false;

    root.innerHTML = `<div class="items">${inCategory(key).map((s) => `
      <button class="item" data-arm="${s.id}" type="button"
              aria-pressed="${armed === s.id ? 'true' : 'false'}">
        <i class="swatch" style="background:${COLOUR_OF[key]}"></i>
        <span><span class="i-name">${esc(s.name)}</span>
          <span class="i-sub">${esc(s.blurb)}</span></span>
      </button>`).join('')}</div>`;
  }

  function paint() {
    if (category) paintItems(category);
    else paintCategories();
  }

  /* --------------------------------------------------------------- wire -- */

  root.addEventListener('click', (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.cat) { category = el.dataset.cat; paint(); return; }
    if (el.dataset.go === 'burrow') { onBurrow(); return; }
    if (el.dataset.arm) {
      armed = el.dataset.arm;
      onArm(armed);
      // Stay on the list: placing three ferns should not mean walking back in
      // through the menu three times.
      paint();
    }
  });

  back.addEventListener('click', () => { category = null; paint(); });

  return {
    /** Open at step one. */
    reset() { category = null; armed = null; paint(); },
    /** Reflect what the scene says is armed and whether a way down exists yet. */
    sync({ armedId = null, entrance = false } = {}) {
      const changed = armedId !== armed || entrance !== hasEntrance;
      armed = armedId;
      hasEntrance = entrance;
      if (changed) paint();
    },
    get category() { return category; },
  };
}
