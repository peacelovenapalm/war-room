/**
 * Pure types + helpers for the OPS REVIEW panel (T3 self-healing ladder,
 * RUNG 1 — read-only Ops Advisor). Mirrors server/src/opsAdvisor.ts's
 * shapes exactly — GET /api/ops/review's response, verbatim.
 */

export type OpsFindingSeverity = 'info' | 'warn' | 'alert';

export interface OpsReceipt {
  label: string;
  value: string;
}

export interface OpsFinding {
  id: string;
  kind: string;
  severity: OpsFindingSeverity;
  summary: string;
  detail: string;
  receipts: OpsReceipt[];
}

export interface OpsReview {
  generatedAt: string;
  findings: OpsFinding[];
}

/** GET /api/shift's compact `opsReview` fold — counts + the single most
 *  urgent finding, not the full receipt-laden list. */
export interface OpsReviewSummary {
  generatedAt: string;
  counts: Record<OpsFindingSeverity, number>;
  topFinding: { summary: string; severity: OpsFindingSeverity } | null;
}

/** Colorblind hard rule: shape + label glyph is the primary signal, color
 *  (via CSS class) is reinforcement only. */
export const SEVERITY_GLYPHS: Record<OpsFindingSeverity, { glyph: string; word: string }> = {
  info: { glyph: 'ℹ', word: 'INFO' },
  warn: { glyph: '⚠', word: 'WARN' },
  alert: { glyph: '✗', word: 'ALERT' },
};
