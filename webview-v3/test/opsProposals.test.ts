import { describe, expect, it } from 'vitest';

import type { DispatchEntry, SendFailure } from '../src/net/dispatchFacts';
import {
  buildDispatchNudgeMessage,
  buildFocusMessage,
  buildKillRequest,
  buildRequeueUrl,
  proposalKey,
  type ProposalState,
  resolveDisplayState,
  tapArmsConfirm,
  tapFires,
} from '../src/net/opsProposals';
import type { OpsProposedAction } from '../src/state/opsReview';

function entry(overrides: Partial<DispatchEntry> = {}): DispatchEntry {
  return {
    id: 'e1',
    action: 'dispatch',
    status: 'ringing',
    machine: 'MACBOOK',
    receivedAt: Date.now(),
    ...overrides,
  };
}

describe('proposalKey', () => {
  it('joins the finding id and verb with a colon — a stable, collision-safe lookup key', () => {
    expect(proposalKey('blocked-age-14', 'kill')).toBe('blocked-age-14:kill');
    expect(proposalKey('dispatch-waste-failed', 'requeue')).toBe('dispatch-waste-failed:requeue');
  });
});

describe('confirm-step contract (tapArmsConfirm / tapFires)', () => {
  it('a tap from idle or failed ARMS the confirm step — never fires on the first tap', () => {
    expect(tapArmsConfirm('idle')).toBe(true);
    expect(tapArmsConfirm('failed')).toBe(true);
    expect(tapFires('idle')).toBe(false);
    expect(tapFires('failed')).toBe(false);
  });

  it('a tap while armed (confirm) is the one that fires — and only that one', () => {
    expect(tapArmsConfirm('confirm')).toBe(false);
    expect(tapFires('confirm')).toBe(true);
  });

  it('pending/sent/done taps are no-ops both ways — the button is disabled in those phases', () => {
    for (const phase of ['pending', 'sent', 'done'] as const) {
      expect(tapArmsConfirm(phase)).toBe(false);
      expect(tapFires(phase)).toBe(false);
    }
  });
});

describe('buildKillRequest — wired call for the KILL verb', () => {
  it('extracts machine + numeric pid verbatim from proposedAction.params, matching AgentDrawer/killAgent.ts', () => {
    const action: OpsProposedAction = {
      verb: 'kill',
      label: 'KILL agent 5 (pid 812) on FOCUSBOX',
      params: { machine: 'FOCUSBOX', pid: 812 },
    };
    expect(buildKillRequest(action)).toEqual({ machine: 'FOCUSBOX', pid: 812 });
  });
});

describe('buildFocusMessage — wired call for the FOCUS verb', () => {
  it('builds the exact dispatchRequest/action:focus shape (mirrors v1s handleFocus)', () => {
    const action: OpsProposedAction = {
      verb: 'focus',
      label: 'FOCUS agent 5 (pid 812) on FOCUSBOX',
      params: { machine: 'FOCUSBOX', pid: 812 },
    };
    expect(buildFocusMessage(action)).toEqual({
      type: 'dispatchRequest',
      action: 'focus',
      machine: 'FOCUSBOX',
      pid: 812,
    });
  });
});

describe('buildDispatchNudgeMessage — wired call for the DISPATCH-NUDGE verb', () => {
  it('builds the exact dispatchRequest/action:dispatch shape CallModal sends, carrying the verbatim prompt/machine/cwd/provider', () => {
    const action: OpsProposedAction = {
      verb: 'dispatch-nudge',
      label:
        'DISPATCH NUDGE on MACBOOK: check agent 14, blocked on: Approve: apply migration 0042? (y/n)',
      params: {
        machine: 'MACBOOK',
        cwd: '/Users/dev/proj',
        provider: 'codex',
        prompt:
          'Agent 14 on MACBOOK (/Users/dev/proj) has been blocked 2m, waiting for: "Approve: apply migration 0042? (y/n)". Please check on it, make the requested decision if you safely can, and unblock it.',
      },
    };
    const msg = buildDispatchNudgeMessage(action, 'req-123');
    expect(msg).toEqual({
      type: 'dispatchRequest',
      action: 'dispatch',
      machine: 'MACBOOK',
      provider: 'codex',
      cwd: '/Users/dev/proj',
      prompt: action.params.prompt,
      requestId: 'req-123',
    });
  });
});

describe('buildRequeueUrl — wired call for the REQUEUE verb', () => {
  it('targets the existing /api/rework/:id/redispatch route verbatim — zero new server capability', () => {
    const action: OpsProposedAction = {
      verb: 'requeue',
      label: 'REQUEUE: fails then gets reworked on MACBOOK',
      params: { reworkId: 'rework-abc' },
    };
    expect(buildRequeueUrl(action)).toBe('/api/rework/rework-abc/redispatch');
  });
});

describe('resolveDisplayState — honest DISPATCH-NUDGE outcome from the global dispatch lifecycle', () => {
  it('a "sent" proposal whose requestId shows up in sendFailures resolves to FAILED, never optimistic', () => {
    const state: ProposalState = { phase: 'sent', requestId: 'req-1' };
    const sendFailures: SendFailure[] = [
      { id: 'req-1', machine: 'MACBOOK', action: 'dispatch', detectedAt: Date.now() },
    ];
    expect(resolveDisplayState(state, [], sendFailures)).toEqual({
      phase: 'failed',
      reason: 'not queued (no response)',
    });
  });

  it('a "sent" proposal whose requestId shows up as a real dispatchEntry resolves to DONE', () => {
    const state: ProposalState = { phase: 'sent', requestId: 'req-2' };
    const entries: DispatchEntry[] = [entry({ id: 'd1', requestId: 'req-2' })];
    expect(resolveDisplayState(state, entries, [])).toEqual({ phase: 'done' });
  });

  it('a "sent" proposal with neither yet stays "sent" — no premature success or failure', () => {
    const state: ProposalState = { phase: 'sent', requestId: 'req-3' };
    expect(resolveDisplayState(state, [], [])).toEqual(state);
  });

  it('non-"sent" phases pass through unchanged (idle/confirm/pending/kill-done/kill-failed are already terminal-honest on their own)', () => {
    const idle: ProposalState = { phase: 'idle' };
    const pending: ProposalState = { phase: 'pending' };
    const done: ProposalState = { phase: 'done' };
    expect(resolveDisplayState(idle, [], [])).toBe(idle);
    expect(resolveDisplayState(pending, [], [])).toBe(pending);
    expect(resolveDisplayState(done, [], [])).toBe(done);
  });
});
