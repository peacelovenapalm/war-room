/**
 * Drawer verb eligibility + identity helpers — a faithful port of the
 * proven pure slices of webview-ui/src/dispatch.ts (the frozen fallback is
 * read-only for WS-A). Pure so the honest disabled states ("NO PID" vs
 * "NO RUNNER") are unit-testable without a rendering harness.
 */

/** A machine advertisement from GET /api/dispatch/machines. */
export interface DispatchMachine {
  machine: string;
  providers: string[];
  roots: string[];
  focus: boolean;
}

/** One-line copy-able identity for the drawer's COPY ID button:
 *  "MACHINE · /project/dir · session-id". Missing fields render honestly
 *  rather than silently dropping a separator. */
export function buildCopyIdLine(
  machine: string | undefined,
  cwd: string | undefined,
  sessionId: string | undefined,
): string {
  return [machine ?? '(no machine)', cwd ?? '(no cwd)', sessionId ?? '(no session id)'].join(' · ');
}

/** True when `machine` has ANY live runner advertisement — kill isn't gated
 *  by the allowlist's `focus` flag (a runner honors a stop instruction
 *  unconditionally; the runner's own registry is the real containment). */
export function machineHasLiveRunner(
  machines: DispatchMachine[],
  machine: string | undefined,
): boolean {
  if (!machine) return false;
  return machines.some((m) => m.machine === machine);
}

/** KILL button eligibility (KICKOFF v1.1 item 3): needs a real pid (from
 *  server hook telemetry) AND a live runner on that machine to have any
 *  chance of delivering the stop instruction. */
export function canKillAgent(
  pid: number | undefined,
  machines: DispatchMachine[],
  machine: string | undefined,
): boolean {
  return pid !== undefined && machineHasLiveRunner(machines, machine);
}
