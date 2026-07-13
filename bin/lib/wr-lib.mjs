/**
 * Pure logic for `wr claude` (C3 born-managed wrapper —
 * .planning/v5/C3-DESIGN.md / C3-BUILD-PLAN.md). Kept separate from
 * bin/wr.mjs's I/O (WS connect, tmux exec, file reads) so argv parsing,
 * env-file parsing, request-shape construction, and accept/deny broadcast
 * classification are unit-testable in isolation — same split as
 * dispatch-rules.mjs / dispatch-runner.mjs.
 *
 * Mechanism (d), locked (C3-BUILD-PLAN §1 gate 6): the wrapper is a NEW WS
 * client structurally IDENTICAL to the browser board — it sends the exact
 * same `dispatchRequest{action:'session', ...}` shape the CALL modal sends
 * (server/src/clientMessageHandler.ts's dispatchRequest case), and reads
 * the exact same `dispatchUpdate` broadcast every board client already
 * watches. Zero lines of bin/dispatch-runner.mjs or bin/lib/dispatch-
 * rules.mjs are touched by this file or its caller.
 *
 * Pure ESM, zero dependencies beyond node:crypto (randomUUID) — no `ws`
 * package needed since Node 22 ships a global WebSocket (bin/wr.mjs uses
 * it directly).
 */

import { randomUUID } from 'node:crypto';

import { tmuxSessionName } from './managed-sessions.mjs';

/** Only provider the wrapper supports today (gate 1: `wr claude`). The
 *  design's `wr <provider>` shape generalizes trivially later; scoping to
 *  claude now avoids guessing at codex/gemini interactive-arg conventions
 *  nobody asked for yet. */
export const WR_PROVIDER = 'claude';

/** Default server URL — MATCHES the default baked into every other
 *  runbook-installed client (install-dispatch-runner-launchd.sh,
 *  macbook-hooks-install.sh) so a wrapper run before ~/.war-room/env
 *  exists still has a sane target. Overridden by WAR_ROOM_URL (env file or
 *  process env) or --url. */
export const DEFAULT_SERVER_URL = 'https://nexus.tail722a2e.ts.net:8484';

/** Bounded wait for the runner's accept/deny decision after the WS send —
 *  generous relative to the poll floor (2s) and default (5s) documented in
 *  bin/dispatch-runner.mjs, since a real tick could be mid-flight when the
 *  request lands. */
export const DECISION_TIMEOUT_MS = 15_000;
/** Bounded wait, AFTER acceptance, for the runner-owned tmux session to
 *  actually exist locally (T4 offline/failure hardening) — an accept
 *  decision means the runner's OWN createManagedSession call succeeded on
 *  ITS machine; if this wrapper is running elsewhere (should never happen
 *  for a same-machine session launch, but never trust the network), tmux
 *  may still take a beat to register the new session. */
export const TMUX_APPEAR_TIMEOUT_MS = 10_000;
export const TMUX_APPEAR_POLL_MS = 300;

export const FAIL_CLOSED_MESSAGE =
  'war-room server unreachable — launch plain `claude` yourself if you want an unmanaged session.';

/** First-run banner (T2c) — shown exactly once (bin/wr.mjs persists a
 *  marker under ~/.war-room/). Names the tmux scrollback change per
 *  C3-DESIGN.md §3.3: tmux's own scrollback (`prefix + [`) replaces the
 *  terminal emulator's native scrollback/search inside a wrapped session. */
export const FIRST_RUN_BANNER = [
  '─────────────────────────────────────────────────────────────',
  ' wr claude — this session runs inside a war-room-owned tmux pane.',
  ' Native terminal scrollback/search (Cmd+F, click-drag-select) no',
  ' longer sees this pane’s history — use tmux’s own scrollback',
  ' instead: press the tmux prefix (Ctrl-b by default) then [ to',
  ' enter copy mode, arrow keys / Page Up to scroll, q to exit.',
  ' (Shown once. This banner will not appear again.)',
  '─────────────────────────────────────────────────────────────',
].join('\n');

/**
 * Parse `wr claude [claude-args...]`. The wire (DispatchRequest action
 * 'session') only understands a closed set of session-identity fields
 * (optional opening prompt, model, effort, permissionMode) — NOT arbitrary
 * claude CLI flags — so recognized flags are lifted out and everything
 * else (space-joined) becomes the optional opening prompt, matching
 * buildSessionArgv's "prompt is one optional trailing positional" shape.
 *
 * @returns {{ ok: true, provider: 'claude', prompt?: string, model?: string,
 *   effort?: string, permissionMode?: string, url?: string, machine?: string }
 *   | { ok: false, reason: string }}
 */
export function parseWrArgs(argv) {
  if (argv.length === 0 || argv[0] !== 'claude') {
    return { ok: false, reason: 'usage: wr claude [claude-args...]' };
  }
  const rest = argv.slice(1);
  const out = { ok: true, provider: WR_PROVIDER };
  const promptParts = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--model' && rest[i + 1] !== undefined) {
      out.model = rest[++i];
    } else if (a === '--effort' && rest[i + 1] !== undefined) {
      out.effort = rest[++i];
    } else if (a === '--permission-mode' && rest[i + 1] !== undefined) {
      out.permissionMode = rest[++i];
    } else if (a === '--url' && rest[i + 1] !== undefined) {
      out.url = rest[++i];
    } else if (a === '--machine' && rest[i + 1] !== undefined) {
      out.machine = rest[++i];
    } else if (a === '-p' || a === '--print') {
      // The wrapper only ever launches an INTERACTIVE session (buildSessionArgv
      // never emits -p) — a headless flag here would silently misdescribe what
      // this command does. Reject rather than ignore.
      return { ok: false, reason: '-p/--print is not supported by wr (interactive sessions only)' };
    } else {
      promptParts.push(a);
    }
  }
  if (promptParts.length > 0) out.prompt = promptParts.join(' ');
  return out;
}

