#!/usr/bin/env node

/**
 * War Room dispatch runner (v1 mechanic #6b "call a coworker") — one opt-in
 * instance per machine, runbook-installed (.planning/runbooks/
 * install-dispatch-runner-launchd.sh).
 *
 * The server NEVER shells out — it only queues dispatch/focus requests. This
 * runner polls that queue over the same authed channel as the needs-input
 * poller (POST /api/dispatch/poll, Bearer + X-Machine), and decides LOCALLY,
 * against its own allowlist (`~/.war-room/dispatch.json`, installed by the
 * runbook) whether to honor a request. The server cannot override that
 * decision. See `.planning/DISPATCH-6B-DESIGN.md` for the full threat model.
 *
 * Every tick:
 *   1. Re-read + parse the allowlist (a vanished/corrupt file means DENY
 *      EVERYTHING this tick, never falls back to permissive).
 *   2. POST the allowlist's providers/roots/focus as this machine's
 *      advertisement, receiving this machine's ringing requests in return
 *      (WITH the full prompt -- the only place it travels the wire, and
 *      only to this Bearer-authed poll).
 *   3. For each request not already handled this process's lifetime:
 *      validate against the JUST-RE-READ allowlist, then either deny (2xx
 *      decision, reason as data) or honor it:
 *        - dispatch: build argv (prompt is ALWAYS one argv element, never a
 *          shell string), accept, spawn(..., { shell: false }), report
 *          started (pid) then exited (exitCode + a capped resultTail read
 *          from the per-run log so the run's actual output reaches the
 *          dashboard); stdout/stderr -> a per-run log file.
 *        - focus: best-effort AppleScript front-the-terminal-by-pid, report
 *          the outcome AS the decision itself (accept = fronted, deny =
 *          could not).
 *   4. Append every decision/spawn/exit to an append-only local audit log.
 *
 * Failure policy: a malformed poll response or an unreachable server SKIPS
 * the tick with a ⚠ log line, same contract as needs-input-poller.mjs. The
 * runner never crashes on bad data, and never spawns without an explicit
 * accept decision already having been posted.
 *
 * Worker session kill (KICKOFF v1.1 item 3 — the first server->runner
 * IMPERATIVE channel; everything above is runner-polls-and-decides). Every
 * poll response also carries `stop: StopInstruction[]` (dispatchStore.ts's
 * doc has the full shape) — processed this SAME tick, after `pending`:
 *   - `{kind:'dispatch', id}`: kill a child THIS runner itself spawned.
 *     ONLY honored if `id` is in `state.children` (this process's own
 *     in-memory live-children registry, populated in runDispatch() and
 *     cleared on that child's own 'exit'). No match => reported outcome
 *     'not-found', NEVER a raw process.kill(pid) fallback — the registry IS
 *     the containment boundary, no exceptions.
 *   - `{kind:'pid', id, pid}`: kill an OBSERVED session (any worker with a
 *     known pid, including one this runner never spawned). ONLY honored
 *     after `verifyClaudeProcess(pid)` confirms the target is actually a
 *     claude process (via `ps`) — a verification failure denies with a
 *     reason, NEVER a raw signal on an unverified target, regardless of
 *     whether the pid happens to also be in the dispatch registry (the two
 *     containment rules are never cross-shortcut).
 *
 * T2/T4 managed sessions (REMOTE-ANSWER-DESIGN.md, approved 2026-07-11):
 *   - `action: 'session'` launches an INTERACTIVE provider CLI inside a
 *     runner-owned tmux session (`war-room-<dispatchId>`), gated on its own
 *     deny-by-default `"sessions": true` allowlist flag plus the same
 *     provider/root checks a dispatch gets. Recorded in the machine-local
 *     manifest (~/.war-room/managed-sessions.json); liveness re-derived
 *     from tmux every tick (dead sessions report `exited` and drop out).
 *   - Every poll advertises the live managed-session list — the server's
 *     ONLY license to mark agents answerable.
 *   - `answer: AnswerInstruction[]` rides the poll response (same drained
 *     at-most-once channel as stop[]): one-shot nonce, manifest+alive
 *     re-checked at delivery time, literal `send-keys -l` + separate Enter,
 *     verbatim-text audit line per outcome. Sessions the runner never
 *     launched are unreachable BY CONSTRUCTION — there is no code path to
 *     any other pty.
 *
 * T5 fleet controls, PER-DISPATCH TIME CAP — a `dispatch` item optionally
 * carries `timeoutSec`; when present, runDispatch() arms a timer at spawn
 * (see `triggerCap`). At the cap: SIGTERM through the SAME live-children
 * registry (never a raw pid), then SIGKILL after KILL_GRACE_MS if the child
 * ignores TERM. Reports the DISTINCT terminal event 'capped' — never
 * conflated with a human-initiated 'killed' or a natural 'exited'.
 *
 * Config (env, overridable by flags):
 *   WAR_ROOM_URL                  server base URL  (default http://127.0.0.1:3141)
 *   WAR_ROOM_TOKEN                bearer token     (REQUIRED)
 *   WAR_ROOM_MACHINE              machine TEXT label (default: short hostname, uppercased)
 *   WAR_ROOM_DISPATCH_POLL_MS     poll interval ms (default 5000, min 2000)
 *   WAR_ROOM_DISPATCH_ALLOWLIST   allowlist path   (default ~/.war-room/dispatch.json, REQUIRED to exist)
 *   WAR_ROOM_DISPATCH_LOG_DIR     per-run log dir  (default ~/Library/Logs/war-room-dispatch-runs)
 *   WAR_ROOM_DISPATCH_AUDIT_LOG   audit log path   (default ~/Library/Logs/war-room-dispatch.log)
 * Flags: --url <u> --machine <m> --interval <ms> --allowlist <path> --once --help
 */

