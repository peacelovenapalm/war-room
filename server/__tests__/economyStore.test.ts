/**
 * Unit tests for the economy store (G2, GAME-DESIGN.md §3).
 *
 * Covers: every constant in economyConstants.ts asserted literally,
 * HEAVY-grade day pays exactly 0 in both currencies (never negative), the
 * dispatch-cash daily cap boundary, the Reputation decay grace/boundary +
 * 72h offline-catchup cap, vacation-mode freeze, the once/day streak
 * touch, and the VITEST-guard test cloned from employeeStore.test.ts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BAY_BASE_COST,
  BAY_COST_GROWTH,
  bayCost,
  CASH_PER_CRISIS_RESOLVED,
  CASH_PER_DISPATCH_EXIT_0,
  CASH_PER_TURN,
  CASH_SHIFT_GRADE,
  CASH_STREAK_DAY_TOUCH,
  DISPATCH_CASH_DAILY_CAP,
  PERK_COST,
  PERK_IDS,
  REP_DECAY_DARK_DAY,
  REP_DECAY_GRACE_DAYS,
  REP_SHIFT_GRADE,
  SERVER_ROOM_CASH_BONUS_PCT,
} from '../src/economyConstants.js';
import { EconomyStore, economyStore } from '../src/economyStore.js';

let vitestGuardHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => vitestGuardHome };
});

let tmpDir: string;
let statePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'economy-store-'));
  statePath = path.join(tmpDir, 'economy.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const DAY1 = new Date(2026, 6, 7, 12, 0, 0).getTime(); // Tue 2026-07-07 noon
const ONE_DAY_MS = 86_400_000;

/** Test receipt (v3 REP receipts) — mutations require a full cause. */
const cause = (label: string) => ({ label, sourceEventRefs: [`test:${label}`] });

describe('economyConstants', () => {
  it('matches the canonical GAME-DESIGN §3 numbers literally', () => {
    expect(CASH_PER_TURN).toBe(2);
    expect(CASH_PER_CRISIS_RESOLVED).toBe(10);
    expect(CASH_SHIFT_GRADE).toEqual({ LEAN: 100, STEADY: 40, HEAVY: 0 });
    expect(REP_SHIFT_GRADE).toEqual({ LEAN: 3, STEADY: 1, HEAVY: 0 });
    expect(CASH_STREAK_DAY_TOUCH).toBe(10);
    expect(CASH_PER_DISPATCH_EXIT_0).toBe(5);
    expect(DISPATCH_CASH_DAILY_CAP).toBe(50);
    expect(REP_DECAY_DARK_DAY).toBe(1);
    expect(REP_DECAY_GRACE_DAYS).toBe(1);
    expect(BAY_BASE_COST).toBe(500);
    expect(BAY_COST_GROWTH).toBe(1.55);
  });

  it('bayCost(n) computes 500 * 1.55^n exactly (rounded)', () => {
    expect(bayCost(0)).toBe(500);
    expect(bayCost(1)).toBe(Math.round(500 * 1.55));
    expect(bayCost(11)).toBe(Math.round(500 * Math.pow(1.55, 11)));
  });
});

