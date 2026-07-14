import { describe, expect, it } from 'vitest';

import {
  CHAIN_MAX_STEPS,
  CHAIN_MAX_STEPS_CHAIN_GANG,
  chainMaxSteps,
  chainRunChipLabel,
  type ChainRunClient,
  dismissChainRun,
  pruneChainRuns,
  reconcileChainRunSnapshot,
  upsertChainRun,
  validateStepTemplatesClient,
} from '../src/state/chain';

function run(overrides: Partial<ChainRunClient> = {}): ChainRunClient {
  return {
    id: 'r1',
    chainId: 'c1',
    status: 'running',
    currentStep: 0,
    steps: [
      { stepId: 's1', status: 'pending' },
      { stepId: 's2', status: 'pending' },
    ],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('chainMaxSteps', () => {
  it('never fail-opens to the perked cap on unknown perk state', () => {
    expect(chainMaxSteps(false)).toBe(CHAIN_MAX_STEPS);
    expect(chainMaxSteps(true)).toBe(CHAIN_MAX_STEPS_CHAIN_GANG);
  });
});

describe('chainRunChipLabel', () => {
  it('shows step progress while running', () => {
    expect(chainRunChipLabel(run({ status: 'running', currentStep: 1 }))).toBe(
      '◎ RUNNING (step 2/2)',
    );
  });

  it('shows the budget pause reason distinctly from a mid-run pending step', () => {
    expect(chainRunChipLabel(run({ status: 'running', pausedReason: '5h-threshold' }))).toBe(
      '⏸ PAUSED — 5h budget (step 1/2)',
    );
  });

  it('shows fail/halt reasons verbatim', () => {
    expect(
      chainRunChipLabel(run({ status: 'failed', failReason: 'denied: path-not-allowlisted' })),
    ).toBe('⊘ FAILED — denied: path-not-allowlisted');
    expect(chainRunChipLabel(run({ status: 'halted', haltReason: 'stop-all' }))).toBe(
      '■ HALTED — stop-all',
    );
    expect(chainRunChipLabel(run({ status: 'completed' }))).toBe('✓ COMPLETED');
  });
});

describe('validateStepTemplatesClient', () => {
  it('accepts a template referencing an earlier step', () => {
    const steps = [
      { id: 's1', prompt: 'build' },
      { id: 's2', prompt: 'report on {{step1.result}}' },
    ];
    expect(validateStepTemplatesClient(steps)).toEqual({ ok: true });
  });

  it('rejects a forward or self reference', () => {
    const steps = [{ id: 's1', prompt: 'uses {{step1.result}}' }];
    const result = validateStepTemplatesClient(steps);
    expect(result.ok).toBe(false);
  });
});

describe('upsertChainRun / pruneChainRuns / dismissChainRun', () => {
  it('inserts new runs and updates existing ones by id', () => {
    const first = upsertChainRun([], run({ id: 'a', status: 'running' }));
    const second = upsertChainRun(first, run({ id: 'a', status: 'completed' }));
    expect(second).toHaveLength(1);
    expect(second[0].status).toBe('completed');
  });

  it('rejects an older run revision', () => {
    const current = [run({ id: 'a', status: 'completed', updatedAt: 20 })];
    expect(upsertChainRun(current, run({ id: 'a', status: 'running', updatedAt: 10 }))).toBe(
      current,
    );
  });

  it('authoritative snapshot prunes absent active ids and hydrates offline terminal outcomes', () => {
    const current = [
      run({ id: 'stale-active', status: 'running', updatedAt: 10 }),
      run({ id: 'older-terminal', status: 'failed', updatedAt: 5 }),
    ];
    const next = reconcileChainRunSnapshot(
      current,
      [run({ id: 'completed-offline', status: 'completed', updatedAt: 20 })],
      30,
    );
    expect(next.map((item) => item.id)).toEqual(['older-terminal', 'completed-offline']);
  });

  it('prunes terminal runs past autoclear, keeps FAILED sticky', () => {
    const runs = [run({ id: 'a', status: 'completed' }), run({ id: 'b', status: 'failed' })];
    const pruned = pruneChainRuns(runs, 60_000, { a: 0, b: 0 });
    expect(pruned.map((r) => r.id)).toEqual(['b']);
  });

  it('dismiss removes a sticky FAILED run from the client-side tray view', () => {
    const runs = [run({ id: 'a', status: 'failed' })];
    expect(dismissChainRun(runs, 'a')).toHaveLength(0);
  });
});