import { exec, execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import {
  buildArgv,
  buildComputeArgv,
  buildSessionArgv,
  emptyAllowlist,
  parseAllowlist,
  validateRequest,
} from './lib/dispatch-rules.mjs';
import {
  createManagedSession,
  defaultManifestPath,
  deliverAnswer,
  listTmuxSessions,
  readManifest,
  validateAnswerText,
  writeManifest,
} from './lib/managed-sessions.mjs';
import { createOutputForwarder } from './lib/output-forwarder.mjs';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const POST_TIMEOUT_MS = 10_000;
const FOCUS_TIMEOUT_MS = 5_000;
const MIN_INTERVAL_MS = 2_000;
/** Upper bound on how long the terminal (exited/killed) status POST waits
 *  for the output forwarder's final flush. The server's /output route is
 *  liveness-gated (non-terminal dispatches only), so a terminal status POST
 *  that overtakes the final flush would evict the ring entry and silently
 *  drop the run's last chunks — the flush must be sequenced FIRST. But a
 *  hung server must never stall exit reporting indefinitely (same posture
 *  as readResultTail: lost telemetry is acceptable, a missing terminal
 *  status is not), so the wait is bounded at one POST timeout. */
const FINAL_FLUSH_MAX_WAIT_MS = POST_TIMEOUT_MS;
/** Tail of the per-run log posted alongside `exited` — the only place a run's
 *  actual output reaches the dashboard (otherwise it's stranded in a log file
 *  on whichever machine ran it). Capped well under the server's own cap
 *  (dispatchStore.ts DISPATCH_RESULT_TAIL_MAX_CHARS) so a chatty run never
 *  balloons the status POST. */
const RESULT_TAIL_MAX_BYTES = 8 * 1024;
/** T5 fleet controls, PER-DISPATCH TIME CAP: grace period between the cap
 *  timer's SIGTERM and its SIGKILL escalation if the child ignores TERM.
 *  Overridable via deps.killGraceMs for tests (real timers would otherwise
 *  make an escalation test slow). */
const KILL_GRACE_MS = 5_000;
/** C9-4: consumed-nonce retention. `state.consumedNonces` (the one-shot
 *  answer-nonce replay guard) was an unbounded Set that grew for the runner's
 *  entire process lifetime. A nonce only needs guarding while its answer
 *  record could still be replayed server-side; that record sweeps to a
 *  terminal state after the server's ANSWER_TTL_MS (600_000 ms). Keying
 *  consumed nonces by consumption time and evicting past this SAME window
 *  bounds the map without ever narrowing the real replay defense (an evicted
 *  nonce's server record is already terminal). */
const CONSUMED_NONCE_TTL_MS = 600_000;

/**
 * Consume a one-shot answer nonce with TTL-bounded replay protection (C9-4).
 * `consumed` is a Map<nonce, consumedAtMs>. Expired entries are pruned on
 * every call (keeping the map bounded to at most one TTL window's worth of
 * nonces), then the nonce is checked: a still-live prior consumption is a
 * replay; otherwise it is recorded. Returns `{ replayed }`.
 */
export function consumeNonce(consumed, nonce, now = Date.now(), ttlMs = CONSUMED_NONCE_TTL_MS) {
  for (const [n, at] of consumed) {
    if (now - at > ttlMs) consumed.delete(n);
  }
  if (consumed.has(nonce)) return { replayed: true };
  consumed.set(nonce, now);
  return { replayed: false };
}

// ── Config ──────────────────────────────────────────────────────

function machineLabelDefault() {
  const raw = process.env.WAR_ROOM_MACHINE || os.hostname().split('.')[0] || 'LOCAL';
  return (
    raw
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '-')
      .slice(0, 32) || 'LOCAL'
  );
}

export function parseArgs(argv) {
  const cfg = {
    url: process.env.WAR_ROOM_URL || 'http://127.0.0.1:3141',
    token: process.env.WAR_ROOM_TOKEN || '',
    machine: machineLabelDefault(),
    intervalMs: Number(process.env.WAR_ROOM_DISPATCH_POLL_MS) || 5_000,
    allowlistPath:
      process.env.WAR_ROOM_DISPATCH_ALLOWLIST ||
      path.join(os.homedir(), '.war-room', 'dispatch.json'),
    logDir:
      process.env.WAR_ROOM_DISPATCH_LOG_DIR ||
      path.join(os.homedir(), 'Library', 'Logs', 'war-room-dispatch-runs'),
    auditLog:
      process.env.WAR_ROOM_DISPATCH_AUDIT_LOG ||
      path.join(os.homedir(), 'Library', 'Logs', 'war-room-dispatch.log'),
    manifestPath: process.env.WAR_ROOM_MANAGED_MANIFEST || defaultManifestPath(),
    once: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && argv[i + 1]) cfg.url = argv[++i];
    else if (a === '--machine' && argv[i + 1]) cfg.machine = argv[++i];
    else if (a === '--interval' && argv[i + 1]) cfg.intervalMs = Number(argv[++i]);
    else if (a === '--allowlist' && argv[i + 1]) cfg.allowlistPath = argv[++i];
    else if (a === '--once') cfg.once = true;
    else if (a === '--help') {
      console.log(
        'Usage: dispatch-runner.mjs [--url <base>] [--machine <label>] [--interval <ms>] ' +
          '[--allowlist <path>] [--once]\n' +
          'Requires WAR_ROOM_TOKEN in the environment (never passed as a flag) and an ' +
          'existing allowlist file (see .planning/runbooks/install-dispatch-runner-launchd.sh).',
      );
      process.exit(0);
    }
  }
  if (!Number.isFinite(cfg.intervalMs) || cfg.intervalMs < MIN_INTERVAL_MS) {
    cfg.intervalMs = 5_000;
  }
  cfg.url = cfg.url.replace(/\/+$/, '');
  return cfg;
}

// ── Allowlist (re-read every tick — vanish/corruption ⇒ deny-all) ──