describe('EconomyStore real-event awards', () => {
  it('recordTurnCompleted awards CASH_PER_TURN plus a once/day streak touch', () => {
    const store = new EconomyStore(statePath);
    store.recordTurnCompleted('test:turn', DAY1);
    expect(store.getSnapshot().cash).toBe(CASH_PER_TURN + CASH_STREAK_DAY_TOUCH);
    // A second turn the same local day pays CASH_PER_TURN only (no repeat streak touch).
    store.recordTurnCompleted('test:turn', DAY1 + 60_000);
    expect(store.getSnapshot().cash).toBe(CASH_PER_TURN * 2 + CASH_STREAK_DAY_TOUCH);
  });

  it('recordCrisisResolved awards CASH_PER_CRISIS_RESOLVED', () => {
    const store = new EconomyStore(statePath);
    store.recordCrisisResolved('test:crisis', DAY1);
    expect(store.getSnapshot().cash).toBe(CASH_PER_CRISIS_RESOLVED);
  });

  it('HEAVY-graded day pays exactly 0 in both currencies, never negative', () => {
    const store = new EconomyStore(statePath);
    store.recordShiftDayClosed(
      { date: '2026-07-07', turnsCompleted: 40, efficiency: 'HEAVY' },
      DAY1,
    );
    const snap = store.getSnapshot();
    expect(snap.cash).toBe(0);
    expect(snap.reputation).toBe(0);
  });

  it('LEAN-graded day pays CASH_SHIFT_GRADE.LEAN cash + REP_SHIFT_GRADE.LEAN reputation', () => {
    const store = new EconomyStore(statePath);
    store.recordShiftDayClosed(
      { date: '2026-07-07', turnsCompleted: 10, efficiency: 'LEAN' },
      DAY1,
    );
    const snap = store.getSnapshot();
    expect(snap.cash).toBe(CASH_SHIFT_GRADE.LEAN);
    expect(snap.reputation).toBe(REP_SHIFT_GRADE.LEAN);
  });

  it('skips days with zero completed turns or null efficiency (mirrors progressionStore)', () => {
    const store = new EconomyStore(statePath);
    store.recordShiftDayClosed({ date: '2026-07-07', turnsCompleted: 0, efficiency: 'LEAN' }, DAY1);
    store.recordShiftDayClosed({ date: '2026-07-07', turnsCompleted: 5, efficiency: null }, DAY1);
    expect(store.getSnapshot().cash).toBe(0);
  });
});

describe('EconomyStore.ingestRevenue durability (REVENUE.md seam — force-persist on drain)', () => {
  it('a credited amount is durably on disk immediately after ingestRevenue, even inside the persist-throttle window', () => {
    const store = new EconomyStore(statePath);
    const provider: {
      getRevenueEvents: () => { ts: number; amount: number; cause: ReturnType<typeof cause> }[];
      queue: { ts: number; amount: number; cause: ReturnType<typeof cause> }[];
    } = {
      queue: [],
      getRevenueEvents() {
        const out = this.queue;
        this.queue = [];
        return out;
      },
    };

    // First credit — the very first persist() call ever is never throttled
    // (lastPersistAt starts at 0), so this alone wouldn't prove anything.
    provider.queue.push({ ts: DAY1, amount: 10, cause: cause('first') });
    store.ingestRevenue(provider, DAY1);
    expect(store.getSnapshot().cash).toBe(10);

    // Second credit, 1s later — well inside the 5s persist-throttle
    // window. Without a forced persist here, the on-disk sidecar would
    // still show the stale amount=10 state; a crash in that window loses
    // the second credit with no redrain path (the provider already
    // forgot it — drain semantics).
    provider.queue.push({ ts: DAY1 + 1000, amount: 5, cause: cause('second') });
    store.ingestRevenue(provider, DAY1 + 1000);
    expect(store.getSnapshot().cash).toBe(15);

    const onDisk = JSON.parse(fs.readFileSync(statePath, 'utf8')) as { cash: number };
    expect(onDisk.cash).toBe(15);
  });
});

