// Terrarium gates.
//
// Two independent, server-authoritative flags per terrarium. They are cheap to
// sync because they are checked at the boundary-crossing moment and never
// polled: a visit is decided once, at entry.

export function makeGate({ gateOpen = false, pvpEnabled = false } = {}) {
  return { gateOpen, pvpEnabled, visitors: new Set(), updatedAt: 0 };
}

/**
 * Entry is decided ONCE. Closing the gate mid-visit does not eject anyone
 * already inside — trapping a visitor by shutting the gate behind them is a
 * better moment than a hard ejection, and it costs the server nothing (no
 * forced-relocation path to write).
 */
export function tryEnter(gate, visitorId, now = 0) {
  if (!gate.gateOpen) return { ok: false, reason: 'closed' };
  gate.visitors.add(visitorId);
  gate.updatedAt = now;
  return { ok: true, enteredAt: now };
}

export function leave(gate, visitorId, now = 0) {
  const had = gate.visitors.delete(visitorId);
  if (had) gate.updatedAt = now;
  return had;
}

export function setGateOpen(gate, open, now = 0) {
  gate.gateOpen = Boolean(open);
  gate.updatedAt = now;
  return gate;              // existing visitors stay put, by design
}

export function setPvp(gate, enabled, now = 0) {
  gate.pvpEnabled = Boolean(enabled);
  gate.updatedAt = now;
  return gate;
}

/**
 * One-sided PVP is not PVP. A visitor from a PVP-off player is simply
 * unfightable inside a PVP-on terrarium, and vice versa.
 */
export function canFight(hostGate, visitorGate) {
  return Boolean(hostGate?.pvpEnabled && visitorGate?.pvpEnabled);
}

/**
 * What the dirt zone shows on a terrarium's outward-facing wall. A closed
 * terrarium should read as a legible discovery, not as a dead end that looks
 * like a bug.
 */
export function wallMarker(gate) {
  if (!gate) return { state: 'unknown', label: 'nobody home' };
  if (!gate.gateOpen) return { state: 'closed', label: 'sealed' };
  return gate.pvpEnabled
    ? { state: 'open-hostile', label: 'open — they fight' }
    : { state: 'open', label: 'open' };
}

/**
 * Abandoned cells auto-close. It is the simpler default and it removes the
 * griefing case where a long-inactive player's PVP-on terrarium stays open
 * forever with nobody minding it.
 */
export const ABANDON_SECONDS = 60 * 60 * 24 * 30;

export function reapAbandoned(gate, lastSeen, now) {
  if (now - lastSeen < ABANDON_SECONDS) return false;
  gate.gateOpen = false;
  gate.pvpEnabled = false;
  gate.updatedAt = now;
  return true;
}
