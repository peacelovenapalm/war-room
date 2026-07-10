/**
 * Unit tests for the employee store (G1).
 *
 * Covers: key determinism (same machine+project -> same id, regardless of
 * provider), score formula boundaries (MIN_SAMPLES gate, 0/50/100 cases),
 * quit determinism (fixed seed -> fixed outcome, halving math explicit),
 * fire-vs-quit identity (blacklist vs auto-rehire), ledger rotation, and
 * the VITEST-guard test cloned from progressionStore.test.ts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { employeeId } from '../../core/src/employeeId.js';
import { computeLevel, xpForLevel } from '../../core/src/leveling.js';
import {
  BREAK_ROOM_MOOD_REGEN_MULT,
  KITCHEN_MOOD_DECAY_MULT,
  WAR_ROOM_CRISIS_XP_BONUS_PCT,
} from '../src/economyConstants.js';
import type { Employee } from '../src/employeeStore.js';
import {
  computeBadges,
  computeScores,
  EMPLOYEE_LEVEL_CURVE,
  EmployeeStore,
  employeeStore,
  MIN_SAMPLES,
  MOOD_BREAK_RESTORE,
  MOOD_DECAY_PER_HOUR_IDLE,
  PROMOTE_COST_PER_TIER,
  QUIT_GRACE_DAYS,
  QUIT_THRESHOLD_MOOD,
  SPEED_MS_REFERENCE,
  TRAIN_COST_CASH,
  XP_CRISIS_RESOLVED,
  XP_TURN,
} from '../src/employeeStore.js';
import type { OfficeLayout, PlacedFurniture, PlacedRoom } from '../src/officeLayoutTypes.js';
import { RoomType, TileType } from '../src/officeLayoutTypes.js';

// Building buffs (G2, GAME-DESIGN §5.4/§5.5): break_/applyUpkeep now call
// the real getOfficeLayout() (via officeLayoutStore.ts). Stub only that
// module boundary (keep every other real export via vi.importActual, same
// idiom as the `os` mock above) so buffsForDesk/globalBuffs — the real,
// unmocked computation — run against a layout fixture we control.
vi.mock('../src/officeLayoutStore.js', async () => {
  const actual = await vi.importActual<typeof import('../src/officeLayoutStore.js')>(
    '../src/officeLayoutStore.js',
  );
  return { ...actual, getOfficeLayout: vi.fn() };
});
const { getOfficeLayout } = await import('../src/officeLayoutStore.js');

/** Mirrors buildingBuffs.test.ts's fixture-construction style. */
function baseLayout(overrides: Partial<OfficeLayout> = {}): OfficeLayout {
  const cols = 20;
  const rows = 11;
  const tiles = new Array(cols * rows).fill(TileType.FLOOR_1);
  return { version: 1, cols, rows, tiles, furniture: [], rooms: [], ...overrides };
}
function desk(uid: string, col: number, row: number): PlacedFurniture {
  return { uid, type: 'DESK_FRONT', col, row };
}
function room(
  type: RoomType,
  colStart: number,
  rowStart: number,
  colEnd: number,
  rowEnd: number,
): PlacedRoom {
  return { uid: `room-${type}`, type, colStart, rowStart, colEnd, rowEnd, createdAt: 0 };
}

// Isolated temp HOME for the VITEST-guard describe block below (same
// rationale/pattern as dispatchRoutes.test.ts — mocks os.homedir so the
// process-wide singleton's DEFAULT path resolves somewhere harmless, then
// asserts the VITEST guard still refuses to write there).
let vitestGuardHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => vitestGuardHome };
});

let tmpDir: string;
let statePath: string;
let ledgerDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-store-'));
  statePath = path.join(tmpDir, 'employees.json');
  ledgerDir = path.join(tmpDir, 'employee-history');
  // Building buffs (G2, GAME-DESIGN §5.4/§5.5): applyUpkeep/break_/
  // recordCrisisResolved now call the real getOfficeLayout() (via
  // officeLayoutStore.ts -> layoutPersistence.ts), which resolves
  // os.homedir() unconditionally — give it a valid default here so that
  // read resolves to "no layout file" (tolerant -> null -> neutral buffs)
  // instead of throwing on the mocked homedir's undefined default. The
  // nested VITEST-guard describe below still overrides this per-test.
  vitestGuardHome = tmpDir;
  // Default: no layout (neutral buffs) — individual tests below override
  // via vi.mocked(getOfficeLayout).mockReturnValue(...) to exercise a
  // specific room fixture.
  vi.mocked(getOfficeLayout).mockReturnValue(null);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const DAY1 = new Date(2026, 6, 7, 12, 0, 0).getTime();
const ONE_DAY_MS = 86_400_000;

