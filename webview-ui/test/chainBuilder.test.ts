/**
 * Unit tests for chain.ts's pure logic (v2 mechanic G3, GAME-DESIGN.md
 * §7.1) — the ChainBuilderPanel/ChainTray components' testable core.
 */

import { describe, expect, it } from 'vitest';

import {
  CHAIN_RUN_STATUS_CHIPS,
  chainRunChipLabel,
  type ChainRunClient,
  pruneChainRuns,
  shouldAutoClearChainRun,
  upsertChainRun,
  validateStepTemplatesClient,
} from '../src/chain.js';

function run(overrides: Partial<ChainRunClient> = {}): ChainRunClient {
  return {
    id: 'run-1',
    chainId: 'chain-1',
    status: 'running',
    currentStep: 0,
    steps: [{ stepId: 's1', status: 'pending' }],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('chainRunChipLabel', () => {
  it('shows the step position while running', () => {
    const label = chainRunChipLabel(
      run({
        currentStep: 1,
        steps: [
          { stepId: 's1', status: 'exited' },
          { stepId: 's2', status: 'running' },
          { stepId: 's3', status: 'pending' },
        ],
      }),
    );
    expect(label).toBe(`${CHAIN_RUN_STATUS_CHIPS.running.glyph} RUNNING (step 2/3)`);
  });

  it('surfaces the fail reason when failed', () => {
    const label = chainRunChipLabel(
      run({ status: 'failed', failReason: 'denied: path-not-allowlisted' }),
    );
    expect(label).toBe(
      `${CHAIN_RUN_STATUS_CHIPS.failed.glyph} FAILED — denied: path-not-allowlisted`,
    );
  });

  it('is a plain glyph+word for completed/halted', () => {
    expect(chainRunChipLabel(run({ status: 'completed' }))).toBe(
      `${CHAIN_RUN_STATUS_CHIPS.completed.glyph} COMPLETED`,
    );
    expect(chainRunChipLabel(run({ status: 'halted' }))).toBe(
      `${CHAIN_RUN_STATUS_CHIPS.halted.glyph} HALTED`,
    );
  });
});

describe('shouldAutoClearChainRun', () => {
  it('never auto-clears running or failed (sticky)', () => {
    expect(shouldAutoClearChainRun('running', 999_999)).toBe(false);
    expect(shouldAutoClearChainRun('failed', 999_999)).toBe(false);
  });

  it('auto-clears completed/halted after the threshold', () => {
    expect(shouldAutoClearChainRun('completed', 59_999)).toBe(false);
    expect(shouldAutoClearChainRun('completed', 60_000)).toBe(true);
    expect(shouldAutoClearChainRun('halted', 60_000)).toBe(true);
  });
});

describe('validateStepTemplatesClient', () => {
  it('accepts a backward reference', () => {
    const result = validateStepTemplatesClient([
      { id: 's1', prompt: 'first' },
      { id: 's2', prompt: 'use {{step1.result}}' },
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects a forward reference', () => {
    const result = validateStepTemplatesClient([
      { id: 's1', prompt: 'use {{step2.result}}' },
      { id: 's2', prompt: 'second' },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('upsertChainRun / pruneChainRuns', () => {
  it('inserts a new run and updates an existing one by id', () => {
    let runs = upsertChainRun([], run());
    expect(runs).toHaveLength(1);
    runs = upsertChainRun(runs, run({ status: 'completed' }));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('completed');
  });

  it('drops a completed run past auto-clear age, keeps a failed one', () => {
    const now = 1_000_000;
    const runs = [run({ id: 'a', status: 'completed' }), run({ id: 'b', status: 'failed' })];
    const receivedAtById = { a: now - 61_000, b: now - 61_000 };
    const pruned = pruneChainRuns(runs, now, receivedAtById);
    expect(pruned.map((r) => r.id)).toEqual(['b']);
  });
});
