/**
 * Rivalry & Bond derivation tests (v3 WS-C stage 2): the live checkout-
 * overlap sweep (same-machine nested cwds → activeWarning rivalry — the
 * 74d74e8 incident class; cross-machine name match → soft rivalry),
 * warning clearance when the overlap disappears, the self-pair honesty
 * limitation, collaboration bonds from COMPLETED runs only (with per-run
 * dedupe), and the priority rule: a bond never overwrites a live warning.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { employeeId } from '../../core/src/employeeId.js';
import type { ChainRun, ChainStepRun } from '../src/chainStore.js';
import type { DispatchStore } from '../src/dispatchStore.js';
import { BOND_COLLABORATION_THRESHOLD, RivalryDerivation } from '../src/rivalryDerivation.js';
import { RivalryStore } from '../src/rivalryStore.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rivalry-derivation-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const noopChains = { onRunUpdate: () => () => {} };

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

function makeDerivation(dispatchRecords: Record<string, { machine: string; cwd: string }> = {}) {
  const rivalries = new RivalryStore(path.join(tmpDir, 'rivalries.json'));
  const derivation = new RivalryDerivation(
    rivalries,
    noopChains,
    lookupFor(dispatchRecords),
    path.join(tmpDir, 'rivalry-collab.json'),
  );
  return { rivalries, derivation };
}

function completedRun(id: string, dispatchIds: string[]): ChainRun {
  const steps: ChainStepRun[] = dispatchIds.map((dispatchId, i) => ({
    stepId: `s-${i}`,
    dispatchId,
    status: 'exited',
    exitCode: 0,
  }));
  return {
    id,
    chainId: 'chain-1',
    status: 'completed',
    currentStep: steps.length - 1,
    steps,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('RivalryDerivation.sweepLiveOverlap — the collision early warning', () => {
  it('flags nested live cwds on one machine as an activeWarning rivalry with verbatim evidence', () => {
    const { rivalries, derivation } = makeDerivation();
    derivation.sweepLiveOverlap(
      [
        { machine: 'MACBOOK', projectDir: '/code/war-room', sessionId: 'sess-outer-1' },
        { machine: 'MACBOOK', projectDir: '/code/war-room/server', sessionId: 'sess-inner-2' },
      ],
      'MACBOOK',
      1000,
    );
    const pairs = rivalries.getAll();
    expect(pairs).toHaveLength(1);
    expect(pairs[0].kind).toBe('rivalry');
    expect(pairs[0].activeWarning).toBe(true);
    expect(pairs[0].staffIds).toEqual(
      [
        employeeId('MACBOOK', '/code/war-room'),
        employeeId('MACBOOK', '/code/war-room/server'),
      ].sort(),
    );
    expect(pairs[0].evidence[0]).toContain('/code/war-room');
    expect(pairs[0].evidence[0]).toContain('/code/war-room/server');
    expect(pairs[0].evidence[0]).toContain('sess-out'); // session id fragment
  });

  it('clears the warning (keeps the pair) once the live overlap is gone', () => {
    const { rivalries, derivation } = makeDerivation();
    const agents = [
      { machine: 'MACBOOK', projectDir: '/code/war-room', sessionId: 's1' },
      { machine: 'MACBOOK', projectDir: '/code/war-room/server', sessionId: 's2' },
    ];
    derivation.sweepLiveOverlap(agents, 'MACBOOK', 1000);
    expect(rivalries.getAll()[0].activeWarning).toBe(true);

    derivation.sweepLiveOverlap([agents[0]], 'MACBOOK', 2000);
    const pairs = rivalries.getAll();
    expect(pairs).toHaveLength(1); // history retained
    expect(pairs[0].activeWarning).toBe(false); // live signal dropped
  });

  it('HONESTY LIMITATION: two agents in the LITERAL same cwd share one identity — no pair', () => {
    const { rivalries, derivation } = makeDerivation();
    derivation.sweepLiveOverlap(
      [
        { machine: 'MACBOOK', projectDir: '/code/war-room', sessionId: 's1' },
        { machine: 'MACBOOK', projectDir: '/code/war-room', sessionId: 's2' },
      ],
      'MACBOOK',
      1000,
    );
    expect(rivalries.getAll()).toHaveLength(0);
  });

  it('sibling dirs that merely share a path prefix STRING are not one checkout', () => {
    const { rivalries, derivation } = makeDerivation();
    derivation.sweepLiveOverlap(
      [
        { machine: 'MACBOOK', projectDir: '/code/war-room', sessionId: 's1' },
        { machine: 'MACBOOK', projectDir: '/code/war-room-wt', sessionId: 's2' },
      ],
      'MACBOOK',
      1000,
    );
    expect(rivalries.getAll().filter((p) => p.activeWarning)).toHaveLength(0);
  });

  it('same project name live on two machines → soft rivalry (no warning), honestly labeled', () => {
    const { rivalries, derivation } = makeDerivation();
    derivation.sweepLiveOverlap(
      [
        { machine: 'MACBOOK', projectDir: '/Users/greg/code/turf', sessionId: 's1' },
        { machine: 'NEXUS', projectDir: '/srv/code/turf', sessionId: 's2' },
      ],
      'MACBOOK',
      1000,
    );
    const pairs = rivalries.getAll();
    expect(pairs).toHaveLength(1);
    expect(pairs[0].kind).toBe('rivalry');
    expect(pairs[0].activeWarning).toBe(false);
    expect(pairs[0].evidence[0]).toContain('basename match');
  });

  it('unrelated live agents derive nothing', () => {
    const { rivalries, derivation } = makeDerivation();
    derivation.sweepLiveOverlap(
      [
        { machine: 'MACBOOK', projectDir: '/code/alpha', sessionId: 's1' },
        { machine: 'MACBOOK', projectDir: '/code/beta', sessionId: 's2' },
      ],
      'MACBOOK',
      1000,
    );
    expect(rivalries.getAll()).toHaveLength(0);
  });
});

describe('RivalryDerivation — bonds from repeated successful collaboration', () => {
  const records = {
    'd-a': { machine: 'MACBOOK', cwd: '/code/shared' },
    'd-b': { machine: 'NEXUS', cwd: '/code/shared' },
  };
  const staffA = employeeId('MACBOOK', '/code/shared');
  const staffB = employeeId('NEXUS', '/code/shared');

  it('bonds a pair after the threshold of COMPLETED sequential handoffs, with run refs', () => {
    const { rivalries, derivation } = makeDerivation(records);
    for (let i = 0; i < BOND_COLLABORATION_THRESHOLD - 1; i++) {
      derivation.recordCollaboration(completedRun(`run-${i}`, ['d-a', 'd-b']), 1000 + i);
    }
    expect(rivalries.getAll()).toHaveLength(0); // below threshold — nothing yet

    derivation.recordCollaboration(completedRun('run-final', ['d-a', 'd-b']), 2000);
    const pairs = rivalries.getAll();
    expect(pairs).toHaveLength(1);
    expect(pairs[0].kind).toBe('bond');
    expect(pairs[0].activeWarning).toBe(false);
    expect(pairs[0].staffIds).toEqual([staffA, staffB].sort());
    expect(pairs[0].evidence.some((e) => e.startsWith('chainRun:run-'))).toBe(true);
  });

  it('the same run replayed never counts twice, and non-completed runs never count', () => {
    const { rivalries, derivation } = makeDerivation(records);
    const one = completedRun('run-dup', ['d-a', 'd-b']);
    for (let i = 0; i < 10; i++) derivation.recordCollaboration(one, 1000 + i);
    expect(rivalries.getAll()).toHaveLength(0); // one real run ≠ three

    const failed = { ...completedRun('run-failed', ['d-a', 'd-b']), status: 'failed' as const };
    derivation.recordCollaboration(failed, 5000);
    derivation.recordCollaboration(
      { ...completedRun('run-halted', ['d-a', 'd-b']), status: 'halted' as const },
      6000,
    );
    expect(rivalries.getAll()).toHaveLength(0);
  });

  it('consecutive steps by the SAME staff are not a collaboration', () => {
    const { rivalries, derivation } = makeDerivation({
      'd-a': records['d-a'],
      'd-a2': records['d-a'],
    });
    for (let i = 0; i < BOND_COLLABORATION_THRESHOLD + 1; i++) {
      derivation.recordCollaboration(completedRun(`run-${i}`, ['d-a', 'd-a2']), 1000 + i);
    }
    expect(rivalries.getAll()).toHaveLength(0);
  });

  it('SAFETY-NET PRIORITY: a bond never overwrites a pair while its warning is active', () => {
    // Same pair identity for both signals: nested cwds on one machine.
    const nestedRecords = {
      'd-outer': { machine: 'MACBOOK', cwd: '/code/war-room' },
      'd-inner': { machine: 'MACBOOK', cwd: '/code/war-room/server' },
    };
    const { rivalries, derivation } = makeDerivation(nestedRecords);
    const agents = [
      { machine: 'MACBOOK', projectDir: '/code/war-room', sessionId: 's1' },
      { machine: 'MACBOOK', projectDir: '/code/war-room/server', sessionId: 's2' },
    ];
    derivation.sweepLiveOverlap(agents, 'MACBOOK', 1000);
    expect(rivalries.getAll()[0].activeWarning).toBe(true);

    for (let i = 0; i < BOND_COLLABORATION_THRESHOLD; i++) {
      derivation.recordCollaboration(completedRun(`run-${i}`, ['d-outer', 'd-inner']), 2000 + i);
    }
    const warned = rivalries.getAll()[0];
    expect(warned.kind).toBe('rivalry'); // the live warning outranks the bond
    expect(warned.activeWarning).toBe(true);

    // Once the warning clears, the NEXT completed collaboration bonds them.
    derivation.sweepLiveOverlap([agents[0]], 'MACBOOK', 9000);
    derivation.recordCollaboration(completedRun('run-post', ['d-outer', 'd-inner']), 10_000);
    const after = rivalries.getAll()[0];
    expect(after.kind).toBe('bond');
    expect(after.activeWarning).toBe(false);
  });
});
