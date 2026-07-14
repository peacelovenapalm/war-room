import { describe, expect, it } from 'vitest';

import {
  reconcileDispatchSnapshot,
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
        updatedAt: 100,
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
        updatedAt: 100,
      },
    ]);
    expect(reduceDispatchEntries(entries, { type: 'agentClosed', id: 1 })).toBe(entries);
  });

  it('T5 fleet controls: threads timeoutSec through from the wire (a CAPPED chip needs it to render "(Ns)")', () => {
    const entries = reduceDispatchEntries(
      [],
      {
        type: 'dispatchUpdate',
        id: 'd-capped',
        action: 'dispatch',
        status: 'capped',
        machine: 'MACBOOK',
        timeoutSec: 300,
      },
      1_000,
    );
    expect(entries[0].timeoutSec).toBe(300);
  });
});

describe('reconcileDispatchSnapshot', () => {
  const update = (
    id: string,
    status: 'ringing' | 'answered' | 'exited',
    updatedAt: number,
  ) => ({
    type: 'dispatchUpdate' as const,
    id,
    action: 'dispatch' as const,
    status,
    machine: 'MACBOOK',
    updatedAt,
  });

  it('hydrates terminal rows and replaces stale non-terminal rows absent on reconnect', () => {
    let entries = reduceDispatchEntries([], update('stale-running', 'answered', 10), 100);
    entries = reduceDispatchEntries(entries, update('old-terminal', 'exited', 10), 100);

    const next = reconcileDispatchSnapshot(
      entries,
      [update('completed-offline', 'exited', 20)],
      new Set(),
      200,
    );

    expect(next.map((entry) => entry.id)).toEqual(['old-terminal', 'completed-offline']);
  });

  it('does not let a stale HTTP row overwrite a newer WS update', () => {
    const live = reduceDispatchEntries([], update('d1', 'exited', 30), 300);
    const next = reconcileDispatchSnapshot(
      live,
      [update('d1', 'answered', 20)],
      new Set(),
      400,
    );
    expect(next[0].status).toBe('exited');
    expect(next[0].receivedAt).toBe(300);
  });

  it('preserves ids updated by WS after the HTTP request started', () => {
    const live = reduceDispatchEntries([], update('new-live', 'ringing', 30), 300);
    const next = reconcileDispatchSnapshot(live, [], new Set(['new-live']), 400);
    expect(next).toEqual(live);
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

  it('applies an authoritative snapshot and timestamps every included run', () => {
    const stale = reduceChainRuns([], chainRunUpdate);
    const snapshot = {
      type: 'chainRunSnapshot' as const,
      runs: [{ ...chainRunUpdate.run, id: 'r2', status: 'completed' as const, updatedAt: 20 }],
      updatedAt: 30,
    };
    const runs = reduceChainRuns(stale, snapshot);
    expect(runs.map((run) => run.id)).toEqual(['r2']);
    expect(reduceChainRunReceivedAt({ r1: 100 }, snapshot, 200)).toEqual({ r1: 100, r2: 200 });
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
