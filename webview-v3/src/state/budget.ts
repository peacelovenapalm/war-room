/**
 * Budget guardrail pure logic — port of webview-ui/src/budget.ts (the
 * frozen fallback is read-only for WS-A). Mirrors core/src/messages.ts's
 * BudgetUpdate/BudgetClaudeSnapshot/BudgetCodexSnapshot without importing
 * the generated types directly.
 *
 * HARD RULE: this meter is informational ONLY next to Send — the CALL
 * modal never disables Send based on it (a human clicking Send is a
 * conscious spend, never budget-gated; only chain-step auto-continuation
 * and standing-order fires are).
 */

export interface BudgetSnapshotClient {
  claude: {
    fiveHourUsedPct: number | null;
    sevenDayUsedPct: number | null;
    stale: boolean;
    receivedAt: number | null;
    /** T5 fleet controls (RATE-LIMIT SCHEDULING HINTS, display-only) — Unix
     *  MS, null/absent when the snapshot itself carried none. Optional (not
     *  just nullable) so existing fixtures/older wire payloads without the
     *  field still type-check as an honest "no data", not an error. */
    fiveHourResetsAt?: number | null;
    sevenDayResetsAt?: number | null;
  };
  codex: {
    weeklyCap: number | null;
    weeklyUsed: number;
    estimatedPct: number | null;
  };
}

/** Colorblind-rule tier word alongside the number — never color alone. */
export function budgetTierWord(pct: number): string {
  if (pct >= 90) return 'critical';
  if (pct >= 70) return 'busy';
  return 'fair';
}

/** The Claude meter chip — bare %, the real live signal. e.g. "5H 42% fair". */
export function claudeBudgetChipLabel(claude: BudgetSnapshotClient['claude']): string {
  if (claude.stale || claude.fiveHourUsedPct === null) return '5H ⚠ STALE';
  const pct = Math.round(claude.fiveHourUsedPct);
  return `5H ${String(pct)}% ${budgetTierWord(pct)}`;
}

/** The Codex meter chip — ALWAYS "est." prefixed, NEVER the bare % the
 *  Claude meter gets (the word IS the honesty signal) — a manual
 *  heuristic, not a live read. */
export function codexBudgetChipLabel(codex: BudgetSnapshotClient['codex']): string {
  if (codex.weeklyCap === null || codex.estimatedPct === null) return '~ est. unset';
  return `~${String(codex.estimatedPct)}% est.`;
}

/** Provider-aware chip for the CALL modal meter next to Send. */
export function budgetChipLabel(
  snapshot: BudgetSnapshotClient | null,
  provider: string | undefined,
): string {
  if (!snapshot) return '⚠ STALE';
  return provider === 'codex'
    ? codexBudgetChipLabel(snapshot.codex)
    : claudeBudgetChipLabel(snapshot.claude);
}

/** Mirrors server/src/budgetStore.ts's AutomationPauseResult reasons — the
 *  ONLY four reasons a chain step or standing-order tick is ever
 *  budget-gated. */
export const AUTOMATION_PAUSE_REASONS = [
  'stale-snapshot',
  '5h-threshold',
  '7d-threshold',
  'codex-cap-reached',
] as const;
export type AutomationPauseReason = (typeof AUTOMATION_PAUSE_REASONS)[number];

export function isAutomationPauseReason(reason: string): reason is AutomationPauseReason {
  return (AUTOMATION_PAUSE_REASONS as readonly string[]).includes(reason);
}

const AUTOMATION_PAUSE_REASON_WORDS: Record<AutomationPauseReason, string> = {
  'stale-snapshot': 'stale telemetry',
  '5h-threshold': '5h budget',
  '7d-threshold': '7d budget',
  'codex-cap-reached': 'codex cap',
};

/** Colorblind rule: glyph + word, never color alone — this supplies the WORD
 *  half for a raw pause-reason string off the wire. Falls back to the raw
 *  string for forward-compat with an unknown reason. */
export function budgetPauseReasonWord(reason: string): string {
  return isAutomationPauseReason(reason) ? AUTOMATION_PAUSE_REASON_WORDS[reason] : reason;
}

// ── T5 fleet controls: RATE-LIMIT SCHEDULING HINTS (display-only) ───
//
// Mirrors server/src/budgetStore.ts's BASE pause thresholds (not the
// Foreman-perk-raised or hard-ceiling variants — this is a DISPLAY hint,
// not a gate, so the conservative base numbers are the honest default to
// warn against). Same hard rule as the rest of this file: informational
// only, never disables Send.

export const BUDGET_HINT_5H_PCT_THRESHOLD = 70;

/** "2h 15m" / "45m" / "<1m" / "now" — never a bare unformatted ms count. */
export function formatResetIn(resetsAt: number, now: number = Date.now()): string {
  const remainingMs = resetsAt - now;
  if (remainingMs <= 0) return 'now';
  const minutes = Math.round(remainingMs / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(mins)}m`;
}

/** "5h window 72% — resets in ~2h 15m · queue for reset?" (the "queue for
 *  reset?" hint only appears at/past the threshold). Honest NO DATA: null
 *  when the snapshot is stale/absent (never guess at a %), and the resets-in
 *  clause is simply omitted (not fabricated) when the snapshot carried no
 *  resetsAt. Codex's weekly heuristic has no resets_at concept at all — no
 *  hint line for it. */
export function budgetResetHintLine(
  snapshot: BudgetSnapshotClient | null,
  provider: string | undefined,
  now: number = Date.now(),
): string | null {
  if (provider === 'codex') return null;
  if (!snapshot) return null;
  const { claude } = snapshot;
  if (claude.stale || claude.fiveHourUsedPct === null) return null;
  const pct = Math.round(claude.fiveHourUsedPct);
  const resetsAt = claude.fiveHourResetsAt;
  const resetPart =
    resetsAt !== null && resetsAt !== undefined
      ? ` — resets in ~${formatResetIn(resetsAt, now)}`
      : '';
  const queueHint = pct >= BUDGET_HINT_5H_PCT_THRESHOLD ? ' · queue for reset?' : '';
  return `5h window ${String(pct)}%${resetPart}${queueHint}`;
}
