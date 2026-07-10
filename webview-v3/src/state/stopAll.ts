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
 *  - stoppedFromOrders: mount-time hydration from GET /api/standing-orders
 *    (`stoppedByKillSwitch` is the server's persisted record of a halt
 *    awaiting RESUME). Limitation, honestly noted: a STOP ALL that halted
 *    only chain runs (zero enabled orders) leaves no durable order flag —
 *    hydration then reads not-stopped, and pressing STOP ALL again is a
 *    harmless idempotent re-halt (the safe default direction).
 *  - reduceAutomationStopped: the WS `automationStopped` broadcast latches
 *    every open webview to stopped, so all instances agree the moment ANY
 *    operator hits the switch.
 */

import type { ServerMessage } from '../../../core/src/messages.js';

export type StopAllResult = { ok: true; haltedOrders: number; haltedRuns: number } | { ok: false };

export type ResumeResult = { ok: true; resumedOrders: number } | { ok: false };

function bodyOk(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** POST /api/automation/stop-all — success needs res.ok AND body.ok. */
export function interpretStopAllResponse(httpOk: boolean, body: unknown): StopAllResult {
  if (!httpOk || !bodyOk(body)) return { ok: false };
  return { ok: true, haltedOrders: count(body.haltedOrders), haltedRuns: count(body.haltedRuns) };
}

/** POST /api/automation/resume — same rule. */
export function interpretResumeResponse(httpOk: boolean, body: unknown): ResumeResult {
  if (!httpOk || !bodyOk(body)) return { ok: false };
  return { ok: true, resumedOrders: count(body.resumedOrders) };
}

/** Server-derived stop state: any order halted by the kill switch is still
 *  awaiting RESUME. (See the header for the chain-only-halt limitation.) */
export function stoppedFromOrders(orders: Array<{ stoppedByKillSwitch?: boolean }>): boolean {
  return orders.some((order) => order.stoppedByKillSwitch === true);
}

/** WS reducer: `automationStopped` latches stopped for every client. */
export function reduceAutomationStopped(prev: boolean, message: ServerMessage): boolean {
  if (message.type === 'automationStopped') return true;
  return prev;
}