describe('EconomyStore Server Room cashBonusPct (G2, GAME-DESIGN §5.4) — F2', () => {
  it('recordTurnCompleted applies cashBonusPct to CASH_PER_TURN only, never the once/day streak touch', () => {
    const store = new EconomyStore(statePath);
    // CASH_PER_TURN (2) is small enough that a 10% bump rounds back down to
    // 2 — assert the exact rounded formula (the real regression check on
    // the wiring) rather than a "greater than" that a small base defeats.
    store.recordTurnCompleted('test:turn', DAY1, SERVER_ROOM_CASH_BONUS_PCT);
    const expectedTurnCash = Math.round(CASH_PER_TURN * (1 + SERVER_ROOM_CASH_BONUS_PCT / 100));
    expect(store.getSnapshot().cash).toBe(expectedTurnCash + CASH_STREAK_DAY_TOUCH);
    // A larger, more realistic bonus pct DOES measurably exceed the unbuffed award.
    const secondStore = new EconomyStore(path.join(tmpDir, 'economy-2.json'));
    secondStore.recordTurnCompleted('test:turn', DAY1, 200);
    expect(secondStore.getSnapshot().cash).toBeGreaterThan(CASH_PER_TURN + CASH_STREAK_DAY_TOUCH);
  });

  it('recordCrisisResolved applies cashBonusPct to CASH_PER_CRISIS_RESOLVED', () => {
    const store = new EconomyStore(statePath);
    store.recordCrisisResolved('test:crisis', DAY1, SERVER_ROOM_CASH_BONUS_PCT);
    const expected = Math.round(CASH_PER_CRISIS_RESOLVED * (1 + SERVER_ROOM_CASH_BONUS_PCT / 100));
    expect(store.getSnapshot().cash).toBe(expected);
    expect(expected).toBeGreaterThan(CASH_PER_CRISIS_RESOLVED);
  });

  it('recordDispatchExit applies cashBonusPct to CASH_PER_DISPATCH_EXIT_0, still bounded by the daily cap', () => {
    const store = new EconomyStore(statePath);
    store.recordDispatchExit(0, 'test:dispatch', DAY1, SERVER_ROOM_CASH_BONUS_PCT);
    const expected = Math.round(CASH_PER_DISPATCH_EXIT_0 * (1 + SERVER_ROOM_CASH_BONUS_PCT / 100));
    expect(store.getSnapshot().cash).toBe(expected);
    expect(expected).toBeGreaterThan(CASH_PER_DISPATCH_EXIT_0);
    // The daily cap still wins even with the bonus applied — award never
    // exceeds DISPATCH_CASH_DAILY_CAP total for the day (anti-farming
    // guarantee holds regardless of Server Room).
    for (let i = 1; i < 12; i++) {
      store.recordDispatchExit(0, 'test:dispatch', DAY1 + i * 1000, SERVER_ROOM_CASH_BONUS_PCT);
    }
    expect(store.getSnapshot().cash).toBe(DISPATCH_CASH_DAILY_CAP);
  });

  it('a zero cashBonusPct (no Server Room) awards the plain unbuffed amount — default param', () => {
    const store = new EconomyStore(statePath);
    store.recordTurnCompleted('test:turn', DAY1);
    expect(store.getSnapshot().cash).toBe(CASH_PER_TURN + CASH_STREAK_DAY_TOUCH);
  });
});

describe('EconomyStore dispatch-cash daily cap (anti-farming, Fable review delta #5)', () => {
  it('pays +5 per exit-0 up to the cap, then 0 — boundary-tested at the 11th call', () => {
    const store = new EconomyStore(statePath);
    for (let i = 0; i < 10; i++) {
      store.recordDispatchExit(0, 'test:dispatch', DAY1 + i * 1000);
    }
    expect(store.getSnapshot().cash).toBe(DISPATCH_CASH_DAILY_CAP); // 10 * 5 = 50
    // 11th exit-0 the same local day pays 0 — cap boundary.
    store.recordDispatchExit(0, 'test:dispatch', DAY1 + 11_000);
    expect(store.getSnapshot().cash).toBe(DISPATCH_CASH_DAILY_CAP);
  });

  it('a nonzero exit pays 0, never negative', () => {
    const store = new EconomyStore(statePath);
    store.recordDispatchExit(1, 'test:dispatch', DAY1);
    expect(store.getSnapshot().cash).toBe(0);
  });

  it('the cap resets on a new local day', () => {
    const store = new EconomyStore(statePath);
    for (let i = 0; i < 10; i++) store.recordDispatchExit(0, 'test:dispatch', DAY1 + i * 1000);
    expect(store.getSnapshot().cash).toBe(DISPATCH_CASH_DAILY_CAP);
    store.recordDispatchExit(0, 'test:dispatch', DAY1 + ONE_DAY_MS);
    expect(store.getSnapshot().cash).toBe(DISPATCH_CASH_DAILY_CAP + CASH_PER_DISPATCH_EXIT_0);
  });
});

