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

import type { ToolActivity } from './types.js';

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
}

/**
 * Derive the chip state from character + tool activity.
 *
 * needs-input = permission wait (bubble or pending tool) OR idle-prompt
 * ("waiting for input"). done = turn finished. working = active. idle = rest.
 * failed/stopped arrive with the M4 `claude agents --json` poller.
 */
export function deriveVisualState(
  ch: VisualStateSource,
  tools: ToolActivity[] | undefined,
): AgentVisualState {
  const permissionPending =
    ch.bubbleType === 'permission' || !!tools?.some((t) => t.permissionWait && !t.done);
  if (permissionPending) return AgentVisualState.NEEDS_INPUT;
  if (ch.bubbleType === 'waiting') {
    return ch.waitingAwaitingInput ? AgentVisualState.NEEDS_INPUT : AgentVisualState.DONE;
  }
  // WORKING requires actual tool activity this turn — mirrors the upstream
  // "active dot" condition (isActive alone shows the Idle label, so an
  // isActive-but-toolless agent must not claim a WORKING chip).
  if (ch.isActive && !!tools && tools.length > 0) return AgentVisualState.WORKING;
  return AgentVisualState.IDLE;
}
