import { describe, expect, it } from 'vitest';

import {
  budgetChipLabel,
  budgetPauseReasonWord,
  budgetTierWord,
  claudeBudgetChipLabel,
  codexBudgetChipLabel,
  isAutomationPauseReason,
} from '../src/state/budget';

describe('budgetTierWord', () => {
  it('tiers by threshold, word always alongside the number', () => {
    expect(budgetTierWord(10)).toBe('fair');
    expect(budgetTierWord(70)).toBe('busy');
    expect(budgetTierWord(90)).toBe('critical');
  });
});

describe('claudeBudgetChipLabel', () => {
  it('shows the bare live percentage', () => {
    expect(
      claudeBudgetChipLabel({
        fiveHourUsedPct: 42,
        sevenDayUsedPct: 10,
        stale: false,
        receivedAt: 1,
      }),
    ).toBe('5H 42% fair');
  });

  it('is honestly STALE when the snapshot says so, or missing', () => {
    expect(
      claudeBudgetChipLabel({
        fiveHourUsedPct: 42,
        sevenDayUsedPct: 10,
        stale: true,
        receivedAt: 1,
      }),
    ).toBe('5H ⚠ STALE');
    expect(
      claudeBudgetChipLabel({
        fiveHourUsedPct: null,
        sevenDayUsedPct: null,
        stale: false,
        receivedAt: null,
      }),
    ).toBe('5H ⚠ STALE');
  });
});

describe('codexBudgetChipLabel', () => {
  it('is ALWAYS "est." prefixed — never the bare Claude-style number', () => {
    expect(codexBudgetChipLabel({ weeklyCap: 1000, weeklyUsed: 300, estimatedPct: 30 })).toBe(
      '~30% est.',
    );
  });

  it('is honest about an unset cap', () => {
    expect(codexBudgetChipLabel({ weeklyCap: null, weeklyUsed: 0, estimatedPct: null })).toBe(
      '~ est. unset',
    );
  });
});

describe('budgetChipLabel', () => {
  it('routes by provider and handles a null snapshot', () => {
    const snapshot = {
      claude: { fiveHourUsedPct: 20, sevenDayUsedPct: 5, stale: false, receivedAt: 1 },
      codex: { weeklyCap: 100, weeklyUsed: 10, estimatedPct: 10 },
    };
    expect(budgetChipLabel(snapshot, 'codex')).toBe('~10% est.');
    expect(budgetChipLabel(snapshot, 'claude')).toBe('5H 20% fair');
    expect(budgetChipLabel(snapshot, undefined)).toBe('5H 20% fair');
    expect(budgetChipLabel(null, 'claude')).toBe('⚠ STALE');
  });
});

describe('automation pause reasons', () => {
  it('recognizes the four real reasons and falls back for anything else', () => {
    expect(isAutomationPauseReason('5h-threshold')).toBe(true);
    expect(isAutomationPauseReason('made-up-reason')).toBe(false);
    expect(budgetPauseReasonWord('codex-cap-reached')).toBe('codex cap');
    expect(budgetPauseReasonWord('made-up-reason')).toBe('made-up-reason');
  });
});
