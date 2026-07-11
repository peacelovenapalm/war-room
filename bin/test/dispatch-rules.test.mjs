/**
 * Unit tests for the dispatch-runner pure logic (v1 mechanic #6b).
 *
 * Run with: node --test bin/test/   (npm run test:poller)
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import {
  buildArgv,
  DISPATCH_PROVIDERS,
  emptyAllowlist,
  parseAllowlist,
  validateRequest,
} from '../lib/dispatch-rules.mjs';

let tmpDir;
let allowedRoot;
let outsideDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-rules-'));
  allowedRoot = path.join(tmpDir, 'allowed-project');
  outsideDir = path.join(tmpDir, 'outside-secret');
  fs.mkdirSync(allowedRoot, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── parseAllowlist ───────────────────────────────────────────────

test('parseAllowlist: valid file parses providers/roots/focus', () => {
  const result = parseAllowlist(
    JSON.stringify({ providers: ['claude', 'codex'], roots: ['/x'], focus: true }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.allowlist, {
    providers: ['claude', 'codex'],
    roots: ['/x'],
    focus: true,
    sessions: false,
  });
});

test('parseAllowlist: the deny-everything template parses to all-empty/false', () => {
  const result = parseAllowlist(JSON.stringify(emptyAllowlist()));
  assert.equal(result.ok, true);
  assert.deepEqual(result.allowlist, { providers: [], roots: [], focus: false, sessions: false });
});

test('parseAllowlist: corrupt JSON denies (ok:false), never throws', () => {
  for (const raw of ['not json {{{', '', '   ', '[1,2,3]', 'null', '42', '"a string"']) {
    const result = parseAllowlist(raw);
    assert.equal(result.ok, false, `expected ok:false for ${JSON.stringify(raw)}`);
    assert.equal(typeof result.reason, 'string');
  }
});

test('parseAllowlist: wrong-typed fields sanitize to safe defaults instead of failing', () => {
  const result = parseAllowlist(JSON.stringify({ providers: 'claude', roots: 123, focus: 'yes' }));
  assert.equal(result.ok, true);
  // Non-array providers/roots -> empty; focus/sessions must be the LITERAL boolean true.
  assert.deepEqual(result.allowlist, { providers: [], roots: [], focus: false, sessions: false });
});

test('parseAllowlist: focus only true for the literal boolean true (deny-by-default)', () => {
  for (const focusValue of ['true', 1, {}, ['true']]) {
    const result = parseAllowlist(JSON.stringify({ providers: [], roots: [], focus: focusValue }));
    assert.equal(result.allowlist.focus, false, `focus=${JSON.stringify(focusValue)} must deny`);
  }
});

test('parseAllowlist: accepts an already-parsed object (not just a string)', () => {
  const result = parseAllowlist({ providers: ['claude'], roots: [], focus: false });
  assert.equal(result.ok, true);
});

// ── validateRequest: dispatch action ─────────────────────────────

test('validateRequest: allows a dispatch request inside an allowlisted root', () => {
  const allowlist = { providers: ['claude'], roots: [allowedRoot], focus: false };
  const result = validateRequest(
    { action: 'dispatch', provider: 'claude', cwd: allowedRoot },
    allowlist,
  );
  assert.equal(result.ok, true);
});

test('validateRequest: allows a NESTED subdirectory of an allowlisted root', () => {
  const nested = path.join(allowedRoot, 'src', 'components');
  fs.mkdirSync(nested, { recursive: true });
  const allowlist = { providers: ['claude'], roots: [allowedRoot], focus: false };
  const result = validateRequest(
    { action: 'dispatch', provider: 'claude', cwd: nested },
    allowlist,
  );
  assert.equal(result.ok, true);
});

test('validateRequest: denies a provider not in the allowlist', () => {
  const allowlist = { providers: ['codex'], roots: [allowedRoot], focus: false };
  const result = validateRequest(
    { action: 'dispatch', provider: 'claude', cwd: allowedRoot },
    allowlist,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'provider-not-allowlisted');
});

test('validateRequest: denies an unrecognized provider string outright', () => {
  const allowlist = {
    providers: ['claude', 'not-a-real-provider'],
    roots: [allowedRoot],
    focus: false,
  };
  const result = validateRequest(
    { action: 'dispatch', provider: 'not-a-real-provider', cwd: allowedRoot },
    allowlist,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'provider-not-allowlisted');
});

test('validateRequest: denies a `../` path-traversal escape out of the allowed root', () => {
  const allowlist = { providers: ['claude'], roots: [allowedRoot], focus: false };
  const escaped = path.join(allowedRoot, '..', 'outside-secret');
  assert.equal(escaped, outsideDir); // sanity: this really does resolve outside
  const result = validateRequest(
    { action: 'dispatch', provider: 'claude', cwd: escaped },
    allowlist,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'path-not-allowlisted');
});

test('validateRequest: denies a symlink INSIDE the allowed root that resolves OUTSIDE it', () => {
  const trapLink = path.join(allowedRoot, 'escape-hatch');
  fs.symlinkSync(outsideDir, trapLink, 'dir');
  const allowlist = { providers: ['claude'], roots: [allowedRoot], focus: false };
  // The request's cwd is textually inside allowedRoot, but realpath resolves
  // through the symlink to outsideDir -- containment must catch this.
  const result = validateRequest(
    { action: 'dispatch', provider: 'claude', cwd: trapLink },
    allowlist,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'path-not-allowlisted');
});

test('validateRequest: denies when the allowlisted root ITSELF is a symlink and cwd escapes through it', () => {
  const rootLink = path.join(tmpDir, 'root-via-symlink');
  fs.symlinkSync(allowedRoot, rootLink, 'dir');
  const escapedViaRootLink = path.join(rootLink, '..', 'outside-secret');
  const allowlist = { providers: ['claude'], roots: [rootLink], focus: false };
  const result = validateRequest(
    { action: 'dispatch', provider: 'claude', cwd: escapedViaRootLink },
    allowlist,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'path-not-allowlisted');
});

test('validateRequest: denies a nonexistent cwd', () => {
  const allowlist = { providers: ['claude'], roots: [allowedRoot], focus: false };
  const result = validateRequest(
    { action: 'dispatch', provider: 'claude', cwd: path.join(allowedRoot, 'does-not-exist') },
    allowlist,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'cwd-not-found');
});

test('validateRequest: a corrupt (empty) allowlist denies every dispatch request', () => {
  const corrupt = parseAllowlist('not json {{{');
  assert.equal(corrupt.ok, false);
  const allowlist = emptyAllowlist(); // caller's fallback on parse failure
  const result = validateRequest(
    { action: 'dispatch', provider: 'claude', cwd: allowedRoot },
    allowlist,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'provider-not-allowlisted');
});

test('validateRequest: an allowlist root that does not itself exist is skipped, not fatal', () => {
  const allowlist = {
    providers: ['claude'],
    roots: [path.join(tmpDir, 'ghost-root')],
    focus: false,
  };
  const result = validateRequest(
    { action: 'dispatch', provider: 'claude', cwd: allowedRoot },
    allowlist,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'path-not-allowlisted');
});

// ── validateRequest: focus action ────────────────────────────────

test('validateRequest: focus allowed only when allowlist.focus is true', () => {
  assert.equal(validateRequest({ action: 'focus' }, { focus: true }).ok, true);
  assert.equal(validateRequest({ action: 'focus' }, { focus: false }).ok, false);
  assert.equal(validateRequest({ action: 'focus' }, {}).ok, false);
});

test('validateRequest: focus denial reason is data, not an exception', () => {
  const result = validateRequest({ action: 'focus' }, { focus: false });
  assert.equal(result.reason, 'focus-not-allowlisted');
});

test('validateRequest: unknown action denies', () => {
  const result = validateRequest(
    { action: 'delete-everything' },
    { providers: DISPATCH_PROVIDERS, roots: ['/'], focus: true },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown-action');
});

// ── buildArgv ─────────────────────────────────────────────────────

test('buildArgv: maps each provider to its documented argv shape', () => {
  assert.deepEqual(buildArgv({ provider: 'claude', prompt: 'hello' }), ['claude', '-p', 'hello']);
  assert.deepEqual(buildArgv({ provider: 'codex', prompt: 'hello' }), [
    'codex',
    'exec',
    '--skip-git-repo-check',
    'hello',
  ]);
  assert.deepEqual(buildArgv({ provider: 'gemini', prompt: 'hello' }), ['gemini', '-p', 'hello']);
});

test('buildArgv: codex always carries --skip-git-repo-check (allowlist containment is the trust boundary)', () => {
  const argv = buildArgv({ provider: 'codex', prompt: 'hi' });
  assert.ok(argv.includes('--skip-git-repo-check'));
});

test('buildArgv: threads an optional model per-provider, in the right position', () => {
  assert.deepEqual(buildArgv({ provider: 'claude', prompt: 'hi', model: 'fable' }), [
    'claude',
    '-p',
    '--model',
    'fable',
    'hi',
  ]);
  assert.deepEqual(buildArgv({ provider: 'codex', prompt: 'hi', model: 'o3' }), [
    'codex',
    'exec',
    '--skip-git-repo-check',
    '--model',
    'o3',
    'hi',
  ]);
  // gemini's -p TAKES the prompt as its value, so --model must precede it.
  assert.deepEqual(buildArgv({ provider: 'gemini', prompt: 'hi', model: 'flash' }), [
    'gemini',
    '--model',
    'flash',
    '-p',
    'hi',
  ]);
});

test('buildArgv: threads --effort for claude only — codex/gemini have no effort flag, silently omitted', () => {
  assert.deepEqual(buildArgv({ provider: 'claude', prompt: 'hi', effort: 'high' }), [
    'claude',
    '-p',
    '--effort',
    'high',
    'hi',
  ]);
  assert.deepEqual(buildArgv({ provider: 'codex', prompt: 'hi', effort: 'high' }), [
    'codex',
    'exec',
    '--skip-git-repo-check',
    'hi',
  ]);
  assert.deepEqual(buildArgv({ provider: 'gemini', prompt: 'hi', effort: 'high' }), [
    'gemini',
    '-p',
    'hi',
  ]);
});

test('buildArgv: blank/whitespace-only model or effort strings are treated as absent', () => {
  assert.deepEqual(buildArgv({ provider: 'claude', prompt: 'hi', model: '  ', effort: '' }), [
    'claude',
    '-p',
    'hi',
  ]);
});

test('buildArgv: a shell-metacharacter-laden prompt stays ONE argv element, never split/interpolated', () => {
  const malicious = '"; rm -rf / #';
  const argv = buildArgv({ provider: 'claude', prompt: malicious });
  assert.equal(argv.length, 3);
  assert.equal(argv[2], malicious); // untouched, single element
  assert.equal(argv.join(' ').includes('\n'), false);
});

test('buildArgv: backticks and $() command-substitution syntax pass through inert as data', () => {
  const malicious = '`whoami` && echo $(cat /etc/passwd)';
  const argv = buildArgv({ provider: 'codex', prompt: malicious });
  assert.equal(argv.at(-1), malicious);
});

test('buildArgv: unknown provider returns null rather than throwing', () => {
  assert.equal(buildArgv({ provider: 'bogus', prompt: 'x' }), null);
});
