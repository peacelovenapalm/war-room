/**
 * Unit tests for budget.ts's pure logic (v2 mechanic G3, GAME-DESIGN.md
 * §7.4) — the CallModal budget meter chip's testable core. Covers the
 * hard rule that the Codex chip is ALWAYS "est."-prefixed and the Claude
 * chip is ALWAYS the bare %, never swapped.
 */

import { describe, expect, it } from 'vitest';

import {
  budgetChipLabel,
  type BudgetSnapshotClient,
  claudeBudgetChipLabel,
  codexBudgetChipLabel,
} from '../src/budget.js';

function snapshot(overrides: Partial<BudgetSnapshotClient> = {}): BudgetSnapshotClient {
  return {
    claude: { fiveHourUsedPct: 42, sevenDayUsedPct: 10, stale: false, receivedAt: 1000 },
    codex: { weeklyCap: 20, weeklyUsed: 5, estimatedPct: 25 },
    ...overrides,
  };
}

describe('claudeBudgetChipLabel', () => {
  it('renders the bare % with a tier word — never a tilde prefix', () => {
    const label = claudeBudgetChipLabel(snapshot().claude);
    expect(label).toBe('5H 42% fair');
    expect(label.startsWith('~')).toBe(false);
  });

  it('shows STALE when the snapshot is stale', () => {
    expect(
      claudeBudgetChipLabel({
        fiveHourUsedPct: 10,
        sevenDayUsedPct: 10,
        stale: true,
        receivedAt: 1,
      }),
    ).toBe('5H ⚠ STALE');
  });
});

describe('codexBudgetChipLabel', () => {
  it('ALWAYS renders with a tilde + est. suffix — never the bare % the Claude meter gets', () => {
    const label = codexBudgetChipLabel(snapshot().codex);
    expect(label).toBe('~25% est.');
    expect(label.startsWith('~')).toBe(true);
    expect(label.endsWith('est.')).toBe(true);
  });

  it('shows an unset state when no cap has been configured', () => {
    expect(codexBudgetChipLabel({ weeklyCap: null, weeklyUsed: 0, estimatedPct: null })).toBe(
      '~ est. unset',
    );
  });
});

describe('budgetChipLabel (provider-aware)', () => {
  it('routes to the Claude chip for claude/undefined provider', () => {
    expect(budgetChipLabel(snapshot(), 'claude')).toBe('5H 42% fair');
    expect(budgetChipLabel(snapshot(), undefined)).toBe('5H 42% fair');
  });

  it('routes to the Codex chip for codex provider', () => {
    expect(budgetChipLabel(snapshot(), 'codex')).toBe('~25% est.');
  });

  it('shows STALE when there is no snapshot at all', () => {
    expect(budgetChipLabel(null, 'claude')).toBe('⚠ STALE');
  });
});