describe('employeeId', () => {
  it('is deterministic for the same machine+project', () => {
    expect(employeeId('MACBOOK', '/Users/greg/code/war-room')).toBe(
      employeeId('MACBOOK', '/Users/greg/code/war-room'),
    );
  });

  it('does not vary by provider (provider is an attribute, not identity — GAME-DESIGN §4.1/§9.4)', () => {
    // employeeId() has no provider parameter at all — this test documents
    // that invariant explicitly rather than just relying on the signature.
    const id = employeeId('MACBOOK', '/proj');
    expect(id).toBe('MACBOOK:-proj');
  });

  it('defaults an absent machine to LOCAL', () => {
    expect(employeeId(undefined, '/proj')).toBe('LOCAL:-proj');
  });
});

describe('computeScores', () => {
  it('stays at neutral defaults below MIN_SAMPLES', () => {
    const turns = Array.from({ length: MIN_SAMPLES - 1 }, (_, i) => ({
      ts: i,
      wallMs: 0,
      outputTokens: 0,
      wasError: false,
      hour: 12,
    }));
    const scores = computeScores(turns, { speed: 0, accuracy: 0, nightOwl: 0, tokenEfficiency: 0 });
    expect(scores).toEqual({ speed: 50, accuracy: 50, nightOwl: 0, tokenEfficiency: 50 });
  });

  it('scores a fast, accurate, low-token, daytime run near the top of each band', () => {
    const turns = Array.from({ length: MIN_SAMPLES }, () => ({
      ts: 0,
      wallMs: 0, // instant turn -> speed 100
      outputTokens: 100, // well under LEAN_MAX -> tokenEfficiency 100
      wasError: false, // 0% error -> accuracy 100
      hour: 12, // daytime -> nightOwl 0
    }));
    const scores = computeScores(turns, { speed: 0, accuracy: 0, nightOwl: 0, tokenEfficiency: 0 });
    expect(scores).toEqual({ speed: 100, accuracy: 100, nightOwl: 0, tokenEfficiency: 100 });
  });

  it('scores a maximally slow, all-error, all-night run at the bottom', () => {
    const turns = Array.from({ length: MIN_SAMPLES }, () => ({
      ts: 0,
      wallMs: SPEED_MS_REFERENCE * 2, // >= reference -> speed 0
      outputTokens: 999_999, // >= STEADY_MAX -> tokenEfficiency 0
      wasError: true, // 100% errors -> accuracy clamped to 0 (200% penalty)
      hour: 2, // 2am -> nightOwl 100
    }));
    const scores = computeScores(turns, { speed: 0, accuracy: 0, nightOwl: 0, tokenEfficiency: 0 });
    expect(scores).toEqual({ speed: 0, accuracy: 0, nightOwl: 100, tokenEfficiency: 0 });
  });

  it('adds trainingBonus on top of the base score', () => {
    const turns = Array.from({ length: MIN_SAMPLES }, () => ({
      ts: 0,
      wallMs: 0,
      outputTokens: 100,
      wasError: false,
      hour: 12,
    }));
    const scores = computeScores(turns, {
      speed: 10,
      accuracy: 0,
      nightOwl: 0,
      tokenEfficiency: 0,
    });
    expect(scores.speed).toBe(110);
  });
});

describe('computeBadges', () => {
  it('ROOKIE suppresses everything below MIN_SAMPLES', () => {
    const badges = computeBadges(
      { speed: 100, accuracy: 100, nightOwl: 100, tokenEfficiency: 100 },
      1,
    );
    expect(badges).toEqual(['ROOKIE']);
  });

  it('assigns FAST/METICULOUS/NIGHT_OWL/EFFICIENT at threshold', () => {
    const badges = computeBadges(
      { speed: 70, accuracy: 85, nightOwl: 40, tokenEfficiency: 70 },
      MIN_SAMPLES,
    );
    expect(badges).toContain('FAST');
    expect(badges).toContain('METICULOUS');
    expect(badges).toContain('NIGHT_OWL');
    expect(badges).toContain('EFFICIENT');
    expect(badges).not.toContain('ROOKIE');
  });

  it('assigns SLOPPY/BURNS_TOKENS below their thresholds', () => {
    const badges = computeBadges(
      { speed: 0, accuracy: 49, nightOwl: 0, tokenEfficiency: 29 },
      MIN_SAMPLES,
    );
    expect(badges).toContain('SLOPPY');
    expect(badges).toContain('BURNS_TOKENS');
  });
});

