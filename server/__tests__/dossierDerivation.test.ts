/**
 * Dossier derivation tests (v3 WS-C stage 2): staff-lineage identity,
 * session dedupe, real-history accumulation, and every trait THRESHOLD
 * RULE at its boundary — including the honesty edges (no trait without
 * enough real samples, every earned trait carries its triggering event
 * refs, bounce/kill inside the window blocks Steady Hands).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { employeeId } from '../../core/src/employeeId.js';
import type { DispatchBroadcast, DispatchStore } from '../src/dispatchStore.js';
import {
  BOUNCE_WINDOW_MS,
  CLOSER_FAST_MS,
  DossierDerivation,
  NIGHT_OWL_MIN_TURNS,
  STEADY_HANDS_MIN_EXITS,
  TRAIT_BIG_SPENDER,
  TRAIT_NIGHT_OWL,
  TRAIT_STEADY_HANDS,
  TRAIT_THE_CLOSER,
} from '../src/dossierDerivation.js';
import { DossierStore } from '../src/dossierStore.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dossier-derivation-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const MACHINE = 'NEXUS';
const PROJECT = '/code/war-room';
const STAFF_ID = employeeId(MACHINE, PROJECT);

/** A local-time timestamp at the given hour (night vs day control). */
function atHour(hour: number, minute = 0): number {
  return new Date(2026, 6, 10, hour, minute).getTime();
}

function makeDerivation() {
  const dossiers = new DossierStore(path.join(tmpDir, 'dossiers.json'));
  const derivation = new DossierDerivation(
    dossiers,
    path.join(tmpDir, 'dossier-telemetry.json'),
    () => 'Sam Vimes',
  );
  return { dossiers, derivation };
}

function traitNames(dossiers: DossierStore, staffId = STAFF_ID): string[] {
  return (dossiers.get(staffId)?.traits ?? []).map((t) => t.name);
}

/** Fake dispatch-record lookup (Pick<DispatchStore, 'getRecord'>). */
function lookupFor(
  records: Record<string, { machine: string; cwd: string }>,
): Pick<DispatchStore, 'getRecord'> {
  return {
    getRecord: (id: string) =>
      records[id]
        ? ({ ...records[id], status: 'exited' } as ReturnType<DispatchStore['getRecord']>)
        : undefined,
  };
}

function terminal(id: string, status: 'exited' | 'killed', exitCode?: number): DispatchBroadcast {
  return { type: 'dispatchUpdate', id, action: 'dispatch', status, machine: MACHINE, exitCode };
}

describe('DossierDerivation — identity + history', () => {
  it('keys the dossier by the (machine, project) lineage and dedupes sessions by id', () => {
    const { dossiers, derivation } = makeDerivation();
    derivation.recordSession(MACHINE, PROJECT, 'war-room', 'sess-1', atHour(10));
    derivation.recordSession(MACHINE, PROJECT, 'war-room', 'sess-1', atHour(11)); // dup
    derivation.recordSession(MACHINE, PROJECT, 'war-room', 'sess-2', atHour(12));

    const dossier = dossiers.get(STAFF_ID);
    expect(dossier).toBeDefined();
    expect(dossier!.displayName).toBe('Sam Vimes');
    expect(derivation.getTelemetry(STAFF_ID)!.sessions).toBe(2);
    expect(dossier!.history).toContain('2 sessions');
  });

  it('accumulates turns, token burn, crises, kills, and bounces into the history line', () => {
    const { dossiers, derivation } = makeDerivation();
    derivation.recordTurn(MACHINE, PROJECT, 'war-room', 1_000, atHour(10));
    derivation.recordTurn(MACHINE, PROJECT, 'war-room', 3_500, atHour(11));
    derivation.recordCrisisResolved(MACHINE, PROJECT, 1, 120_000, atHour(12));
    derivation.onDispatchUpdate(
      terminal('d-kill', 'killed'),
      lookupFor({ 'd-kill': { machine: MACHINE, cwd: PROJECT } }),
      atHour(13),
    );

    const history = dossiers.get(STAFF_ID)!.history;
    expect(history).toContain('2 turns');
    expect(history).toContain('1 crises resolved (mean unblock 120s)');
    expect(history).toContain('1 kills');
    expect(history).toContain('3.5k output tokens');
  });

  it('detects a bounce: re-block within the window of a resolution', () => {
    const { derivation } = makeDerivation();
    const t0 = atHour(10);
    derivation.recordCrisisResolved(MACHINE, PROJECT, 1, 30_000, t0);
    derivation.recordCrisisStarted(MACHINE, PROJECT, 1, t0 + BOUNCE_WINDOW_MS - 1);
    expect(derivation.getTelemetry(STAFF_ID)!.bounces).toHaveLength(1);

    // A re-block AT/after the window is a fresh crisis, not a bounce.
    derivation.recordCrisisResolved(MACHINE, PROJECT, 1, 30_000, t0 + 3_600_000);
    derivation.recordCrisisStarted(MACHINE, PROJECT, 1, t0 + 3_600_000 + BOUNCE_WINDOW_MS);
    expect(derivation.getTelemetry(STAFF_ID)!.bounces).toHaveLength(1);
  });
});

