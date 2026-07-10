/**
 * Crisis & triage row logic (v3 port of webview-ui/src/office/crisis.ts —
 * the frozen fallback stays untouched; this is the same PROVEN math carried
 * into the new workspace, minus canvas-effect plumbing).
 *
 * A blocked session is a FIRE that AGES: smoke → fire → alarm as minutes
 * pass. Every stage is a distinct SHAPE + TEXT LABEL (colorblind hard
 * rule). Failed/stopped agents leave labeled DEBRIS until acknowledged.
 * Concurrent crises form a triage queue ordered by age × severity.
 *
 * All aging is real: poll-driven states anchor to the server's transition
 * time; locally-detected needs-input anchors to client first-seen. No fake
 * ages (one-tap-real, hard rule 5).
 */

// ── Stages ──────────────────────────────────────────────────────

export const CrisisStage = {
  SMOKE: 'smoke',
  FIRE: 'fire',
  ALARM: 'alarm',
} as const;
export type CrisisStage = (typeof CrisisStage)[keyof typeof CrisisStage];

/** A blocked desk escalates to FIRE after this long. */
export const FIRE_AT_MS = 90_000;
/** …and to ALARM after this long. */
export const ALARM_AT_MS = 240_000;

export interface CrisisStageSpec {
  /** Distinct shape per stage — primary signal together with the label. */
  glyph: string;
  /** Uppercase text label — the other primary signal. */
  label: string;
  /** Loud stages render inverted/emphasized. */
  loud: boolean;
}

export const CRISIS_STAGE_SPECS: Record<CrisisStage, CrisisStageSpec> = {
  [CrisisStage.SMOKE]: { glyph: '≋', label: 'SMOKE', loud: false },
  [CrisisStage.FIRE]: { glyph: '▲', label: 'FIRE', loud: false },
  [CrisisStage.ALARM]: { glyph: '✱', label: 'ALARM', loud: true },
};

export const DEBRIS_GLYPH = '✗';

export function stageForAge(ageMs: number): CrisisStage {
  if (ageMs >= ALARM_AT_MS) return CrisisStage.ALARM;
  if (ageMs >= FIRE_AT_MS) return CrisisStage.FIRE;
  return CrisisStage.SMOKE;
}

// ── Triage queue ────────────────────────────────────────────────

/** Severity weights for the queue score (score = weight × ageMs).
 *  A blocked session wastes a live agent; debris is cleanup. */
export const SEVERITY_WEIGHTS = {
  blocked: 3,
  failed: 2,
  stopped: 1,
} as const;
export type CrisisKind = keyof typeof SEVERITY_WEIGHTS;

/**
 * What the row's inline answer verb can HONESTLY do today:
 *
 * - 'ack-undo' — debris rows: ACK is a client-side dismiss, genuinely
 *   reversible, so it gets an undo window (ackUndo.ts).
 * - 'none' — blocked rows: the current wire has NO remote approve gate
 *   (verified against core/asyncapi.yaml ClientMessage set + server HTTP
 *   routes + bin/needs-input-poller.mjs: the poller reports state, it
 *   cannot inject an answer). Per the stage contract, the row SAYS SO
 *   instead of faking an approve — answering happens at the desk
 *   (▸ DESK → COPY ID / KILL) until a substrate gate exists.
 */
export type ApproveGate = 'ack-undo' | 'none';

export interface TriageRow {
  /** 'fire:<id>' rows are live fires; 'debris:<key>' rows carry ACK. */
  rowKey: string;
  agentId: number;
  kind: CrisisKind;
  /** Stage for blocked rows; undefined for debris rows. */
  stage?: CrisisStage;
  /** Shape + word — the row's primary signal. */
  glyph: string;
  word: string;
  loud: boolean;
  /** Identity TEXT: "#id [MACHINE] folder". */
  identity: string;
  /** One-line cause (waitingFor, or a generic fallback) — verbatim. */
  cause: string;
  /** Escalation forecast ("→ ✱ ALARM at 4:00"), when a stage remains. */
  forecast?: string;
  ageMs: number;
  score: number;
  gate: ApproveGate;
  /** Set on debris rows so the board can ACK/UNDO them. */
  debrisKey?: string;
  /** The debris instance anchor (DebrisRecord.since) — ACKs are keyed to
   *  THIS instance so a stale undo window never sweeps a newer failure
   *  that reused the same `agentId:kind` key (ackUndo.ts). */
  debrisSince?: number;
}

export interface CrisisViewInput {
  agentId: number;
  since: number;
  identity: string;
  /** waitingFor from the poller, or a local detail line. */
  cause?: string;
}

export interface DebrisViewInput {
  key: string;
  agentId: number;
  kind: 'failed' | 'stopped';
  label: string;
  since: number;
}

/** "→ ▲ FIRE at 1:30" / "→ ✱ ALARM at 4:00"; none once ALARM is reached. */
export function escalationForecast(stage: CrisisStage): string | undefined {
  if (stage === CrisisStage.SMOKE) {
    return `→ ${CRISIS_STAGE_SPECS.fire.glyph} FIRE at ${formatAge(FIRE_AT_MS)}`;
  }
  if (stage === CrisisStage.FIRE) {
    return `→ ${CRISIS_STAGE_SPECS.alarm.glyph} ALARM at ${formatAge(ALARM_AT_MS)}`;
  }
  return undefined;
}

export function buildTriageRows(
  fires: CrisisViewInput[],
  debris: DebrisViewInput[],
  now: number,
): TriageRow[] {
  const rows: TriageRow[] = [];
  for (const f of fires) {
    const ageMs = Math.max(0, now - f.since);
    const stage = stageForAge(ageMs);
    const spec = CRISIS_STAGE_SPECS[stage];
    rows.push({
      rowKey: `fire:${String(f.agentId)}`,
      agentId: f.agentId,
      kind: 'blocked',
      stage,
      glyph: spec.glyph,
      word: spec.label,
      loud: spec.loud,
      identity: f.identity,
      cause: f.cause ?? 'Blocked — needs input',
      forecast: escalationForecast(stage),
      ageMs,
      score: SEVERITY_WEIGHTS.blocked * ageMs,
      gate: 'none',
    });
  }
  for (const d of debris) {
    const ageMs = Math.max(0, now - d.since);
    rows.push({
      rowKey: `debris:${d.key}`,
      agentId: d.agentId,
      kind: d.kind,
      glyph: DEBRIS_GLYPH,
      word: 'DEBRIS',
      loud: false,
      identity: d.label,
      cause: d.kind === 'failed' ? 'Session failed' : 'Session stopped',
      ageMs,
      score: SEVERITY_WEIGHTS[d.kind] * ageMs,
      gate: 'ack-undo',
      debrisKey: d.key,
      debrisSince: d.since,
    });
  }
  rows.sort((a, b) => b.score - a.score || a.agentId - b.agentId);
  return rows;
}

// ── Formatting ──────────────────────────────────────────────────

/** Compact m:ss / h:mm age for board rows and crisis tags (tabular nums). */
export function formatAge(ageMs: number): string {
  const totalSec = Math.max(0, Math.floor(ageMs / 1000));
  if (totalSec < 3600) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m)}:${String(s).padStart(2, '0')}`;
  }
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${String(h)}h${String(m).padStart(2, '0')}`;
}
