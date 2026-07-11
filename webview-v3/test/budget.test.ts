import { describe, expect, it } from 'vitest';

import {
  budgetChipLabel,
  budgetPauseReasonWord,
  budgetResetHintLine,
  budgetTierWord,
  claudeBudgetChipLabel,
  codexBudgetChipLabel,
  formatResetIn,
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

describe('T5 fleet controls: formatResetIn', () => {
  it('formats a future reset time as ~Xh Ym, never a bare ms count', () => {
    const now = 1_000_000;
    expect(formatResetIn(now + 45 * 60_000, now)).toBe('45m');
    expect(formatResetIn(now + 2 * 60 * 60_000 + 15 * 60_000, now)).toBe('2h 15m');
    expect(formatResetIn(now + 3 * 60 * 60_000, now)).toBe('3h'); // exact hour, no "0m" clutter
    expect(formatResetIn(now + 10_000, now)).toBe('<1m'); // 10s rounds to 0 minutes
  });

  it('a reset time already in the past reads "now", never a negative duration', () => {
    expect(formatResetIn(500, 1_000)).toBe('now');
  });
});

describe('T5 fleet controls: budgetResetHintLine (RATE-LIMIT SCHEDULING HINTS, display-only)', () => {
  const now = 1_000_000;

  it('a fresh snapshot under the queue threshold shows the % and resets-in, no queue hint', () => {
    const snapshot = {
      claude: {
        fiveHourUsedPct: 50,
        sevenDayUsedPct: 10,
        stale: false,
        receivedAt: now,
        fiveHourResetsAt: now + 60 * 60_000,
      },
      codex: { weeklyCap: null, weeklyUsed: 0, estimatedPct: null },
    };
    expect(budgetResetHintLine(snapshot, 'claude', now)).toBe('5h window 50% — resets in ~1h');
  });

  it('at/past the threshold, appends the "queue for reset?" hint', () => {
    const snapshot = {
      claude: {
        fiveHourUsedPct: 70,
        sevenDayUsedPct: 10,
        stale: false,
        receivedAt: now,
        fiveHourResetsAt: now + 30 * 60_000,
      },
      codex: { weeklyCap: null, weeklyUsed: 0, estimatedPct: null },
    };
    expect(budgetResetHintLine(snapshot, 'claude', now)).toBe(
      '5h window 70% — resets in ~30m · queue for reset?',
    );
  });

  it('a snapshot with no resetsAt omits the resets-in clause — never fabricates one', () => {
    const snapshot = {
      claude: { fiveHourUsedPct: 50, sevenDayUsedPct: 10, stale: false, receivedAt: now },
      codex: { weeklyCap: null, weeklyUsed: 0, estimatedPct: null },
    };
    expect(budgetResetHintLine(snapshot, 'claude', now)).toBe('5h window 50%');
  });

  it('honest NO DATA: null when the snapshot is stale, absent, or provider is codex (no resets_at concept)', () => {
    const staleSnapshot = {
      claude: { fiveHourUsedPct: 50, sevenDayUsedPct: 10, stale: true, receivedAt: now },
      codex: { weeklyCap: null, weeklyUsed: 0, estimatedPct: null },
    };
    expect(budgetResetHintLine(staleSnapshot, 'claude', now)).toBeNull();
    expect(budgetResetHintLine(null, 'claude', now)).toBeNull();
    expect(budgetResetHintLine(staleSnapshot, 'codex', now)).toBeNull();
    const freshClaudeSnapshot = {
      claude: { fiveHourUsedPct: 50, sevenDayUsedPct: 10, stale: false, receivedAt: now },
      codex: { weeklyCap: null, weeklyUsed: 0, estimatedPct: null },
    };
    // Codex is never hinted even when the underlying Claude data is fine —
    // the hint is per-selected-provider, and codex has no resets_at at all.
    expect(budgetResetHintLine(freshClaudeSnapshot, 'codex', now)).toBeNull();
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