function readAllowlist(cfg) {
  let raw;
  try {
    raw = fs.readFileSync(cfg.allowlistPath, 'utf8');
  } catch (err) {
    log(`⚠ allowlist unreadable (${shortErr(err)}) — denying everything this tick`);
    return emptyAllowlist();
  }
  const result = parseAllowlist(raw);
  if (!result.ok) {
    log(`⚠ allowlist corrupt (${result.reason}) — denying everything this tick`);
    return emptyAllowlist();
  }
  return result.allowlist;
}

// ── Skills advertisement (4B) ───────────────────────────────────

/** Skill names are directory names — same names-only wire discipline as
 *  scriptIds (never paths, never file contents). */
export const SKILL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const SKILLS_MAX = 200;
const SKILLS_CACHE_TTL_MS = 60_000;
let skillsCache = { at: 0, names: [], home: '' };

/** Enumerate the machine's global skills (~/.claude/skills dir names) for
 *  the poll advertisement — the CALL modal's skill picker source. Names
 *  only: pattern-filtered, capped, cached (a readdir per minute, not per
 *  tick). Unreadable dir → empty list, never a throw (a machine without
 *  skills is honestly skill-less). */
export function listSkills(nowMs = Date.now(), fsImpl = fs, homedir = os.homedir()) {
  if (
    skillsCache.at !== 0 &&
    skillsCache.home === homedir &&
    nowMs - skillsCache.at < SKILLS_CACHE_TTL_MS
  ) {
    return skillsCache.names;
  }
  let names = [];
  try {
    names = fsImpl
      .readdirSync(path.join(homedir, '.claude', 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && SKILL_NAME_PATTERN.test(e.name))
      .map((e) => e.name)
      .sort()
      .slice(0, SKILLS_MAX);
  } catch {
    names = [];
  }
  skillsCache = { at: nowMs, names, home: homedir };
  return names;
}

// ── Server calls ────────────────────────────────────────────────

async function postDispatchPoll(cfg, allowlist, managedSessions, fetchImpl) {
  // T8 Mini compute: advertise only the registered scriptId NAMES, never the
  // interpreter/path/registry internals — the wire carries intent, the local
  // registry carries the capability (MINI-COMPUTE-NODE.md trust boundary).
  const { compute, ...capabilities } = allowlist;
  const scriptIds = compute?.scripts ? Object.keys(compute.scripts) : [];
  // 4B: skills are names-only too — the picker composes a visible `/name`
  // prefix into the prompt client-side; no new dispatch-request field.
  const skills = listSkills();
  return fetchImpl(`${cfg.url}/api/dispatch/poll`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.token}`,
      'x-machine': cfg.machine,
    },
    // The allowlist advertisement (providers/roots/focus/sessions) plus the
    // live managed-session list (T2 remote-answer plane) — the server's ONLY
    // source for which agents may render ANSWER. Alive-in-tmux entries only,
    // re-derived every tick, never cached (REMOTE-ANSWER-DESIGN.md). scriptIds
    // are names-only (T8) so the CALL tray can render a real script picker.
    body: JSON.stringify({ ...capabilities, scriptIds, skills, managedSessions }),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
}

async function postDecision(cfg, id, decision, opts, fetchImpl) {
  try {
    await fetchImpl(`${cfg.url}/api/dispatch/${id}/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({ decision, ...opts }),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
  } catch (err) {
    log(`⚠ decision POST failed for ${id} (${shortErr(err)})`);
  }
}