describe('EmployeeStore.recordTurn', () => {
  it('creates a candidate on first telemetry and auto-onboards to active after 3 turns', () => {
    const store = new EmployeeStore(statePath, ledgerDir);
    let emp = store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 100 }, DAY1);
    expect(emp.status).toBe('candidate');
    emp = store.recordTurn(
      'MACBOOK',
      '/proj',
      'proj',
      { outputTokensCumulative: 200 },
      DAY1 + 1000,
    );
    expect(emp.status).toBe('candidate');
    emp = store.recordTurn(
      'MACBOOK',
      '/proj',
      'proj',
      { outputTokensCumulative: 300 },
      DAY1 + 2000,
    );
    expect(emp.status).toBe('active');
  });

  it('awards XP_TURN per turn and derives a per-turn outputTokens delta from the cumulative total', () => {
    const store = new EmployeeStore(statePath, ledgerDir);
    store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 1000 }, DAY1);
    const emp = store.recordTurn(
      'MACBOOK',
      '/proj',
      'proj',
      { outputTokensCumulative: 1500 },
      DAY1 + 1000,
    );
    expect(emp.xp).toBe(XP_TURN * 2);
    expect(emp.rolling.recentTurns.at(-1)?.outputTokens).toBe(500);
  });

  it('is id-stable across repeated telemetry for the same identity (REAL-session acceptance shape)', () => {
    const store = new EmployeeStore(statePath, ledgerDir);
    const first = store.recordTurn(
      'MACBOOK',
      '/proj',
      'proj',
      { outputTokensCumulative: 100 },
      DAY1,
    );
    const second = store.recordTurn(
      'MACBOOK',
      '/proj',
      'proj',
      { outputTokensCumulative: 200 },
      DAY1 + 1000,
    );
    expect(second.id).toBe(first.id);
    expect(second.name).toBe(first.name);
    const all = store.getAll(DAY1 + 2000);
    expect(all.some((e) => e.id === first.id)).toBe(true);
  });
});

describe('EmployeeStore fire vs quit identity (GAME-DESIGN §9.5)', () => {
  it('fire blacklists the key; the NEXT telemetry for the same base allocates a new #n record', () => {
    const store = new EmployeeStore(statePath, ledgerDir);
    const first = store.recordTurn(
      'MACBOOK',
      '/proj',
      'proj',
      { outputTokensCumulative: 100 },
      DAY1,
    );
    const fired = store.fire(first.id, DAY1 + 1000);
    expect(fired.ok).toBe(true);

    const rehiredTelemetry = store.recordTurn(
      'MACBOOK',
      '/proj',
      'proj',
      { outputTokensCumulative: 200 },
      DAY1 + 2000,
    );
    expect(rehiredTelemetry.id).not.toBe(first.id);
    expect(rehiredTelemetry.id).toBe(`${first.id}#1`);
    expect(rehiredTelemetry.status).toBe('candidate');

    // The original fired record is untouched and still fired.
    const original = store.getById(first.id, DAY1 + 3000);
    expect(original?.status).toBe('fired');
  });

  it('a natural quit does NOT blacklist — the same id auto-rehires on the next telemetry', () => {
    const store = new EmployeeStore(statePath, ledgerDir);
    const first = store.recordTurn(
      'MACBOOK',
      '/proj',
      'proj',
      { outputTokensCumulative: 100 },
      DAY1,
    );

    // Force the record into 'quit' directly (unit-testing the identity
    // resolution logic independent of the probabilistic quit roll, which
    // is covered separately below).
    const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    data.employees[first.id].status = 'quit';
    fs.writeFileSync(statePath, JSON.stringify(data), 'utf8');

    // Force-load path: construct a fresh store instance pointed at the
    // same file so it re-reads the mutated state from disk.
    const store2 = new EmployeeStore(statePath, ledgerDir);
    const revived = store2.recordTurn(
      'MACBOOK',
      '/proj',
      'proj',
      { outputTokensCumulative: 200 },
      DAY1 + 86_400_000,
    );
    expect(revived.id).toBe(first.id);
    expect(revived.status).toBe('active');
  });
});

