/**
 * v3 REP receipts (KICKOFF-v3.1 §3 WS-C item 2) — every CASH/REP/XP
 * movement carries a mandatory cause {label, sourceEventRefs}.
 *
 * Covers, per the stage-3 contract:
 *  - every economyStore mutation path stamps a full cause on its ledger
 *    line (walked exhaustively below — the runtime half of "no mutation
 *    path can omit a cause"),
 *  - the type system refuses cause-less/string-reason mutations (the
 *    compile-time half — @ts-expect-error assertions inside a function
 *    that is never executed, type-checked by server/tsconfig.test.json),
 *  - pre-receipt sidecar entries migrate on load with the honest sentinel
 *    UNKNOWN-LEGACY (empty refs — never a guessed backfill),
 *  - the broadcast plane (onChange snapshot — what economyUpdate spreads)
 *    carries the cause on every ledger line,
 *  - progressionStore XP movements produce the same receipt shape
 *    (currency 'xp'), persisted and replayed through its snapshot.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EconomySnapshot } from '../src/economyStore.js';
import { EconomyStore, UNKNOWN_LEGACY_LABEL } from '../src/economyStore.js';
import { ProgressionStore } from '../src/progressionStore.js';

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => '/nonexistent-receipts-home' };
});

let tmpDir: string;
let statePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'economy-receipts-'));
  statePath = path.join(tmpDir, 'economy.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const DAY1 = new Date(2026, 6, 7, 12, 0, 0).getTime();
const ONE_DAY_MS = 86_400_000;

const cause = (label: string) => ({ label, sourceEventRefs: [`test:${label}`] });

describe('economyStore receipts — every mutation path stamps a full cause', () => {
  it('walks every public mutation path and finds a cause on every ledger line', () => {
    const store = new EconomyStore(statePath);

    // Real-event award paths (caller-supplied source refs).
    store.recordTurnCompleted('hook-stop:MACBOOK:proj', DAY1); // + streak touch
    store.recordCrisisResolved('crisis:agent:7@1000', DAY1 + 1000);
    store.recordDispatchExit(0, 'dispatch:d-1', DAY1 + 2000);
    store.recordShiftDayClosed(
      { date: '2026-07-07', turnsCompleted: 3, efficiency: 'LEAN' },
      DAY1 + 3000,
    );

    // Direct mutation surface.
    store.addCash(500, cause('seed'), DAY1 + 4000);
    store.addReputation(5, cause('rep-seed'), DAY1 + 5000);

    // Player-action sinks (internal player-action:* refs).
    store.spend(100, cause('room-shell:dev_pit'), DAY1 + 6000);
    store.spendOnBay(1, DAY1 + 7000);
    expect(store.buyPerk('secondShift', DAY1 + 8000).ok).toBe(true);

    // Decay path (internal dark-day:<date> refs).
    store.catchUpOffline(DAY1 + 3 * ONE_DAY_MS);

    const ledger = store.getSnapshot().ledger;
    expect(ledger.length).toBeGreaterThanOrEqual(10);
    for (const entry of ledger) {
      expect(entry.cause).toBeDefined();
      expect(typeof entry.cause.label).toBe('string');
      expect(entry.cause.label.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.cause.sourceEventRefs)).toBe(true);
      // reason always mirrors cause.label (v2-client wire compatibility).
      expect(entry.reason).toBe(entry.cause.label);
    }

    // Every NON-legacy entry names at least one source event ref.
    for (const entry of ledger) {
      expect(entry.cause.label).not.toBe(UNKNOWN_LEGACY_LABEL);
      expect(entry.cause.sourceEventRefs.length).toBeGreaterThan(0);
    }

    // Spot-check the derived refs are the real observed events.
    const turn = ledger.find((e) => e.reason === 'turn-completed');
    expect(turn?.cause.sourceEventRefs).toEqual(['hook-stop:MACBOOK:proj']);
    const dispatch = ledger.find((e) => e.reason === 'dispatch-exit-0');
    expect(dispatch?.cause.sourceEventRefs).toEqual(['dispatch:d-1']);
    const grade = ledger.find((e) => e.reason === 'shift-grade-LEAN');
    expect(grade?.cause.sourceEventRefs).toEqual(['shift-day:2026-07-07']);
    const decay = ledger.find((e) => e.reason === 'zero-activity-decay');
    expect(decay?.cause.sourceEventRefs?.[0]).toMatch(/^dark-day:\d{4}-\d{2}-\d{2}$/);
    const perk = ledger.find((e) => e.reason === 'perk-secondShift');
    expect(perk?.cause.sourceEventRefs).toEqual(['player-action:buy-perk:secondShift']);
    const bay = ledger.find((e) => e.reason === 'bay-expansion');
    expect(bay?.cause.sourceEventRefs).toEqual(['player-action:expand-bay:1']);
  });

  it('the broadcast plane (onChange snapshot — what economyUpdate spreads) carries the cause', () => {
    const store = new EconomyStore(statePath);
    const seen: EconomySnapshot[] = [];
    store.onChange((snap) => seen.push(snap));
    store.addCash(10, cause('broadcast-probe'), DAY1);
    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1];
    expect(last.ledger[last.ledger.length - 1].cause).toEqual({
      label: 'broadcast-probe',
      sourceEventRefs: ['test:broadcast-probe'],
    });
  });

  it('migrates pre-receipt ledger entries on load with UNKNOWN-LEGACY and empty refs — never guessed', () => {
    // A sidecar written by the pre-receipt store: entries carry reason only.
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        cash: 42,
        reputation: 3,
        grime: 0,
        vacationMode: false,
        bayCount: 0,
        ledger: [
          { ts: DAY1, delta: 2, currency: 'cash', reason: 'turn-completed' },
          { ts: DAY1 + 1, delta: 1, currency: 'reputation', reason: 'shift-grade-STEADY' },
        ],
        lastActiveDate: null,
        streakDayTouchedDate: null,
        dispatchCashDate: null,
        dispatchCashToday: 0,
        zeroActivityStreakDays: 0,
        lastDecayCheckDate: null,
        purchasedPerks: [],
      }),
      'utf8',
    );
    const store = new EconomyStore(statePath);
    const snap = store.getSnapshot();
    expect(snap.cash).toBe(42);
    expect(snap.ledger).toHaveLength(2);
    for (const entry of snap.ledger) {
      expect(entry.cause).toEqual({ label: UNKNOWN_LEGACY_LABEL, sourceEventRefs: [] });
      // The original reason is preserved verbatim — migration never rewrites history.
    }
    expect(snap.ledger[0].reason).toBe('turn-completed');
    expect(snap.ledger[1].reason).toBe('shift-grade-STEADY');

    // New movements on the migrated store still get full receipts.
    store.addCash(1, cause('post-migration'), DAY1 + 10);
    const after = store.getSnapshot().ledger;
    expect(after[after.length - 1].cause.label).toBe('post-migration');
  });

  it('the type system refuses cause-less or bare-string mutations (compile-time enforcement)', () => {
    // Never executed — these lines exist so `npm run check-types` (which
    // covers server tests via tsconfig.test.json) FAILS if any mutation
    // path regains a string/optional-cause overload.
    const neverRun = (store: EconomyStore, progression: ProgressionStore) => {
      // @ts-expect-error — addCash without a cause must not compile
      store.addCash(5);
      // @ts-expect-error — a bare string reason must not compile
      store.addCash(5, 'turn-completed');
      // @ts-expect-error — addReputation without a cause must not compile
      store.addReputation(5);
      // @ts-expect-error — a bare string reason must not compile
      store.addReputation(5, 'shift-grade-LEAN');
      // @ts-expect-error — spend without a cause must not compile
      store.spend(5);
      // @ts-expect-error — a bare string reason must not compile
      store.spend(5, 'room-shell:dev_pit');
      // @ts-expect-error — a turn award must name its observed source event
      store.recordTurnCompleted();
      // @ts-expect-error — a crisis award must name the resolved episode
      store.recordCrisisResolved();
      // @ts-expect-error — a dispatch award must name the dispatch
      store.recordDispatchExit(0);
      // @ts-expect-error — XP: a turn must name its observed Stop event
      progression.recordTurnEnd();
      // @ts-expect-error — XP: a crisis award must name the resolved episode
      progression.recordCrisisResolved();
    };
    expect(typeof neverRun).toBe('function');
  });
});

describe('progressionStore XP receipts (same shape, currency xp)', () => {
  it('every XP movement produces a ledger line with a full cause', () => {
    const store = new ProgressionStore(path.join(tmpDir, 'progression.json'));
    store.recordTurnEnd('hook-stop:MACBOOK:proj', DAY1);
    store.recordCrisisResolved('crisis:agent:7@1000', DAY1 + 1000);
    store.recordShiftDayClosed(
      { date: '2026-07-07', turnsCompleted: 3, efficiency: 'STEADY' },
      DAY1 + 2000,
    );
    const snap = store.getSnapshot();
    expect(snap.ledger).toHaveLength(3);
    for (const entry of snap.ledger) {
      expect(entry.currency).toBe('xp');
      expect(entry.cause.label.length).toBeGreaterThan(0);
      expect(entry.cause.sourceEventRefs.length).toBeGreaterThan(0);
      expect(entry.reason).toBe(entry.cause.label);
      expect(entry.delta).toBeGreaterThan(0);
    }
    expect(snap.ledger[0].cause.sourceEventRefs).toEqual(['hook-stop:MACBOOK:proj']);
    expect(snap.ledger[2].cause.sourceEventRefs).toEqual(['shift-day:2026-07-07']);
  });

  it('zero-turn / ungraded day closes never mint an XP receipt (no movement, no line)', () => {
    const store = new ProgressionStore(path.join(tmpDir, 'progression.json'));
    store.recordShiftDayClosed({ date: '2026-07-07', turnsCompleted: 0, efficiency: 'LEAN' }, DAY1);
    store.recordShiftDayClosed({ date: '2026-07-07', turnsCompleted: 5, efficiency: null }, DAY1);
    expect(store.getSnapshot().ledger).toHaveLength(0);
  });

  it('XP receipts persist and reload; a pre-receipt sidecar loads with an empty ledger (no backfill)', () => {
    const persistPath = path.join(tmpDir, 'progression.json');
    // Pre-receipt sidecar: xp total exists, no ledger field.
    fs.writeFileSync(
      persistPath,
      JSON.stringify({
        xp: 120,
        streak: { current: 2, longest: 4, lastActiveDate: '2026-07-06' },
        leanDayCount: 1,
        unlocks: {},
      }),
      'utf8',
    );
    const store = new ProgressionStore(persistPath);
    expect(store.getSnapshot().xp).toBe(120);
    expect(store.getSnapshot().ledger).toEqual([]); // honest: unknown history stays unwritten

    store.recordTurnEnd('hook-stop:M:p', DAY1);
    // Force a persist boundary by reloading a second instance.
    const reloaded = new ProgressionStore(persistPath);
    const ledger = reloaded.getSnapshot().ledger;
    expect(ledger).toHaveLength(1);
    expect(ledger[0].cause.sourceEventRefs).toEqual(['hook-stop:M:p']);
  });
});
