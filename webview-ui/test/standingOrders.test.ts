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

  it('budget-paused skip reason renders distinctly from a generic skip', () => {
    expect(standingOrderStatusLabel(order({ lastSkipReason: 'budget-paused' }))).toBe(
      '⏸ BUDGET PAUSED',
    );
    expect(standingOrderStatusLabel(order({ lastSkipReason: 'missing-dispatch-target' }))).toBe(
      '⚠ SKIPPED — missing-dispatch-target',
    );
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