describe('EmployeeStore quit mechanic (deterministic, mulberry32)', () => {
  it('halves XP (never resets to 1) on a quit', () => {
    const store = new EmployeeStore(statePath, ledgerDir);
    // Build up XP to a known level, then force the quit path by direct
    // manipulation of mood/lowMoodStreakDays via the persisted file,
    // re-derive expected halved xp from the SAME curve the store uses.
    let emp = store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 100 }, DAY1);
    for (let i = 0; i < 20; i++) {
      emp = store.recordTurn(
        'MACBOOK',
        '/proj',
        'proj',
        { outputTokensCumulative: 100 + i * 50 },
        DAY1 + i * 1000,
      );
    }
    const { level: levelBefore } = computeLevel(emp.xp, EMPLOYEE_LEVEL_CURVE);
    expect(levelBefore).toBeGreaterThan(1);

    // Force mood below threshold and the streak to grace, then let upkeep
    // roll deterministically across days until a quit fires or we exhaust
    // a generous day budget (the roll is seeded, so this is still
    // deterministic per day — just search forward for the day it lands).
    const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    data.employees[emp.id].mood = 0;
    data.employees[emp.id].lastMoodCheckDate = null;
    fs.writeFileSync(statePath, JSON.stringify(data), 'utf8');

    let quitEmployee;
    const store2 = new EmployeeStore(statePath, ledgerDir);
    for (let day = 1; day <= QUIT_GRACE_DAYS + 30; day++) {
      const now = DAY1 + day * ONE_DAY_MS;
      const all = store2.getAll(now);
      const found = all.find((e) => e.id === emp.id);
      if (found?.status === 'quit') {
        quitEmployee = found;
        break;
      }
    }
    expect(quitEmployee).toBeDefined();
    const expectedXp = xpForLevel(Math.max(1, Math.floor(levelBefore / 2)), EMPLOYEE_LEVEL_CURVE);
    expect(quitEmployee!.xp).toBe(expectedXp);
    expect(quitEmployee!.xp).toBeLessThan(emp.xp);
    // Never reset to level 1's zero baseline unless halving already lands there.
    if (levelBefore > 2) expect(quitEmployee!.xp).toBeGreaterThan(0);
  });

  it('mood at or above QUIT_THRESHOLD_MOOD never rolls a quit', () => {
    const store = new EmployeeStore(statePath, ledgerDir);
    let emp = store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 100 }, DAY1);
    const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    data.employees[emp.id].mood = QUIT_THRESHOLD_MOOD; // exactly at threshold, not below
    fs.writeFileSync(statePath, JSON.stringify(data), 'utf8');

    const store2 = new EmployeeStore(statePath, ledgerDir);
    let last = emp;
    for (let day = 1; day <= QUIT_GRACE_DAYS + 10; day++) {
      const all = store2.getAll(DAY1 + day * ONE_DAY_MS);
      last = all.find((e) => e.id === emp.id)!;
    }
    expect(last.status).not.toBe('quit');
  });

  // KICKOFF v1.1 item 6: applyUpkeep's quit roll used to only appendLedger()
  // directly — it never called finish() like every other mutation here, so
  // it silently skipped persist() and the onChange() broadcast. A quit that
  // never persists/broadcasts is invisible to the office view and lost on a
  // fresh page load (state re-read from disk would show 'active' forever).
  it('a quit roll persists to disk and fires the onChange broadcast — not just the ledger', () => {
    const store = new EmployeeStore(statePath, ledgerDir);
    // recordTurn auto-onboards candidate -> active after 3 turns — the quit
    // roll only ever fires for an 'active' employee, so drive past that
    // threshold before forcing mood=0 (same reason the "halves XP" test
    // above calls recordTurn well past 3 times).
    let emp = store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 100 }, DAY1);
    for (let i = 0; i < 3; i++) {
      emp = store.recordTurn(
        'MACBOOK',
        '/proj',
        'proj',
        { outputTokensCumulative: 100 + i * 50 },
        DAY1 + i * 1000,
      );
    }
    expect(emp.status).toBe('active');
    const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    // persist() is throttled (PERSIST_THROTTLE_MS) and these recordTurn calls
    // land within the same throttle window, so the on-disk snapshot can lag
    // the in-memory 'active' transition just asserted above — force status
    // explicitly rather than depend on persist-timing luck.
    data.employees[emp.id].status = 'active';
    data.employees[emp.id].mood = 0;
    data.employees[emp.id].lastMoodCheckDate = null;
    fs.writeFileSync(statePath, JSON.stringify(data), 'utf8');

    const store2 = new EmployeeStore(statePath, ledgerDir);
    const broadcasts: Array<{ id: string; status: string }> = [];
    store2.onChange((snapshot) => broadcasts.push({ id: snapshot.id, status: snapshot.status }));

    let quitEmployee;
    for (let day = 1; day <= QUIT_GRACE_DAYS + 30; day++) {
      const now = DAY1 + day * ONE_DAY_MS;
      const all = store2.getAll(now);
      const found = all.find((e) => e.id === emp.id);
      if (found?.status === 'quit') {
        quitEmployee = found;
        break;
      }
    }
    expect(quitEmployee).toBeDefined();

    // Broadcast: onChange must have fired with this employee's quit snapshot
    // — not just silently updated in-memory state.
    expect(broadcasts.some((b) => b.id === emp.id && b.status === 'quit')).toBe(true);

    // Persist: a FRESH store instance reading the SAME file must see the
    // quit too — proves persist() actually wrote it, not just that the
    // in-memory object we already hold happens to show 'quit'.
    const rereadStore = new EmployeeStore(statePath, ledgerDir);
    const reread = rereadStore.getById(emp.id, DAY1 + (QUIT_GRACE_DAYS + 30) * ONE_DAY_MS);
    expect(reread?.status).toBe('quit');
  });
});

