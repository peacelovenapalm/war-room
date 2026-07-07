/**
 * Crisis & triage layer (v1 mechanic #1) — pure logic, no DOM/canvas.
 *
 * A blocked session is a FIRE at that agent's desk that AGES:
 * smoke → fire → alarm as minutes pass. Every stage is a distinct
 * SILHOUETTE + TEXT LABEL (colorblind hard rule — color reinforces, never
 * carries). Failed/stopped agents leave labeled DEBRIS until acknowledged.
 * Concurrent crises form a triage queue ordered by age × severity.
 *
 * All aging is real: poll-driven states anchor to the server's transition
 * time (`ageMs` → since), locally-detected needs-input anchors to client
 * first-seen. No fake ages.
 */

import { AgentVisualState } from './agentState.js';

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
  /** Loud stages render inverted (white) like the NEEDS INPUT chip. */
  loud: boolean;
}

export const CRISIS_STAGE_SPECS: Record<CrisisStage, CrisisStageSpec> = {
  [CrisisStage.SMOKE]: { glyph: '≋', label: 'SMOKE', loud: false },
  [CrisisStage.FIRE]: { glyph: '▲', label: 'FIRE', loud: false },
  [CrisisStage.ALARM]: { glyph: '✱', label: 'ALARM', loud: true },
};

export function stageForAge(ageMs: number): CrisisStage {
  if (ageMs >= ALARM_AT_MS) return CrisisStage.ALARM;
  if (ageMs >= FIRE_AT_MS) return CrisisStage.FIRE;
  return CrisisStage.SMOKE;
}

// ── Crisis state machine (per character, applied by OfficeState) ──

/** Active fire on a character (blocked/needs-input only). */
export interface CrisisRecord {
  /** Epoch ms when the blocked state began (server-anchored when available). */
  since: number;
}

export interface CrisisUpdateInput {
  /** Visual state derived this tick (deriveVisualState). */
  vState: AgentVisualState;
  /** Visual state from the previous tick (undefined on first sight). */
  prevVState?: AgentVisualState;
  /** Existing crisis record, if any. */
  prevCrisis?: CrisisRecord;
  /** Server-anchored transition time (Date.now() - ageMs), if poll-driven. */
  pollSince?: number;
  now: number;
}

export interface CrisisUpdateResult {
  crisis?: CrisisRecord;
  /** The fire went out this tick (blocked → anything else) → calm feedback. */
  resolved: boolean;
  /** The agent newly failed/stopped this tick → leave debris at the desk. */
  spawnDebris?: 'failed' | 'stopped';
  /** The agent recovered from failed/stopped → clear its un-acked debris. */
  clearDebris: boolean;
}

/**
 * One tick of the per-agent crisis state machine. Pure — OfficeState applies
 * the result (spawning effects/debris, mutating the character).
 */
export function computeCrisisUpdate(input: CrisisUpdateInput): CrisisUpdateResult {
  const { vState, prevVState, prevCrisis, pollSince, now } = input;

  const result: CrisisUpdateResult = { resolved: false, clearDebris: false };

  if (vState === AgentVisualState.NEEDS_INPUT) {
    // Keep the earliest honest anchor: an existing record, improved by the
    // server's transition time when that is earlier (rebroadcast/replay).
    const anchor = pollSince ?? now;
    const since = prevCrisis ? Math.min(prevCrisis.since, anchor) : anchor;
    result.crisis = { since };
  } else if (prevCrisis) {
    // Fire went out — blocked ended (answered, finished, or session closed).
    result.resolved = true;
  }

  const wasDown = prevVState === AgentVisualState.FAILED || prevVState === AgentVisualState.STOPPED;
  if (vState === AgentVisualState.FAILED && prevVState !== AgentVisualState.FAILED) {
    result.spawnDebris = 'failed';
  } else if (vState === AgentVisualState.STOPPED && prevVState !== AgentVisualState.STOPPED) {
    result.spawnDebris = 'stopped';
  } else if (wasDown && vState !== AgentVisualState.FAILED && vState !== AgentVisualState.STOPPED) {
    // Recovered — the wreck cleaned itself up; keeping debris would lie.
    result.clearDebris = true;
  }

  return result;
}

// ── Debris ──────────────────────────────────────────────────────

export interface DebrisRecord {
  /** Stable key: `${agentId}:${kind}`. */
  key: string;
  agentId: number;
  kind: 'failed' | 'stopped';
  /** Identity TEXT captured at spawn time (survives the agent despawning). */
  label: string;
  /** World pixel position of the desk (character anchor at spawn time). */
  x: number;
  y: number;
  /** Epoch ms when the debris appeared. */
  since: number;
}

export function debrisKey(agentId: number, kind: 'failed' | 'stopped'): string {
  return `${agentId}:${kind}`;
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

export interface TriageRow {
  /** 'agent' rows are live fires; 'debris' rows carry an ACK affordance. */
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
  /** One-line cause (waitingFor, or a generic fallback). */
  cause: string;
  ageMs: number;
  score: number;
  /** Set on debris rows so the panel can offer CLEAR. */
  debrisKey?: string;
}

export interface CrisisViewInput {
  agentId: number;
  since: number;
  identity: string;
  /** waitingFor from the poller, or a local detail line. */
  cause?: string;
}

export function buildTriageRows(
  fires: CrisisViewInput[],
  debris: DebrisRecord[],
  now: number,
): TriageRow[] {
  const rows: TriageRow[] = [];
  for (const f of fires) {
    const ageMs = Math.max(0, now - f.since);
    const stage = stageForAge(ageMs);
    const spec = CRISIS_STAGE_SPECS[stage];
    rows.push({
      rowKey: `fire:${f.agentId}`,
      agentId: f.agentId,
      kind: 'blocked',
      stage,
      glyph: spec.glyph,
      word: spec.label,
      loud: spec.loud,
      identity: f.identity,
      cause: f.cause ?? 'Blocked — needs input',
      ageMs,
      score: SEVERITY_WEIGHTS.blocked * ageMs,
    });
  }
  for (const d of debris) {
    const ageMs = Math.max(0, now - d.since);
    rows.push({
      rowKey: `debris:${d.key}`,
      agentId: d.agentId,
      kind: d.kind,
      glyph: '✗',
      word: 'DEBRIS',
      loud: false,
      identity: d.label,
      cause: d.kind === 'failed' ? 'Session failed' : 'Session stopped',
      ageMs,
      score: SEVERITY_WEIGHTS[d.kind] * ageMs,
      debrisKey: d.key,
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
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}`;
}

// ── Resolution feedback ─────────────────────────────────────────

/** White steam puff + floating "✓ RESOLVED" lifetime. */
export const EXTINGUISH_DURATION_MS = 1_400;

export interface ExtinguishEffect {
  /** World pixel position (character anchor when the fire went out). */
  x: number;
  y: number;
  startedAt: number;
}
