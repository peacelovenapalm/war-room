/**
 * Revenue-ready CASH seam (v3 stage 3 — KICKOFF-v3.1 §3 WS-C item 3).
 *
 * Covers: drain semantics (each event exactly once), the relocated
 * synthetic rules at provider level (turn + once/day streak touch,
 * crisis, shift grades incl. the HEAVY 0-amount line, dispatch daily
 * cap), and economyStore.ingestRevenue as the single door — a fake
 * "future real provider" flows straight into the ledger with its cause
 * intact, and negative amounts are refused (revenue only credits).
 *
 * The relocation's byte-identical guarantee is asserted by the EXISTING
 * economyStore.test.ts suite passing unchanged (its award/cap/streak
 * tests all exercise the relocated rules through the same public
 * record* surface) — this file only adds seam-specific coverage.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CASH_PER_CRISIS_RESOLVED,
  CASH_PER_DISPATCH_EXIT_0,
  CASH_PER_TURN,
  CASH_SHIFT_GRADE,
  CASH_STREAK_DAY_TOUCH,
  DISPATCH_CASH_DAILY_CAP,
} from '../src/economyConstants.js';
import { EconomyStore } from '../src/economyStore.js';
import type { RevenueProvider, SyntheticRevenueState } from '../src/revenueProvider.js';
import { SyntheticRevenueProvider } from '../src/revenueProvider.js';

let tmpDir: string;
let statePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-seam-'));
  statePath = path.join(tmpDir, 'economy.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const DAY1 = new Date(2026, 6, 7, 12, 0, 0).getTime();

/** In-memory state accessor mirroring economyStore's sidecar fields. */
function memoryState(): SyntheticRevenueState & { fields: Record<string, unknown> } {
  const fields: {
    streakDayTouchedDate: string | null;
    dispatchCashDate: string | null;
    dispatchCashToday: number;
  } = { streakDayTouchedDate: null, dispatchCashDate: null, dispatchCashToday: 0 };
  return {
    fields,
    getStreakDayTouchedDate: () => fields.streakDayTouchedDate,
    setStreakDayTouchedDate: (date) => {
      fields.streakDayTouchedDate = date;
    },
    getDispatchCashWindow: () => ({
      date: fields.dispatchCashDate,
      paidToday: fields.dispatchCashToday,
    }),
    setDispatchCashWindow: (date, paidToday) => {
      fields.dispatchCashDate = date;
      fields.dispatchCashToday = paidToday;
    },
  };
}

describe('SyntheticRevenueProvider — relocated rules', () => {
  it('getRevenueEvents drains: each event is returned exactly once', () => {
    const provider = new SyntheticRevenueProvider(memoryState());
    provider.noteCrisisResolved('crisis:agent:1@0', DAY1);
    const first = provider.getRevenueEvents();
    expect(first).toHaveLength(1);
    expect(provider.getRevenueEvents()).toHaveLength(0); // drained
  });

  it('turn: CASH_PER_TURN plus the once/day streak touch, bonus on the base award only', () => {
    const provider = new SyntheticRevenueProvider(memoryState());
    provider.noteTurnCompleted('hook-stop:M:p', DAY1, 200);
    const events = provider.getRevenueEvents();
    expect(events.map((e) => [e.cause.label, e.amount])).toEqual([
      ['turn-completed', Math.round(CASH_PER_TURN * 3)],
      ['streak-day-touch', CASH_STREAK_DAY_TOUCH], // bonus never applies here
    ]);
    // Same local day: no second streak touch.
    provider.noteTurnCompleted('hook-stop:M:p', DAY1 + 60_000);
    expect(provider.getRevenueEvents().map((e) => e.cause.label)).toEqual(['turn-completed']);
  });

  it('crisis: CASH_PER_CRISIS_RESOLVED with the observed episode as the receipt ref', () => {
    const provider = new SyntheticRevenueProvider(memoryState());
    provider.noteCrisisResolved('crisis:agent:7@123', DAY1);
    const [event] = provider.getRevenueEvents();
    expect(event.amount).toBe(CASH_PER_CRISIS_RESOLVED);
    expect(event.cause.sourceEventRefs).toEqual(['crisis:agent:7@123']);
  });

  it('shift grades: LEAN pays 100, HEAVY queues the honest 0-amount line, ungraded days queue nothing', () => {
    const provider = new SyntheticRevenueProvider(memoryState());
    provider.noteShiftDayClosed(
      { date: '2026-07-07', turnsCompleted: 3, efficiency: 'LEAN' },
      DAY1,
    );
    provider.noteShiftDayClosed(
      { date: '2026-07-08', turnsCompleted: 9, efficiency: 'HEAVY' },
      DAY1,
    );
    provider.noteShiftDayClosed(
      { date: '2026-07-09', turnsCompleted: 0, efficiency: 'LEAN' },
      DAY1,
    );
    provider.noteShiftDayClosed({ date: '2026-07-10', turnsCompleted: 4, efficiency: null }, DAY1);
    const events = provider.getRevenueEvents();
    expect(events.map((e) => [e.cause.label, e.amount])).toEqual([
      ['shift-grade-LEAN', CASH_SHIFT_GRADE.LEAN],
      ['shift-grade-HEAVY', 0],
    ]);
  });

  it('dispatch: exit-0 pays up to the daily cap, nonzero exits queue nothing', () => {
    const provider = new SyntheticRevenueProvider(memoryState());
    provider.noteDispatchExit(1, 'dispatch:bad', DAY1);
    expect(provider.getRevenueEvents()).toHaveLength(0);
    for (let i = 0; i < 11; i++) {
      provider.noteDispatchExit(0, `dispatch:d-${i}`, DAY1 + i * 1000);
    }
    const events = provider.getRevenueEvents();
    expect(events).toHaveLength(10); // 10 * 5 = 50 = cap; the 11th queued nothing
    expect(events.every((e) => e.amount === CASH_PER_DISPATCH_EXIT_0)).toBe(true);
    expect(events.reduce((sum, e) => sum + e.amount, 0)).toBe(DISPATCH_CASH_DAILY_CAP);
    // New local day: the window resets.
    provider.noteDispatchExit(0, 'dispatch:next-day', DAY1 + 86_400_000);
    expect(provider.getRevenueEvents()).toHaveLength(1);
  });
});

