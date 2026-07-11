/**
 * Unit tests for the T8 Mini-compute `shell` provider containment surface
 * (MINI-COMPUTE-NODE.md): registry parsing, request validation, and argv
 * resolution. The wire carries an opaque scriptId + plain-token args; ONLY
 * the machine-local registry resolves it to a real interpreter/path — these
 * tests pin that boundary and the deny-by-default posture around it.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  COMPUTE_MAX_ARGS_CEILING,
  buildComputeArgv,
  emptyAllowlist,
  parseAllowlist,
  validateComputeRequest,
  validateRequest,
} from '../lib/dispatch-rules.mjs';

const REGISTRY = {
  scripts: {
    'photo-resize': {
      interpreter: '/opt/homebrew/bin/python3.12',
      path: '/Users/greg/scripts/compute/resize.py',
      maxArgs: 2,
      timeoutSec: 7200,
      cpulimit: 50,
      nice: 15,
    },
    'quick-hash': {
      interpreter: '/bin/sh',
      path: '/Users/greg/scripts/compute/hash.sh',
    },
  },
};

function allow(overrides = {}) {
  return { providers: [], roots: [], focus: false, sessions: false, compute: REGISTRY, ...overrides };
}

// ── parseAllowlist compute registry ───────────────────────────────

test('emptyAllowlist carries an empty compute registry (deny-all)', () => {
  assert.deepEqual(emptyAllowlist().compute, { scripts: {} });
});

test('parseAllowlist sanitizes compute entries, dropping malformed ones', () => {
  const raw = JSON.stringify({
    compute: {
      scripts: {
        good: { interpreter: '/bin/sh', path: '/s/g.sh', maxArgs: 3, timeoutSec: 60 },
        'no-path': { interpreter: '/bin/sh' },
        'no-interp': { path: '/s/x.sh' },
        'bad id!': { interpreter: '/bin/sh', path: '/s/x.sh' },
        clamped: { interpreter: '/bin/sh', path: '/s/c.sh', maxArgs: 9999, cpulimit: 500, nice: 99 },
      },
    },
  });
  const { allowlist } = parseAllowlist(raw);
  const s = allowlist.compute.scripts;
  assert.deepEqual(Object.keys(s).sort(), ['clamped', 'good']);
  assert.equal(s.good.maxArgs, 3);
  assert.equal(s.good.timeoutSec, 60);
  assert.equal(s.clamped.maxArgs, COMPUTE_MAX_ARGS_CEILING); // clamped down
  assert.equal(s.clamped.cpulimit, undefined); // >100 dropped
  assert.equal(s.clamped.nice, undefined); // out of [-20,19] dropped
});

test('parseAllowlist tolerates a missing/wrong-typed compute block', () => {
  assert.deepEqual(parseAllowlist('{}').allowlist.compute, { scripts: {} });
  assert.deepEqual(parseAllowlist('{"compute": 5}').allowlist.compute, { scripts: {} });
  assert.deepEqual(parseAllowlist('{"compute": {"scripts": []}}').allowlist.compute, { scripts: {} });
});

// ── validateComputeRequest ────────────────────────────────────────

test('validateComputeRequest: a registered scriptId with valid args passes', () => {
  assert.deepEqual(
    validateComputeRequest({ scriptId: 'photo-resize', args: ['--width=800', '/in/dir'] }, allow()),
    { ok: true },
  );
  assert.deepEqual(validateComputeRequest({ scriptId: 'quick-hash' }, allow()), { ok: true });
});

test('validateComputeRequest: unregistered / missing registry denies', () => {
  assert.equal(validateComputeRequest({ scriptId: 'nope' }, allow()).reason, 'script-not-allowlisted');
  assert.equal(
    validateComputeRequest({ scriptId: 'photo-resize' }, { compute: { scripts: {} } }).reason,
    'script-not-allowlisted',
  );
  assert.equal(validateComputeRequest({ scriptId: 'photo-resize' }, {}).reason, 'script-not-allowlisted');
});

test('validateComputeRequest: bad scriptId shape and arg shapes deny', () => {
  assert.equal(validateComputeRequest({ scriptId: 'a b' }, allow()).reason, 'invalid-scriptId');
  assert.equal(validateComputeRequest({ scriptId: 42 }, allow()).reason, 'invalid-scriptId');
  assert.equal(
    validateComputeRequest({ scriptId: 'quick-hash', args: 'notarray' }, allow()).reason,
    'invalid-args',
  );
  assert.equal(
    validateComputeRequest({ scriptId: 'quick-hash', args: ['ok', 'rm -rf; $(x)'] }, allow()).reason,
    'invalid-arg',
  );
  assert.equal(
    validateComputeRequest({ scriptId: 'quick-hash', args: ['a', 'b`c`'] }, allow()).reason,
    'invalid-arg',
  );
});

test('validateComputeRequest: per-script maxArgs cap enforced', () => {
  // photo-resize maxArgs=2
  assert.equal(
    validateComputeRequest({ scriptId: 'photo-resize', args: ['1', '2', '3'] }, allow()).reason,
    'too-many-args',
  );
});

test('validateRequest routes shell through the compute check; never a session', () => {
  assert.deepEqual(
    validateRequest({ action: 'dispatch', provider: 'shell', scriptId: 'quick-hash' }, allow()),
    { ok: true },
  );
  assert.equal(
    validateRequest({ action: 'session', provider: 'shell', scriptId: 'quick-hash' }, allow({ sessions: true }))
      .reason,
    'shell-cannot-be-a-session',
  );
  // shell need NOT be in providers[] — the registry entry IS the capability.
  assert.deepEqual(
    validateRequest({ action: 'dispatch', provider: 'shell', scriptId: 'quick-hash' }, allow({ providers: [] })),
    { ok: true },
  );
});

// ── buildComputeArgv ──────────────────────────────────────────────

test('buildComputeArgv: resolves scriptId → nice/cpulimit-wrapped argv + cap meta', () => {
  const result = buildComputeArgv({ scriptId: 'photo-resize', args: ['--width=800'] }, allow());
  assert.deepEqual(result.argv, [
    'cpulimit',
    '-l',
    '50',
    '--',
    'nice',
    '-n',
    '15',
    '/opt/homebrew/bin/python3.12',
    '/Users/greg/scripts/compute/resize.py',
    '--width=800',
  ]);
  assert.equal(result.meta.timeoutSec, 7200);
});

test('buildComputeArgv: no cpulimit → nice-only; default nice +10; no timeout', () => {
  const result = buildComputeArgv({ scriptId: 'quick-hash' }, allow());
  assert.deepEqual(result.argv, ['nice', '-n', '10', '/bin/sh', '/Users/greg/scripts/compute/hash.sh']);
  assert.equal(result.meta.timeoutSec, undefined);
});

test('buildComputeArgv: unregistered scriptId returns null (defensive)', () => {
  assert.equal(buildComputeArgv({ scriptId: 'nope' }, allow()), null);
  assert.equal(buildComputeArgv({ scriptId: 'quick-hash' }, {}), null);
});

test('buildComputeArgv: filters any arg that slipped past validation', () => {
  // Defense in depth: even if a bad arg reaches here, it never lands in argv.
  const result = buildComputeArgv({ scriptId: 'quick-hash', args: ['ok', 'bad;rm'] }, allow());
  assert.deepEqual(result.argv, ['nice', '-n', '10', '/bin/sh', '/Users/greg/scripts/compute/hash.sh', 'ok']);
});