describe('DossierDerivation — Night Owl (>60% of ≥20 turns at 22:00–05:59)', () => {
  it('earns at the documented threshold with real turn refs', () => {
    const { dossiers, derivation } = makeDerivation();
    for (let i = 0; i < NIGHT_OWL_MIN_TURNS; i++) {
      derivation.recordTurn(MACHINE, PROJECT, 'war-room', i * 10, atHour(23, i));
    }
    expect(traitNames(dossiers)).toContain(TRAIT_NIGHT_OWL);
    const trait = dossiers.get(STAFF_ID)!.traits.find((t) => t.name === TRAIT_NIGHT_OWL)!;
    expect(trait.earnedFrom.length).toBeGreaterThan(0);
    expect(trait.earnedFrom[0]).toMatch(/^turn:/);
  });

  it('does not earn below the sample floor (19 night turns)', () => {
    const { dossiers, derivation } = makeDerivation();
    for (let i = 0; i < NIGHT_OWL_MIN_TURNS - 1; i++) {
      derivation.recordTurn(MACHINE, PROJECT, 'war-room', i * 10, atHour(23, i));
    }
    expect(traitNames(dossiers)).not.toContain(TRAIT_NIGHT_OWL);
  });

  it('does not earn at EXACTLY 60% night fraction (rule is strictly greater)', () => {
    const { dossiers, derivation } = makeDerivation();
    for (let i = 0; i < 12; i++) derivation.recordTurn(MACHINE, PROJECT, 'p', i, atHour(23, i));
    for (let i = 0; i < 8; i++)
      derivation.recordTurn(MACHINE, PROJECT, 'p', 200 + i, atHour(14, i));
    expect(derivation.getTelemetry(STAFF_ID)!.turns).toBe(20);
    expect(traitNames(dossiers)).not.toContain(TRAIT_NIGHT_OWL);
  });
});

describe('DossierDerivation — The Closer (>5 sub-60s observed resolutions)', () => {
  it('earns on the 6th fast resolution, never the 5th', () => {
    const { dossiers, derivation } = makeDerivation();
    for (let i = 0; i < 5; i++) {
      derivation.recordCrisisResolved(MACHINE, PROJECT, i, CLOSER_FAST_MS - 1, atHour(9, i));
    }
    expect(traitNames(dossiers)).not.toContain(TRAIT_THE_CLOSER);
    derivation.recordCrisisResolved(MACHINE, PROJECT, 9, CLOSER_FAST_MS - 1, atHour(10));
    expect(traitNames(dossiers)).toContain(TRAIT_THE_CLOSER);
    const trait = dossiers.get(STAFF_ID)!.traits.find((t) => t.name === TRAIT_THE_CLOSER)!;
    expect(trait.earnedFrom.some((r) => r.startsWith('crisis:agent:'))).toBe(true);
  });

  it('slow resolutions (≥60s) never count toward it', () => {
    const { dossiers, derivation } = makeDerivation();
    for (let i = 0; i < 10; i++) {
      derivation.recordCrisisResolved(MACHINE, PROJECT, i, CLOSER_FAST_MS, atHour(9, i));
    }
    expect(traitNames(dossiers)).not.toContain(TRAIT_THE_CLOSER);
  });
});

