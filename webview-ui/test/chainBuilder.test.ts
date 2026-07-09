/**
 * Unit tests for chain.ts's pure logic (v2 mechanic G3, GAME-DESIGN.md
 * §7.1) — the ChainBuilderPanel/ChainTray components' testable core.
 */

import { describe, expect, it } from 'vitest';

import {
  CHAIN_MAX_STEPS,
  CHAIN_MAX_STEPS_CHAIN_GANG,
  CHAIN_RUN_STATUS_CHIPS,
  chainMaxSteps,
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

  it('surfaces the halt reason when halted', () => {
    expect(chainRunChipLabel(run({ status: 'halted', haltReason: 'step-killed' }))).toBe(
      `${CHAIN_RUN_STATUS_CHIPS.halted.glyph} HALTED — step-killed`,
    );
  });

  it('a budget-paused running step renders distinctly from mid-chain running (KICKOFF v1.1 item 5)', () => {
    const twoStepRun = {
      currentStep: 1,
      steps: [
        { stepId: 's1', status: 'exited' as const },
        { stepId: 's2', status: 'pending' as const },
      ],
    };
    const paused = chainRunChipLabel(
      run({ status: 'running', ...twoStepRun, pausedReason: '5h-threshold' }),
    );
    const running = chainRunChipLabel(run({ status: 'running', ...twoStepRun }));
    // Same status/currentStep either way — pausedReason is the ONLY thing
    // that lets a client tell "paused" apart from "just between steps"
    // (both are otherwise an identical pending step, nothing else).
    expect(paused).not.toBe(running);
    expect(paused).toBe('⏸ PAUSED — 5h budget (step 2/2)');
  });

  it('each of the 4 real budget-pause reasons renders distinctly', () => {
    const labels = {
      'stale-snapshot': chainRunChipLabel(
        run({ status: 'running', pausedReason: 'stale-snapshot' }),
      ),
      '5h-threshold': chainRunChipLabel(run({ status: 'running', pausedReason: '5h-threshold' })),
      '7d-threshold': chainRunChipLabel(run({ status: 'running', pausedReason: '7d-threshold' })),
      'codex-cap-reached': chainRunChipLabel(
        run({ status: 'running', pausedReason: 'codex-cap-reached' }),
      ),
    };
    expect(labels['stale-snapshot']).toContain('stale telemetry');
    expect(labels['5h-threshold']).toContain('5h budget');
    expect(labels['7d-threshold']).toContain('7d budget');
    expect(labels['codex-cap-reached']).toContain('codex cap');
    const values = Object.values(labels);
    expect(new Set(values).size).toBe(values.length);
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

describe('chainMaxSteps (F3 follow-up — Chain Gang perk threading into ChainBuilderPanel)', () => {
  it('is the base 8-step cap without Chain Gang', () => {
    expect(chainMaxSteps(false)).toBe(CHAIN_MAX_STEPS);
    expect(chainMaxSteps(false)).toBe(8);
  });

  it('raises to 12 with Chain Gang owned', () => {
    expect(chainMaxSteps(true)).toBe(CHAIN_MAX_STEPS_CHAIN_GANG);
    expect(chainMaxSteps(true)).toBe(12);
  });

  // Mirrors ChainBuilderPanel.tsx's own derivation exactly:
  //   const hasChainGang = economy?.purchasedPerks.includes('chainGang') ?? false;
  // economy=null (initial load, perk state not yet known) must degrade to
  // the BASE cap — never fail-open to the perked cap.
  function hasChainGangFromEconomy(economy: { purchasedPerks: string[] } | null): boolean {
    return economy?.purchasedPerks.includes('chainGang') ?? false;
  }

  // Mirrors ChainBuilderPanel.tsx's handleAddStep guard exactly:
  //   if (steps.length >= maxSteps) return;
  // Returns false when the hard-return fires (no step added).
  function wouldAddStep(currentStepCount: number, maxSteps: number): boolean {
    return !(currentStepCount >= maxSteps);
  }

  it('without Chain Gang (or economy=null): "+ ADD STEP" hard-returns at 8, button stays disabled at 8', () => {
    for (const economy of [{ purchasedPerks: [] }, null]) {
      const maxSteps = chainMaxSteps(hasChainGangFromEconomy(economy));
      expect(maxSteps).toBe(8);
      expect(wouldAddStep(7, maxSteps)).toBe(true); // 7 -> 8 still allowed
      expect(wouldAddStep(8, maxSteps)).toBe(false); // hard-returns at 8 (pre-fix bug, both perked and unperked)
      expect(wouldAddStep(11, maxSteps)).toBe(false); // nowhere near the perked 12 cap
      expect(8 >= maxSteps).toBe(true); // button's disabled={steps.length >= maxSteps}
    }
  });

  it('with Chain Gang owned: building past 8 up to 12 is allowed, button not disabled, canSave accepts 9-12 steps', () => {
    const maxSteps = chainMaxSteps(hasChainGangFromEconomy({ purchasedPerks: ['chainGang'] }));
    expect(maxSteps).toBe(12);

    // This is exactly the case the verifier's F3 finding named as broken:
    // 8 steps already built, perk owned — "+ ADD STEP" must NOT hard-return
    // and the button must NOT be disabled.
    expect(wouldAddStep(8, maxSteps)).toBe(true);
    expect(8 >= maxSteps).toBe(false); // button's disabled bound

    expect(wouldAddStep(11, maxSteps)).toBe(true); // 11 -> 12 still allowed
    expect(wouldAddStep(12, maxSteps)).toBe(false); // hard cap at 12, matches server's CHAIN_MAX_STEPS_CHAIN_GANG

    // canSave's `steps.length <= maxSteps` bound
    expect(9 <= maxSteps).toBe(true);
    expect(12 <= maxSteps).toBe(true);
    expect(13 <= maxSteps).toBe(false);
  });

  it('owning an unrelated perk does not raise the chain step cap', () => {
    const maxSteps = chainMaxSteps(
      hasChainGangFromEconomy({ purchasedPerks: ['secondShift', 'nightShiftForeman'] }),
    );
    expect(maxSteps).toBe(8);
  });
});
