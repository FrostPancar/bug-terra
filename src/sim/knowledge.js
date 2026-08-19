// What the player has actually learned about each bug.
//
// `core/impressions.js` holds the vocabulary; this holds the earning of it.
// Nothing here touches genes or stats — it only records that the player was
// present for something, and decides which phrases that entitles them to.
//
// Keyed by genome id, which is a pure hash of the gene vector: the same animal
// is the same animal across a reload, and a sibling with different genes is a
// different animal even if it looks similar.

import { allImpressions } from '../core/impressions.js';
import { genomeId } from '../core/genes.js';

/**
 * How much exposure a phrase costs, by channel. Multiplied down by salience —
 * "freakishly fast" is obvious in seconds; "slow to recover" takes a while to
 * become a thing you'd say out loud.
 *
 * watch    : seconds of the bug being on screen and moving
 * combat   : fights the bug took part in
 * training : completed training sessions
 * vet      : visits (the vet reveals physical facts, never performance)
 */
export const CHANNEL_COST = {
  watch:    { base: 150, floor: 12 },   // seconds
  combat:   { base: 6,   floor: 1 },    // fights
  training: { base: 4,   floor: 1 },    // sessions
  vet:      { base: 1,   floor: 1 },    // visits
};

function costFor(channel, salience) {
  const c = CHANNEL_COST[channel] ?? CHANNEL_COST.watch;
  // salience 1 -> floor, salience 0 -> base
  return Math.max(c.floor, Math.round(c.base - (c.base - c.floor) * salience));
}

/** A blank record. Plain data on purpose — it serializes straight to storage. */
export function blankRecord(id) {
  return {
    id,
    exposure: { watch: 0, combat: 0, training: 0, vet: 0 },
    moments: [],          // short strings: things the player saw happen
    firstSeen: null,
    vet: { state: 'available', until: 0, visits: 0 },
  };
}

export class Knowledge {
  constructor(saved = {}) {
    /** @type {Record<string, ReturnType<typeof blankRecord>>} */
    this.records = { ...saved };
  }

  recordFor(genome) {
    const id = genomeId(genome);
    if (!this.records[id]) this.records[id] = blankRecord(id);
    return this.records[id];
  }

  /** Time spent watching a bug move, in seconds. Called from the sim loop. */
  observe(genome, seconds) {
    const r = this.recordFor(genome);
    r.exposure.watch += seconds;
    if (r.firstSeen === null) r.firstSeen = 0;
    return r;
  }

  /** One completed fight involving this bug. */
  fought(genome, { won = false, note = null } = {}) {
    const r = this.recordFor(genome);
    r.exposure.combat += 1;
    if (note) this.remember(genome, note);
    else this.remember(genome, won ? 'won a fight' : 'lost a fight');
    return r;
  }

  /** One completed training session (Training Rock, Obstacle Course, ...). */
  trained(genome, what = 'trained') {
    const r = this.recordFor(genome);
    r.exposure.training += 1;
    this.remember(genome, what);
    return r;
  }

  /** A moment worth remembering. Capped so the log stays readable. */
  remember(genome, text) {
    const r = this.recordFor(genome);
    if (r.moments[r.moments.length - 1] === text) return r;   // no stutter
    r.moments.push(text);
    if (r.moments.length > 12) r.moments.shift();
    return r;
  }

  /**
   * The phrases the player has earned about this bug, most striking first.
   * Everything else stays invisible — not greyed out, not teased, absent.
   */
  known(genome) {
    const r = this.recordFor(genome);
    return allImpressions(genome).filter(
      (imp) => r.exposure[imp.channel] >= costFor(imp.channel, imp.salience)
    );
  }

  /**
   * How much of a bug is still unknown, as a coarse word rather than a
   * percentage — a progress bar would be exactly the spreadsheet the concept
   * doc is trying to avoid.
   */
  familiarity(genome) {
    const total = allImpressions(genome).length;
    if (total === 0) return 'unremarkable so far';
    const got = this.known(genome).length;
    const k = got / total;
    if (k === 0) return 'a stranger';
    if (k < 0.34) return 'starting to get a sense of it';
    if (k < 0.67) return 'you know its habits';
    if (k < 1) return 'few surprises left';
    return 'you know this one';
  }

  export() { return JSON.parse(JSON.stringify(this.records)); }
}

/* ----------------------------------------------------------- vet station -- */

/**
 * The one place a bug's genetics can be seen directly — visually, never as
 * numbers. It costs time on purpose: the bug is out of the terrarium for the
 * length of the visit and cannot go straight back in afterwards, so checking
 * every bug constantly is not a strategy.
 *
 * Durations are in real seconds and read off a caller-supplied clock, so tests
 * can advance time without waiting.
 */
export const VET = {
  visitSeconds: 90,
  cooldownSeconds: 240,
};

export function vetStatus(record, now) {
  const v = record.vet;
  if (v.state === 'available') return { state: 'available', remaining: 0 };
  const remaining = Math.max(0, v.until - now);
  if (remaining > 0) return { state: v.state, remaining };
  // The timer ran out — a visit becomes a cooldown, a cooldown becomes free.
  if (v.state === 'visiting') {
    v.state = 'cooldown';
    v.until = now + VET.cooldownSeconds;
    return { state: 'cooldown', remaining: VET.cooldownSeconds };
  }
  v.state = 'available';
  v.until = 0;
  return { state: 'available', remaining: 0 };
}

/**
 * Send a bug in. Returns false if it is already there or still cooling down —
 * the caller decides how to tell the player, this just refuses.
 */
export function sendToVet(knowledge, genome, now) {
  const r = knowledge.recordFor(genome);
  if (vetStatus(r, now).state !== 'available') return false;
  r.vet.state = 'visiting';
  r.vet.until = now + VET.visitSeconds;
  r.vet.visits += 1;
  r.exposure.vet += 1;
  knowledge.remember(genome, 'went in for a look-over');
  return true;
}

/** True while the bug should NOT be present in the terrarium. */
export function isAway(record, now) {
  return vetStatus(record, now).state === 'visiting';
}