describe('DossierDerivation — Big Spender (top-quartile burn, ≥4 staff)', () => {
  it('earns only for the top-quartile staff once enough staff have burn on record', () => {
    const { dossiers, derivation } = makeDerivation();
    const burns: Array<[string, number]> = [
      ['/p/one', 1_000],
      ['/p/two', 2_000],
      ['/p/three', 3_000],
      ['/p/four', 90_000],
    ];
    for (const [dir, tokens] of burns) {
      derivation.recordTurn(MACHINE, dir, path.basename(dir), tokens, atHour(9));
    }
    // Re-touch the top burner so the cross-staff rule re-evaluates with all
    // four on record (real life: evaluation runs on every event anyway).
    derivation.recordTurn(MACHINE, '/p/four', 'four', 90_000, atHour(10));

    expect(traitNames(dossiers, employeeId(MACHINE, '/p/four'))).toContain(TRAIT_BIG_SPENDER);
    expect(traitNames(dossiers, employeeId(MACHINE, '/p/one'))).not.toContain(TRAIT_BIG_SPENDER);
  });

  it('never fires with fewer than 4 staff on record (a quartile of 3 is noise)', () => {
    const { dossiers, derivation } = makeDerivation();
    for (const dir of ['/p/one', '/p/two', '/p/three']) {
      derivation.recordTurn(MACHINE, dir, path.basename(dir), 50_000, atHour(9));
    }
    for (const dir of ['/p/one', '/p/two', '/p/three']) {
      expect(traitNames(dossiers, employeeId(MACHINE, dir))).not.toContain(TRAIT_BIG_SPENDER);
    }
  });
});

describe('DossierDerivation — Steady Hands (14-day zero-bounce streak with real work)', () => {
  const lookup = lookupFor({
    'd-1': { machine: MACHINE, cwd: PROJECT },
    'd-2': { machine: MACHINE, cwd: PROJECT },
    'd-3': { machine: MACHINE, cwd: PROJECT },
    'd-4': { machine: MACHINE, cwd: PROJECT },
    'd-5': { machine: MACHINE, cwd: PROJECT },
    'd-kill': { machine: MACHINE, cwd: PROJECT },
  });

  it('earns after ≥5 in-window dispatch exits with zero bounces/kills', () => {
    const { dossiers, derivation } = makeDerivation();
    const base = atHour(9);
    for (let i = 1; i <= STEADY_HANDS_MIN_EXITS; i++) {
      derivation.onDispatchUpdate(terminal(`d-${i}`, 'exited', 0), lookup, base + i * 1000);
    }
    expect(traitNames(dossiers)).toContain(TRAIT_STEADY_HANDS);
    const trait = dossiers.get(STAFF_ID)!.traits.find((t) => t.name === TRAIT_STEADY_HANDS)!;
    expect(trait.earnedFrom.every((r) => r.startsWith('dispatch:'))).toBe(true);
  });

  it('HONESTY EDGE: a bounce inside the window blocks it (work must be steady, not absent)', () => {
    const { dossiers, derivation } = makeDerivation();
    const base = atHour(9);
    derivation.recordCrisisResolved(MACHINE, PROJECT, 1, 30_000, base);
    derivation.recordCrisisStarted(MACHINE, PROJECT, 1, base + 60_000); // bounce
    for (let i = 1; i <= STEADY_HANDS_MIN_EXITS; i++) {
      derivation.onDispatchUpdate(terminal(`d-${i}`, 'exited', 0), lookup, base + i * 100_000);
    }
    expect(traitNames(dossiers)).not.toContain(TRAIT_STEADY_HANDS);
  });

  it('a kill inside the window blocks it too', () => {
    const { dossiers, derivation } = makeDerivation();
    const base = atHour(9);
    derivation.onDispatchUpdate(terminal('d-kill', 'killed'), lookup, base);
    for (let i = 1; i <= STEADY_HANDS_MIN_EXITS; i++) {
      derivation.onDispatchUpdate(terminal(`d-${i}`, 'exited', 0), lookup, base + i * 1000);
    }
    expect(traitNames(dossiers)).not.toContain(TRAIT_STEADY_HANDS);
  });

  it('fewer than 5 in-window exits never mints it (the activity floor)', () => {
    const { dossiers, derivation } = makeDerivation();
    const base = atHour(9);
    for (let i = 1; i <= STEADY_HANDS_MIN_EXITS - 1; i++) {
      derivation.onDispatchUpdate(terminal(`d-${i}`, 'exited', 0), lookup, base + i * 1000);
    }
    expect(traitNames(dossiers)).not.toContain(TRAIT_STEADY_HANDS);
  });
});

describe('DossierDerivation — trait permanence', () => {
  it('an earned trait is stored exactly once across repeated evaluations', () => {
    const { dossiers, derivation } = makeDerivation();
    for (let i = 0; i < NIGHT_OWL_MIN_TURNS + 10; i++) {
      derivation.recordTurn(MACHINE, PROJECT, 'war-room', i * 10, atHour(23, i % 60));
    }
    const owls = dossiers.get(STAFF_ID)!.traits.filter((t) => t.name === TRAIT_NIGHT_OWL);
    expect(owls).toHaveLength(1);
  });
});
