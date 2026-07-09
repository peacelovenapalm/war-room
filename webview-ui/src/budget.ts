/**
 * Budget guardrail (v2 mechanic G3 — GAME-DESIGN.md §7.4) pure logic, split
 * out of CallModal so it's unit-testable with no rendering harness. Mirrors
 * core/src/messages.ts's BudgetUpdate/BudgetClaudeSnapshot/
 * BudgetCodexSnapshot without importing the server-facing generated types
 * directly into the webview bundle.
 *
 * HARD RULE: this meter is informational ONLY next to Send — CallModal
 * never disables Send based on it (a human clicking Send is a conscious
 * spend, never budget-gated; only chain-step auto-continuation and
 * standing-order fires are). budgetChipLabel is never consulted to compute
 * `canSubmit` anywhere in this codebase — grep for that if this changes.
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

/** Colorblind-rule tier word alongside the number — never color alone.
 *  Boundaries loosely mirror budgetStore.ts's own base pause thresholds
 *  (70/80) and hard ceilings (95) without hardcoding them here (this is
 *  display-only commentary, not a gate). */
export function budgetTierWord(pct: number): string {
  if (pct >= 90) return 'critical';
  if (pct >= 70) return 'busy';
  return 'fair';
}

/** The Claude meter chip — bare %, the real live signal. e.g. "5H 42% fair". */
export function claudeBudgetChipLabel(claude: BudgetSnapshotClient['claude']): string {
  if (claude.stale || claude.fiveHourUsedPct === null) return '5H ⚠ STALE';
  const pct = Math.round(claude.fiveHourUsedPct);
  return `5H ${pct}% ${budgetTierWord(pct)}`;
}

/** The Codex meter chip — ALWAYS "est." prefixed, NEVER the bare % the
 *  Claude meter gets (the word IS the honesty signal, GAME-DESIGN §7.4) —
 *  a manual heuristic Greg configures once, not a live read. */
export function codexBudgetChipLabel(codex: BudgetSnapshotClient['codex']): string {
  if (codex.weeklyCap === null || codex.estimatedPct === null) return '~ est. unset';
  return `~${codex.estimatedPct}% est.`;
}

/** Provider-aware chip for the CallModal meter next to Send. */
export function budgetChipLabel(
  snapshot: BudgetSnapshotClient | null,
  provider: string | undefined,
): string {
  if (!snapshot) return '⚠ STALE';
  return provider === 'codex'
    ? codexBudgetChipLabel(snapshot.codex)
    : claudeBudgetChipLabel(snapshot.claude);
}
