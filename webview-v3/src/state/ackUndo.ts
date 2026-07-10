/**
 * ACK undo window (stage-2 board verb contract): acknowledging debris is a
 * client-side dismiss, so it is genuinely reversible — the row flips to
 * "↩ UNDO (ns)" for ACK_UNDO_WINDOW_MS before the removal commits. This is
 * the ONE gate on the board that honestly allows undo; blocked-row approve
 * has no remote gate at all (crisis.ts ApproveGate doc).
 *
 * Instance keying (panel finding, crisisStore.ts:47): the map key
 * `${agentId}:${kind}` is REUSABLE — an agent can recover (deleting its
 * debris) and fail again inside a still-open undo window. Each pending ack
 * therefore also records the `since` of the debris instance it was aimed
 * at; crisisStore.sweepAcks() commits an expiry ONLY against the same
 * instance and drops the ack the moment its debris is deleted or replaced.
 *
 * Pure map-in/map-out helpers; the caller owns the tick that runs
 * crisisStore.sweepAcks.
 */

export const ACK_UNDO_WINDOW_MS = 5_000;

export interface PendingAck {
  /** Epoch ms when the undo window closes and the removal commits. */
  undoUntil: number;
  /** The `since` of the debris instance this ack was aimed at — the
   *  failure-instance identity (a reused key gets a fresh `since`). */
  since: number;
}

/** debrisKey → the pending ack aimed at that key's CURRENT instance. */
export type AckState = ReadonlyMap<string, PendingAck>;

export const EMPTY_ACKS: AckState = new Map<string, PendingAck>();

export function requestAck(state: AckState, key: string, since: number, now: number): AckState {
  const next = new Map(state);
  next.set(key, { undoUntil: now + ACK_UNDO_WINDOW_MS, since });
  return next;
}

export function undoAck(state: AckState, key: string): AckState {
  if (!state.has(key)) return state;
  const next = new Map(state);
  next.delete(key);
  return next;
}

/** Whole seconds left in the undo window (for the "↩ UNDO (ns)" label). */
export function undoSecondsLeft(undoUntil: number, now: number): number {
  return Math.max(0, Math.ceil((undoUntil - now) / 1000));
}
