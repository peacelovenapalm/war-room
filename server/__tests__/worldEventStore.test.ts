/**
 * Unit tests for the world event store (G4, GAME-DESIGN.md §6.3).
 *
 * Covers: weight/gap enforcement (the same event never re-fires before its
 * own min-gap elapses), the flavor_bonus +5/local-day cap enforced
 * independent of the min-gap (belt-and-suspenders), the online-only skip
 * for power_surge/power_outage_scare, and vacation-mode suppression (only
 * pureAmbient events remain eligible).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FLAVOR_BONUS_CASH_CAP_PER_DAY,
  WORLD_EVENTS,
  WorldEventStore,
  type WorldEventTickDeps,
} from '../src/worldEventStore.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-event-store-'));
  filePath = path.join(tmpDir, 'world-events.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const NOW = 10_000 * 3_600_000; // far past every event's min-gap from a fresh (lastFiredAt=0) store

function baseDeps(overrides: Partial<WorldEventTickDeps> = {}): WorldEventTickDeps {
  return {
    online: true,
    isVacationActive: () => false,
    getGrime: () => 0,
    awardCash: () => {},
    awardReputation: () => {},
    pickLowMoodEmployeeId: () => undefined,
    pickRandomEmployeeId: () => undefined,
    nudgeEmployeeMoodBoost: () => {},
    random: () => 0,
    ...overrides,
  };
}

/** Forces exactly `eligibleIds` into the tick's eligible pool by seeding
 *  every other event as "just fired" (on cooldown) and the targeted ones as
 *  "never fired" (eligible, since NOW comfortably exceeds every min-gap).
 *  Preserves flavorCashDate/flavorCashToday/eventLog across calls — this
 *  only rigs the min-gap eligibility, never the cap-tracking fields under
 *  test. */
function seedOnlyEligible(eligibleIds: readonly string[], now: number): void {
  const existing = fs.existsSync(filePath)
    ? (JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
        flavorCashDate: string | null;
        flavorCashToday: number;
        eventLog: unknown[];
      })
    : { flavorCashDate: null, flavorCashToday: 0, eventLog: [] };
  const lastFiredAt: Record<string, number> = {};
  for (const e of WORLD_EVENTS) {
    lastFiredAt[e.id] = eligibleIds.includes(e.id) ? 0 : now;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ ...existing, lastFiredAt }));
}

describe('WorldEventStore min-gap enforcement', () => {
  it('never re-fires the same event before its own min-gap elapses', () => {
    const store = new WorldEventStore(filePath);
    const first = store.tick(NOW, baseDeps({ random: () => 0 }));
    expect(first).not.toBeNull();
    expect(first!.id).toBe(WORLD_EVENTS[0].id); // power_surge — first table entry, weight slot [0,10)

    // Re-tick moments later with the same selection bias — power_surge is
    // now on its own 4h cooldown, so a DIFFERENT event must fire instead.
    const second = store.tick(NOW + 1_000, baseDeps({ random: () => 0 }));
    expect(second).not.toBeNull();
    expect(second!.id).not.toBe('power_surge');
  });

  it('returns null when nothing is eligible', () => {
    seedOnlyEligible([], NOW);
    const store = new WorldEventStore(filePath);
    expect(store.tick(NOW, baseDeps())).toBeNull();
  });
});

describe('WorldEventStore flavor_bonus cap (belt-and-suspenders)', () => {
  it('never pays more than FLAVOR_BONUS_CASH_CAP_PER_DAY in one local day, across repeated eligibility', () => {
    let totalAwarded = 0;
    for (let i = 0; i < 5; i++) {
      // Force ONLY flavor_bonus eligible each iteration, bypassing its own
      // realistic 24h cooldown -- isolating the CASH CAP's own enforcement
      // (tracked independently of the min-gap, per the design doc).
      seedOnlyEligible(['flavor_bonus'], NOW);
      const store = new WorldEventStore(filePath);
      store.tick(
        NOW + i,
        baseDeps({ awardCash: (amt) => (totalAwarded += amt), random: () => 0.99 }),
      );
    }
    expect(totalAwarded).toBe(FLAVOR_BONUS_CASH_CAP_PER_DAY);
  });

  it('resets the cap on a new local day', () => {
    let totalAwarded = 0;
    seedOnlyEligible(['flavor_bonus'], NOW);
    new WorldEventStore(filePath).tick(
      NOW,
      baseDeps({ awardCash: (amt) => (totalAwarded += amt), random: () => 0.99 }),
    );
    expect(totalAwarded).toBe(FLAVOR_BONUS_CASH_CAP_PER_DAY);

    const nextDay = NOW + 86_400_000;
    seedOnlyEligible(['flavor_bonus'], nextDay);
    new WorldEventStore(filePath).tick(
      nextDay,
      baseDeps({ awardCash: (amt) => (totalAwarded += amt), random: () => 0.99 }),
    );
    expect(totalAwarded).toBe(FLAVOR_BONUS_CASH_CAP_PER_DAY * 2);
  });
});

