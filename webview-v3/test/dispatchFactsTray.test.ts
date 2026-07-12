import { describe, expect, it } from 'vitest';

import {
  clearTerminalDispatchEntries,
  detectSendFailures,
  dismissDispatchEntry,
  dispatchChipLabel,
  type DispatchEntry,
  hasViewableResult,
  isTerminalDispatchStatus,
  joinRootSubpath,
  machineSupportsFocus,
  type PendingSend,
  promptRemaining,
  pruneDispatchEntries,
  shouldAutoClear,
  splitCwdIntoRootSubpath,
  upsertDispatchEntry,
} from '../src/net/dispatchFacts';

function entry(overrides: Partial<DispatchEntry> = {}): DispatchEntry {
  return {
    id: 'd1',
    action: 'dispatch',
    status: 'ringing',
    machine: 'MACBOOK',
    receivedAt: 1_000,
    ...overrides,
  };
}

describe('dispatchChipLabel', () => {
  it('renders glyph + word, with reason for denied and exit code for exited', () => {
    expect(dispatchChipLabel(entry({ status: 'ringing' }))).toBe('◎ RINGING');
    expect(dispatchChipLabel(entry({ status: 'denied', reason: 'path-not-allowlisted' }))).toBe(
      '⊘ DENIED — path-not-allowlisted',
    );
    expect(dispatchChipLabel(entry({ status: 'exited', exitCode: 0 }))).toBe('■ EXITED (code 0)');
  });

  it('4A status honesty: answered is ACCEPTED until a pid proves the child started', () => {
    // 'answered' = the runner ACCEPTED, set before anything spawns — never
    // a ✓-success chip (a launch that then fails would have read as done).
    expect(dispatchChipLabel(entry({ status: 'answered' }))).toBe('▸ ACCEPTED');
    expect(dispatchChipLabel(entry({ status: 'answered', pid: 4242 }))).toBe('▸ RUNNING');
  });

  it('4A status honesty: the ✓ glyph is reserved for real terminal outcomes', () => {
    expect(dispatchChipLabel(entry({ status: 'answered' }))).not.toContain('✓');
    expect(dispatchChipLabel(entry({ status: 'answered', pid: 4242 }))).not.toContain('✓');
  });

  it('T5 fleet controls: capped renders the cap duration; queued-budget renders its held reason', () => {
    expect(dispatchChipLabel(entry({ status: 'capped', timeoutSec: 300 }))).toBe('✗ CAPPED (300s)');
    expect(dispatchChipLabel(entry({ status: 'capped' }))).toBe('✗ CAPPED'); // no timeoutSec echo — never fabricate a duration
    expect(
      dispatchChipLabel(
        entry({ status: 'queued-budget', reason: 'HELD — daily ceiling 1000 reached, spend 1000' }),
      ),
    ).toBe('⏸ HELD — HELD — daily ceiling 1000 reached, spend 1000');
  });
});

describe('shouldAutoClear / hasViewableResult', () => {
  it('T6: NOTHING auto-clears by age any more — every status persists until an explicit DISMISS/CLEAR DONE', () => {
    expect(shouldAutoClear('ringing', 1_000_000)).toBe(false);
    expect(shouldAutoClear('answered', 1_000_000)).toBe(false);
    expect(shouldAutoClear('denied', 1_000_000)).toBe(false);
    expect(shouldAutoClear('exited', 1_000_000)).toBe(false);
    expect(shouldAutoClear('queued-budget', 1_000_000)).toBe(false);
    expect(shouldAutoClear('capped', 1_000_000)).toBe(false);
    expect(shouldAutoClear('expired', 1_000_000)).toBe(false);
    expect(shouldAutoClear('killed', 1_000_000)).toBe(false);
  });

  it('only exited entries are viewable', () => {
    expect(hasViewableResult({ status: 'exited' })).toBe(true);
    expect(hasViewableResult({ status: 'denied' })).toBe(false);
    expect(hasViewableResult({ status: 'ringing' })).toBe(false);
  });

  it('T5 fleet controls: capped is ALSO viewable (the runner reports a resultTail alongside a cap)', () => {
    expect(hasViewableResult({ status: 'capped' })).toBe(true);
    expect(hasViewableResult({ status: 'queued-budget' })).toBe(false);
  });
});

