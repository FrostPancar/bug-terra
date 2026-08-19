// Animation layer — a tiny state machine over baked sprite frames.
// Playback rate is driven by the stats layer (speed -> walk cadence,
// attackRate -> swing speed), so genes are visible in the motion.

import { ANIM_FRAMES } from '../render/bugArt.js';

export const STATES = ['idle', 'walk', 'attack'];

/** Which states may follow which. `attack` is a one-shot that returns to idle. */
const TRANSITIONS = {
  idle:   new Set(['walk', 'attack']),
  walk:   new Set(['idle', 'attack']),
  attack: new Set(['idle', 'walk']),
};

export class Animator {
  /**
   * @param {object} stats output of computeStats
   * @param {object} frames { idle:[...], walk:[...], attack:[...] } frame indices
   */
  constructor(stats, frames) {
    this.stats = stats;
    this.frames = frames;
    this.state = 'idle';
    this.t = 0;          // seconds inside the current state
    this.frame = frames.idle[0];
    this.locked = false; // one-shot in progress
    this.onComplete = null;
  }

  /** Frames per second for a state, derived from stats. */
  fps(state) {
    const s = this.stats;
    if (state === 'walk')   return Math.max(4, Math.min(26, 3 + s.speed * 0.22));
    if (state === 'attack') return Math.max(6, ANIM_FRAMES.attack * s.attackRate);
    return 3 + s.recovery * 0.35; // idle breathing
  }

  /** Length of a one-shot in seconds. */
  duration(state) {
    return ANIM_FRAMES[state] / this.fps(state);
  }

  /** Request a state change. Returns true if it took. */
  play(state, { force = false } = {}) {
    if (!STATES.includes(state)) return false;
    if (state === this.state) return true;
    if (this.locked && !force) return false;
    if (!TRANSITIONS[this.state].has(state) && !force) return false;
    this.state = state;
    this.t = 0;
    this.locked = state === 'attack';
    return true;
  }

  /** @param {number} dt seconds */
  update(dt) {
    this.t += dt;
    const list = this.frames[this.state];
    const n = list.length;
    const idx = Math.floor(this.t * this.fps(this.state));
    if (this.locked && idx >= n) {
      // one-shot finished
      this.locked = false;
      const cb = this.onComplete;
      this.state = 'idle';
      this.t = 0;
      this.frame = this.frames.idle[0];
      if (cb) cb();
      return this.frame;
    }
    this.frame = list[idx % n];
    return this.frame;
  }

  /** 0..1 progress through a one-shot; 0 when not locked. */
  get progress() {
    return this.locked ? Math.min(1, this.t / this.duration(this.state)) : 0;
  }
}
