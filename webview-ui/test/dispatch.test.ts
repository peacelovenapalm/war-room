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
  canFocusAgent,
  canKillAgent,
  detectSendFailures,
  dismissDispatchEntry,
  DISPATCH_EFFORT_VALUES,
  DISPATCH_MODEL_OPTIONS,
  DISPATCH_MODEL_PATTERN,
  DISPATCH_SEND_TIMEOUT_MS,
  DISPATCH_STATUS_CHIPS,
  DISPATCH_STATUSES,
  DISPATCH_UI_PROVIDERS,
  dispatchChipLabel,
  type DispatchEntry,
  hasViewableResult,
  joinRootSubpath,
  machineHasLiveRunner,
  machineSupportsFocus,
  type PendingSend,
  promptRemaining,
  pruneDispatchEntries,
  pruneSendFailures,
  type SendFailure,
  sendFailureChipLabel,
  shouldAutoClear,
  splitCwdIntoRootSubpath,
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

  it('clears KILLED past the auto-clear age, same as EXITED (KICKOFF v1.1 item 3)', () => {
    expect(shouldAutoClear('killed', 61_000)).toBe(true);
    expect(shouldAutoClear('killed', 59_000)).toBe(false);
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

  it('renders a distinct KILLED chip, never the EXITED glyph/word (KICKOFF v1.1 item 3)', () => {
    expect(dispatchChipLabel({ status: 'killed', reason: undefined, exitCode: undefined })).toBe(
      '✕ KILLED',
    );
  });

  it('4A status honesty: answered is ACCEPTED until a pid proves the child started', () => {
    expect(dispatchChipLabel({ status: 'answered', reason: undefined, exitCode: undefined })).toBe(
      '▸ ACCEPTED',
    );
    expect(
      dispatchChipLabel({ status: 'answered', reason: undefined, exitCode: undefined, pid: 4242 }),
    ).toBe('▸ RUNNING');
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

describe('canFocusAgent (drawer FOCUS button eligibility)', () => {
  const machines = [
    { machine: 'MACBOOK', providers: ['claude'], roots: ['/x'], focus: true },
    { machine: 'MINI', providers: ['claude'], roots: ['/y'], focus: false },
  ];

  it('is true with both a pid and a focus-capable runner', () => {
    expect(canFocusAgent(4242, machines, 'MACBOOK')).toBe(true);
  });

  it('is false with a runner but no pid ("NO PID -- use COPY ID")', () => {
    expect(canFocusAgent(undefined, machines, 'MACBOOK')).toBe(false);
  });

  it('is false with a pid but no focus-capable runner ("NO RUNNER")', () => {
    expect(canFocusAgent(4242, machines, 'MINI')).toBe(false);
  });

  it('is false with a pid but no runner at all on that machine', () => {
    expect(canFocusAgent(4242, machines, 'NEXUS')).toBe(false);
  });

  it('is false with neither pid nor machine', () => {
    expect(canFocusAgent(undefined, machines, undefined)).toBe(false);
  });
});

describe('machineHasLiveRunner (KICKOFF v1.1 item 3 — kill is NOT gated by the focus flag)', () => {
  const machines = [
    { machine: 'MACBOOK', providers: ['claude'], roots: ['/x'], focus: true },
    { machine: 'MINI', providers: ['claude'], roots: ['/y'], focus: false },
  ];

  it('is true for ANY live runner, focus-capable or not', () => {
    expect(machineHasLiveRunner(machines, 'MACBOOK')).toBe(true);
    expect(machineHasLiveRunner(machines, 'MINI')).toBe(true); // focus:false, still a live runner
  });

  it('is false for a machine with no runner at all', () => {
    expect(machineHasLiveRunner(machines, 'NEXUS')).toBe(false);
  });

  it('is false when no machine is given', () => {
    expect(machineHasLiveRunner(machines, undefined)).toBe(false);
  });
});

describe('canKillAgent (drawer KILL button eligibility — KICKOFF v1.1 item 3)', () => {
  const machines = [
    { machine: 'MACBOOK', providers: ['claude'], roots: ['/x'], focus: true },
    { machine: 'MINI', providers: ['claude'], roots: ['/y'], focus: false },
  ];

  it('is true with both a pid and ANY live runner, even one without focus enabled', () => {
    expect(canKillAgent(4242, machines, 'MACBOOK')).toBe(true);
    expect(canKillAgent(4242, machines, 'MINI')).toBe(true);
  });

  it('is false with a runner but no pid ("NO PID -- use COPY ID")', () => {
    expect(canKillAgent(undefined, machines, 'MACBOOK')).toBe(false);
  });

  it('is false with a pid but no runner at all on that machine', () => {
    expect(canKillAgent(4242, machines, 'NEXUS')).toBe(false);
  });

  it('is false with neither pid nor machine', () => {
    expect(canKillAgent(undefined, machines, undefined)).toBe(false);
  });
});

describe('detectSendFailures (dispatchRequest has no ack)', () => {
  it('keeps a fresh send pending before the timeout', () => {
    const pending: PendingSend[] = [
      { id: 'p1', machine: 'MACBOOK', action: 'dispatch', sentAt: 0 },
    ];
    const result = detectSendFailures(pending, [], DISPATCH_SEND_TIMEOUT_MS - 1);
    expect(result.stillPending).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
  });

  it('fails a send with no matching entry past the timeout', () => {
    const pending: PendingSend[] = [
      { id: 'p1', machine: 'MACBOOK', action: 'dispatch', sentAt: 0 },
    ];
    const result = detectSendFailures(pending, [], DISPATCH_SEND_TIMEOUT_MS);
    expect(result.stillPending).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('p1');
  });

  it('resolves silently once a matching entry for the same machine+action arrives', () => {
    const pending: PendingSend[] = [
      { id: 'p1', machine: 'MACBOOK', action: 'dispatch', sentAt: 0 },
    ];
    const entries: DispatchEntry[] = [
      {
        id: 'server-id',
        action: 'dispatch',
        status: 'ringing',
        machine: 'MACBOOK',
        receivedAt: 100,
      },
    ];
    const result = detectSendFailures(pending, entries, DISPATCH_SEND_TIMEOUT_MS);
    expect(result.stillPending).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it('does not resolve against an entry received before the send (a stale/unrelated one)', () => {
    const pending: PendingSend[] = [
      { id: 'p1', machine: 'MACBOOK', action: 'dispatch', sentAt: 1000 },
    ];
    const entries: DispatchEntry[] = [
      { id: 'old', action: 'dispatch', status: 'exited', machine: 'MACBOOK', receivedAt: 500 },
    ];
    const result = detectSendFailures(pending, entries, 1000 + DISPATCH_SEND_TIMEOUT_MS);
    expect(result.failed).toHaveLength(1);
  });

  it('does not resolve against a different action on the same machine', () => {
    const pending: PendingSend[] = [{ id: 'p1', machine: 'MACBOOK', action: 'focus', sentAt: 0 }];
    const entries: DispatchEntry[] = [
      { id: 'other', action: 'dispatch', status: 'ringing', machine: 'MACBOOK', receivedAt: 10 },
    ];
    const result = detectSendFailures(pending, entries, DISPATCH_SEND_TIMEOUT_MS);
    expect(result.failed).toHaveLength(1);
  });
});

describe('pruneSendFailures', () => {
  it('drops failures past the auto-clear age', () => {
    const failures: SendFailure[] = [
      { id: 'a', machine: 'M', action: 'dispatch', detectedAt: 0 },
      { id: 'b', machine: 'M', action: 'dispatch', detectedAt: 59_000 },
    ];
    const result = pruneSendFailures(failures, 60_000);
    expect(result.map((f) => f.id)).toEqual(['b']);
  });
});

describe('sendFailureChipLabel', () => {
  it('names the machine that never got queued', () => {
    expect(sendFailureChipLabel({ machine: 'MACBOOK' })).toBe('⚠ NOT QUEUED — MACBOOK');
  });
});

describe('DISPATCH_UI_PROVIDERS (scope change 2026-07-08: gemini dropped from dispatch)', () => {
  it('offers only claude and codex — gemini is excluded (IneligibleTierError, no free tier)', () => {
    expect(DISPATCH_UI_PROVIDERS).toEqual(['claude', 'codex']);
    expect(DISPATCH_UI_PROVIDERS).not.toContain('gemini');
  });
});

describe('hasViewableResult', () => {
  it('only EXITED entries carry a resultTail worth viewing', () => {
    for (const status of DISPATCH_STATUSES) {
      expect(hasViewableResult({ status })).toBe(status === 'exited');
    }
  });
});

describe('joinRootSubpath', () => {
  it('returns the root itself when subpath is blank', () => {
    expect(joinRootSubpath('/Users/dev/proj', '')).toEqual({ ok: true, cwd: '/Users/dev/proj' });
    expect(joinRootSubpath('/Users/dev/proj', '   ')).toEqual({
      ok: true,
      cwd: '/Users/dev/proj',
    });
  });

  it('joins a plain relative subpath onto the root', () => {
    expect(joinRootSubpath('/Users/dev/proj', 'packages/api')).toEqual({
      ok: true,
      cwd: '/Users/dev/proj/packages/api',
    });
  });

  it('tolerates a trailing slash on the root and stray double-slashes in the subpath', () => {
    expect(joinRootSubpath('/Users/dev/proj/', 'packages//api/')).toEqual({
      ok: true,
      cwd: '/Users/dev/proj/packages/api',
    });
  });

  it('rejects an absolute subpath (would silently ignore the chosen root)', () => {
    const result = joinRootSubpath('/Users/dev/proj', '/etc/passwd');
    expect(result.ok).toBe(false);
  });

  it('rejects a ".." escape attempt client-side', () => {
    const result = joinRootSubpath('/Users/dev/proj', '../../etc');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/\.\./);
  });

  it('rejects a ".." embedded mid-path, not just at the start', () => {
    const result = joinRootSubpath('/Users/dev/proj', 'packages/../../etc');
    expect(result.ok).toBe(false);
  });
});

describe('splitCwdIntoRootSubpath', () => {
  it('splits a cwd nested under an advertised root', () => {
    expect(splitCwdIntoRootSubpath('/Users/dev/proj/packages/api', ['/Users/dev/proj'])).toEqual({
      root: '/Users/dev/proj',
      subpath: 'packages/api',
    });
  });

  it('returns an empty subpath when the cwd IS the root', () => {
    expect(splitCwdIntoRootSubpath('/Users/dev/proj', ['/Users/dev/proj'])).toEqual({
      root: '/Users/dev/proj',
      subpath: '',
    });
  });

  it('returns null when no advertised root contains the cwd', () => {
    expect(splitCwdIntoRootSubpath('/Users/dev/other', ['/Users/dev/proj'])).toBeNull();
  });

  it('does not false-match a root that is merely a string prefix (not a path ancestor)', () => {
    // '/Users/dev/proj-2' textually starts with '/Users/dev/proj' but is a
    // sibling directory, not nested inside it.
    expect(splitCwdIntoRootSubpath('/Users/dev/proj-2', ['/Users/dev/proj'])).toBeNull();
  });

  it('round-trips with joinRootSubpath', () => {
    const split = splitCwdIntoRootSubpath('/Users/dev/proj/src/lib', ['/Users/dev/proj']);
    expect(split).not.toBeNull();
    if (!split) return;
    expect(joinRootSubpath(split.root, split.subpath)).toEqual({
      ok: true,
      cwd: '/Users/dev/proj/src/lib',
    });
  });
});

describe('DISPATCH_MODEL_OPTIONS (CallModal MODEL dropdown registry)', () => {
  it('gives every dispatchable UI provider a non-empty options list', () => {
    for (const provider of DISPATCH_UI_PROVIDERS) {
      const options = DISPATCH_MODEL_OPTIONS[provider];
      expect(options, `${provider} missing a MODEL_OPTIONS entry`).toBeDefined();
      expect(options?.length ?? 0, `${provider} has no dropdown options`).toBeGreaterThan(0);
    }
  });

  it("every provider's first option is the default (no flag) entry", () => {
    for (const provider of DISPATCH_UI_PROVIDERS) {
      const first = DISPATCH_MODEL_OPTIONS[provider]?.[0];
      expect(first?.value, `${provider} first option must be the blank/default value`).toBe('');
    }
  });

  it('every non-default option value matches the wire-level model pattern', () => {
    for (const provider of DISPATCH_UI_PROVIDERS) {
      for (const opt of DISPATCH_MODEL_OPTIONS[provider] ?? []) {
        if (opt.value === '') continue;
        expect(
          DISPATCH_MODEL_PATTERN.test(opt.value),
          `${provider} option "${opt.value}" fails the server's model pattern`,
        ).toBe(true);
      }
    }
  });

  it('has no duplicate values within a single provider list', () => {
    for (const provider of DISPATCH_UI_PROVIDERS) {
      const values = (DISPATCH_MODEL_OPTIONS[provider] ?? []).map((o) => o.value);
      expect(new Set(values).size, `${provider} has duplicate MODEL option values`).toBe(
        values.length,
      );
    }
  });
});

describe('DISPATCH_EFFORT_VALUES', () => {
  it('does not include "minimal" — not a real claude --effort value', () => {
    expect((DISPATCH_EFFORT_VALUES as readonly string[]).includes('minimal')).toBe(false);
  });

  it('matches the documented claude --effort levels exactly', () => {
    expect(DISPATCH_EFFORT_VALUES).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
});
