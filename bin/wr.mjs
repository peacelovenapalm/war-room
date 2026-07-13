#!/usr/bin/env node

/**
 * `wr claude` — C3 born-managed wrapper (.planning/v5/C3-DESIGN.md,
 * .planning/v5/C3-BUILD-PLAN.md T1/T2/T4). Opt-in (gate 2 CLOSED): typing
 * `wr claude` instead of `claude` gets you a session that is visible,
 * answerable, and remote-promptable from the board from the first
 * keystroke — Greg's plain `claude` muscle memory is completely untouched,
 * no shell shadowing, no opt-out escape hatch (not built, per gate 2).
 *
 * Mechanism (d), LOCKED (gate 6): this file is a WS client structurally
 * identical to the browser board — it sends the same `dispatchRequest
 * {action:'session', ...}` message every board client sends
 * (server/src/clientMessageHandler.ts's dispatchRequest case), waits for
 * the SAME `dispatchUpdate` accept/deny broadcast every client watches,
 * then `tmux attach`es locally. ZERO lines of bin/dispatch-runner.mjs or
 * bin/lib/dispatch-rules.mjs are imported, read, or modified by this file
 * — the runner's own deny-by-default gate/audit path is reused wholesale,
 * never duplicated, never bypassed.
 *
 * Fail CLOSED (non-negotiable, C3-DESIGN.md §3.1): if the server is
 * unreachable, or the runner never answers, or the tmux session never
 * appears, this prints an honest message and exits non-zero. It NEVER
 * falls back to launching a plain unmanaged `claude` — that would look
 * managed while not being reachable by ANSWER/PROMPT/board at all, which
 * is worse than an honest failure.
 *
 * Config, in priority order (pure logic in bin/lib/wr-lib.mjs):
 *   1. CLI flags: --url <u> --machine <m>
 *   2. process.env: WAR_ROOM_URL, WAR_ROOM_MACHINE, WAR_ROOM_TOKEN
 *   3. ~/.war-room/env (0600 file, Phase D convention — export KEY=value
 *      lines, same format macbook-hooks-install.sh writes)
 *   4. built-in default server URL (matches every other runbook's default)
 *
 * Usage: wr claude [--model <m>] [--effort <e>] [--permission-mode plan]
 *                   [--url <u>] [--machine <m>] [free-text opening prompt...]
 */

import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import {
  buildSessionDispatchRequest,
  classifyDispatchBroadcast,
  DECISION_TIMEOUT_MS,
  FAIL_CLOSED_MESSAGE,
  FIRST_RUN_BANNER,
  parseEnvFile,
  parseWrArgs,
  resolveWrConfig,
  TMUX_APPEAR_POLL_MS,
  TMUX_APPEAR_TIMEOUT_MS,
  tmuxSessionNameFor,
  wsUrlFor,
} from './lib/wr-lib.mjs';

const execFileAsync = promisify(execFile);

/** First-run banner marker (T2c) — persisted so the scrollback-change
 *  banner shows exactly once, ever, per the plan's stated pass criterion. */
function bannerMarkerPath() {
  return path.join(os.homedir(), '.war-room', 'wr-banner-shown');
}

function showFirstRunBannerOnce() {
  const marker = bannerMarkerPath();
  try {
    if (fs.existsSync(marker)) return;
  } catch {
    /* an unreadable marker path is treated as "not yet shown" — worst case
       the banner repeats, never worse than silently swallowing it forever */
  }
  console.log(FIRST_RUN_BANNER);
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, `${new Date().toISOString()}\n`, 'utf8');
  } catch {
    /* best-effort — a failed write just means the banner may repeat */
  }
}

function readEnvFile(envPath) {
  try {
    return parseEnvFile(fs.readFileSync(envPath, 'utf8'));
  } catch {
    return {};
  }
}

function failClosed(detail) {
  console.error(`[wr] ${FAIL_CLOSED_MESSAGE}`);
  if (detail) console.error(`[wr]   (${detail})`);
  process.exit(1);
}

