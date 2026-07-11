/**
 * Unit tests for bin/lib/tailer-roots.mjs (T1 remote live-tail, S3) — the
 * transcript-tailer's local allowlist. Uses a real temp directory tree
 * (fs.realpathSync needs real paths to resolve) rather than an fs fake,
 * mirroring dispatch-rules.test.mjs's approach for the same reason.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import * as assert from 'node:assert/strict';

import { defaultTailerRoot, isPathAllowed, parseTailerRoots } from '../lib/tailer-roots.mjs';

let tmpBase;

before(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'tailer-roots-test-'));
});

after(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test('defaultTailerRoot is ~/.claude/projects', () => {
  assert.equal(defaultTailerRoot(), path.join(os.homedir(), '.claude', 'projects'));
});

test('parseTailerRoots is additive to the default root, never replaces it', () => {
  const extra = path.join(tmpBase, 'extra');
  const roots = parseTailerRoots(extra);
  assert.deepEqual(roots, [defaultTailerRoot(), extra]);
});

test('parseTailerRoots handles multiple path.delimiter-separated entries and drops blanks', () => {
  const a = path.join(tmpBase, 'a');
  const b = path.join(tmpBase, 'b');
  const roots = parseTailerRoots(`${a}${path.delimiter}${path.delimiter}${b}${path.delimiter} `);
  assert.deepEqual(roots, [defaultTailerRoot(), a, b]);
});

test('parseTailerRoots with an absent/empty env value still returns just the default', () => {
  assert.deepEqual(parseTailerRoots(undefined), [defaultTailerRoot()]);
  assert.deepEqual(parseTailerRoots(''), [defaultTailerRoot()]);
});

test('a path inside an allowlisted root (existing file) is allowed', () => {
  const root = path.join(tmpBase, 'projects');
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'session-1.jsonl');
  fs.writeFileSync(file, '');
  assert.equal(isPathAllowed(file, [root]), true);
});

test('a path inside an allowlisted root that does NOT exist yet is still allowed', () => {
  // The tail-on/missing-file case: the session hasn't written its first
  // byte, so the candidate can't be realpath-resolved — must not be
  // refused for that reason alone.
  const root = path.join(tmpBase, 'projects2');
  fs.mkdirSync(root, { recursive: true });
  const notYetWritten = path.join(root, 'sub', 'not-written.jsonl');
  assert.equal(isPathAllowed(notYetWritten, [root]), true);
});

test('a path outside every allowlisted root is refused', () => {
  const root = path.join(tmpBase, 'projects3');
  fs.mkdirSync(root, { recursive: true });
  const outside = path.join(tmpBase, 'elsewhere', 'file.jsonl');
  assert.equal(isPathAllowed(outside, [root]), false);
});

test('a ../ escape attempt (candidate does not exist) is refused', () => {
  const root = path.join(tmpBase, 'projects4');
  fs.mkdirSync(root, { recursive: true });
  const escape = path.join(root, '..', '..', 'etc', 'passwd');
  assert.equal(isPathAllowed(escape, [root]), false);
});

test('a ../ escape attempt via a REAL symlink inside the root is refused', () => {
  const root = path.join(tmpBase, 'projects5');
  const outsideDir = path.join(tmpBase, 'outside5');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  const secret = path.join(outsideDir, 'secret.jsonl');
  fs.writeFileSync(secret, 'top secret');
  const link = path.join(root, 'escape-link.jsonl');
  fs.symlinkSync(secret, link);
  // The symlink itself lives inside the root, but realpath resolves it to
  // outsideDir — must be refused, not allowed by textual containment alone.
  assert.equal(isPathAllowed(link, [root]), false);
});

test('the root itself is allowed, and no roots means deny-everything', () => {
  const root = path.join(tmpBase, 'projects6');
  fs.mkdirSync(root, { recursive: true });
  assert.equal(isPathAllowed(root, [root]), true);
  assert.equal(isPathAllowed(path.join(root, 'x.jsonl'), []), false);
});

test('a non-string or empty candidate is refused, never throws', () => {
  const root = path.join(tmpBase, 'projects7');
  fs.mkdirSync(root, { recursive: true });
  assert.equal(isPathAllowed('', [root]), false);
  assert.equal(isPathAllowed(undefined, [root]), false);
  assert.equal(isPathAllowed(null, [root]), false);
});
