/**
 * Colorblind-safe agent visual state (War Room hard rule).
 *
 * Every agent state maps to a SHAPE (glyph) + TEXT LABEL chip. Color is
 * reinforcement only — a grayscale screenshot must stay fully readable.
 * `needs-input` is the loudest signal on screen: inverted (white) chip,
 * bold, larger, ⚠ glyph. Never a tint.
 *
 * The full chip vocabulary intentionally covers the `claude agents --json`
 * states (working / blocked→needs-input / done / failed / stopped) so the
 * M4 poller can reuse it unchanged.
 */

import type { PollStateInfo, ToolActivity } from './types.js';

export const AgentVisualState = {
  NEEDS_INPUT: 'needs-input',
  WORKING: 'working',
  DONE: 'done',
  FAILED: 'failed',
  STOPPED: 'stopped',
  IDLE: 'idle',
} as const;
export type AgentVisualState = (typeof AgentVisualState)[keyof typeof AgentVisualState];

export interface StateChipSpec {
  /** Distinct shape per state — the primary signal together with the label. */
  glyph: string;
  /** Uppercase text label — the other primary signal. */
  label: string;
  /** CSS class (see index.css `.state-chip--*`). Color there is reinforcement only. */
  chipClass: string;
  /** Loud chips (needs-input, failed) always render at full size + opacity. */
  loud: boolean;
}

export const STATE_CHIPS: Record<AgentVisualState, StateChipSpec> = {
  [AgentVisualState.NEEDS_INPUT]: {
    glyph: '⚠',
    label: 'NEEDS INPUT',
    chipClass: 'state-chip--alert',
    loud: true,
  },
  [AgentVisualState.WORKING]: {
    glyph: '▶',
    label: 'WORKING',
    chipClass: 'state-chip--working',
    loud: false,
  },
  [AgentVisualState.DONE]: {
    glyph: '✓',
    label: 'DONE',
    chipClass: 'state-chip--done',
    loud: false,
  },
  [AgentVisualState.FAILED]: {
    glyph: '✗',
    label: 'FAILED',
    chipClass: 'state-chip--failed',
    loud: true,
  },
  [AgentVisualState.STOPPED]: {
    glyph: '■',
    label: 'STOPPED',
    chipClass: 'state-chip--stopped',
    loud: false,
  },
  [AgentVisualState.IDLE]: {
    glyph: '○',
    label: 'IDLE',
    chipClass: 'state-chip--idle',
    loud: false,
  },
};

/** Minimal slice of Character needed to derive a visual state (testable). */
export interface VisualStateSource {
  bubbleType: 'permission' | 'waiting' | null;
  waitingAwaitingInput?: boolean;
  isActive: boolean;
  /** Poll-derived state (M4 needs-input poller), if any. */
  pollState?: PollStateInfo;
}

/** Poll states older than this are visually expired (poller/server silent). */
export const POLL_STATE_TTL_MS = 60_000;

/** The character's poll state, or undefined when absent/expired. */
export function getFreshPollState(
  ch: VisualStateSource,
  now: number = Date.now(),
): PollStateInfo | undefined {
  if (!ch.pollState) return undefined;
  return now - ch.pollState.at <= POLL_STATE_TTL_MS ? ch.pollState : undefined;
}

/**
 * Derive the chip state from character + tool activity + poll state.
 *
 * needs-input = poll `blocked` (loudest, always wins) OR permission wait
 * (bubble or pending tool) OR idle-prompt ("waiting for input"). failed/
 * stopped only ever come from the M4 poller. Live local evidence of tool
 * activity outranks a (≤15s-old) poll `working`/`done`; poll working/done
 * only lift an otherwise-IDLE agent (typically hooks-only remote agents).
 */
export function deriveVisualState(
  ch: VisualStateSource,
  tools: ToolActivity[] | undefined,
  now: number = Date.now(),
): AgentVisualState {
  const poll = getFreshPollState(ch, now);
  if (poll?.state === 'blocked') return AgentVisualState.NEEDS_INPUT;
  const permissionPending =
    ch.bubbleType === 'permission' || !!tools?.some((t) => t.permissionWait && !t.done);
  if (permissionPending) return AgentVisualState.NEEDS_INPUT;
  if (ch.bubbleType === 'waiting') {
    return ch.waitingAwaitingInput ? AgentVisualState.NEEDS_INPUT : AgentVisualState.DONE;
  }
  if (poll?.state === 'failed') return AgentVisualState.FAILED;
  if (poll?.state === 'stopped') return AgentVisualState.STOPPED;
  // WORKING requires actual tool activity this turn — mirrors the upstream
  // "active dot" condition (isActive alone shows the Idle label, so an
  // isActive-but-toolless agent must not claim a WORKING chip).
  if (ch.isActive && !!tools && tools.length > 0) return AgentVisualState.WORKING;
  if (poll?.state === 'working') return AgentVisualState.WORKING;
  if (poll?.state === 'done') return AgentVisualState.DONE;
  return AgentVisualState.IDLE;
}
