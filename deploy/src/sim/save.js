// Session persistence.
//
// The concept doc calls the terrarium "a small world that's always going".
// That only holds if it survives the tab closing. Without this module a reload
// discarded the seed, the generation counter, the live population and every
// impression the player had earned — which is the whole investment the hidden
// stats layer asks them to make.
//
// One versioned JSON blob under one key. Nothing here interprets a genome: it
// round-trips whatever the scene hands it, and the scene re-validates on the
// way back in. That keeps this file free of the gene layer entirely.

export const SAVE_KEY = 'terrarium.save.v1';
export const SAVE_VERSION = 1;

/**
 * localStorage, or null when it is unavailable or refuses to write.
 * Safari in private mode exposes the API and throws on `setItem`, so a probe
 * is the only honest test.
 */
function storage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__terrarium_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** True when a run can actually be kept. The HUD says so rather than lying. */
export function canPersist() {
  return storage() !== null;
}

/**
 * Read the saved run. Returns null when there is nothing to resume, when the
 * blob is from a different version, or when it is unparseable — a corrupt save
 * should start a fresh terrarium, never crash into one.
 */
export function loadSave() {
  const s = storage();
  if (!s) return null;
  let raw;
  try {
    raw = s.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || data.version !== SAVE_VERSION) return null;
    return data;
  } catch {
    // Unreadable is the same as absent, and leaving it in place would keep
    // failing every load.
    clearSave();
    return null;
  }
}

/** Write the run. Returns false when storage refused, so callers can stop. */
export function writeSave(state) {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(SAVE_KEY, JSON.stringify({ ...state, version: SAVE_VERSION, savedAt: Date.now() }));
    return true;
  } catch {
    // Almost always the quota. Dropping the knowledge log's oldest half is a
    // better outcome than silently keeping a stale save forever.
    return false;
  }
}

export function clearSave() {
  const s = storage();
  if (!s) return;
  try { s.removeItem(SAVE_KEY); } catch { /* nothing useful to do */ }
}

/**
 * Debounced writer. The scene marks itself dirty on anything worth keeping and
 * ticks this; the write lands at most once every `everySeconds`, plus once more
 * whenever the page is about to go away.
 */
export class Autosave {
  constructor(collect, { everySeconds = 6 } = {}) {
    this.collect = collect;
    this.everySeconds = everySeconds;
    this.dirty = false;
    this.elapsed = 0;
    this.available = canPersist();
  }

  markDirty() { this.dirty = true; }

  tick(dt) {
    if (!this.available || !this.dirty) return false;
    this.elapsed += dt;
    if (this.elapsed < this.everySeconds) return false;
    return this.flush();
  }

  /** Write now, dirty or not. Used on pagehide, where there is no next tick. */
  flush() {
    if (!this.available) return false;
    this.elapsed = 0;
    this.dirty = false;
    return writeSave(this.collect());
  }
}