describe('upsertDispatchEntry / pruneDispatchEntries / dismissDispatchEntry', () => {
  it('inserts new ids and updates existing ones by id', () => {
    const first = upsertDispatchEntry(
      [],
      { id: 'a', action: 'dispatch', status: 'ringing', machine: 'M' },
      100,
    );
    const second = upsertDispatchEntry(
      first,
      { id: 'a', action: 'dispatch', status: 'answered', machine: 'M' },
      200,
    );
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ status: 'answered', receivedAt: 200 });
  });

  it('T6: pruneDispatchEntries no longer drops anything by age — every status survives', () => {
    const entries = [
      entry({ id: 'a', status: 'exited', receivedAt: 0 }),
      entry({ id: 'b', status: 'denied', receivedAt: 0 }),
    ];
    const pruned = pruneDispatchEntries(entries, 1_000_000);
    expect(pruned.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('dismiss removes by id regardless of status', () => {
    const entries = [entry({ id: 'a' }), entry({ id: 'b' })];
    expect(dismissDispatchEntry(entries, 'a').map((e) => e.id)).toEqual(['b']);
  });
});

describe('isTerminalDispatchStatus / clearTerminalDispatchEntries (T6 CLEAR DONE)', () => {
  it('denied/expired/exited/killed/capped are terminal; ringing/answered/queued-budget are not', () => {
    expect(isTerminalDispatchStatus('denied')).toBe(true);
    expect(isTerminalDispatchStatus('expired')).toBe(true);
    expect(isTerminalDispatchStatus('exited')).toBe(true);
    expect(isTerminalDispatchStatus('killed')).toBe(true);
    expect(isTerminalDispatchStatus('capped')).toBe(true);
    expect(isTerminalDispatchStatus('ringing')).toBe(false);
    expect(isTerminalDispatchStatus('answered')).toBe(false);
    expect(isTerminalDispatchStatus('queued-budget')).toBe(false);
  });

  it('CLEAR DONE removes every terminal entry, leaves in-flight entries untouched', () => {
    const entries = [
      entry({ id: 'a', status: 'exited' }),
      entry({ id: 'b', status: 'ringing' }),
      entry({ id: 'c', status: 'denied' }),
      entry({ id: 'd', status: 'answered', pid: 1 }),
    ];
    expect(clearTerminalDispatchEntries(entries).map((e) => e.id)).toEqual(['b', 'd']);
  });
});

describe('promptRemaining', () => {
  it('counts down from the max, going negative once over', () => {
    expect(promptRemaining('')).toBe(4000);
    expect(promptRemaining('x'.repeat(4001))).toBe(-1);
  });
});

describe('joinRootSubpath / splitCwdIntoRootSubpath', () => {
  it('joins a root with a relative subpath', () => {
    expect(joinRootSubpath('/Users/greg/code/war-room', 'packages/api')).toEqual({
      ok: true,
      cwd: '/Users/greg/code/war-room/packages/api',
    });
    expect(joinRootSubpath('/root', '')).toEqual({ ok: true, cwd: '/root' });
  });

  it('rejects an absolute subpath or a .. escape', () => {
    expect(joinRootSubpath('/root', '/etc').ok).toBe(false);
    expect(joinRootSubpath('/root', '../etc').ok).toBe(false);
  });

  it('splits a full cwd back into its advertised root + remaining subpath', () => {
    expect(
      splitCwdIntoRootSubpath('/Users/greg/code/war-room/packages/api', [
        '/Users/greg/code/war-room',
      ]),
    ).toEqual({
      root: '/Users/greg/code/war-room',
      subpath: 'packages/api',
    });
    expect(splitCwdIntoRootSubpath('/elsewhere', ['/Users/greg/code/war-room'])).toBeNull();
  });
});

describe('machineSupportsFocus', () => {
  it('requires a live runner AND the focus flag', () => {
    const machines = [
      { machine: 'MACBOOK', providers: ['claude'], roots: ['/x'], focus: true, sessions: false },
    ];
    expect(machineSupportsFocus(machines, 'MACBOOK')).toBe(true);
    expect(machineSupportsFocus(machines, 'GHOST')).toBe(false);
    expect(machineSupportsFocus(machines, undefined)).toBe(false);
  });
});

describe('detectSendFailures (per-request correlation)', () => {
  it('resolves silently once the entry echoing THIS requestId arrives', () => {
    const pending: PendingSend[] = [
      { id: 'p1', machine: 'MACBOOK', action: 'dispatch', sentAt: 0 },
    ];
    const entries = [entry({ machine: 'MACBOOK', receivedAt: 100, requestId: 'p1' })];
    const result = detectSendFailures(pending, entries, 200);
    expect(result.stillPending).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it('CORRELATION: one real ack never masks a DIFFERENT dropped dispatch', () => {
    // Regression (panel finding, dispatchFacts.ts:283): two rapid dispatches
    // to the same machine+action; only one reached the server. The fuzzy
    // (machine, action, receivedAt>=sentAt) match marked BOTH as delivered,
    // so the dropped one never showed "⚠ NOT QUEUED".
    const pending: PendingSend[] = [
      { id: 'p1', machine: 'MACBOOK', action: 'dispatch', sentAt: 0 },
      { id: 'p2', machine: 'MACBOOK', action: 'dispatch', sentAt: 10 },
    ];
    const entries = [entry({ machine: 'MACBOOK', receivedAt: 100, requestId: 'p1' })];
    const result = detectSendFailures(pending, entries, 1_600);
    expect(result.failed.map((f) => f.id)).toEqual(['p2']);
    expect(result.stillPending).toHaveLength(0);
  });

  it('CORRELATION: an entry with no requestId (chain/standing-order dispatch) matches nothing', () => {
    const pending: PendingSend[] = [
      { id: 'p1', machine: 'MACBOOK', action: 'dispatch', sentAt: 0 },
    ];
    const entries = [entry({ machine: 'MACBOOK', receivedAt: 100 })];
    const result = detectSendFailures(pending, entries, 1_600);
    expect(result.failed.map((f) => f.id)).toEqual(['p1']);
  });

  it('reports a timed-out send with no matching entry as failed', () => {
    const pending: PendingSend[] = [
      { id: 'p1', machine: 'MACBOOK', action: 'dispatch', sentAt: 0 },
    ];
    const result = detectSendFailures(pending, [], 1_500);
    expect(result.failed).toEqual(pending);
    expect(result.stillPending).toHaveLength(0);
  });

  it('keeps a fresh send pending until the timeout elapses', () => {
    const pending: PendingSend[] = [
      { id: 'p1', machine: 'MACBOOK', action: 'dispatch', sentAt: 0 },
    ];
    const result = detectSendFailures(pending, [], 500);
    expect(result.stillPending).toEqual(pending);
    expect(result.failed).toHaveLength(0);
  });
});
