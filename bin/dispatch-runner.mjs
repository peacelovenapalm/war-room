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
 *          started (pid) then exited (exitCode); stdout/stderr -> a per-run
 *          log file.
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

const execAsync = promisify(exec);

const POST_TIMEOUT_MS = 10_000;
const FOCUS_TIMEOUT_MS = 5_000;
const MIN_INTERVAL_MS = 2_000;

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

function runDispatch(cfg, item, argv, deps) {
  const spawnImpl = deps.spawn ?? spawn;
  ensureLogDir(cfg);
  const logPath = path.join(cfg.logDir, `${item.id}.log`);
  let logStream;
  try {
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
  } catch {
    logStream = null;
  }

  const child = spawnImpl(argv[0], argv.slice(1), {
    cwd: item.cwd,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk) => logStream?.write(chunk));
  child.stderr?.on('data', (chunk) => logStream?.write(chunk));

  void postStatus(cfg, item.id, { event: 'started', pid: child.pid }, deps.fetch ?? fetch);
  audit(cfg, 'started', { id: item.id, pid: child.pid, provider: item.provider, cwd: item.cwd });

  child.on('exit', (code) => {
    logStream?.end();
    const exitCode = typeof code === 'number' ? code : -1;
    void postStatus(cfg, item.id, { event: 'exited', exitCode }, deps.fetch ?? fetch);
    audit(cfg, 'exited', { id: item.id, pid: child.pid, exitCode });
  });
  child.on('error', (err) => {
    log(`⚠ spawn error for ${item.id}: ${shortErr(err)}`);
    audit(cfg, 'spawn-error', { id: item.id, reason: shortErr(err) });
  });
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
  runDispatch(cfg, item, argv, deps);
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

  const state = { handled: new Set() };
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
