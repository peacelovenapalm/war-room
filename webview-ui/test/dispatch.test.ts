/**
 * Unit tests for dispatch.ts's pure helpers — the tray/reducer/drawer logic
 * for mechanic #6b ("call a coworker"). No rendering harness exists in this
 * workspace (vitest runs with `environment: 'node'`); these cover status
 * chip completeness, the auto-clear/sticky-denied timing rule, the entry
 * reducer, and the drawer's copy-id + focus-availability helpers directly.
 */

import { describe, expect, it } from 'vitest';

import {
  buildCopyIdLine,
  dismissDispatchEntry,
  DISPATCH_STATUS_CHIPS,
  DISPATCH_STATUSES,
  dispatchChipLabel,
  type DispatchEntry,
  machineSupportsFocus,
  promptRemaining,
  pruneDispatchEntries,
  shouldAutoClear,
  upsertDispatchEntry,
} from '../src/dispatch.js';

describe('DISPATCH_STATUS_CHIPS (colorblind regression guard)', () => {
  it('gives every status a distinct glyph + a WORD', () => {
    const glyphs = new Set<string>();
    for (const status of DISPATCH_STATUSES) {
      const spec = DISPATCH_STATUS_CHIPS[status];
      expect(spec.glyph.trim(), `${status} missing glyph`).toBeTruthy();
      expect(spec.word.trim(), `${status} missing word`).toBeTruthy();
      expect(glyphs.has(spec.glyph), `${status} reuses a glyph — not colorblind-distinct`).toBe(
        false,
      );
      glyphs.add(spec.glyph);
    }
  });
});

describe('shouldAutoClear', () => {
  it('never auto-clears RINGING', () => {
    expect(shouldAutoClear('ringing', 10 * 60_000)).toBe(false);
  });

  it('never auto-clears ANSWERED', () => {
    expect(shouldAutoClear('answered', 10 * 60_000)).toBe(false);
  });

  it('never auto-clears DENIED (sticky — dismiss only)', () => {
    expect(shouldAutoClear('denied', 10 * 60_000)).toBe(false);
  });

  it('keeps EXPIRED under the auto-clear age', () => {
    expect(shouldAutoClear('expired', 59_000)).toBe(false);
  });

  it('clears EXPIRED past the auto-clear age', () => {
    expect(shouldAutoClear('expired', 60_000)).toBe(true);
  });

  it('clears EXITED past the auto-clear age', () => {
    expect(shouldAutoClear('exited', 61_000)).toBe(true);
  });
});

describe('dispatchChipLabel', () => {
  it('renders a plain RINGING chip', () => {
    expect(dispatchChipLabel({ status: 'ringing', reason: undefined, exitCode: undefined })).toBe(
      '◎ RINGING',
    );
  });

  it('appends the reason to a DENIED chip', () => {
    expect(
      dispatchChipLabel({ status: 'denied', reason: 'path-not-allowlisted', exitCode: undefined }),
    ).toBe('⊘ DENIED — path-not-allowlisted');
  });

  it('renders DENIED without a reason plainly', () => {
    expect(dispatchChipLabel({ status: 'denied', reason: undefined, exitCode: undefined })).toBe(
      '⊘ DENIED',
    );
  });

  it('appends the exit code to an EXITED chip', () => {
    expect(dispatchChipLabel({ status: 'exited', reason: undefined, exitCode: 0 })).toBe(
      '■ EXITED (code 0)',
    );
  });

  it('renders EXITED without a code plainly', () => {
    expect(dispatchChipLabel({ status: 'exited', reason: undefined, exitCode: undefined })).toBe(
      '■ EXITED',
    );
  });
});

describe('upsertDispatchEntry', () => {
  it('inserts a new entry', () => {
    const result = upsertDispatchEntry(
      [],
      { id: 'a', action: 'dispatch', status: 'ringing', machine: 'MACBOOK' },
      1000,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'a', status: 'ringing', receivedAt: 1000 });
  });

  it('updates an existing entry in place (lifecycle transition)', () => {
    const entries: DispatchEntry[] = [
      { id: 'a', action: 'dispatch', status: 'ringing', machine: 'MACBOOK', receivedAt: 1000 },
    ];
    const result = upsertDispatchEntry(
      entries,
      { id: 'a', action: 'dispatch', status: 'answered', machine: 'MACBOOK' },
      2000,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ status: 'answered', receivedAt: 2000 });
  });
});

describe('pruneDispatchEntries', () => {
  it('drops auto-clearable entries and keeps the rest', () => {
    const entries: DispatchEntry[] = [
      { id: 'ringing', action: 'dispatch', status: 'ringing', machine: 'M', receivedAt: 0 },
      { id: 'denied', action: 'dispatch', status: 'denied', machine: 'M', receivedAt: 0 },
      { id: 'expired-old', action: 'dispatch', status: 'expired', machine: 'M', receivedAt: 0 },
      {
        id: 'expired-fresh',
        action: 'dispatch',
        status: 'expired',
        machine: 'M',
        receivedAt: 61_000,
      },
    ];
    const result = pruneDispatchEntries(entries, 61_000);
    const ids = result.map((e) => e.id);
    expect(ids).toContain('ringing');
    expect(ids).toContain('denied');
    expect(ids).toContain('expired-fresh');
    expect(ids).not.toContain('expired-old');
  });
});

describe('dismissDispatchEntry', () => {
  it('removes only the dismissed id', () => {
    const entries: DispatchEntry[] = [
      { id: 'a', action: 'dispatch', status: 'denied', machine: 'M', receivedAt: 0 },
      { id: 'b', action: 'dispatch', status: 'denied', machine: 'M', receivedAt: 0 },
    ];
    const result = dismissDispatchEntry(entries, 'a');
    expect(result.map((e) => e.id)).toEqual(['b']);
  });
});

describe('promptRemaining', () => {
  it('counts down from the 4000-char cap', () => {
    expect(promptRemaining('hello')).toBe(3995);
  });

  it('goes negative once over the cap', () => {
    expect(promptRemaining('x'.repeat(4001))).toBe(-1);
  });
});

describe('buildCopyIdLine', () => {
  it('joins machine, cwd, and session id', () => {
    expect(buildCopyIdLine('MACBOOK', '/Users/greg/code/war-room', 'sess-123')).toBe(
      'MACBOOK · /Users/greg/code/war-room · sess-123',
    );
  });

  it('renders missing fields honestly instead of silently dropping them', () => {
    expect(buildCopyIdLine(undefined, undefined, undefined)).toBe(
      '(no machine) · (no cwd) · (no session id)',
    );
  });
});

describe('machineSupportsFocus', () => {
  const machines = [
    { machine: 'MACBOOK', providers: ['claude'], roots: ['/x'], focus: true },
    { machine: 'MINI', providers: ['claude'], roots: ['/y'], focus: false },
  ];

  it('is true for a machine with a live runner advertising focus', () => {
    expect(machineSupportsFocus(machines, 'MACBOOK')).toBe(true);
  });

  it('is false for a machine that has not enabled focus', () => {
    expect(machineSupportsFocus(machines, 'MINI')).toBe(false);
  });

  it('is false for a machine with no runner at all', () => {
    expect(machineSupportsFocus(machines, 'NEXUS')).toBe(false);
  });

  it('is false when no machine is given', () => {
    expect(machineSupportsFocus(machines, undefined)).toBe(false);
  });
});