describe('WorldEventStore online-only skip (power_surge/power_outage_scare)', () => {
  it('excludes an online-only event from the eligible pool when offline', () => {
    seedOnlyEligible(['power_surge'], NOW);
    const store = new WorldEventStore(filePath);
    expect(store.tick(NOW, baseDeps({ online: false }))).toBeNull();
  });

  it('fires an online-only event normally when online', () => {
    seedOnlyEligible(['power_outage_scare'], NOW);
    const store = new WorldEventStore(filePath);
    const entry = store.tick(NOW, baseDeps({ online: true }));
    expect(entry?.id).toBe('power_outage_scare');
  });
});

describe('WorldEventStore vacation-mode suppression', () => {
  it('excludes non-pureAmbient events while vacation mode is on', () => {
    seedOnlyEligible(['inspection'], NOW);
    const store = new WorldEventStore(filePath);
    expect(store.tick(NOW, baseDeps({ isVacationActive: () => true }))).toBeNull();
  });

  it('still fires pureAmbient events while vacation mode is on', () => {
    seedOnlyEligible(['coffee_run'], NOW);
    const store = new WorldEventStore(filePath);
    const entry = store.tick(NOW, baseDeps({ isVacationActive: () => true }));
    expect(entry?.id).toBe('coffee_run');
  });

  it('picks only the pureAmbient candidate when both are eligible during vacation', () => {
    seedOnlyEligible(['inspection', 'coffee_run'], NOW);
    const store = new WorldEventStore(filePath);
    const entry = store.tick(NOW, baseDeps({ isVacationActive: () => true, random: () => 0 }));
    expect(entry?.id).toBe('coffee_run');
  });
});

describe('WorldEventStore effect application', () => {
  it('inspection: awards +2 Rep when grime <= 70, -1 Rep when grime > 70', () => {
    let repDelta = 0;
    seedOnlyEligible(['inspection'], NOW);
    new WorldEventStore(filePath).tick(
      NOW,
      baseDeps({ getGrime: () => 50, awardReputation: (amt) => (repDelta += amt) }),
    );
    expect(repDelta).toBe(2);

    repDelta = 0;
    seedOnlyEligible(['inspection'], NOW + 1);
    new WorldEventStore(filePath).tick(
      NOW + 1,
      baseDeps({ getGrime: () => 90, awardReputation: (amt) => (repDelta += amt) }),
    );
    expect(repDelta).toBe(-1);
  });

  it('rival_poach fizzles silently when nobody qualifies (no low-mood employee)', () => {
    let nudged = false;
    seedOnlyEligible(['rival_poach'], NOW);
    const entry = new WorldEventStore(filePath).tick(
      NOW,
      baseDeps({
        random: () => 0, // guaranteed under the 5% roll threshold
        pickLowMoodEmployeeId: () => undefined,
        nudgeEmployeeMoodBoost: () => (nudged = true),
      }),
    );
    expect(entry).not.toBeNull();
    expect(nudged).toBe(false);
  });

  it('rival_poach nudges the qualifying employee on the roll', () => {
    let nudgedId: string | undefined;
    let nudgedDelta = 0;
    seedOnlyEligible(['rival_poach'], NOW);
    new WorldEventStore(filePath).tick(
      NOW,
      baseDeps({
        random: () => 0,
        pickLowMoodEmployeeId: () => 'emp-1',
        nudgeEmployeeMoodBoost: (id, delta) => {
          nudgedId = id;
          nudgedDelta = delta;
        },
      }),
    );
    expect(nudgedId).toBe('emp-1');
    expect(nudgedDelta).toBe(-3);
  });

  it('birthday nudges a random employee +1 moodBoost', () => {
    let nudgedDelta = 0;
    seedOnlyEligible(['birthday'], NOW);
    new WorldEventStore(filePath).tick(
      NOW,
      baseDeps({
        pickRandomEmployeeId: () => 'emp-2',
        nudgeEmployeeMoodBoost: (_id, delta) => (nudgedDelta = delta),
      }),
    );
    expect(nudgedDelta).toBe(1);
  });
});

describe('WorldEventStore event log', () => {
  it('records fired events for digest.ts to consume', () => {
    seedOnlyEligible(['coffee_run'], NOW);
    const store = new WorldEventStore(filePath);
    store.tick(NOW, baseDeps());
    const log = store.getEventLog();
    expect(log).toHaveLength(1);
    expect(log[0].id).toBe('coffee_run');
    expect(log[0].summary.length).toBeGreaterThan(0);
  });
});
