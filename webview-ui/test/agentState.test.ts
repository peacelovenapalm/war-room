/**
 * Unit tests for the colorblind-safe visual-state derivation (agentState.ts),
 * including the M4 poll-state layer (`claude agents --json` via agentPollState).
 *
 * Precedence under test:
 *   poll blocked > local permission/waiting > poll failed/stopped >
 *   local working > poll working/done > idle
 * plus TTL expiry (a dead poller must not pin a stale chip).
 */

import { describe, expect, it } from 'vitest';

import {
  AgentVisualState,
  deriveVisualState,
  getFreshPollState,
  POLL_STATE_TTL_MS,
  type VisualStateSource,
} from '../src/office/agentState.js';
import type { ToolActivity } from '../src/office/types.js';

const NOW = 1_000_000;

function src(overrides: Partial<VisualStateSource> = {}): VisualStateSource {
  return { bubbleType: null, isActive: false, ...overrides };
}

function poll(state: 'working' | 'blocked' | 'done' | 'failed' | 'stopped', waitingFor?: string) {
  return { state, waitingFor, at: NOW };
}

const activeTools: ToolActivity[] = [{ toolId: 't1', status: 'Running: npm test', done: false }];

describe('deriveVisualState with poll states', () => {
  it('poll blocked → NEEDS INPUT, beating every local signal', () => {
    expect(deriveVisualState(src({ pollState: poll('blocked') }), undefined, NOW)).toBe(
      AgentVisualState.NEEDS_INPUT,
    );
    // even over active local tools
    expect(
      deriveVisualState(src({ isActive: true, pollState: poll('blocked') }), activeTools, NOW),
    ).toBe(AgentVisualState.NEEDS_INPUT);
  });

  it('poll failed/stopped map to their chips when no local input-wait exists', () => {
    expect(deriveVisualState(src({ pollState: poll('failed') }), undefined, NOW)).toBe(
      AgentVisualState.FAILED,
    );
    expect(deriveVisualState(src({ pollState: poll('stopped') }), undefined, NOW)).toBe(
      AgentVisualState.STOPPED,
    );
  });

  it('local permission bubble outranks poll failed/stopped (input-wait is louder)', () => {
    expect(
      deriveVisualState(src({ bubbleType: 'permission', pollState: poll('failed') }), [], NOW),
    ).toBe(AgentVisualState.NEEDS_INPUT);
  });

  it('live local tool activity outranks poll working/done', () => {
    expect(
      deriveVisualState(src({ isActive: true, pollState: poll('done') }), activeTools, NOW),
    ).toBe(AgentVisualState.WORKING);
  });

  it('poll working/done lift an otherwise-idle agent (hooks-only remote case)', () => {
    expect(deriveVisualState(src({ pollState: poll('working') }), undefined, NOW)).toBe(
      AgentVisualState.WORKING,
    );
    expect(deriveVisualState(src({ pollState: poll('done') }), undefined, NOW)).toBe(
      AgentVisualState.DONE,
    );
  });

  it('expired poll state is ignored (poller died — no permanent badge)', () => {
    const stale = src({ pollState: { state: 'blocked', at: NOW } });
    const later = NOW + POLL_STATE_TTL_MS + 1;
    expect(getFreshPollState(stale, later)).toBeUndefined();
    expect(deriveVisualState(stale, undefined, later)).toBe(AgentVisualState.IDLE);
  });

  it('no poll state → M3 behavior unchanged', () => {
    expect(deriveVisualState(src(), undefined, NOW)).toBe(AgentVisualState.IDLE);
    expect(deriveVisualState(src({ bubbleType: 'permission' }), [], NOW)).toBe(
      AgentVisualState.NEEDS_INPUT,
    );
    expect(
      deriveVisualState(src({ bubbleType: 'waiting', waitingAwaitingInput: true }), [], NOW),
    ).toBe(AgentVisualState.NEEDS_INPUT);
    expect(deriveVisualState(src({ bubbleType: 'waiting' }), [], NOW)).toBe(AgentVisualState.DONE);
    expect(deriveVisualState(src({ isActive: true }), activeTools, NOW)).toBe(
      AgentVisualState.WORKING,
    );
  });
});
