import { describe, expect, it } from 'vitest';

import {
  COMPUTE_MAX_ARGS_CEILING,
  parseComputeArgs,
  applySkillPrefix,
  buildCopyIdLine,
  canKillAgent,
  DISPATCH_PERMISSION_MODE_OPTIONS,
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

describe('DISPATCH_PERMISSION_MODE_OPTIONS (4B PERMISSION toggle)', () => {
  it('is exactly the two enum-validated values, default first', () => {
    expect(DISPATCH_PERMISSION_MODE_OPTIONS).toEqual(['default', 'plan']);
  });
});

describe('applySkillPrefix (4B SKILL picker mechanic)', () => {
  it('inserts "/<skill> " at the start of an empty prompt', () => {
    expect(applySkillPrefix('', undefined, 'plan-review')).toBe('/plan-review ');
  });

  it('inserts the prefix ahead of existing prompt text', () => {
    expect(applySkillPrefix('fix the bug', undefined, 'plan-review')).toBe(
      '/plan-review fix the bug',
    );
  });

  it('replaces a previously-inserted prefix when the user switches picks', () => {
    const withFirst = applySkillPrefix('fix the bug', undefined, 'plan-review');
    expect(applySkillPrefix(withFirst, 'plan-review', 'code-review')).toBe(
      '/code-review fix the bug',
    );
  });

  it('removes the prefix entirely when the user picks "— none —" (nextSkill undefined)', () => {
    const withSkill = applySkillPrefix('fix the bug', undefined, 'plan-review');
    expect(applySkillPrefix(withSkill, 'plan-review', undefined)).toBe('fix the bug');
  });

  it('leaves free-edited text untouched if it no longer matches the tracked prefix exactly', () => {
    // The user hand-edited the inserted prefix (e.g. added a trailing
    // character) — the mechanic must not mangle text it doesn't recognize;
    // it just prepends the new prefix instead of guessing.
    expect(applySkillPrefix('/plan-reviewX fix the bug', 'plan-review', 'code-review')).toBe(
      '/code-review /plan-reviewX fix the bug',
    );
  });

  it('is a no-op pass-through when neither prevSkill nor nextSkill is set', () => {
    expect(applySkillPrefix('just a prompt', undefined, undefined)).toBe('just a prompt');
  });
});

describe('parseComputeArgs (T8 compute — client-side arg-token hints)', () => {
  it('empty / whitespace-only input parses to zero args', () => {
    expect(parseComputeArgs('')).toEqual({ ok: true, args: [] });
    expect(parseComputeArgs('   ')).toEqual({ ok: true, args: [] });
  });

  it('splits on any whitespace run into plain tokens', () => {
    expect(parseComputeArgs(' --limit=50  /data/in.csv batch,2 ')).toEqual({
      ok: true,
      args: ['--limit=50', '/data/in.csv', 'batch,2'],
    });
  });

  it('rejects shell metacharacters and control chars token-by-token', () => {
    for (const bad of ['a;b', '$(x)', 'a|b', 'a"b', "a'b", 'a\tstillonetoken?`']) {
      const parsed = parseComputeArgs(bad);
      expect(parsed.ok).toBe(false);
    }
  });

  it('rejects more than the ceiling and overlong tokens', () => {
    const many = Array.from({ length: COMPUTE_MAX_ARGS_CEILING + 1 }, (_, i) => `a${String(i)}`);
    expect(parseComputeArgs(many.join(' ')).ok).toBe(false);
    expect(parseComputeArgs('x'.repeat(257)).ok).toBe(false);
  });
});