/**
 * Parse a `~/.war-room/env` file's contents (KEY=value / export KEY=value
 * lines, one per line, matching macbook-hooks-install.sh's own write
 * format). Tolerant: blank lines and `#`-comments are skipped, unparsable
 * lines are ignored (never thrown) — a partially-malformed file still
 * yields whatever keys DID parse rather than nothing.
 *
 * @param {string} contents
 * @returns {Record<string, string>}
 */
export function parseEnvFile(contents) {
  const out = {};
  if (typeof contents !== 'string') return out;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice('export '.length) : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(eq + 1).trim();
    // Strip one layer of matching quotes, same tolerance a shell `source`
    // would apply for the common `KEY="value"` authoring style.
    if (
      value.length >= 2 &&
      ((value[0] === '"' && value[value.length - 1] === '"') ||
        (value[0] === "'" && value[value.length - 1] === "'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Resolve the wrapper's runtime config from (in priority order) explicit
 * CLI flags, then process.env, then the parsed env-file contents, then
 * built-in defaults. Never silently invents a machine label (unlike
 * dispatch-runner.mjs's own hostname-derived default) — the wrapper's
 * machine MUST match a live runner's own WAR_ROOM_MACHINE advertisement
 * exactly, or the launch simply never gets picked up by any runner, so an
 * absent machine is an honest configuration error, not a guess.
 *
 * @param {{ url?: string, machine?: string }} argFlags
 * @param {Record<string,string>} processEnv
 * @param {Record<string,string>} fileEnv
 * @returns {{ ok: true, url: string, token: string|undefined, machine: string }
 *   | { ok: false, reason: string }}
 */
export function resolveWrConfig(argFlags, processEnv, fileEnv) {
  const url = argFlags.url || processEnv.WAR_ROOM_URL || fileEnv.WAR_ROOM_URL || DEFAULT_SERVER_URL;
  const machine = argFlags.machine || processEnv.WAR_ROOM_MACHINE || fileEnv.WAR_ROOM_MACHINE;
  if (!machine) {
    return {
      ok: false,
      reason:
        'no machine label found (WAR_ROOM_MACHINE) — run the hooks install runbook first, ' +
        'or pass --machine <NAME>',
    };
  }
  const token = processEnv.WAR_ROOM_TOKEN || fileEnv.WAR_ROOM_TOKEN || undefined;
  return { ok: true, url: url.replace(/\/+$/, ''), token, machine };
}

/** http(s) base URL -> ws(s):// + /ws, matching webview-v3/src/net/
 *  connection.ts's own same-origin derivation exactly (just cross-origin
 *  here instead of same-origin, since the wrapper isn't a page). */
export function wsUrlFor(baseUrl) {
  return baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/ws';
}

/**
 * Build the EXACT dispatchRequest payload the wrapper sends — structurally
 * identical to CallModal.tsx's own action:'session' send (same fields),
 * plus `launchedVia: 'wrapper'` (C3, additive) so the server can attribute
 * the session's origin without any runner/manifest change (see
 * server/src/dispatchStore.ts's DispatchRecord.launchedVia doc).
 */
export function buildSessionDispatchRequest({
  machine,
  cwd,
  prompt,
  model,
  effort,
  permissionMode,
}) {
  const requestId = randomUUID();
  const msg = {
    type: 'dispatchRequest',
    action: 'session',
    machine,
    provider: WR_PROVIDER,
    cwd,
    requestId,
    launchedVia: 'wrapper',
  };
  if (prompt) msg.prompt = prompt;
  if (model) msg.model = model;
  if (effort) msg.effort = effort;
  if (permissionMode) msg.permissionMode = permissionMode;
  return msg;
}

/**
 * Classify an incoming ServerMessage against the dispatchRequest this
 * wrapper just sent (matched by requestId — the wire's only exact per-
 * request correlation, same discipline dispatchFacts.ts's send-failure
 * detector uses). Returns 'ignore' for anything not addressed to this
 * request (every OTHER client's dispatchUpdate rides the same broadcast
 * plane).
 *
 * @param {unknown} message
 * @param {string} requestId
 * @returns {{ kind: 'accepted', dispatchId: string, pid?: number }
 *   | { kind: 'denied', reason?: string }
 *   | { kind: 'ignore' }}
 */
export function classifyDispatchBroadcast(message, requestId) {
  if (
    !message ||
    typeof message !== 'object' ||
    message.type !== 'dispatchUpdate' ||
    message.requestId !== requestId
  ) {
    return { kind: 'ignore' };
  }
  if (message.status === 'answered') {
    return { kind: 'accepted', dispatchId: String(message.id), pid: message.pid };
  }
  if (message.status === 'denied' || message.status === 'expired') {
    return { kind: 'denied', reason: message.reason ?? message.status };
  }
  // 'ringing' (still queued) — not a terminal decision yet.
  return { kind: 'ignore' };
}

/** The runner-owned tmux session name for a dispatchId — re-exported from
 *  bin/lib/managed-sessions.mjs (the runner's own naming convention;
 *  managed-sessions.mjs is NOT one of the two files this plan forbids
 *  touching, so this is a real shared import, not a duplicated constant
 *  that could drift). */
export const tmuxSessionNameFor = tmuxSessionName;