describe('EconomyStore.ingestRevenue — the single door for CASH-as-revenue', () => {
  it('a future real provider flows straight into the ledger with its cause intact', () => {
    const store = new EconomyStore(statePath);
    // The exact shape a StripeRevenueProvider would return (REVENUE.md).
    const fakeRealProvider: RevenueProvider = {
      getRevenueEvents: () => [
        {
          ts: DAY1,
          amount: 120,
          cause: {
            label: 'stripe-payment',
            sourceEventRefs: ['stripe:payment_intent:pi_TEST123'],
          },
        },
      ],
    };
    store.ingestRevenue(fakeRealProvider, DAY1);
    const snap = store.getSnapshot();
    expect(snap.cash).toBe(120);
    expect(snap.ledger).toHaveLength(1);
    expect(snap.ledger[0].cause).toEqual({
      label: 'stripe-payment',
      sourceEventRefs: ['stripe:payment_intent:pi_TEST123'],
    });
  });

  it('refuses negative amounts — revenue only credits, a debit can never masquerade as revenue', () => {
    const store = new EconomyStore(statePath);
    store.addCash(100, { label: 'seed', sourceEventRefs: ['test:seed'] }, DAY1);
    const hostileProvider: RevenueProvider = {
      getRevenueEvents: () => [
        { ts: DAY1, amount: -50, cause: { label: 'evil-debit', sourceEventRefs: ['test:evil'] } },
        { ts: DAY1, amount: 10, cause: { label: 'fine', sourceEventRefs: ['test:fine'] } },
      ],
    };
    store.ingestRevenue(hostileProvider, DAY1);
    const snap = store.getSnapshot();
    expect(snap.cash).toBe(110); // the -50 was dropped, the +10 applied
    expect(snap.ledger.some((e) => e.reason === 'evil-debit')).toBe(false);
  });

  it('an empty drain is a no-op on cash and ledger', () => {
    const store = new EconomyStore(statePath);
    store.ingestRevenue({ getRevenueEvents: () => [] }, DAY1);
    expect(store.getSnapshot().cash).toBe(0);
    expect(store.getSnapshot().ledger).toHaveLength(0);
  });

  it('the record* surface routes through the seam with identical observable behavior (spot check)', () => {
    const store = new EconomyStore(statePath);
    store.recordTurnCompleted('hook-stop:M:p', DAY1);
    expect(store.getSnapshot().cash).toBe(CASH_PER_TURN + CASH_STREAK_DAY_TOUCH);
    const labels = store.getSnapshot().ledger.map((e) => e.reason);
    expect(labels).toEqual(['turn-completed', 'streak-day-touch']);
  });
});