async function postStatus(cfg, id, body, fetchImpl) {
  try {
    await fetchImpl(`${cfg.url}/api/dispatch/${id}/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
  } catch (err) {
    log(`⚠ status POST failed for ${id} (${shortErr(err)})`);
  }
}

/** Report an observed-session pid-kill outcome (KICKOFF v1.1 item 3's
 *  separate, non-dispatch-id lifecycle — see verifyClaudeProcess/
 *  processPidKillStop below). Best-effort, same tolerance as postStatus. */
async function postPidKillStatus(cfg, id, event, reason, fetchImpl) {
  try {
    await fetchImpl(`${cfg.url}/api/pid-kills/${id}/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({ event, reason }),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
  } catch (err) {
    log(`⚠ pid-kill status POST failed for ${id} (${shortErr(err)})`);
  }
}

/** Report an answer-delivery outcome (T2 remote-answer plane — its own
 *  lifecycle, keyed by the AnswerInstruction id, mirroring pid-kills).
 *  Best-effort, same tolerance as postStatus. */
async function postAnswerStatus(cfg, id, event, reason, fetchImpl) {
  try {
    await fetchImpl(`${cfg.url}/api/answers/${id}/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({ event, reason }),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
  } catch (err) {
    log(`⚠ answer status POST failed for ${id} (${shortErr(err)})`);
  }
}

// ── Focus (best-effort, macOS AppleScript) ─────────────────────

/**
 * Best-effort front-the-terminal-by-pid. Deny-by-default: only a validated
 * request (allowlist.focus === true, checked by the caller) reaches here,
 * and even then a missing/non-integer pid or a non-darwin host denies
 * honestly rather than guessing. Returns the result AS the decision (per
 * design: focus reports its outcome as accept/deny, not a separate status).
 */
export async function attemptFocus(item, execImpl = execAsync) {
  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'focus-unsupported-platform' };
  }
  if (!Number.isInteger(item.pid) || item.pid <= 0) {
    return { ok: false, reason: 'missing-pid' };
  }
  const script = `tell application "System Events" to set frontmost of (first process whose unix id is ${item.pid}) to true`;
  try {
    await execImpl(`osascript -e '${script}'`, { timeout: FOCUS_TIMEOUT_MS });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `focus-failed: ${shortErr(err)}` };
  }
}

// ── Worker session kill: observed-session pid verification ──────

/** The containment gate for the OBSERVED-SESSION kill path (KICKOFF v1.1
 *  item 3): the runner must NEVER signal a raw, unverified pid off the
 *  wire. `pid` is already validated as a positive integer by the caller
 *  (processPidKillStop) — interpolated into a shell command here only as a
 *  number, never as untrusted string content, same posture as attemptFocus's
 *  own osascript interpolation. Injectable `execImpl` (defaults to the same
 *  `execAsync` attemptFocus uses) so this is unit-testable without a real
 *  process, and re-usable in tests against a REAL process for the positive
 *  case. Deny-by-default: any lookup failure (process gone, `ps` error, a
 *  command line that doesn't mention "claude") denies with a reason, never
 *  a guess. */
export async function verifyClaudeProcess(pid, execImpl = execAsync) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, reason: 'invalid-pid' };
  }
  let stdout;
  try {
    ({ stdout } = await execImpl(`ps -p ${pid} -o command=`, { timeout: FOCUS_TIMEOUT_MS }));
  } catch (err) {
    // A nonzero exit from `ps -p` (process doesn't exist) lands here too —
    // an honest "not found" rather than treating a lookup error as license
    // to signal anyway.
    return { ok: false, reason: `verify-failed: ${shortErr(err)}` };
  }
  const command = (stdout ?? '').trim();
  if (!command) {
    return { ok: false, reason: 'process-not-found' };
  }
  if (!/\bclaude\b/i.test(command)) {
    return { ok: false, reason: 'not-a-claude-process' };
  }
  return { ok: true };
}

// ── Spawn (dispatch action) ─────────────────────────────────────

function ensureLogDir(cfg) {
  try {
    fs.mkdirSync(cfg.logDir, { recursive: true });
  } catch {
    /* best-effort — spawn still proceeds, just without a log sink */
  }
}

/** Append one audit line (append-only, tolerant — never throws). */
function audit(cfg, event, fields) {
  try {
    fs.mkdirSync(path.dirname(cfg.auditLog), { recursive: true });
    fs.appendFileSync(
      cfg.auditLog,
      `${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}\n`,
      'utf8',
    );
  } catch {
    /* audit-log loss must never crash the runner */
  }
}

/** Read the last RESULT_TAIL_MAX_BYTES of a run's log file. Tolerant of a
 *  missing/unreadable file (returns undefined) — a lost result tail must
 *  never block the `exited` status POST. */
function readResultTail(logPath) {
  try {
    const stat = fs.statSync(logPath);
    const start = Math.max(0, stat.size - RESULT_TAIL_MAX_BYTES);
    const length = stat.size - start;
    const fd = fs.openSync(logPath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

/**
 * T5 fleet controls, PER-DISPATCH TIME CAP: fires when `item.timeoutSec`
 * elapses. Uses the EXACT SAME containment discipline as
 * processDispatchStop — the registry IS the boundary, never a raw pid — but
 * reports a DISTINCT terminal event ('capped'), never conflated with a
 * human-initiated 'killed'. Escalates SIGTERM -> SIGKILL after
 * KILL_GRACE_MS if the child ignores the first signal. A no-op if the
 * dispatch already exited or was already capped/killed by the time the
 * timer fires (registry lookup naturally guards this — 'exit' always
 * deletes the entry first).
 */
function triggerCap(cfg, id, state, deps) {
  const entry = state.children.get(id);
  if (!entry || entry.capped || entry.killRequested) return;
  // Codex fix round finding 5: mark capped ONLY after the TERM actually
  // delivered. kill() returning false (or throwing) means the child is
  // already dead/exiting — its natural 'exited' report must stand; marking
  // capped first would mislabel a natural exit that raced the cap timer.
  let delivered = false;
  try {
    delivered = entry.child.kill('SIGTERM');
  } catch (err) {
    audit(cfg, 'cap-signal-error', { id, pid: entry.child.pid, reason: shortErr(err) });
  }
  if (!delivered) {
    audit(cfg, 'cap-signal-undelivered', { id, pid: entry.child.pid });
    return;
  }
  entry.capped = true;
  audit(cfg, 'cap-signal-sent', { id, pid: entry.child.pid });
  const graceMs = deps.killGraceMs ?? KILL_GRACE_MS;
  const escalationTimer = setTimeout(() => {
    const stillRunning = state.children.get(id);
    if (!stillRunning) return; // already exited — nothing to escalate
    try {
      stillRunning.child.kill('SIGKILL');
      audit(cfg, 'cap-escalated-sigkill', { id, pid: stillRunning.child.pid });
    } catch (err) {
      audit(cfg, 'cap-escalation-error', {
        id,
        pid: stillRunning.child.pid,
        reason: shortErr(err),
      });
    }
  }, graceMs);
  escalationTimer.unref?.();
  entry.escalationTimer = escalationTimer;
}

function runDispatch(cfg, item, argv, state, deps) {
  const spawnImpl = deps.spawn ?? spawn;
  ensureLogDir(cfg);
  const logPath = path.join(cfg.logDir, `${item.id}.log`);
  let logStream;
  try {
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
    // createWriteStream opens the fd lazily/async — a bad log dir surfaces as
    // an 'error' event, not a synchronous throw. An unhandled 'error' event
    // crashes the process, so this permanent listener keeps the run's
    // spawn/exit reporting alive even when logging itself is broken.
    logStream.on('error', () => {});
  } catch {
    logStream = null;
  }

  const child = spawnImpl(argv[0], argv.slice(1), {
    cwd: item.cwd,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Worker session kill (KICKOFF v1.1 item 3): THIS is the containment
  // boundary for the dispatch-id stop path — a stop instruction is honored
  // ONLY for an id present in this registry, never a raw pid off the wire.
  // Registered here (right after a real spawn), cleared unconditionally on
  // 'exit' below (whether that exit was self-caused or the result of a stop
  // instruction's SIGTERM).
  const registryEntry = {
    child,
    killRequested: false,
    capped: false,
    capTimer: null,
    escalationTimer: null,
  };
  state.children.set(item.id, registryEntry);

  // T5 fleet controls, PER-DISPATCH TIME CAP: arm the timer only when the
  // request actually carried one (absent = no cap, current behavior).
  // Cleared in the 'exit' handler below if the process finishes on its own
  // before the cap fires.
  // The server already validates timeoutSec as a positive integer <=
  // DISPATCH_TIMEOUT_MAX_SEC before it ever reaches a poll response — the
  // runner just needs a usable positive number to schedule a timer with,
  // same trust level as model/effort (validated once, upstream, not
  // re-validated here).
  if (
    typeof item.timeoutSec === 'number' &&
    Number.isFinite(item.timeoutSec) &&
    item.timeoutSec > 0
  ) {
    const capTimer = setTimeout(
      () => triggerCap(cfg, item.id, state, deps),
      item.timeoutSec * 1000,
    );
    capTimer.unref?.();
    registryEntry.capTimer = capTimer;
  }

  // Live output forwarding (KICKOFF-v2.0 Phase 2 slice 2.5) — ADDITIVE tap
  // beside the per-run log stream (which stays the durable record):
  // coalesced chunks POST to the Bearer-authed /api/dispatch/:id/output.
  // Telemetry only, fire-and-forget: a dead server never crashes or blocks
  // the runner (the forwarder swallows every POST failure), and the flush
  // loop stops with a final flush when the child exits.
  const forwarder = (deps.createOutputForwarder ?? createOutputForwarder)({
    url: cfg.url,
    token: cfg.token,
    id: item.id,
    fetchImpl: deps.fetch ?? fetch,
    log,
  });

  child.stdout?.on('data', (chunk) => {
    logStream?.write(chunk);
    forwarder.push('stdout', chunk);
  });
  child.stderr?.on('data', (chunk) => {
    logStream?.write(chunk);
    forwarder.push('stderr', chunk);
  });

  void postStatus(cfg, item.id, { event: 'started', pid: child.pid }, deps.fetch ?? fetch);
  audit(cfg, 'started', { id: item.id, pid: child.pid, provider: item.provider, cwd: item.cwd });

  child.on('exit', (code) => {
    const finalEntry = state.children.get(item.id);
    const wasKilled = finalEntry?.killRequested === true;
    const wasCapped = finalEntry?.capped === true;
    // Clear both timers regardless of which path this exit took — a
    // natural exit before the cap ever fired must not leave a stray timer
    // that later signals a long-gone pid; a cap that already fired has
    // nothing left to escalate once the child is actually gone.
    if (finalEntry?.capTimer) clearTimeout(finalEntry.capTimer);
    if (finalEntry?.escalationTimer) clearTimeout(finalEntry.escalationTimer);
    state.children.delete(item.id);
    // Final output flush — stops the coalescing loop. The returned promise
    // (the forwarder's serialized POST chain) GATES the terminal status
    // POST below: the server's /output route is liveness-gated, so letting
    // the exited/killed status POST win the race would evict the ring entry
    // and reject the flush — subscribers would silently lose the run's last
    // output. Bounded via FINAL_FLUSH_MAX_WAIT_MS in reportExited (a hung
    // server delays exit reporting by at most one POST timeout, then the
    // report proceeds without the flush). stop() itself never throws.
    const finalFlush = forwarder.stop();
    const exitCode = typeof code === 'number' ? code : -1;
    // Read the tail AFTER the log stream settles — reading immediately on
    // 'exit' can race the write stream's buffered data. Guards against
    // double-reporting: whichever of 'finish' (clean flush) or 'error' (a
    // stream that never opened, e.g. an unwritable log dir) fires first wins.
    let reported = false;
    const reportExited = () => {
      if (reported) return;
      reported = true;
      const resultTail = readResultTail(logPath);
      // DISTINCT terminal statuses, never conflated: an explicit kill
      // (KICKOFF v1.1 item 3), a T5 fleet-controls cap, or a natural exit.
      // capped takes priority over killed — a human kill racing an
      // already-fired cap timer is still honestly reported as capped (the
      // cap is what actually ended it first).
      const event = wasCapped ? 'capped' : wasKilled ? 'killed' : 'exited';
      // Sequence AFTER the final output flush (bounded — see finalFlush's
      // comment above) so the terminal status POST can never overtake the
      // run's last chunks into the server's liveness-gated /output route.
      const maxWaitMs = deps.finalFlushMaxWaitMs ?? FINAL_FLUSH_MAX_WAIT_MS;
      const bound = new Promise((resolve) => {
        const t = setTimeout(resolve, maxWaitMs);
        t.unref?.();
      });
      void Promise.race([finalFlush, bound]).then(() => {
        void postStatus(cfg, item.id, { event, exitCode, resultTail }, deps.fetch ?? fetch);
        audit(cfg, event, { id: item.id, pid: child.pid, exitCode, resultTail });
      });
    };
    if (logStream) {
      logStream.once('finish', reportExited);
      logStream.once('error', reportExited);
      logStream.end();
    } else {
      reportExited();
    }
  });
  child.on('error', (err) => {
    const erroredEntry = state.children.get(item.id);
    if (erroredEntry?.capTimer) clearTimeout(erroredEntry.capTimer);
    if (erroredEntry?.escalationTimer) clearTimeout(erroredEntry.escalationTimer);
    state.children.delete(item.id);
    void forwarder.stop();
    log(`⚠ spawn error for ${item.id}: ${shortErr(err)}`);
    audit(cfg, 'spawn-error', { id: item.id, reason: shortErr(err) });
  });
}

// ── Worker session kill: stop-instruction processing ─────────────

/** Dispatch-id kill: registry-only, no exceptions. `state.children` is THIS
 *  process's own in-memory live-children map — it only knows about
 *  dispatches THIS runner itself spawned since it started. No match =>
 *  'not-found', reported honestly, never a raw process.kill(pid) fallback. */
async function processDispatchStop(cfg, state, id, deps) {
  const fetchImpl = deps.fetch ?? fetch;
  const entry = state.children.get(id);
  if (!entry) {
    await postStatus(cfg, id, { event: 'killed', killOutcome: 'not-found' }, fetchImpl);
    audit(cfg, 'stop-not-found', { id });
    return;
  }
  entry.killRequested = true;
  try {
    entry.child.kill('SIGTERM');
    audit(cfg, 'kill-signal-sent', { id, pid: entry.child.pid });
  } catch (err) {
    // The child's own 'exit' handler still fires and reports the terminal
    // status either way — this is a best-effort audit line, not the report.
    audit(cfg, 'kill-signal-error', { id, pid: entry.child.pid, reason: shortErr(err) });
  }
  // The actual 'killed' status POST happens in runDispatch's exit handler
  // once the process actually exits — never reported twice.
}

/** Observed-session kill: verification-gated, no exceptions — see
 *  verifyClaudeProcess's doc. Never skips verification even if `pid`
 *  happens to also be a registered dispatch child; the two containment
 *  rules are never cross-shortcut. */
async function processPidKillStop(cfg, instr, deps) {
  const fetchImpl = deps.fetch ?? fetch;
  const verify = deps.verifyClaudeProcess ?? verifyClaudeProcess;
  const execImpl = deps.execForVerify ?? execAsync;
  const killImpl = deps.killImpl ?? ((pid, signal) => process.kill(pid, signal));
  const verified = await verify(instr.pid, execImpl);
  if (!verified.ok) {
    await postPidKillStatus(cfg, instr.id, 'denied', verified.reason, fetchImpl);
    audit(cfg, 'pid-kill-denied', { id: instr.id, pid: instr.pid, reason: verified.reason });
    return;
  }
  try {
    killImpl(instr.pid, 'SIGTERM');
    await postPidKillStatus(cfg, instr.id, 'killed', undefined, fetchImpl);
    audit(cfg, 'pid-killed', { id: instr.id, pid: instr.pid });
  } catch (err) {
    const reason = `kill-failed: ${shortErr(err)}`;
    await postPidKillStatus(cfg, instr.id, 'denied', reason, fetchImpl);
    audit(cfg, 'pid-kill-failed', { id: instr.id, pid: instr.pid, reason });
  }
}

/** Dispatch one poll tick's `stop` array — never throws (each instruction is
 *  independently try/caught so one bad entry can't skip the rest). */
async function processStopInstructions(cfg, state, stopInstructions, deps) {
  for (const instr of stopInstructions) {
    if (!instr || typeof instr.kind !== 'string') continue;
    try {
      if (instr.kind === 'dispatch' && typeof instr.id === 'string') {
        await processDispatchStop(cfg, state, instr.id, deps);
      } else if (
        instr.kind === 'pid' &&
        typeof instr.id === 'string' &&
        Number.isInteger(instr.pid)
      ) {
        await processPidKillStop(cfg, instr, deps);
      }
    } catch (err) {
      log(`⚠ stop instruction ${instr?.id ?? '?'} failed: ${shortErr(err)}`);
    }
  }
}

// ── Managed sessions (T2 remote-answer plane + T4 session launch) ─

/**
 * Per-tick manifest sweep: re-derive liveness from tmux itself (the design's
 * "a runner restart re-derives liveness from tmux" rule — tmux is the
 * supervisor, this runner is the gatekeeper). Entries whose tmux session is
 * gone get a terminal `exited` status POST (the server's reportStatus is
 * duplicate-tolerant) and drop out of the manifest; what survives IS this
 * tick's advertisement. Any failure returns an EMPTY advertisement — a
 * machine that can't prove its sessions are alive advertises none
 * (deny-by-default composes all the way up to the board's ANSWER verb).
 */
async function sweepManagedSessions(cfg, deps) {
  const execFileImpl = deps.execFileImpl ?? execFileAsync;
  const fetchImpl = deps.fetch ?? fetch;
  try {
    const entries = readManifest(cfg.manifestPath);
    if (entries.length === 0) return [];
    const alive = await listTmuxSessions(execFileImpl);
    const live = [];
    let pruned = false;
    for (const entry of entries) {
      if (alive.has(entry.tmuxSession)) {
        live.push(entry);
        continue;
      }
      pruned = true;
      await postStatus(cfg, entry.dispatchId, { event: 'exited' }, fetchImpl);
      audit(cfg, 'session-ended', {
        id: entry.dispatchId,
        tmuxSession: entry.tmuxSession,
        panePid: entry.panePid,
      });
    }
    if (pruned) writeManifest(cfg.manifestPath, live);
    return live;
  } catch (err) {
    log(`⚠ managed-session sweep failed (${shortErr(err)}) — advertising none this tick`);
    return [];
  }
}

/**
 * Honor a VALIDATED `action: 'session'` request (allowlist.sessions === true
 * + provider + root containment already checked by validateRequest): create
 * the runner-owned tmux session, record it in the manifest, report the
 * decision. The tmux session name is derived from the dispatch id and the
 * pane pid (= the CLI's own pid) rides the accept decision so the server
 * can correlate this session to its hook/poller-observed agent.
 */
async function runSessionLaunch(cfg, item, deps) {
  const fetchImpl = deps.fetch ?? fetch;
  const execFileImpl = deps.execFileImpl ?? execFileAsync;

  const argv = buildSessionArgv(item);
  if (!argv) {
    await postDecision(cfg, item.id, 'deny', { reason: 'unknown-provider' }, fetchImpl);
    audit(cfg, 'denied', { id: item.id, action: item.action, reason: 'unknown-provider' });
    return;
  }

  const created = await createManagedSession(
    { dispatchId: item.id, cwd: item.cwd, argv },
    execFileImpl,
  );
  if (!created.ok) {
    await postDecision(cfg, item.id, 'deny', { reason: created.reason }, fetchImpl);
    audit(cfg, 'session-denied', { id: item.id, reason: created.reason });
    return;
  }

  const entries = readManifest(cfg.manifestPath);
  entries.push({
    dispatchId: item.id,
    tmuxSession: created.tmuxSession,
    panePid: created.panePid,
    cwd: item.cwd,
    provider: item.provider,
    createdAt: Date.now(),
  });
  if (!writeManifest(cfg.manifestPath, entries)) {
    // A session the manifest can't record is NOT answerable (manifest
    // membership is half the answerability check) — but it DID launch.
    // Report honestly: accepted (it's running), audit the manifest failure.
    audit(cfg, 'session-manifest-write-failed', { id: item.id, tmuxSession: created.tmuxSession });
  }

  await postDecision(cfg, item.id, 'accept', { pid: created.panePid }, fetchImpl);
  audit(cfg, 'session-started', {
    id: item.id,
    tmuxSession: created.tmuxSession,
    panePid: created.panePid,
    provider: item.provider,
    cwd: item.cwd,
  });
  // 'started' status attaches the pane pid the same way runDispatch's does —
  // the drawer's FOCUS/KILL verbs key off it.
  void postStatus(cfg, item.id, { event: 'started', pid: created.panePid }, fetchImpl);
}

/**
 * Process one poll tick's `answer` array (T2 remote-answer plane — the same
 * drained at-most-once imperative channel as stop[]). Per instruction, in
 * order, every gate re-checked HERE at delivery time, never cached:
 *   1. shape + text validation (control chars rejected, length cap);
 *   2. one-shot nonce — consumed-set membership denies `nonce-replayed`;
 *      consumed AT ATTEMPT time (after validation, before send) so even a
 *      failed send burns the nonce (one shot means one shot);
 *   3. manifest membership (`session-not-managed`) AND tmux liveness
 *      (`session-dead`) — both checks at answer time (design rule);
 *   4. literal send-keys delivery, Enter as a separate send.
 * Every outcome: status POST (delivered/denied + reason) + an audit line
 * with the VERBATIM text + nonce (the design's audit-trail requirement).
 */
async function processAnswerInstructions(cfg, state, answers, deps) {
  const fetchImpl = deps.fetch ?? fetch;
  const execFileImpl = deps.execFileImpl ?? execFileAsync;
  for (const instr of answers) {
    try {
      if (
        !instr ||
        typeof instr.id !== 'string' ||
        typeof instr.managedSessionRef !== 'string' ||
        typeof instr.nonce !== 'string' ||
        instr.nonce === ''
      ) {
        continue; // unusable shape — nothing to report against
      }
      const deny = async (reason) => {
        await postAnswerStatus(cfg, instr.id, 'denied', reason, fetchImpl);
        audit(cfg, 'answer-denied', {
          id: instr.id,
          sessionRef: instr.managedSessionRef,
          text: instr.text,
          nonce: instr.nonce,
          reason,
        });
      };

      const textCheck = validateAnswerText(instr.text);
      if (!textCheck.ok) {
        await deny(textCheck.reason);
        continue;
      }
      // C9-4: TTL-bounded one-shot consume (prunes expired nonces first).
      const nowMs = deps.now?.() ?? Date.now();
      if (consumeNonce(state.consumedNonces, instr.nonce, nowMs).replayed) {
        await deny('nonce-replayed');
        continue;
      }
      audit(cfg, 'answer-nonce-consumed', { id: instr.id, nonce: instr.nonce });

      const entry = readManifest(cfg.manifestPath).find(
        (e) => e.dispatchId === instr.managedSessionRef,
      );
      if (!entry) {
        await deny('session-not-managed');
        continue;
      }
      const delivery = await deliverAnswer(
        { tmuxSession: entry.tmuxSession, text: instr.text },
        execFileImpl,
      );
      if (!delivery.ok) {
        await deny(delivery.reason);
        continue;
      }
      await postAnswerStatus(cfg, instr.id, 'delivered', undefined, fetchImpl);
      audit(cfg, 'answer-delivered', {
        id: instr.id,
        sessionRef: instr.managedSessionRef,
        tmuxSession: entry.tmuxSession,
        text: instr.text,
        nonce: instr.nonce,
      });
    } catch (err) {
      log(`⚠ answer instruction ${instr?.id ?? '?'} failed: ${shortErr(err)}`);
    }
  }
}

// ── One item ─────────────────────────────────────────────────────

async function handleItem(cfg, item, allowlist, state, deps) {
  const fetchImpl = deps.fetch ?? fetch;
  const validation = validateRequest(item, allowlist);

  if (!validation.ok) {
    await postDecision(cfg, item.id, 'deny', { reason: validation.reason }, fetchImpl);
    audit(cfg, 'denied', { id: item.id, action: item.action, reason: validation.reason });
    return;
  }

  if (item.action === 'focus') {
    const result = await (deps.attemptFocus ?? attemptFocus)(item);
    await postDecision(
      cfg,
      item.id,
      result.ok ? 'accept' : 'deny',
      { reason: result.ok ? undefined : result.reason, pid: item.pid },
      fetchImpl,
    );
    audit(cfg, result.ok ? 'focused' : 'focus-denied', {
      id: item.id,
      pid: item.pid,
      reason: result.ok ? undefined : result.reason,
    });
    return;
  }

  if (item.action === 'session') {
    await runSessionLaunch(cfg, item, deps);
    return;
  }

  // action === 'dispatch', provider === 'shell' (T8 Mini compute): resolve
  // the opaque scriptId against the machine-local registry HERE — the wire
  // never carried an interpreter/path. The registry's own timeoutSec arms
  // the SAME per-dispatch cap machinery T5 built (a compute timeout is a
  // self-issued stop). cwd stays the runner's own (compute scripts run
  // where the runner runs; the registry path is the trust boundary, not cwd).
  if (item.provider === 'shell') {
    const resolved = buildComputeArgv(item, allowlist);
    if (!resolved) {
      await postDecision(cfg, item.id, 'deny', { reason: 'script-not-allowlisted' }, fetchImpl);
      audit(cfg, 'denied', { id: item.id, action: item.action, reason: 'script-not-allowlisted' });
      return;
    }
    await postDecision(cfg, item.id, 'accept', {}, fetchImpl);
    audit(cfg, 'accepted', { id: item.id, provider: 'shell', scriptId: item.scriptId });
    state.handled.add(item.id);
    // Thread the registry-derived cap through the same field runDispatch's
    // timer reads — never trusting a wire-supplied timeoutSec for shell.
    runDispatch(cfg, { ...item, timeoutSec: resolved.meta.timeoutSec }, resolved.argv, state, deps);
    return;
  }

  // action === 'dispatch'
  const argv = buildArgv(item);
  if (!argv) {
    await postDecision(cfg, item.id, 'deny', { reason: 'unknown-provider' }, fetchImpl);
    audit(cfg, 'denied', { id: item.id, action: item.action, reason: 'unknown-provider' });
    return;
  }
  await postDecision(cfg, item.id, 'accept', {}, fetchImpl);
  audit(cfg, 'accepted', { id: item.id, provider: item.provider, cwd: item.cwd });
  state.handled.add(item.id);
  runDispatch(cfg, item, argv, state, deps);
}

// ── Tick ────────────────────────────────────────────────────────

/**
 * One poll tick. Never throws — every failure path logs ⚠ and returns.
 * `state.handled` tracks ids already decided THIS PROCESS's lifetime so a
 * request the server keeps returning (e.g. a decision POST that failed
 * silently) is never double-spawned or double-decided.
 */
export async function tick(cfg, state, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const allowlist = (deps.readAllowlist ?? readAllowlist)(cfg);

  // Managed-session sweep BEFORE the poll (T2/T4): prune dead sessions
  // (posting their terminal status) and advertise only what tmux itself
  // confirms alive this tick. Advertising nothing when the capability is
  // off keeps the wire honest (the flag alone already denies launches).
  const managedSessions = allowlist.sessions === true ? await sweepManagedSessions(cfg, deps) : [];

  let res;
  try {
    res = await postDispatchPoll(cfg, allowlist, managedSessions, fetchImpl);
  } catch (err) {
    log(`⚠ skip tick — poll POST failed: ${shortErr(err)}`);
    return;
  }
  if (!res.ok) {
    log(`⚠ skip tick — server responded ${res.status}`);
    return;
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    log(`⚠ skip tick — malformed poll response: ${shortErr(err)}`);
    return;
  }
  const pending = Array.isArray(body?.pending) ? body.pending : [];

  let handledCount = 0;
  for (const item of pending) {
    if (!item || typeof item.id !== 'string' || state.handled.has(item.id)) continue;
    state.handled.add(item.id);
    handledCount++;
    try {
      await handleItem(cfg, item, allowlist, state, deps);
    } catch (err) {
      log(`⚠ item ${item.id} failed: ${shortErr(err)}`);
    }
  }
  if (pending.length > 0 || handledCount > 0) {
    log(`✓ tick — ${pending.length} pending, ${handledCount} newly handled`);
  }

  // Worker session kill (KICKOFF v1.1 item 3) — processed AFTER pending,
  // same tick, so a stop targeting a dispatch this very tick just spawned
  // still finds it in the registry.
  const stopInstructions = Array.isArray(body?.stop) ? body.stop : [];
  if (stopInstructions.length > 0) {
    await processStopInstructions(cfg, state, stopInstructions, deps);
  }

  // T2 remote-answer plane — the SAME drained at-most-once imperative
  // channel as stop[], processed after it (an answer to a session a stop
  // just ended denies honestly on the liveness check).
  const answerInstructions = Array.isArray(body?.answer) ? body.answer : [];
  if (answerInstructions.length > 0) {
    await processAnswerInstructions(cfg, state, answerInstructions, deps);
  }
}

// ── Main loop ───────────────────────────────────────────────────

function log(msg) {
  console.log(`[dispatch-runner] ${new Date().toISOString()} ${msg}`);
}

function shortErr(err) {
  const m = err instanceof Error ? err.message : String(err);
  return m.split('\n')[0].slice(0, 200);
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (!cfg.token) {
    console.error('[dispatch-runner] ✗ WAR_ROOM_TOKEN is not set — refusing to start.');
    process.exit(1);
  }
  if (!fs.existsSync(cfg.allowlistPath)) {
    console.error(
      `[dispatch-runner] ✗ no allowlist at ${cfg.allowlistPath} — refusing to start. ` +
        'Run .planning/runbooks/install-dispatch-runner-launchd.sh first.',
    );
    process.exit(1);
  }
  log(
    `starting — machine=${cfg.machine} url=${cfg.url} interval=${cfg.intervalMs}ms allowlist=${cfg.allowlistPath}`,
  );

  // Belt & braces: a runner must never die on an unexpected async error.
  process.on('unhandledRejection', (err) => log(`⚠ unhandled rejection: ${shortErr(err)}`));
  process.on('uncaughtException', (err) => log(`⚠ uncaught exception: ${shortErr(err)}`));

  // C9-4: consumedNonces is a Map<nonce, consumedAtMs> (was an unbounded Set)
  // so consumeNonce() can evict entries past CONSUMED_NONCE_TTL_MS.
  const state = { handled: new Set(), children: new Map(), consumedNonces: new Map() };
  // setTimeout chain (not setInterval) so slow ticks never overlap.
  for (;;) {
    await tick(cfg, state);
    if (cfg.once) return;
    await new Promise((resolve) => setTimeout(resolve, cfg.intervalMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
