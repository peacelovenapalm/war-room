/**
 * Pure helpers + types for the Shift report panel, split out of
 * ShiftPanel.tsx so the component file exports components only
 * (react-refresh/only-export-components) — this module can be unit-tested
 * directly with no rendering harness.
 */

export interface ShiftReport {
  date: string;
  turnsCompleted: number;
  tokensIn: number;
  tokensOut: number;
  crisesIgnited: number;
  crisesResolved: number;
  crisesOpen: number;
  meanTimeToUnblockMs: number | null;
  longestBlockedMs: number;
  todosClosed: number | null;
  gatesAdvanced: number | null;
  outputTokensPerTurn: number | null;
  efficiency: 'LEAN' | 'STEADY' | 'HEAVY' | null;
  generatedAt: string;
}

/** GET /api/shift response shape: today's live scorecard + yesterday's
 *  closed ledger (deferred nit: previous-day card survives midnight). */
export interface ShiftSnapshot {
  today: ShiftReport;
  yesterday: ShiftReport | null;
}

export function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** HH:MM in local time, zero-padded — used by the staleness marker. */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Pure staleness rule (colorblind hard rule: shape + text, never a silent
 *  fallback to old-data-looking-fresh): stale only when a refresh failed
 *  AND there's a previously-shown report to mark as stale. No report yet
 *  + error → the existing "unable to reach" banner instead (not stale). */
export function isShiftReportStale(hasReport: boolean, refreshFailed: boolean): boolean {
  return refreshFailed && hasReport;
}

/** Colorblind rule: WORD carries the grade; color is reinforcement only. */
export const EFFICIENCY_WORDS: Record<NonNullable<ShiftReport['efficiency']>, string> = {
  LEAN: 'LEAN — low spend per completed turn. Keep it up.',
  STEADY: 'STEADY — normal spend per completed turn.',
  HEAVY: 'HEAVY — high spend per completed turn. Worth a look.',
};
