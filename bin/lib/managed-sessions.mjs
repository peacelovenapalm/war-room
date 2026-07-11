/**
 * Managed-session substrate (T2 remote-answer plane + T4 session launch —
 * REMOTE-ANSWER-DESIGN.md, approved 2026-07-11).
 *
 * THE founding constraint, enforced here by construction: the runner can
 * only ever answer sessions it supervises. Every function in this module
 * operates exclusively on tmux sessions the runner itself created (named
 * `war-room-<dispatchId>` and recorded in the machine-local manifest,
 * `~/.war-room/managed-sessions.json`). There is no code path that reaches
 * any other pty — answering an unmanaged session isn't denied by policy,
 * it's unreachable.
 *
 * Discipline carried over from dispatch-rules.mjs / dispatch-runner.mjs:
 *   - argv-array exec everywhere (`execFile`, never `exec` with a composed
 *     shell string) — answer text and prompts are single argv elements,
 *     inert to shell metacharacters.
 *   - deny-by-default: any parse/validation/liveness failure denies with a
 *     reason (data, not an exception); nothing falls open.
 *   - tolerant I/O: a missing/corrupt manifest reads as empty; a failed
 *     write is reported (boolean), never thrown.
 *
 * Injectable `execFileImpl` throughout (promisified execFile shape:
 * `(file, args, opts) => Promise<{ stdout, stderr }>`) so unit tests never
 * need a real tmux server.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Cap on a single answer's text (design: "text over a cap (constant)").
 *  Matches the server's DISPATCH_PROMPT_MAX_CHARS — an answer is at most
 *  prompt-sized. The server validates too; twice-enforced is held. */
export const ANSWER_TEXT_MAX_CHARS = 4000;

/** tmux ≥ 3.2 is the floor for argv-exec `new-session -- cmd arg…` (older
 *  tmux joins the words into ONE string run via `sh -c`, which would turn
 *  the prompt argv element back into shell input — exactly the injection
 *  class the argv discipline exists to kill). Launch DENIES below this. */
export const TMUX_MIN_VERSION = [3, 2];

const TMUX_TIMEOUT_MS = 5_000;

/** Manifest default path (machine-local; the runner is the only writer). */
export function defaultManifestPath() {
  return path.join(os.homedir(), '.war-room', 'managed-sessions.json');
}

/**
 * Derive the runner-owned tmux session name for a dispatch id. The id is
 * server-minted (randomUUID) but arrives OFF THE WIRE, so it is validated
 * here as a strict token before it ever touches a tmux argv — anything
 * else returns null (caller denies `invalid-dispatch-id`).
 */
export function tmuxSessionName(dispatchId) {
  if (typeof dispatchId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(dispatchId)) {
    return null;
  }
  return `war-room-${dispatchId}`;
}

// ── Manifest (machine-local registry of runner-owned sessions) ────

/**
 * Read the manifest. Missing/corrupt/wrong-shape ⇒ [] — deny-by-default
 * composes: an empty manifest means NOTHING is answerable.
 * @returns {Array<{ dispatchId: string, tmuxSession: string, panePid?: number,
 *   cwd?: string, provider?: string, createdAt?: number }>}
 */
export function readManifest(manifestPath, fsImpl = fs) {
  let raw;
  try {
    raw = fsImpl.readFileSync(manifestPath, 'utf8');
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e) =>
      e !== null &&
      typeof e === 'object' &&
      typeof e.dispatchId === 'string' &&
      typeof e.tmuxSession === 'string',
  );
}

/**
 * Write the manifest atomically (temp file + rename — a crash mid-write
 * leaves the previous manifest intact, never a truncated one). Returns
 * false on failure; never throws.
 */
export function writeManifest(manifestPath, entries, fsImpl = fs) {
  const tmpPath = `${manifestPath}.tmp`;
  try {
    fsImpl.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fsImpl.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf8');
    fsImpl.renameSync(tmpPath, manifestPath);
    return true;
  } catch {
    try {
      fsImpl.rmSync(tmpPath, { force: true });
    } catch {
      /* best-effort tmp cleanup */
    }
    return false;
  }
}

// ── tmux liveness (never cached — checked at use time, per design) ─

/**
 * Names of the tmux sessions currently alive. tmux exiting nonzero ("no
 * server running") or being absent entirely both read as an empty set —
 * for liveness purposes "tmux says nothing is running" and "tmux can't
 * say" both mean NOTHING is answerable (deny-by-default composes).
 */