describe('EconomyStore Reputation decay (§3.2, 1-day grace, 72h offline-catchup cap)', () => {
  it('grants the first zero-activity day free, decays from the second', () => {
    const store = new EconomyStore(statePath);
    store.addReputation(20, cause('test-seed'), DAY1);
    store.recordTurnCompleted('test:turn', DAY1); // lastActiveDate = day1

    // Day 2 (first zero-activity day): grace, no decay.
    store.catchUpOffline(DAY1 + ONE_DAY_MS);
    expect(store.getSnapshot().reputation).toBe(20);

    // Day 3 (second consecutive zero-activity day): -1.
    store.catchUpOffline(DAY1 + 2 * ONE_DAY_MS);
    expect(store.getSnapshot().reputation).toBe(19);

    // Day 4: another -1.
    store.catchUpOffline(DAY1 + 3 * ONE_DAY_MS);
    expect(store.getSnapshot().reputation).toBe(18);
  });

  it('floors at 0, never negative', () => {
    const store = new EconomyStore(statePath);
    store.addReputation(1, cause('test-seed'), DAY1);
    store.recordTurnCompleted('test:turn', DAY1);
    // Walk far enough forward (multiple catch-up calls) to exceed the balance.
    let now = DAY1;
    for (let i = 0; i < 10; i++) {
      now += 3 * ONE_DAY_MS; // 3 days per call = the 72h cap
      store.catchUpOffline(now);
    }
    expect(store.getSnapshot().reputation).toBe(0);
  });

  it('no decay on any day with real activity, however small', () => {
    const store = new EconomyStore(statePath);
    store.addReputation(10, cause('test-seed'), DAY1);
    store.recordTurnCompleted('test:turn', DAY1);
    store.catchUpOffline(DAY1 + ONE_DAY_MS); // grace day
    // Activity resumes on day 3 before any decay-causing catch-up ran for it.
    store.recordTurnCompleted('test:turn', DAY1 + 2 * ONE_DAY_MS);
    store.catchUpOffline(DAY1 + 2 * ONE_DAY_MS);
    expect(store.getSnapshot().reputation).toBe(10);
    // Day 4 is a fresh zero-activity streak start (grace again).
    store.catchUpOffline(DAY1 + 3 * ONE_DAY_MS);
    expect(store.getSnapshot().reputation).toBe(10);
  });

  it('caps a single catch-up call at 72h/3 days — a long gap never back-charges beyond it', () => {
    const store = new EconomyStore(statePath);
    store.addReputation(100, cause('test-seed'), DAY1);
    store.recordTurnCompleted('test:turn', DAY1);
    // Away for 30 days, one single catch-up call on return.
    store.catchUpOffline(DAY1 + 30 * ONE_DAY_MS);
    // At most (3 days processed - 1 grace day) = 2 decay days charged in one call.
    expect(store.getSnapshot().reputation).toBe(100 - 2 * REP_DECAY_DARK_DAY);
  });

  it('zero decay while vacation mode is on, and never back-charges once turned off', () => {
    const store = new EconomyStore(statePath);
    store.addReputation(50, cause('test-seed'), DAY1);
    store.recordTurnCompleted('test:turn', DAY1);
    store.setVacationMode(true, DAY1 + ONE_DAY_MS);
    // 10 days pass entirely on vacation.
    store.catchUpOffline(DAY1 + 11 * ONE_DAY_MS);
    expect(store.getSnapshot().reputation).toBe(50);
    store.setVacationMode(false, DAY1 + 11 * ONE_DAY_MS);
    // Resuming: the vacation days are never retroactively charged — decay
    // only starts fresh from here (grace day, then -1/day).
    store.catchUpOffline(DAY1 + 12 * ONE_DAY_MS);
    expect(store.getSnapshot().reputation).toBe(50);
    store.catchUpOffline(DAY1 + 13 * ONE_DAY_MS);
    expect(store.getSnapshot().reputation).toBe(49);
  });
});

describe('EconomyStore building sinks', () => {
  it('spendOnBay debits exact cost and increments bayCount on success', () => {
    const store = new EconomyStore(statePath);
    store.addCash(1000, cause('test-seed'), DAY1);
    const result = store.spendOnBay(bayCost(0), DAY1);
    expect(result).toEqual({ ok: true, bayCount: 1 });
    expect(store.getSnapshot().cash).toBe(1000 - bayCost(0));
    expect(store.getSnapshot().bayCount).toBe(1);
  });

  it('rejects an insufficient-cash bay purchase without mutating state', () => {
    const store = new EconomyStore(statePath);
    store.addCash(10, cause('test-seed'), DAY1);
    const result = store.spendOnBay(bayCost(0), DAY1);
    expect(result).toEqual({ ok: false });
    expect(store.getSnapshot().cash).toBe(10);
    expect(store.getSnapshot().bayCount).toBe(0);
  });

  it('spend() rejects insufficient funds without mutating cash', () => {
    const store = new EconomyStore(statePath);
    store.addCash(10, cause('test-seed'), DAY1);
    expect(store.spend(300, cause('room-shell:dev_pit'), DAY1)).toBe(false);
    expect(store.getSnapshot().cash).toBe(10);
  });

  it('spend() debits on sufficient funds; a negative amount (refund) credits', () => {
    const store = new EconomyStore(statePath);
    store.addCash(300, cause('test-seed'), DAY1);
    expect(store.spend(300, cause('room-shell:dev_pit'), DAY1)).toBe(true);
    expect(store.getSnapshot().cash).toBe(0);
    expect(store.spend(-25, cause('sell-refund'), DAY1)).toBe(true);
    expect(store.getSnapshot().cash).toBe(25);
  });
});

