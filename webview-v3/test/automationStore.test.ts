import { describe, expect, it } from 'vitest';

import {
  reduceBudget,
  reduceChainRunReceivedAt,
  reduceChainRuns,
  reduceDispatchEntries,
} from '../src/state/automationStore';

describe('reduceDispatchEntries', () => {
  it('upserts on dispatchUpdate and ignores everything else', () => {
    const entries = reduceDispatchEntries(
      [],
      {
        type: 'dispatchUpdate',
        id: 'd1',
        action: 'dispatch',
        status: 'ringing',
        machine: 'MACBOOK',
      },
      1_000,
    );
    expect(entries).toEqual([
      {
        id: 'd1',
        action: 'dispatch',
        status: 'ringing',
        machine: 'MACBOOK',
        provider: undefined,
        promptPreview: undefined,
        reason: undefined,
        pid: undefined,
        exitCode: undefined,
        resultTail: undefined,
        receivedAt: 1_000,
      },
    ]);
    expect(reduceDispatchEntries(entries, { type: 'agentClosed', id: 1 })).toBe(entries);
  });
});

describe('reduceChainRuns / reduceChainRunReceivedAt', () => {
  const chainRunUpdate = {
    type: 'chainRunUpdate' as const,
    run: {
      id: 'r1',
      chainId: 'c1',
      status: 'running' as const,
      currentStep: 0,
      steps: [{ stepId: 's1', status: 'pending' as const }],
      createdAt: 0,
      updatedAt: 0,
    },
  };

  it('upserts the run and reads pausedReason through the documented drift escape hatch', () => {
    const withPause = {
      ...chainRunUpdate,
      run: { ...chainRunUpdate.run, pausedReason: '5h-threshold' },
    };
    const runs = reduceChainRuns([], withPause);
    expect(runs[0].pausedReason).toBe('5h-threshold');
  });

  it('leaves pausedReason undefined when absent, never fabricated', () => {
    const runs = reduceChainRuns([], chainRunUpdate);
    expect(runs[0].pausedReason).toBeUndefined();
  });

  it('ignores unrelated messages', () => {
    const runs = reduceChainRuns([], chainRunUpdate);
    expect(reduceChainRuns(runs, { type: 'agentClosed', id: 1 })).toBe(runs);
  });

  it('refreshes receivedAt on every update for that run id', () => {
    const first = reduceChainRunReceivedAt({}, chainRunUpdate, 100);
    const second = reduceChainRunReceivedAt(first, chainRunUpdate, 200);
    expect(second).toEqual({ r1: 200 });
  });
});

describe('reduceBudget', () => {
  it('mirrors budgetUpdate verbatim', () => {
    const claude = { fiveHourUsedPct: 10, sevenDayUsedPct: 5, stale: false, receivedAt: 1 };
    const codex = { weeklyCap: 100, weeklyUsed: 10, estimatedPct: 10 };
    const budget = reduceBudget(null, { type: 'budgetUpdate', claude, codex });
    expect(budget).toEqual({ claude, codex });
    expect(reduceBudget(budget, { type: 'agentClosed', id: 1 })).toBe(budget);
  });
});
