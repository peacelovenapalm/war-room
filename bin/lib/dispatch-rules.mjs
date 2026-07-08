/**
 * Pure dispatch-runner logic (v1 mechanic #6b) — allowlist parsing, request
 * validation, and CLI argv construction. Zero I/O side effects other than
 * the realpath resolution `validateRequest` needs for symlink-safe path
 * containment (fs.realpathSync is a read, never a write).
 *
 * The runner (bin/dispatch-runner.mjs) is the ONLY thing that decides
 * whether a dispatch/focus request actually runs — this module is that
 * decision, kept pure and unit-testable in isolation from the network/
 * spawn plumbing. Deny-by-default throughout: any parse failure, missing
 * field, or ambiguous containment check denies, never falls open.
 *
 * Pure ESM, zero dependencies beyond node:fs/node:path, unit-tested with
 * node:test (bin/test/dispatch-rules.test.mjs).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const DISPATCH_PROVIDERS = Object.freeze(['claude', 'codex', 'gemini']);

/** The deny-everything template the install runbook writes when no allowlist exists. */
export function emptyAllowlist() {
  return { providers: [], roots: [], focus: false };
}

/**
 * Parse a runner's local allowlist (`~/.war-room/dispatch.json`). Tolerant
 * of missing/wrong-typed fields (sanitized to safe defaults); a totally
 * malformed payload (not JSON, not an object) returns `{ ok: false }` so the
 * caller falls back to `emptyAllowlist()` (deny-all) rather than crashing or
 * running with a partially-trusted shape.
 *
 * @param {unknown} raw - file contents string, or an already-parsed value.
 * @returns {{ ok: true, allowlist: { providers: string[], roots: string[], focus: boolean } }
 *         | { ok: false, reason: string }}
 */
export function parseAllowlist(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text === '') return { ok: false, reason: 'empty allowlist file' };
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { ok: false, reason: `not JSON: ${err instanceof Error ? err.message : err}` };
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'allowlist is not an object' };
  }

  const providers = Array.isArray(parsed.providers)
    ? parsed.providers.filter((p) => typeof p === 'string')
    : [];
  const roots = Array.isArray(parsed.roots)
    ? parsed.roots.filter((r) => typeof r === 'string')
    : [];
  // Deny-by-default: only the literal boolean `true` grants focus.
  const focus = parsed.focus === true;

  return { ok: true, allowlist: { providers, roots, focus } };
}

/**
 * Realpath-resolve a path, or return null if it doesn't exist / can't be
 * resolved. Resolving BOTH the candidate cwd and each allowlisted root
 * collapses symlinks before comparison — a symlink inside an allowed root
 * that points outside it must not grant access.
 */
function tryRealpath(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return null;
  }
}

/** Is `child` the same path as, or nested inside, `root` (both already realpath-resolved)? */
function isContained(root, child) {
  if (root === child) return true;
  const rel = path.relative(root, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Validate a dispatch/focus request against a runner's parsed allowlist.
 * Never throws. Reasons are DATA (rendered as the deny chip's text), not
 * exceptions — the design's "deny is a decision, not an error" rule extends
 * all the way down to this pure check.
 *
 * @param {{ action: 'dispatch' | 'focus', provider?: string, cwd?: string }} request
 * @param {{ providers: string[], roots: string[], focus: boolean }} allowlist
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateRequest(request, allowlist) {
  if (request?.action === 'focus') {
    return allowlist?.focus === true
      ? { ok: true }
      : { ok: false, reason: 'focus-not-allowlisted' };
  }
  if (request?.action !== 'dispatch') {
    return { ok: false, reason: 'unknown-action' };
  }

  if (
    !DISPATCH_PROVIDERS.includes(request.provider) ||
    !allowlist?.providers?.includes(request.provider)
  ) {
    return { ok: false, reason: 'provider-not-allowlisted' };
  }

  if (typeof request.cwd !== 'string' || request.cwd === '') {
    return { ok: false, reason: 'missing-cwd' };
  }
  const realCwd = tryRealpath(request.cwd);
  if (!realCwd) {
    return { ok: false, reason: 'cwd-not-found' };
  }
  const roots = Array.isArray(allowlist?.roots) ? allowlist.roots : [];
  for (const root of roots) {
    const realRoot = tryRealpath(root);
    if (realRoot && isContained(realRoot, realCwd)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'path-not-allowlisted' };
}

/**
 * Build the argv array for a validated dispatch request. The prompt is
 * ALWAYS a single argv element — never concatenated into a shell string —
 * so shell metacharacters in a prompt (`; rm -rf`, backticks, `$(...)`) are
 * inert: `child_process.spawn(argv[0], argv.slice(1), { shell: false })`
 * passes it straight through as one exec() argument.
 *
 * @param {{ provider: string, prompt: string }} request
 * @returns {string[] | null} argv, or null for an unknown provider (should
 *   never happen post-validateRequest — defensive only, never throws).
 */
export function buildArgv(request) {
  switch (request?.provider) {
    case 'claude':
      return ['claude', '-p', request.prompt];
    case 'codex':
      return ['codex', 'exec', request.prompt];
    case 'gemini':
      return ['gemini', '-p', request.prompt];
    default:
      return null;
  }
}
