import { describe, expect, it } from 'vitest';

import {
  canCreateStandingOrder,
  scheduleLabel,
  standingOrderCapClient,
  type StandingOrderClient,
  standingOrderStatusLabel,
} from '../src/state/standingOrders';

function order(overrides: Partial<StandingOrderClient> = {}): StandingOrderClient {
  return {
    id: 'o1',
    name: 'nightly',
    schedule: { kind: 'daily', atLocalHour: 9 },
    prompt: 'do the thing',
    enabled: true,
    needsFirstFireConfirm: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('scheduleLabel', () => {
  it('formats daily and interval schedules', () => {
    expect(scheduleLabel({ kind: 'daily', atLocalHour: 9 })).toBe('DAILY @ 09:00');
    expect(scheduleLabel({ kind: 'interval', everyMs: 3_600_000 })).toBe('EVERY 1h');
    expect(scheduleLabel({ kind: 'interval', everyMs: 900_000 })).toBe('EVERY 15m');
  });
});

describe('standingOrderStatusLabel', () => {
  it('the first-fire confirm gate is the LOUDEST state — wins over everything else', () => {
    expect(
      standingOrderStatusLabel(
        order({ needsFirstFireConfirm: true, enabled: false, stoppedByKillSwitch: true }),
      ),
    ).toBe('⚠ NEEDS FIRST-RUN CONFIRM');
  });

  it('shows stopped, disabled, paused (with reason), skipped, or active', () => {
    expect(standingOrderStatusLabel(order({ stoppedByKillSwitch: true }))).toBe('■ STOPPED');
    expect(standingOrderStatusLabel(order({ enabled: false }))).toBe('○ DISABLED');
    expect(standingOrderStatusLabel(order({ lastSkipReason: '7d-threshold' }))).toBe(
      '⏸ PAUSED — 7d budget',
    );
    expect(standingOrderStatusLabel(order({ lastSkipReason: 'no-runner' }))).toBe(
      '⚠ SKIPPED — no-runner',
    );
    expect(standingOrderStatusLabel(order())).toBe('● ACTIVE');
  });
});

describe('standingOrderCapClient / canCreateStandingOrder', () => {
  it('fails closed to the base cap when perk state is unknown', () => {
    expect(standingOrderCapClient(null)).toBe(1);
  });

  it('adds perk bonuses additively', () => {
    expect(standingOrderCapClient({ purchasedPerks: ['secondShift'] })).toBe(2);
    expect(standingOrderCapClient({ purchasedPerks: ['secondShift', 'nightShiftForeman'] })).toBe(
      4,
    );
  });

  it('creation is allowed only under the cap', () => {
    expect(canCreateStandingOrder(0, 1)).toBe(true);
    expect(canCreateStandingOrder(1, 1)).toBe(false);
  });
});
