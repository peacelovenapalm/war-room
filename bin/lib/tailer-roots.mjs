/**
 * Local transcript-root allowlist for bin/transcript-tailer.mjs (T1 remote
 * live-tail, S3). Mirrors bin/lib/dispatch-rules.mjs's realpath-containment
 * pattern (`isContained`) — the tailer validates every server-issued
 * tail-on's `transcriptPath` against its OWN local allowlist before ever
 * opening it, the same "the server cannot override the runner's allowlist"
 * posture dispatch-runner.mjs enforces for cwd. Deny-by-default: an
 * unresolvable or out-of-root path is refused, never opened.
 *
 * The candidate path is deliberately NOT required to already exist — a
 * tail-on can legitimately arrive before its session has written its first
 * byte (REMOTE-TAILER-DESIGN.md's "keep the tail active, poll for the file
 * to appear"), so requiring fs.realpathSync to succeed on the candidate
 * would wrongly refuse a genuinely-allowlisted, not-yet-created file. A
 * candidate that DOES exist is realpath-resolved (collapses symlinks before
 * the prefix check — a symlink inside an allowed root pointing outside it
 * must not grant access); one that doesn't exist falls back to
 * path.resolve's lexical normalization, which still collapses a `..`
 * escape attempt even though nothing is there to realpath yet.
 *
 * Pure ESM, zero dependencies beyond node:fs/node:path, unit-tested with
 * node:test (bin/test/tailer-roots.test.mjs).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Default allowlisted root (REMOTE-TAILER-DESIGN.md §Containment: "default
 *  ~/.claude/projects/ only"). */
export function defaultTailerRoot() {
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Parse the WAR_ROOM_TAILER_ROOTS env value (path.delimiter-separated,
 * same joining convention as PATH) into extra allowlisted roots. ADDITIVE
 * to defaultTailerRoot() — never replaces it, so a misconfigured/empty env
 * value can only ever ADD coverage, not silently shrink the default.
 * Blank/whitespace-only entries are dropped.
 */
export function parseTailerRoots(envValue) {
  const extra = (envValue ?? '')
    .split(path.delimiter)
    .map((r) => r.trim())
    .filter((r) => r !== '');
  return [defaultTailerRoot(), ...extra];
}

/** Resolve a root for containment comparison: realpath if it exists
 *  (symlink-safe), lexical path.resolve otherwise (a root that hasn't been
 *  created yet — e.g. a fresh machine before its first Claude session —
 *  still bounds candidates textually). */
/**
 * Resolve any path (root or candidate) for containment comparison. When it
 * exists, fs.realpathSync collapses every symlink. When it doesn't (a
 * not-yet-written transcript, or a not-yet-created root on a fresh
 * machine), walk UP to the nearest EXISTING ancestor, realpath THAT, and
 * reattach the missing suffix — this still collapses a symlinked ancestor
 * (e.g. macOS's /tmp -> /private/tmp) even though the leaf itself is
 * absent, so a root and a not-yet-written candidate that share a
 * symlinked ancestor resolve to the SAME prefix and compare correctly.
 */
function resolveForContainment(target, fsImpl) {
  const abs = path.resolve(target);
  try {
    return fsImpl.realpathSync(abs);
  } catch {
    const parent = path.dirname(abs);
    if (parent === abs) return abs; // reached the filesystem root
    return path.join(resolveForContainment(parent, fsImpl), path.basename(abs));
  }
}

/** Is `child` the same path as, or nested inside, `root` (both already
 *  resolved)? Identical logic to dispatch-rules.mjs's isContained. */
function isContained(root, child) {
  if (root === child) return true;
  const rel = path.relative(root, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * True iff `candidatePath` is the same as, or nested inside, one of
 * `roots`. Never throws — an unresolvable candidate or root is simply not
 * contained, not an exception. `fsImpl` is injectable for tests.
 */
export function isPathAllowed(candidatePath, roots, fsImpl = fs) {
  if (typeof candidatePath !== 'string' || candidatePath === '') return false;
  if (!Array.isArray(roots) || roots.length === 0) return false;
  const realCandidate = resolveForContainment(candidatePath, fsImpl);
  for (const root of roots) {
    const realRoot = resolveForContainment(root, fsImpl);
    if (isContained(realRoot, realCandidate)) return true;
  }
  return false;
}
