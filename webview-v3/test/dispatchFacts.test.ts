import { describe, expect, it } from 'vitest';

import {
  buildCopyIdLine,
  canKillAgent,
  type DispatchMachine,
  machineHasLiveRunner,
  machineSupportsSessions,
} from '../src/net/dispatchFacts';

const MACHINES: DispatchMachine[] = [
  {
    machine: 'MACBOOK',
    providers: ['claude'],
    roots: ['/Users/greg/code'],
    focus: true,
    sessions: true,
  },
  { machine: 'NEXUS', providers: ['claude'], roots: ['/data'], focus: false, sessions: false },
];

describe('buildCopyIdLine', () => {
  it('joins machine · cwd · session id', () => {
    expect(buildCopyIdLine('MACBOOK', '/Users/greg/code/war-room', 'sess-1')).toBe(
      'MACBOOK · /Users/greg/code/war-room · sess-1',
    );
  });

  it('renders missing fields honestly instead of dropping separators', () => {
    expect(buildCopyIdLine(undefined, undefined, undefined)).toBe(
      '(no machine) · (no cwd) · (no session id)',
    );
  });
});

describe('machineHasLiveRunner / canKillAgent', () => {
  it('kill needs BOTH a pid and a live runner on that machine', () => {
    expect(canKillAgent(42, MACHINES, 'MACBOOK')).toBe(true);
    expect(canKillAgent(undefined, MACHINES, 'MACBOOK')).toBe(false);
    expect(canKillAgent(42, MACHINES, 'GHOST')).toBe(false);
    expect(canKillAgent(42, [], 'MACBOOK')).toBe(false);
  });

  it('kill is NOT gated on the focus capability flag (NEXUS advertises focus:false)', () => {
    expect(canKillAgent(42, MACHINES, 'NEXUS')).toBe(true);
  });

  it('no machine label → no runner', () => {
    expect(machineHasLiveRunner(MACHINES, undefined)).toBe(false);
  });
});

describe('machineSupportsSessions (T2/T4 CALL modal session mode)', () => {
  it('deny-by-default: only true when the advertisement carries sessions:true', () => {
    expect(machineSupportsSessions(MACHINES, 'MACBOOK')).toBe(true);
    expect(machineSupportsSessions(MACHINES, 'NEXUS')).toBe(false);
    expect(machineSupportsSessions(MACHINES, 'GHOST')).toBe(false);
    expect(machineSupportsSessions(MACHINES, undefined)).toBe(false);
    expect(machineSupportsSessions([], 'MACBOOK')).toBe(false);
  });
});