describe('EmployeeStore.break_ never blocks real work (GAME-DESIGN §4.6 hard rule)', () => {
  it('an on_break employee record does not prevent unrelated real work from being enqueued elsewhere', () => {
    // employeeStore has zero coupling to dispatchStore by design — this
    // test proves the architectural invariant: putting an employee on
    // break only mutates employeeStore's own record.
    const store = new EmployeeStore(statePath, ledgerDir);
    const emp = store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 100 }, DAY1);
    store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 200 }, DAY1 + 1);
    const active = store.recordTurn(
      'MACBOOK',
      '/proj',
      'proj',
      { outputTokensCumulative: 300 },
      DAY1 + 2,
    );
    expect(active.status).toBe('active');

    const result = store.break_(active.id, DAY1 + 3000);
    expect(result.ok).toBe(true);
    expect((result as { ok: true; employee: { status: string } }).employee.status).toBe('on_break');

    // The record itself carries no field that any dispatch code path reads
    // — recordTurn (the same call a real dispatch-linked employee would
    // hit in G3) still succeeds against the same identity while on break.
    const stillWorks = store.recordTurn(
      'MACBOOK',
      '/proj',
      'proj',
      { outputTokensCumulative: 400 },
      DAY1 + 4000,
    );
    expect(stillWorks.id).toBe(emp.id);
  });
});

describe('EmployeeStore ledger rotation', () => {
  it('trims a ledger file to LEDGER_TRIM_TO_LINES once it exceeds LEDGER_MAX_LINES', () => {
    const store = new EmployeeStore(statePath, ledgerDir);
    let emp = store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 0 }, DAY1);
    // 1 (above) + 5000 (below) = 5001 total ledger appends -- crosses
    // LEDGER_MAX_LINES exactly once, triggering exactly one trim to
    // LEDGER_TRIM_TO_LINES (2500).
    for (let i = 0; i < 5000; i++) {
      emp = store.recordTurn(
        'MACBOOK',
        '/proj',
        'proj',
        { outputTokensCumulative: i },
        DAY1 + i * 10,
      );
    }
    const lines = store.history(emp.id, 100_000);
    expect(lines.length).toBeLessThanOrEqual(2500);
    expect(lines.length).toBeGreaterThan(0);
  }, 20_000);
});

describe('EmployeeStore XP sources', () => {
  it('recordCrisisResolved awards XP_CRISIS_RESOLVED and a +5 moodBoost', () => {
    const store = new EmployeeStore(statePath, ledgerDir);
    store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 100 }, DAY1);
    store.recordCrisisResolved('MACBOOK', '/proj', DAY1 + 1000);
    const emp = store.getAll(DAY1 + 2000).find((e) => e.projectDir === '/proj')!;
    expect(emp.xp).toBe(XP_TURN + XP_CRISIS_RESOLVED);
    expect(emp.moodBoost).toBeGreaterThan(0);
  });

  it('recordCrisisResolved applies an optional crisisXpBonusPct override (War Room buff, G2 §5.4), rounded like xpOverride — F2', () => {
    const store = new EmployeeStore(statePath, ledgerDir);
    store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 100 }, DAY1);
    // Unbuffed baseline.
    store.recordCrisisResolved('MACBOOK', '/proj', DAY1 + 1000);
    const unbuffed = store.getAll(DAY1 + 1500).find((e) => e.projectDir === '/proj')!;
    expect(unbuffed.xp).toBe(XP_TURN + XP_CRISIS_RESOLVED);

    // Second resolution, this time with the War Room bonus applied.
    store.recordCrisisResolved('MACBOOK', '/proj', DAY1 + 2000, WAR_ROOM_CRISIS_XP_BONUS_PCT);
    const buffed = store.getAll(DAY1 + 2500).find((e) => e.projectDir === '/proj')!;
    const expectedBonusedXp = Math.round(
      XP_CRISIS_RESOLVED * (1 + WAR_ROOM_CRISIS_XP_BONUS_PCT / 100),
    );
    expect(buffed.xp).toBe(unbuffed.xp + expectedBonusedXp);
    // The buffed award is measurably higher than the plain XP_CRISIS_RESOLVED.
    expect(expectedBonusedXp).toBeGreaterThan(XP_CRISIS_RESOLVED);
  });
});

