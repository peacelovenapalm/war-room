/**
 * STOP ALL shared state + honest response interpretation (KICKOFF-v3.1
 * hard rule 8: never weaken the unattended-run safety net).
 *
 * Panel findings (StopAllControl.tsx:20 + :12): the control used to treat
 * ANY parseable JSON as success — an HTTP 403 or `{ok:false}` flipped the
 * UI to "stopped" while automation kept running — and the HUD and
 * AutomationPanel mounted two independent, never-synced React states.
 *
 * The fixes live in three pure pieces, all owned here:
 *  - interpret*Response: success ONLY when the transport says 2xx AND the
 *    body says ok:true. Anything else is a failure the UI must render as
 *    an explicit ✗ FAILED state (shape + label, colorblind hard rule).
 *  - latchSnapshotFromHttp/reconcileAutomationLatch: mount hydration that
 *    cannot outrank a newer server revision.
 *  - reduceAutomationLatch: stop AND resume broadcasts are the sole shared
 *    transition authority; POST responses stay local receipts only.
 */

import type { ServerMessage } from '../../../core/src/messages.js';

export type StopAllResult =
  | { ok: true; haltedOrders: number; haltedRuns: number; revision: number }
  | { ok: false };

export type ResumeResult = { ok: true; resumedOrders: number; revision: number } | { ok: false };

export interface AutomationLatchState {
  engaged: boolean;
  revision: number;
}

export const INITIAL_AUTOMATION_LATCH: AutomationLatchState = { engaged: false, revision: 0 };

function bodyOk(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** POST /api/automation/stop-all — success needs res.ok AND body.ok. */
export function interpretStopAllResponse(httpOk: boolean, body: unknown): StopAllResult {
  if (!httpOk || !bodyOk(body)) return { ok: false };
  return {
    ok: true,
    haltedOrders: count(body.haltedOrders),
    haltedRuns: count(body.haltedRuns),
    revision: count(body.revision),
  };
}

/** POST /api/automation/resume — same rule. */
export function interpretResumeResponse(httpOk: boolean, body: unknown): ResumeResult {
  if (!httpOk || !bodyOk(body)) return { ok: false };
  return { ok: true, resumedOrders: count(body.resumedOrders), revision: count(body.revision) };
}

/** Server-derived stop state: any order halted by the kill switch is still
 *  awaiting RESUME. (See the header for the chain-only-halt limitation.) */
export function stoppedFromOrders(orders: Array<{ stoppedByKillSwitch?: boolean }>): boolean {
  return orders.some((order) => order.stoppedByKillSwitch === true);
}

/** C9-1: durable-latch hydration — GET /api/automation/stop-all-state returns
 *  `{ engaged }`, the server's persisted STOP-ALL record. This is the anchor
 *  that closes stoppedFromOrders' chain-only-halt gap: a STOP ALL that halted
 *  zero standing orders still sets the latch, so a fresh mount reads stopped.
 *  Anything but an explicit `engaged: true` is NOT stopped (a missing/garbled
 *  body must never fabricate a halt). */
export function latchSnapshotFromHttp(body: unknown): AutomationLatchState | null {
  if (typeof body !== 'object' || body === null) return null;
  const candidate = body as { engaged?: unknown; revision?: unknown };
  if (typeof candidate.engaged !== 'boolean' || typeof candidate.revision !== 'number') return null;
  return { engaged: candidate.engaged, revision: candidate.revision };
}

/** Server broadcasts are the sole transition authority. Older revisions
 * are ignored so delayed hydration can never clobber a newer push. */
export function reduceAutomationLatch(
  prev: AutomationLatchState,
  message: ServerMessage,
): AutomationLatchState {
  if (message.type !== 'automationStopped' && message.type !== 'automationResumed') return prev;
  const revision = message.revision;
  if (revision < prev.revision) return prev;
  return { engaged: message.type === 'automationStopped', revision };
}

export function reconcileAutomationLatch(
  prev: AutomationLatchState,
  snapshot: AutomationLatchState,
): AutomationLatchState {
  if (snapshot.revision < prev.revision) return prev;
  return snapshot;
}

/** Retained for receipt cleanup tests/components: a shared transition is
 * external when it differs from the request's expected engaged value. */
export function isExternalStopTransition(expected: boolean, actual: boolean): boolean {
  return expected !== actual;
}
