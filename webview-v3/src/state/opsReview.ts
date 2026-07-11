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

/** RUNG 2: gated proposals. Mirrors server/src/opsAdvisor.ts's
 *  OpsProposalVerb/OpsProposedAction exactly — every verb here maps 1:1 to
 *  an EXISTING endpoint/message the client already knows how to call
 *  (never a new server capability). `proposedActions` is absent (never an
 *  empty array) when the finding has nothing to propose. */
export type OpsProposalVerb = 'kill' | 'focus' | 'dispatch-nudge' | 'requeue';

export interface OpsProposedAction {
  verb: OpsProposalVerb;
  label: string;
  params: Record<string, string | number>;
}

export interface OpsFinding {
  id: string;
  kind: string;
  severity: OpsFindingSeverity;
  summary: string;
  detail: string;
  receipts: OpsReceipt[];
  proposedActions?: OpsProposedAction[];
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

/** RUNG 3: auto-executor status. Mirrors server/src/autoExecutor.ts's
 *  AutoStatus/AutoActionReceipt exactly — GET /api/ops/auto's response,
 *  verbatim. `whitelistLine` is server-generated so it's always consistent
 *  with the availability check that produced it (colorblind shape+label —
 *  "AUTO: OFF — whitelist empty" / "AUTO: <kind> ON (cap N, cooldown Nm)"). */
export interface AutoActionReceipt {
  ts: number;
  actionKind: string;
  cause: { findingId: string; receipts: OpsReceipt[] };
  outcome: { ok: boolean; detail: string };
  undo: string;
}

export interface AutoActionStatus {
  enabled: boolean;
  params?: Record<string, unknown>;
}

export interface AutoStatus {
  actions: Record<string, AutoActionStatus>;
  /** Newest first. */
  receipts: AutoActionReceipt[];
  whitelistLine: string;
}
