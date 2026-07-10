/**
 * Colorblind-safe agent visual state (hard rule 1) — the v3 port of
 * webview-ui/src/office/agentState.ts's vocabulary, adapted to the leaner
 * v3 AgentRecord (no bubble/tool-activity channels here; the WS agent plane
 * plus the needs-input poller carry everything).
 *
 * Every state maps to a SHAPE (glyph) + TEXT LABEL chip. Color is
 * reinforcement only — a grayscale screenshot stays fully readable.
 *
 * One-tap-real: every input to this derivation is verbatim server
 * telemetry; nothing here invents a state the wire didn't report.
 */

import type { AgentRecord } from '../net/agentStore';

export const AgentVisualState = {
  NEEDS_INPUT: 'needs-input',
  WORKING: 'working',
  DONE: 'done',
  FAILED: 'failed',
  STOPPED: 'stopped',
  WAITING: 'waiting',
} as const;
export type AgentVisualState = (typeof AgentVisualState)[keyof typeof AgentVisualState];

export interface StateChipSpec {
  /** Distinct shape per state — primary signal together with the label. */
  glyph: string;
  /** Uppercase text label — the other primary signal. */
  label: string;
  /** Loud chips (needs-input, failed) render inverted/emphasized. */
  loud: boolean;
}

export const STATE_CHIPS: Record<AgentVisualState, StateChipSpec> = {
  [AgentVisualState.NEEDS_INPUT]: { glyph: '⚠', label: 'NEEDS INPUT', loud: true },
  [AgentVisualState.WORKING]: { glyph: '▶', label: 'WORKING', loud: false },
  [AgentVisualState.DONE]: { glyph: '✓', label: 'DONE', loud: false },
  [AgentVisualState.FAILED]: { glyph: '✗', label: 'FAILED', loud: true },
  [AgentVisualState.STOPPED]: { glyph: '■', label: 'STOPPED', loud: false },
  [AgentVisualState.WAITING]: { glyph: '⏸', label: 'WAITING', loud: false },
};

/** Poll states older than this are visually expired (poller/server silent). */
export const POLL_STATE_TTL_MS = 60_000;

/** The record's poll snapshot, or undefined when absent/stale/expired. */
export function freshPoll(
  record: Pick<AgentRecord, 'poll'>,
  now: number,
): AgentRecord['poll'] | undefined {
  if (!record.poll || record.poll.stale) return undefined;
  return now - record.poll.receivedAt <= POLL_STATE_TTL_MS ? record.poll : undefined;
}

/**
 * Derive the chip state from the record's verbatim telemetry.
 *
 * needs-input = poll `blocked` (loudest, always wins) OR a pending tool
 * permission OR the hook plane's awaitingInput. failed/stopped only ever
 * come from the poller. An `active` status is WORKING; a fresh poll
 * working/done lifts an otherwise-WAITING agent (hooks-silent remotes).
 */
export function deriveVisualState(
  record: Pick<AgentRecord, 'status' | 'awaitingInput' | 'toolPermission' | 'poll'>,
  now: number,
): AgentVisualState {
  const poll = freshPoll(record, now);
  if (poll?.state === 'blocked') return AgentVisualState.NEEDS_INPUT;
  if (record.toolPermission || record.awaitingInput) return AgentVisualState.NEEDS_INPUT;
  if (poll?.state === 'failed') return AgentVisualState.FAILED;
  if (poll?.state === 'stopped') return AgentVisualState.STOPPED;
  if (record.status === 'active' || poll?.state === 'working') return AgentVisualState.WORKING;
  if (poll?.state === 'done') return AgentVisualState.DONE;
  return AgentVisualState.WAITING;
}

/** Down = the session is gone (failed/stopped) — the tally's ✗ bucket. */
export function isDownState(state: AgentVisualState): boolean {
  return state === AgentVisualState.FAILED || state === AgentVisualState.STOPPED;
}