describe('EmployeeStore.break_ — Break Room moodRegenMult (G2, GAME-DESIGN §5.4) — F2', () => {
  it('restores MOOD_BREAK_RESTORE * BREAK_ROOM_MOOD_REGEN_MULT when the desk is inside a Break Room; MOOD_BREAK_RESTORE only otherwise', () => {
    const layout = baseLayout({
      furniture: [desk('break-desk', 1, 1), desk('plain-desk', 15, 8)],
      rooms: [room(RoomType.BREAK_ROOM, 0, 0, 4, 4)],
    });
    vi.mocked(getOfficeLayout).mockReturnValue(layout);
    const store = new EmployeeStore(statePath, ledgerDir);

    function moodDeltaFromBreak(projectDir: string, deskUid: string): number {
      // 3 turns to reach 'active' (break_ requires it), then assign a desk,
      // then idle 100h so decay brings mood down from 70 with headroom
      // under the 100 cap for the x1.5 multiplier to actually show up.
      let emp = store.recordTurn(
        'MACBOOK',
        projectDir,
        projectDir,
        { outputTokensCumulative: 1 },
        DAY1,
      );
      emp = store.recordTurn(
        'MACBOOK',
        projectDir,
        projectDir,
        { outputTokensCumulative: 2 },
        DAY1 + 1000,
      );
      emp = store.recordTurn(
        'MACBOOK',
        projectDir,
        projectDir,
        { outputTokensCumulative: 3 },
        DAY1 + 2000,
      );
      expect(emp.status).toBe('active');
      store.assign(emp.id, deskUid, DAY1 + 3000);
      const farTime = DAY1 + 3000 + 100 * 3_600_000; // 100h idle
      const moodBefore = store.getById(emp.id, farTime)!.mood;
      const result = store.break_(emp.id, farTime);
      expect(result.ok).toBe(true);
      const moodAfter = (result as { ok: true; employee: { mood: number } }).employee.mood;
      return moodAfter - moodBefore;
    }

    const breakRoomDelta = moodDeltaFromBreak('/break-room-emp', 'break-desk');
    const plainDeskDelta = moodDeltaFromBreak('/plain-desk-emp', 'plain-desk');

    expect(breakRoomDelta).toBeCloseTo(MOOD_BREAK_RESTORE * BREAK_ROOM_MOOD_REGEN_MULT, 5);
    expect(plainDeskDelta).toBeCloseTo(MOOD_BREAK_RESTORE, 5);
    expect(breakRoomDelta).toBeGreaterThan(plainDeskDelta);
  });

  it('a missing layout degrades to the neutral MOOD_BREAK_RESTORE (never throws), even for an assigned desk', () => {
    vi.mocked(getOfficeLayout).mockReturnValue(null);
    const store = new EmployeeStore(statePath, ledgerDir);
    let emp = store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 1 }, DAY1);
    emp = store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 2 }, DAY1 + 1000);
    emp = store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 3 }, DAY1 + 2000);
    store.assign(emp.id, 'some-desk', DAY1 + 3000);
    const moodBefore = store.getById(emp.id, DAY1 + 4000)!.mood;
    let result: ReturnType<EmployeeStore['break_']> | undefined;
    expect(() => {
      result = store.break_(emp.id, DAY1 + 4000);
    }).not.toThrow();
    const moodAfter = (result as { ok: true; employee: { mood: number } }).employee.mood;
    expect(moodAfter - moodBefore).toBeCloseTo(MOOD_BREAK_RESTORE, 5);
  });
});

describe('EmployeeStore idle mood decay — Kitchen moodDecayMult (G2, GAME-DESIGN §5.4) — F2', () => {
  it('decays mood slower by moodDecayMult when a Kitchen exists anywhere in the layout (global, no desk needed)', () => {
    const store = new EmployeeStore(statePath, ledgerDir);
    const elapsedHours = 10;
    const laterNow = DAY1 + elapsedHours * 3_600_000;

    vi.mocked(getOfficeLayout).mockReturnValue(baseLayout());
    const noKitchen = store.recordTurn(
      'MACBOOK',
      '/no-kitchen',
      'no-kitchen',
      { outputTokensCumulative: 1 },
      DAY1,
    );
    const noKitchenMood = store.getById(noKitchen.id, laterNow)!.mood;
    expect(70 - noKitchenMood).toBeCloseTo(elapsedHours * MOOD_DECAY_PER_HOUR_IDLE, 5);

    vi.mocked(getOfficeLayout).mockReturnValue(
      baseLayout({ rooms: [room(RoomType.KITCHEN, 0, 0, 3, 3)] }),
    );
    const withKitchen = store.recordTurn(
      'MACBOOK',
      '/kitchen',
      'kitchen',
      { outputTokensCumulative: 1 },
      DAY1,
    );
    const withKitchenMood = store.getById(withKitchen.id, laterNow)!.mood;
    expect(70 - withKitchenMood).toBeCloseTo(
      elapsedHours * MOOD_DECAY_PER_HOUR_IDLE * KITCHEN_MOOD_DECAY_MULT,
      5,
    );

    // Measurably slower decay with a Kitchen present, over the identical window.
    expect(withKitchenMood).toBeGreaterThan(noKitchenMood);
  });

  it('a missing layout degrades to the neutral moodDecayMult of 1 (never throws)', () => {
    vi.mocked(getOfficeLayout).mockReturnValue(null);
    const store = new EmployeeStore(statePath, ledgerDir);
    const elapsedHours = 10;
    const laterNow = DAY1 + elapsedHours * 3_600_000;
    const emp = store.recordTurn('MACBOOK', '/proj', 'proj', { outputTokensCumulative: 1 }, DAY1);
    let mood: number | undefined;
    expect(() => {
      mood = store.getById(emp.id, laterNow)!.mood;
    }).not.toThrow();
    expect(70 - mood!).toBeCloseTo(elapsedHours * MOOD_DECAY_PER_HOUR_IDLE, 5);
  });
});

