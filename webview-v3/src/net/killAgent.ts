/**
 * Shared KILL request/poll client helpers — the real POST /api/agents/kill
 * + GET /api/agents/kill/:id endpoint calls, extracted out of
 * AgentDrawer.tsx so any other panel that proposes a KILL (e.g. OPS REVIEW's
 * rung-2 gated proposals) hits the exact same wire path rather than a
 * re-implementation that could drift from it.
 */

/** Kill-outcome poll cadence + honest give-up (mirrors the v1 drawer). */
export const KILL_POLL_INTERVAL_MS = 1_000;
export const KILL_RESULT_TIMEOUT_MS = 15_000;

export interface KillRequestResult {
  ok: boolean;
  id?: string;
  reason?: string;
}

export async function requestKill(machine: string, pid: number): Promise<KillRequestResult> {
  try {
    const res = await fetch('/api/agents/kill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine, pid }),
    });
    return (await res.json()) as KillRequestResult;
  } catch {
    return { ok: false, reason: 'request failed' };
  }
}

export interface KillOutcome {
  status: 'pending' | 'killed' | 'denied';
  reason?: string;
}

/** Returns `null` on a fetch/parse failure — the caller decides whether
 *  that counts as "still pending" (transient) vs. a timeout. */
export async function pollKillOutcome(requestId: string): Promise<KillOutcome | null> {
  try {
    const res = await fetch(`/api/agents/kill/${requestId}`);
    if (!res.ok) return null;
    return (await res.json()) as KillOutcome;
  } catch {
    return null;
  }
}