/**
 * Open a WS connection, send the session dispatchRequest, and wait for the
 * matching accept/deny broadcast. Injectable `WebSocketImpl` for tests.
 * Rejects with a typed reason string on any failure (timeout, connect
 * error, explicit deny) — the caller decides how to report it, this
 * function never itself prints or exits (testable in isolation).
 */
export function requestManagedSession(
  { url, request, token },
  { WebSocketImpl = globalThis.WebSocket, timeoutMs = DECISION_TIMEOUT_MS } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed/never opened */
      }
      fn(arg);
    };

    let socket;
    try {
      // Bearer on the WS handshake (codex v5R review, MINOR): the server's
      // /ws requires `Authorization: Bearer <token>` in embedded mode and
      // ignores it in standalone — sending it whenever we HAVE one makes
      // the wrapper correct against both. Node's WebSocket (undici) accepts
      // a non-standard `headers` init; browser impls can't set headers at
      // all, which is exactly why standalone /ws doesn't demand one.
      socket = token
        ? new WebSocketImpl(url, { headers: { Authorization: `Bearer ${token}` } })
        : new WebSocketImpl(url);
    } catch (err) {
      reject({
        reason: 'connect-failed',
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const timer = setTimeout(() => {
      done(reject, { reason: 'timeout', detail: `no decision within ${timeoutMs}ms` });
    }, timeoutMs);

    socket.addEventListener('open', () => {
      try {
        socket.send(JSON.stringify(request));
      } catch (err) {
        done(reject, {
          reason: 'send-failed',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    });

    socket.addEventListener('message', (event) => {
      let parsed;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return; // malformed frame — ignore, same tolerance as the webview client
      }
      const outcome = classifyDispatchBroadcast(parsed, request.requestId);
      if (outcome.kind === 'accepted') {
        done(resolve, { dispatchId: outcome.dispatchId, pid: outcome.pid });
      } else if (outcome.kind === 'denied') {
        done(reject, { reason: 'denied', detail: outcome.reason });
      }
    });

    socket.addEventListener('error', () => {
      done(reject, { reason: 'connect-failed', detail: 'websocket error' });
    });
    socket.addEventListener('close', () => {
      done(reject, {
        reason: 'connect-failed',
        detail: 'connection closed before a decision arrived',
      });
    });
  });
}

/** T4 offline/failure hardening: bounded poll for the runner-owned tmux
 *  session to actually exist locally before attaching — an accept
 *  decision proves the runner's OWN createManagedSession succeeded on its
 *  machine, but never trust the network for "and therefore it's here now". */
export async function waitForTmuxSession(
  sessionName,
  {
    execFileImpl = execFileAsync,
    timeoutMs = TMUX_APPEAR_TIMEOUT_MS,
    pollMs = TMUX_APPEAR_POLL_MS,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await execFileImpl('tmux', ['has-session', '-t', `=${sessionName}`]);
      return { ok: true };
    } catch {
      /* not there yet */
    }
    if (Date.now() >= deadline) {
      return {
        ok: false,
        reason: `tmux session ${sessionName} never appeared within ${timeoutMs}ms`,
      };
    }
    await sleep(pollMs);
  }
}

async function main() {
  const parsed = parseWrArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`[wr] ${parsed.reason}`);
    process.exit(1);
  }

  const envFile = readEnvFile(path.join(os.homedir(), '.war-room', 'env'));
  const cfg = resolveWrConfig({ url: parsed.url, machine: parsed.machine }, process.env, envFile);
  if (!cfg.ok) {
    console.error(`[wr] ${cfg.reason}`);
    process.exit(1);
  }

  const cwd = process.cwd();
  const request = buildSessionDispatchRequest({
    machine: cfg.machine,
    cwd,
    prompt: parsed.prompt,
    model: parsed.model,
    effort: parsed.effort,
    permissionMode: parsed.permissionMode,
  });

  console.log(`[wr] requesting a managed claude session on ${cfg.machine} (${cwd}) …`);

  let decision;
  try {
    decision = await requestManagedSession({
      url: wsUrlFor(cfg.url),
      request,
      token: cfg.token,
    });
  } catch (err) {
    if (err?.reason === 'denied') {
      // NOT a fail-closed case (§4): the runner is reachable and made an
      // honest deny decision (e.g. sessions:false on this machine) — the
      // runner's OWN denial message is what the design calls for, no
      // separate wrapper-invented copy.
      console.error(`[wr] launch denied by the runner: ${err.detail ?? 'no reason given'}`);
      process.exit(1);
    }
    failClosed(err?.detail ?? err?.reason);
    return;
  }

  const sessionName = tmuxSessionNameFor(decision.dispatchId);
  const appeared = await waitForTmuxSession(sessionName);
  if (!appeared.ok) {
    console.error(
      `[wr] session was accepted but never appeared locally — ${appeared.reason}. ` +
        'Check the runner logs (~/Library/Logs/war-room-dispatch-runner.log, ' +
        '~/Library/Logs/war-room-dispatch.log) on this machine.',
    );
    process.exit(1);
  }

  showFirstRunBannerOnce();

  // Exit-code re-derivation (T2b): `tmux attach` returns TMUX's own exit
  // status, not the inner claude process's — re-exec attach, then read the
  // pane's actual command exit code back out via a post-exit marker
  // (`tmux wait-for` pattern) so `$?` after `wr claude` matches what the
  // inner claude process actually returned.
  const exitCode = await attachAndDeriveExitCode(sessionName);
  process.exit(exitCode);
}