describe('EmployeeStore.train/.promote — Cash debit (GAME-DESIGN §3.1, §4.6) — F1', () => {
  /** 3 real turns -> auto-onboards 'candidate' to 'active' (same pattern as
   *  the F2 break_/idle-decay describe blocks above). An optional
   *  xpOverride on the first turn shortcuts leveling for promote tests
   *  without simulating hundreds of turns. */
  function activeEmployee(store: EmployeeStore, projectDir: string, xpOverride?: number): Employee {
    let emp = store.recordTurn(
      'MACBOOK',
      projectDir,
      projectDir,
      { outputTokensCumulative: 1, xpOverride },
      DAY1,
    );
    emp = store.recordTurn(
      'MACBOOK',
      projectDir,
      projectDir,
      { outputTokensCumulative: 2 },
      DAY1 + 1000,
    );
    emp = store.recordTurn(
      'MACBOOK',
      projectDir,
      projectDir,
      { outputTokensCumulative: 3 },
      DAY1 + 2000,
    );
    expect(emp.status).toBe('active');
    return emp;
  }

  it('train() debits TRAIN_COST_CASH on success and still applies the real training effect', () => {
    const spendCash = vi.fn(() => true);
    const store = new EmployeeStore(statePath, ledgerDir, { spendCash });
    const emp = activeEmployee(store, '/f1-train-ok');

    const result = store.train(emp.id, 'speed', DAY1 + 3000);

    expect(result.ok).toBe(true);
    expect(spendCash).toHaveBeenCalledTimes(1);
    expect(spendCash).toHaveBeenCalledWith(
      TRAIN_COST_CASH,
      expect.objectContaining({ label: 'train-speed' }),
      DAY1 + 3000,
    );
    const trained = (result as { ok: true; employee: Employee }).employee;
    expect(trained.trainingBonus.speed).toBe(2);
    expect(trained.moodBoost).toBe(3);
    expect(trained.lastTrainedDate).not.toBeNull();
  });

  it('train() refuses insufficient-cash and grants NOTHING — no trainingBonus/moodBoost, cooldown not consumed', () => {
    const spendCash = vi.fn(() => false);
    const store = new EmployeeStore(statePath, ledgerDir, { spendCash });
    const emp = activeEmployee(store, '/f1-train-refuse');
    const before = store.getById(emp.id, DAY1 + 3000)!;

    const result = store.train(emp.id, 'speed', DAY1 + 3000);

    expect(result).toEqual({ ok: false, reason: 'insufficient-cash' });
    expect(spendCash).toHaveBeenCalledWith(
      TRAIN_COST_CASH,
      expect.objectContaining({ label: 'train-speed' }),
      DAY1 + 3000,
    );
    const after = store.getById(emp.id, DAY1 + 3000)!;
    expect(after.trainingBonus).toEqual(before.trainingBonus);
    expect(after.moodBoost).toBe(before.moodBoost);
    expect(after.lastTrainedDate).toBeNull();

    // Cooldown genuinely untouched by the refusal: funds arriving later the
    // SAME day still let the once/day training succeed.
    spendCash.mockReturnValue(true);
    const retried = store.train(emp.id, 'speed', DAY1 + 4000);
    expect(retried.ok).toBe(true);
  });

  it("promote() debits 200 * nextTierIndex Cash (next tier's own 0-based RANK_TIERS index) and applies the rank/moodBoost", () => {
    const spendCash = vi.fn(() => true);
    const store = new EmployeeStore(statePath, ledgerDir, { spendCash });
    // xp=1700 clears level 10 (Lead's minLevel) up front so both
    // promotions below are level-gated OK; mood stays at the 70 default
    // (>= the 50 gate) across both quick promotions.
    const emp = activeEmployee(store, '/f1-promote-ok', 1700);

    // Junior(index 0) -> Senior(index 1): nextTierIndex 1, cost 200*1.
    const first = store.promote(emp.id, DAY1 + 3000);
    expect(first.ok).toBe(true);
    expect(spendCash).toHaveBeenNthCalledWith(
      1,
      PROMOTE_COST_PER_TIER * 1,
      expect.objectContaining({ label: 'promote-Senior' }),
      DAY1 + 3000,
    );
    expect((first as { ok: true; employee: Employee }).employee.rank).toBe('Senior');
    expect((first as { ok: true; employee: Employee }).employee.moodBoost).toBe(15);

    // Senior(index 1) -> Lead(index 2): nextTierIndex 2, cost 200*2.
    const second = store.promote(emp.id, DAY1 + 4000);
    expect(second.ok).toBe(true);
    expect(spendCash).toHaveBeenNthCalledWith(
      2,
      PROMOTE_COST_PER_TIER * 2,
      expect.objectContaining({ label: 'promote-Lead' }),
      DAY1 + 4000,
    );
    expect((second as { ok: true; employee: Employee }).employee.rank).toBe('Lead');
  });

  it('promote() refuses insufficient-cash and grants NOTHING — rank/moodBoost unchanged', () => {
    const spendCash = vi.fn(() => false);
    const store = new EmployeeStore(statePath, ledgerDir, { spendCash });
    const emp = activeEmployee(store, '/f1-promote-refuse', 1700);
    const before = store.getById(emp.id, DAY1 + 3000)!;

    const result = store.promote(emp.id, DAY1 + 3000);

    expect(result).toEqual({ ok: false, reason: 'insufficient-cash' });
    expect(spendCash).toHaveBeenCalledWith(
      PROMOTE_COST_PER_TIER * 1,
      expect.objectContaining({ label: 'promote-Senior' }),
      DAY1 + 3000,
    );
    const after = store.getById(emp.id, DAY1 + 3000)!;
    expect(after.rank).toBe(before.rank);
    expect(after.moodBoost).toBe(before.moodBoost);

    // Funds arriving later still let the same promotion succeed — no gate
    // was silently consumed by the refusal.
    spendCash.mockReturnValue(true);
    const retried = store.promote(emp.id, DAY1 + 4000);
    expect(retried.ok).toBe(true);
    expect((retried as { ok: true; employee: Employee }).employee.rank).toBe('Senior');
  });

  it('the process-wide employeeStore singleton wires spendCash to the real economyStore.spend (source-guard, F4-test-pattern precedent)', () => {
    // The default `spendCash` (permissive no-op, always succeeds) exists
    // ONLY for test-constructed instances — every test above proves the
    // gating logic against an explicit mock, none of them can observe
    // whether the process-wide singleton itself is still wired to the real
    // economyStore. A future edit that silently dropped `spendCash` from
    // the singleton's deps would fall back to that permissive default
    // (free training/promotion in production) with no other test catching
    // it. Same source-text-drift-guard technique as editorActions.test.ts's
    // PRICED_FURNITURE_TYPES regression test (F4) — reads the actual wiring
    // out of the source file rather than re-asserting a duplicated literal.
    expect(employeeStore).toBeInstanceOf(EmployeeStore);
    const src = fs.readFileSync(path.join(__dirname, '../src/employeeStore.ts'), 'utf8');
    const singletonBlock = src.slice(
      src.indexOf('export const employeeStore = new EmployeeStore('),
    );
    expect(singletonBlock).toMatch(/spendCash:\s*\([^)]*\)\s*=>\s*economyStore\.spend\(/);
  });
});

describe('VITEST guard (cloned from progressionStore.test.ts / dispatchRoutes.test.ts pattern)', () => {
  beforeEach(() => {
    vitestGuardHome = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-store-vitest-guard-'));
  });

  it('never writes the real default sidecar path under VITEST, even via the process-wide singleton', () => {
    // The process-wide `employeeStore` singleton is constructed with NO
    // explicit path — it resolves the DEFAULT path (mocked homedir here).
    // Force it to forget any prior state from other test files sharing
    // this singleton, then mutate it and assert no file appears at the
    // resolved default location.
    employeeStore.recordTurn(
      'MACBOOK',
      '/vitest-guard-proj',
      'proj',
      { outputTokensCumulative: 100 },
      DAY1,
    );
    const expectedPath = path.join(vitestGuardHome, '.pixel-agents', 'employees.json');
    expect(fs.existsSync(expectedPath)).toBe(false);
  });
});
