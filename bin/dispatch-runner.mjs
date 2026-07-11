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

import { exec, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import {
  buildArgv,
  emptyAllowlist,
  parseAllowlist,
  validateRequest,
} from './lib/dispatch-rules.mjs';
import { createOutputForwarder } from './lib/output-forwarder.mjs';

const execAsync = promisify(exec);

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

// ── Server calls ────────────────────────────────────────────────

async function postDispatchPoll(cfg, allowlist, fetchImpl) {
  return fetchImpl(`${cfg.url}/api/dispatch/poll`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.token}`,
      'x-machine': cfg.machine,
    },
    body: JSON.stringify(allowlist),
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

  let res;
  try {
    res = await postDispatchPoll(cfg, allowlist, fetchImpl);
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

  const state = { handled: new Set(), children: new Map() };
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
