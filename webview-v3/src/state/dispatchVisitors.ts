/**
 * T6 — DISPATCHED JOBS VISIBLE IN THE OFFICE (Greg's repeated complaint —
 * KICKOFF-v4 T6 item 1): derives which RUNNING dispatches should render as
 * a visible guest presence on the floor, purely from the existing
 * DispatchEntry store (net/dispatchFacts.ts). No new WS message type —
 * this is a client-side derivation over data already on the wire, so a
 * visitor appears the instant its entry's 'answered' status carries a pid
 * (the runner's real 'started' report — the same split dispatchChipLabel
 * already uses to render RUNNING vs ACCEPTED) and disappears the same
 * render the moment the entry moves on to any terminal status
 * (exited/killed/capped/expired/denied). The DispatchEntry list IS the
 * source of truth; this module never invents timing of its own.
 */

import type { DispatchEntry } from '../net/dispatchFacts';

export interface DispatchVisitor {
  id: string;
  machine: string;
  provider?: string;
}

/** Bounded theater (D-9): at most this many guest presences on the floor
 *  at once — matches engine/world.ts's GUEST_SLOTS count. A burst of
 *  concurrent dispatches beyond this still shows in full in the (uncapped)
 *  dispatch tray; only the in-office sprite is capped. */
export const MAX_DISPATCH_VISITORS = 4;

/** RUNNING = 'answered' status with a pid present — the exact condition
 *  dispatchChipLabel uses to render the RUNNING word instead of ACCEPTED. */
export function isRunningDispatch(entry: Pick<DispatchEntry, 'status' | 'pid'>): boolean {
  return entry.status === 'answered' && entry.pid !== undefined;
}

/** Visible visitors for this frame — oldest-running dispatch first (stable
 *  ordering so guest-slot assignment doesn't jitter frame to frame), capped
 *  at MAX_DISPATCH_VISITORS. */
export function deriveDispatchVisitors(entries: readonly DispatchEntry[]): DispatchVisitor[] {
  return entries
    .filter(isRunningDispatch)
    .slice()
    .sort((a, b) => a.receivedAt - b.receivedAt)
    .slice(0, MAX_DISPATCH_VISITORS)
    .map((e) => ({ id: e.id, machine: e.machine, provider: e.provider }));
}
