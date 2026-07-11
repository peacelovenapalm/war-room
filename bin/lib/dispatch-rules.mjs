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
  return { providers: [], roots: [], focus: false, sessions: false };
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
  // Deny-by-default (REMOTE-ANSWER-DESIGN.md): only the literal boolean
  // `true` grants managed-session launch — absent/false/anything-else denies.
  const sessions = parsed.sessions === true;

  return { ok: true, allowlist: { providers, roots, focus, sessions } };
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
 * @param {{ action: 'dispatch' | 'focus' | 'session', provider?: string, cwd?: string }} request
 * @param {{ providers: string[], roots: string[], focus: boolean, sessions?: boolean }} allowlist
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateRequest(request, allowlist) {
  if (request?.action === 'focus') {
    return allowlist?.focus === true
      ? { ok: true }
      : { ok: false, reason: 'focus-not-allowlisted' };
  }
  // Managed-session launch (REMOTE-ANSWER-DESIGN.md): gated on ITS OWN
  // capability flag first (deny-by-default, same as focus), then the exact
  // provider + root-containment checks a dispatch gets — a machine that can
  // run headless dispatches cannot launch interactive sessions until Greg
  // hand-edits `"sessions": true` into its dispatch.json.
  if (request?.action === 'session' && allowlist?.sessions !== true) {
    return { ok: false, reason: 'sessions-not-allowlisted' };
  }
  if (request?.action !== 'dispatch' && request?.action !== 'session') {
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

/** Providers with a real `--effort` (or equivalent) flag, verified against
 *  each CLI's own `--help` output — see the buildArgv doc comment below for
 *  the exact flags per provider. Requesting effort for a provider not in
 *  this set is honored by validation (a generic effort string) but silently
 *  omitted from argv here rather than passed to a flag that doesn't exist. */
const PROVIDERS_WITH_EFFORT = new Set(['claude']);

/**
 * Build the argv array for a validated dispatch request. The prompt is
 * ALWAYS a single argv element — never concatenated into a shell string —
 * so shell metacharacters in a prompt (`; rm -rf`, backticks, `$(...)`) are
 * inert: `child_process.spawn(argv[0], argv.slice(1), { shell: false })`
 * passes it straight through as one exec() argument.
 *
 * Per-provider flags (verified via `<cli> --help` / `<cli> exec --help` on
 * 2026-07-08 — re-verify if a CLI's help output changes):
 *   - claude: `-p` (`--print`) is a boolean flag, `--model <model>` and
 *     `--effort <level>` each take a value, prompt is a trailing positional.
 *   - codex: `codex exec [OPTIONS] [PROMPT]` — prompt is positional.
 *     `--skip-git-repo-check` is required here because the runner's OWN
 *     allowlist containment check (validateRequest, realpath + relative)
 *     is already the trust boundary for "is this cwd allowed" — codex's own
 *     git-repo trust prompt would otherwise block non-interactive `exec` runs
 *     at a cwd that is a legitimate allowlisted root but not a git repo (or
 *     not yet trusted by codex itself), which is exactly the failure seen in
 *     production. `-m`/`--model <MODEL>` takes a value; there is no
 *     `--effort` flag, so effort is never appended for codex.
 *   - gemini: `-p`/`--prompt <string>` TAKES the prompt as its own value
 *     (unlike claude's boolean `-p`), so any other flags must come BEFORE
 *     `-p`. `-m`/`--model` takes a value; there is no effort flag, so effort
 *     is never appended for gemini.
 *
 * @param {{ provider: string, prompt: string, model?: string, effort?: string }} request
 * @returns {string[] | null} argv, or null for an unknown provider (should
 *   never happen post-validateRequest — defensive only, never throws).
 */
export function buildArgv(request) {
  const model =
    typeof request?.model === 'string' && request.model.trim() !== '' ? request.model : undefined;
  const effort =
    typeof request?.effort === 'string' && request.effort.trim() !== ''
      ? request.effort
      : undefined;
  const includeEffort = (provider) => effort !== undefined && PROVIDERS_WITH_EFFORT.has(provider);

  switch (request?.provider) {
    case 'claude': {
      const argv = ['claude', '-p'];
      if (model) argv.push('--model', model);
      if (includeEffort('claude')) argv.push('--effort', effort);
      argv.push(request.prompt);
      return argv;
    }
    case 'codex': {
      const argv = ['codex', 'exec', '--skip-git-repo-check'];
      if (model) argv.push('--model', model);
      argv.push(request.prompt);
      return argv;
    }
    case 'gemini': {
      const argv = ['gemini'];
      if (model) argv.push('--model', model);
      argv.push('-p', request.prompt);
      return argv;
    }
    default:
      return null;
  }
}

/**
 * Build the argv array for a validated MANAGED-SESSION launch (T2/T4,
 * REMOTE-ANSWER-DESIGN.md) — the INTERACTIVE counterpart of buildArgv: no
 * `-p`/`exec` headless flags, so the CLI runs its normal interactive TUI
 * inside the runner-owned tmux session. Same argv-element discipline: the
 * optional brief/prompt is ALWAYS one argv element, never a shell string
 * (the runner passes this array to `tmux new-session -d -s <name> -- …`,
 * which execs it directly — no shell anywhere, enforced by the runner's
 * tmux-version gate).
 *
 * Per-provider interactive shapes (verified against each CLI's --help,
 * 2026-07-11):
 *   - claude: optional trailing positional prompt; --model/--effort as in
 *     buildArgv.
 *   - codex: bare `codex [PROMPT]` is the interactive TUI; `-m/--model`
 *     takes a value; no effort flag.
 *   - gemini: `-i/--prompt-interactive <prompt>` starts interactive WITH a
 *     first prompt (plain `-p` would run headless); without a prompt the
 *     bare TUI launches. `-m/--model` takes a value; no effort flag.
 *
 * @param {{ provider: string, prompt?: string, model?: string, effort?: string }} request
 * @returns {string[] | null} argv, or null for an unknown provider.
 */
export function buildSessionArgv(request) {
  const model =
    typeof request?.model === 'string' && request.model.trim() !== '' ? request.model : undefined;
  const effort =
    typeof request?.effort === 'string' && request.effort.trim() !== ''
      ? request.effort
      : undefined;
  const prompt =
    typeof request?.prompt === 'string' && request.prompt.trim() !== ''
      ? request.prompt
      : undefined;

  switch (request?.provider) {
    case 'claude': {
      const argv = ['claude'];
      if (model) argv.push('--model', model);
      if (effort !== undefined && PROVIDERS_WITH_EFFORT.has('claude')) {
        argv.push('--effort', effort);
      }
      if (prompt) argv.push(prompt);
      return argv;
    }
    case 'codex': {
      const argv = ['codex'];
      if (model) argv.push('--model', model);
      if (prompt) argv.push(prompt);
      return argv;
    }
    case 'gemini': {
      const argv = ['gemini'];
      if (model) argv.push('--model', model);
      if (prompt) argv.push('-i', prompt);
      return argv;
    }
    default:
      return null;
  }
}
