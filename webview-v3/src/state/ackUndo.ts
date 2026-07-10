/**
 * ACK undo window (stage-2 board verb contract): acknowledging debris is a
 * client-side dismiss, so it is genuinely reversible — the row flips to
 * "↩ UNDO (ns)" for ACK_UNDO_WINDOW_MS before the removal commits. This is
 * the ONE gate on the board that honestly allows undo; blocked-row approve
 * has no remote gate at all (crisis.ts ApproveGate doc).
 *
 * Pure map-in/map-out helpers; the caller owns the tick that sweeps
 * expirations and commits them via crisisStore.acknowledgeDebris.
 */

export const ACK_UNDO_WINDOW_MS = 5_000;

/** debrisKey → epoch ms when the undo window closes. */
export type AckState = ReadonlyMap<string, number>;

export const EMPTY_ACKS: AckState = new Map<string, number>();

export function requestAck(state: AckState, key: string, now: number): AckState {
  const next = new Map(state);
  next.set(key, now + ACK_UNDO_WINDOW_MS);
  return next;
}

export function undoAck(state: AckState, key: string): AckState {
  if (!state.has(key)) return state;
  const next = new Map(state);
  next.delete(key);
  return next;
}

/** Keys whose undo window has lapsed — commit these for real. */
export function expiredAcks(state: AckState, now: number): string[] {
  const expired: string[] = [];
  for (const [key, undoUntil] of state) {
    if (now >= undoUntil) expired.push(key);
  }
  return expired;
}

export function clearAcks(state: AckState, keys: readonly string[]): AckState {
  if (keys.length === 0) return state;
  const next = new Map(state);
  for (const key of keys) next.delete(key);
  return next;
}

/** Whole seconds left in the undo window (for the "↩ UNDO (ns)" label). */
export function undoSecondsLeft(undoUntil: number, now: number): number {
  return Math.max(0, Math.ceil((undoUntil - now) / 1000));
}