/**
 * Attach to the runner-owned tmux session and, once the attach itself
 * returns (detach OR the pane's command exiting), determine the REAL exit
 * code of the pane's command. tmux's `remain-on-exit` + a marker file is
 * the standard trick: the pane is configured (via `set-hook` on THIS
 * session only, never touching Greg's ~/.tmux.conf) to write its exit
 * status to a temp file when the command exits, which this function reads
 * back after attach returns. If the pane already detached with the
 * process still running (Greg just Ctrl-b d'd out), there's no exit code
 * yet — 0 is returned (a detach is not a failure).
 */
export async function attachAndDeriveExitCode(
  sessionName,
  { spawnImpl = spawn, execFileImpl = execFileAsync, fsImpl = fs } = {},
) {
  const markerPath = path.join(os.tmpdir(), `wr-exit-${sessionName}-${process.pid}.marker`);
  try {
    await fsImpl.promises.rm(markerPath, { force: true });
  } catch {
    /* nothing to clean up */
  }
  // pane-exited hook fires when the pane's foreground command exits (tmux
  // >= 2.1) — scoped to THIS session id (`-t =name`), never a global/user
  // config change. Best-effort: if the hook can't be set (older tmux),
  // exit-code re-derivation degrades to "0" rather than failing the attach.
  try {
    await execFileImpl('tmux', [
      'set-hook',
      '-t',
      `=${sessionName}`,
      'pane-exited',
      `run-shell "echo #{pane_dead_status} > ${markerPath}"`,
    ]);
  } catch {
    /* degrade gracefully — see doc above */
  }

  const attachExit = await new Promise((resolve) => {
    const child = spawnImpl('tmux', ['attach', '-t', `=${sessionName}`], { stdio: 'inherit' });
    child.on('exit', (code) => {
      resolve(typeof code === 'number' ? code : 1);
    });
    child.on('error', () => {
      resolve(1);
    });
  });

  try {
    const raw = fsImpl.readFileSync(markerPath, 'utf8').trim();
    const code = Number.parseInt(raw, 10);
    if (Number.isInteger(code)) return code;
  } catch {
    /* no marker (still running / detach-only / hook unsupported) */
  }
  // No marker: either a clean detach (tmux exits 0 — keep 0, a detach is
  // not a failure) or the attach ITSELF failed (e.g. "open terminal
  // failed: not a terminal" — surface tmux's non-zero code instead of
  // masking it as success; live-fire 2026-07-13 found the masking).
  if (attachExit !== 0) {
    console.error(
      `[wr] tmux attach exited ${attachExit} — the session is running detached; ` +
        `reattach with: tmux attach -t =${sessionName}`,
    );
  }
  return attachExit;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
