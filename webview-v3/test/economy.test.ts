import { describe, expect, it } from 'vitest';

import { formatCashChip, formatRepChip, groupThousands, reduceEconomy } from '../src/state/economy';

describe('reduceEconomy', () => {
  it('mirrors economyUpdate verbatim and ignores everything else', () => {
    const update = reduceEconomy(null, {
      type: 'economyUpdate',
      cash: 1250,
      reputation: 42,
      grime: 0,
      vacationMode: false,
      bayCount: 2,
      ledger: [{ ts: 1, delta: 5, currency: 'cash', reason: 'dispatch exit 0' }],
    });
    expect(update).toEqual({
      cash: 1250,
      reputation: 42,
      ledger: [{ ts: 1, delta: 5, currency: 'cash', reason: 'dispatch exit 0' }],
    });
    expect(reduceEconomy(update, { type: 'agentClosed', id: 1 })).toBe(update);
  });
});

describe('formatting', () => {
  it('shows an honest — before the first update (absent ≠ zero)', () => {
    expect(formatCashChip(null)).toBe('$ —');
    expect(formatRepChip(null)).toBe('★ —');
  });

  it('groups thousands deterministically, including negatives', () => {
    expect(groupThousands(0)).toBe('0');
    expect(groupThousands(1234567)).toBe('1,234,567');
    expect(groupThousands(-4200)).toBe('-4,200');
  });

  it('renders live chips with shape + number', () => {
    const snapshot = { cash: 1250, reputation: 42, ledger: [] };
    expect(formatCashChip(snapshot)).toBe('$ 1,250');
    expect(formatRepChip(snapshot)).toBe('★ 42');
  });
});