export async function listTmuxSessions(execFileImpl) {
  let stdout;
  try {
    ({ stdout } = await execFileImpl('tmux', ['list-sessions', '-F', '#{session_name}'], {
      timeout: TMUX_TIMEOUT_MS,
    }));
  } catch {
    return new Set();
  }
  return new Set(
    String(stdout ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
  );
}

/** Point-in-time liveness of ONE session (`tmux has-session` exit 0). */
export async function hasTmuxSession(name, execFileImpl) {
  try {
    await execFileImpl('tmux', ['has-session', '-t', `=${name}`], { timeout: TMUX_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify the local tmux supports argv-exec new-session (see
 * TMUX_MIN_VERSION). An unparseable/absent tmux denies — the launch path
 * NEVER falls back to a shell-joined command line.
 */
export async function checkTmuxVersion(execFileImpl) {
  let stdout;
  try {
    ({ stdout } = await execFileImpl('tmux', ['-V'], { timeout: TMUX_TIMEOUT_MS }));
  } catch {
    return { ok: false, reason: 'tmux-unavailable' };
  }
  const match = /(\d+)\.(\d+)/.exec(String(stdout ?? ''));
  if (!match) {
    return { ok: false, reason: 'tmux-version-unparseable' };
  }
  const [major, minor] = [Number(match[1]), Number(match[2])];
  const [minMajor, minMinor] = TMUX_MIN_VERSION;
  if (major > minMajor || (major === minMajor && minor >= minMinor)) {
    return { ok: true };
  }
  return { ok: false, reason: `tmux-too-old: ${match[0]} < ${minMajor}.${minMinor}` };
}

// ── Session launch ────────────────────────────────────────────────

/**
 * Create the runner-owned tmux session for a validated `action: 'session'`
 * request. `argv` comes from buildSessionArgv (dispatch-rules.mjs) — tmux
 * ≥ 3.2 execs it directly, no shell (gated by checkTmuxVersion above).
 * Returns the pane pid (the CLI's own pid, since the CLI IS the pane
 * process) so the server can correlate this session to the agent the
 * hook/poller planes independently observe.
 */
export async function createManagedSession({ dispatchId, cwd, argv }, execFileImpl) {
  const name = tmuxSessionName(dispatchId);
  if (!name) return { ok: false, reason: 'invalid-dispatch-id' };

  const version = await checkTmuxVersion(execFileImpl);
  if (!version.ok) return { ok: false, reason: version.reason };

  // `=name` = exact-match target (never tmux's prefix matching); a
  // pre-existing session with this name means a duplicate/replayed launch —
  // deny, never adopt a session this call didn't create.
  if (await hasTmuxSession(name, execFileImpl)) {
    return { ok: false, reason: 'session-already-exists' };
  }

  try {
    await execFileImpl('tmux', ['new-session', '-d', '-s', name, '-c', cwd, '--', ...argv], {
      timeout: TMUX_TIMEOUT_MS,
    });
  } catch (err) {
    return { ok: false, reason: `tmux-launch-failed: ${shortErr(err)}` };
  }

  let panePid;
  try {
    const { stdout } = await execFileImpl(
      'tmux',
      ['list-panes', '-t', `=${name}`, '-F', '#{pane_pid}'],
      { timeout: TMUX_TIMEOUT_MS },
    );
    const parsed = Number.parseInt(String(stdout ?? '').trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) panePid = parsed;
  } catch {
    /* pane pid is correlation telemetry — its loss never fails the launch */
  }

  return { ok: true, tmuxSession: name, panePid };
}

// ── Answer delivery ───────────────────────────────────────────────

/**
 * Validate answer text BEFORE it goes anywhere near send-keys. Control
 * characters are rejected outright (design: Enter is delivered separately,
 * never embedded — so no \n, no \r, no ESC sequences that could drive the
 * TUI somewhere the human never typed). Length cap per ANSWER_TEXT_MAX_CHARS.
 */
export function validateAnswerText(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, reason: 'invalid-text' };
  }
  if (text.length > ANSWER_TEXT_MAX_CHARS) {
    return { ok: false, reason: 'text-too-long' };
  }
  // eslint-disable-next-line no-control-regex -- rejecting control chars is the point
  if (/[\u0000-\u001F\u007F]/.test(text)) {
    return { ok: false, reason: 'control-chars-rejected' };
  }
  return { ok: true };
}

/**
 * Deliver validated answer text into a manifest-listed, liveness-checked
 * tmux session: literal keystrokes (`send-keys -l -- <text>` — one argv
 * element, `-l` = no key-name interpretation), then Enter as its own
 * separate send. The text lands as keyboard input to the CLI, never as
 * shell input. Caller has already done manifest + nonce checks; this
 * function re-checks liveness at send time (never cached, per design).
 */
export async function deliverAnswer({ tmuxSession, text }, execFileImpl) {
  if (!(await hasTmuxSession(tmuxSession, execFileImpl))) {
    return { ok: false, reason: 'session-dead' };
  }
  try {
    await execFileImpl('tmux', ['send-keys', '-t', `=${tmuxSession}`, '-l', '--', text], {
      timeout: TMUX_TIMEOUT_MS,
    });
    await execFileImpl('tmux', ['send-keys', '-t', `=${tmuxSession}`, 'Enter'], {
      timeout: TMUX_TIMEOUT_MS,
    });
  } catch (err) {
    return { ok: false, reason: `send-failed: ${shortErr(err)}` };
  }
  return { ok: true };
}

function shortErr(err) {
  const m = err instanceof Error ? err.message : String(err);
  return m.split('\n')[0].slice(0, 200);
}
