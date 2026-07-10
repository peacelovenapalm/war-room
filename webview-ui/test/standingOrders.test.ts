/**
 * Unit tests for standingOrders.ts's pure logic (v2 mechanic G3,
 * GAME-DESIGN.md §7.2) — the StandingOrdersPanel component's testable
 * core. Covers the unconditional first-fire-confirm status precedence
 * (it must win over every other display state).
 */

import { describe, expect, it } from 'vitest';

import {
  canCreateStandingOrder,
  scheduleLabel,
  STANDING_ORDER_BASE_CAP,
  standingOrderCapClient,
  type StandingOrderClient,
  standingOrderStatusLabel,
} from '../src/standingOrders.js';

function order(overrides: Partial<StandingOrderClient> = {}): StandingOrderClient {
  return {
    id: 'o1',
    name: 'nightly',
    schedule: { kind: 'daily', atLocalHour: 9 },
    prompt: 'go',
    enabled: true,
    needsFirstFireConfirm: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('scheduleLabel', () => {
  it('formats a daily schedule', () => {
    expect(scheduleLabel({ kind: 'daily', atLocalHour: 9 })).toBe('DAILY @ 09:00');
  });

  it('formats a whole-hour interval schedule', () => {
    expect(scheduleLabel({ kind: 'interval', everyMs: 3_600_000 })).toBe('EVERY 1h');
  });

  it('formats a sub-hour interval schedule in minutes', () => {
    expect(scheduleLabel({ kind: 'interval', everyMs: 90_000 })).toBe('EVERY 2m');
  });
});

describe('standingOrderStatusLabel', () => {
  it('needsFirstFireConfirm is the LOUDEST state — wins over every other flag', () => {
    const label = standingOrderStatusLabel(
      order({
        needsFirstFireConfirm: true,
        enabled: false,
        stoppedByKillSwitch: true,
        lastSkipReason: 'budget-paused',
      }),
    );
    expect(label).toBe('⚠ NEEDS FIRST-RUN CONFIRM');
  });

  it('stopped-by-kill-switch wins over a plain disabled state', () => {
    expect(standingOrderStatusLabel(order({ enabled: false, stoppedByKillSwitch: true }))).toBe(
      '■ STOPPED',
    );
  });

  it('disabled (not via kill switch)', () => {
    expect(standingOrderStatusLabel(order({ enabled: false }))).toBe('○ DISABLED');
  });

  it('legacy pre-item-5 generic budget-paused literal still renders (not a raw fallthrough)', () => {
    expect(standingOrderStatusLabel(order({ lastSkipReason: 'budget-paused' }))).toBe(
      '⏸ PAUSED — budget',
    );
  });

  it('a non-budget skip reason renders as a generic SKIPPED, not a pause', () => {
    expect(standingOrderStatusLabel(order({ lastSkipReason: 'missing-dispatch-target' }))).toBe(
      '⚠ SKIPPED — missing-dispatch-target',
    );
  });

  it('each of the 4 real budget-pause reasons renders distinctly (KICKOFF v1.1 item 5)', () => {
    const labels = {
      'stale-snapshot': standingOrderStatusLabel(order({ lastSkipReason: 'stale-snapshot' })),
      '5h-threshold': standingOrderStatusLabel(order({ lastSkipReason: '5h-threshold' })),
      '7d-threshold': standingOrderStatusLabel(order({ lastSkipReason: '7d-threshold' })),
      'codex-cap-reached': standingOrderStatusLabel(order({ lastSkipReason: 'codex-cap-reached' })),
    };
    expect(labels['stale-snapshot']).toBe('⏸ PAUSED — stale telemetry');
    expect(labels['5h-threshold']).toBe('⏸ PAUSED — 5h budget');
    expect(labels['7d-threshold']).toBe('⏸ PAUSED — 7d budget');
    expect(labels['codex-cap-reached']).toBe('⏸ PAUSED — codex cap');
    // All four render distinctly from one another — no two reasons collapse
    // to the same string (the exact bug this item fixes: previously every
    // reason rendered as the same generic 'budget-paused').
    const values = Object.values(labels);
    expect(new Set(values).size).toBe(values.length);
  });

  it('active, no flags set', () => {
    expect(standingOrderStatusLabel(order())).toBe('● ACTIVE');
  });
});

describe('canCreateStandingOrder', () => {
  it('allows creation below the cap, blocks at/above it', () => {
    expect(canCreateStandingOrder(0, 1)).toBe(true);
    expect(canCreateStandingOrder(1, 1)).toBe(false);
    expect(canCreateStandingOrder(1, 2)).toBe(true);
  });
});

describe('standingOrderCapClient (KICKOFF v2.0 0.6 — Second Shift perk cap)', () => {
  it('mirrors the server value table exactly: base 1, +1 secondShift, +2 nightShiftForeman', () => {
    // Value table from server/src/standingOrderStore.ts standingOrderCap().
    expect(standingOrderCapClient({ purchasedPerks: [] })).toBe(STANDING_ORDER_BASE_CAP);
    expect(standingOrderCapClient({ purchasedPerks: ['secondShift'] })).toBe(2);
    expect(standingOrderCapClient({ purchasedPerks: ['nightShiftForeman'] })).toBe(3);
    expect(standingOrderCapClient({ purchasedPerks: ['secondShift', 'nightShiftForeman'] })).toBe(
      4,
    );
  });

  it('fails closed to the base cap with no economy snapshot', () => {
    expect(standingOrderCapClient(null)).toBe(STANDING_ORDER_BASE_CAP);
  });

  it('ignores unrelated perks (chainGang raises the CHAIN cap, not this one)', () => {
    expect(standingOrderCapClient({ purchasedPerks: ['chainGang'] })).toBe(STANDING_ORDER_BASE_CAP);
  });

  it('regression: the pre-fix hardcoded base cap under-reports for a perk owner', () => {
    // Pre-fix, StandingOrdersPanel always passed STANDING_ORDER_BASE_CAP to
    // canCreateStandingOrder — so a Second Shift owner with 1 enabled order
    // saw CREATE blocked even though the server would allow a second.
    const perkOwner = { purchasedPerks: ['secondShift'] };
    expect(canCreateStandingOrder(1, standingOrderCapClient(perkOwner))).toBe(true);
    expect(canCreateStandingOrder(1, STANDING_ORDER_BASE_CAP)).toBe(false); // the old bug
  });
});