describe('EconomyStore ledger + vacation flag', () => {
  it('caps the ledger at 200 entries', () => {
    const store = new EconomyStore(statePath);
    for (let i = 0; i < 210; i++) store.addCash(1, cause(`entry-${i}`), DAY1 + i);
    expect(store.getSnapshot().ledger.length).toBe(200);
    expect(store.getSnapshot().ledger[0]?.reason).toBe('entry-10');
  });

  it('setVacationMode toggles the flag and notifies listeners', () => {
    const store = new EconomyStore(statePath);
    const seen: boolean[] = [];
    store.onChange((snap) => seen.push(snap.vacationMode));
    store.setVacationMode(true, DAY1);
    expect(store.getSnapshot().vacationMode).toBe(true);
    expect(seen).toContain(true);
    store.setVacationMode(false, DAY1);
    expect(store.getSnapshot().vacationMode).toBe(false);
  });

  it('isVacationActive() reflects the current flag (employeeStore injection surface)', () => {
    const store = new EconomyStore(statePath);
    expect(store.isVacationActive()).toBe(false);
    store.setVacationMode(true, DAY1);
    expect(store.isVacationActive()).toBe(true);
  });
});

describe('EconomyStore automation perks (v2 mechanic G3, §7.4)', () => {
  it('buyPerk debits the exact cost and flips the flag on', () => {
    const store = new EconomyStore(statePath);
    store.addCash(500, cause('seed'), DAY1);
    expect(store.getPerkFlags()).toEqual({
      secondShift: false,
      chainGang: false,
      nightShiftForeman: false,
    });
    const result = store.buyPerk('secondShift', DAY1);
    expect(result.ok).toBe(true);
    expect(store.getSnapshot().cash).toBe(0);
    expect(store.getPerkFlags().secondShift).toBe(true);
  });

  it('refuses insufficient Cash without mutating state', () => {
    const store = new EconomyStore(statePath);
    const result = store.buyPerk('nightShiftForeman', DAY1);
    expect(result).toEqual({ ok: false, reason: 'insufficient-cash' });
    expect(store.getSnapshot().cash).toBe(0);
  });

  it('refuses a double-purchase of an already-owned perk (idempotent, never double-charges)', () => {
    const store = new EconomyStore(statePath);
    store.addCash(1000, cause('seed'), DAY1);
    store.buyPerk('secondShift', DAY1);
    const cashAfterFirst = store.getSnapshot().cash;
    const result = store.buyPerk('secondShift', DAY1);
    expect(result).toEqual({ ok: false, reason: 'already-owned' });
    expect(store.getSnapshot().cash).toBe(cashAfterFirst); // unchanged
  });

  it('the perk ladder is exactly 3 perks totaling 2800 — the Autopilot perk is CUT', () => {
    expect(PERK_IDS).toEqual(['secondShift', 'chainGang', 'nightShiftForeman']);
    expect(PERK_IDS.reduce((sum, id) => sum + PERK_COST[id], 0)).toBe(2800);
  });
});

describe('VITEST guard (cloned from employeeStore.test.ts pattern)', () => {
  beforeEach(() => {
    vitestGuardHome = fs.mkdtempSync(path.join(os.tmpdir(), 'economy-store-vitest-guard-'));
  });

  it('never writes the real default sidecar path under VITEST, even via the process-wide singleton', () => {
    economyStore.addCash(1, cause('vitest-guard-probe'), DAY1);
    const expectedPath = path.join(vitestGuardHome, '.pixel-agents', 'economy.json');
    expect(fs.existsSync(expectedPath)).toBe(false);
  });
});
