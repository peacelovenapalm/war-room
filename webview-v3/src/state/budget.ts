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
