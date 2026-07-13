/**
 * Unit tests for `wr claude` (C3 born-managed wrapper) — pure logic
 * (bin/lib/wr-lib.mjs) plus the injectable I/O seams in bin/wr.mjs
 * (requestManagedSession, waitForTmuxSession, attachAndDeriveExitCode),
 * exercised with fakes so no real WS server or tmux binary is needed.
 *
 * Run with: node --test bin/test/   (npm run test:poller)
 */

import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import {
  buildSessionDispatchRequest,
  classifyDispatchBroadcast,
  DEFAULT_SERVER_URL,
  FAIL_CLOSED_MESSAGE,
  FIRST_RUN_BANNER,
  parseEnvFile,
  parseWrArgs,
  resolveWrConfig,
  tmuxSessionNameFor,
  wsUrlFor,
} from '../lib/wr-lib.mjs';
import { attachAndDeriveExitCode, requestManagedSession, waitForTmuxSession } from '../wr.mjs';

// ── parseWrArgs ─────────────────────────────────────────────────

test('parseWrArgs: requires a "claude" subcommand', () => {
  assert.deepEqual(parseWrArgs([]), {
    ok: false,
    reason: 'usage: wr claude [claude-args...]',
  });
  assert.deepEqual(parseWrArgs(['codex']), {
    ok: false,
    reason: 'usage: wr claude [claude-args...]',
  });
});

test('parseWrArgs: recognized flags extracted, everything else joins the opening prompt', () => {
  const result = parseWrArgs([
    'claude',
    '--model',
    'fable',
    '--effort',
    'high',
    '--permission-mode',
    'plan',
    'fix',
    'the',
    'bug',
  ]);
  assert.deepEqual(result, {
    ok: true,
    provider: 'claude',
    model: 'fable',
    effort: 'high',
    permissionMode: 'plan',
    prompt: 'fix the bug',
  });
});

test('parseWrArgs: --url/--machine override the resolved config', () => {
  const result = parseWrArgs(['claude', '--url', 'https://x:1', '--machine', 'MINI']);
  assert.equal(result.url, 'https://x:1');
  assert.equal(result.machine, 'MINI');
});

test('parseWrArgs: -p/--print rejected — this wrapper is interactive-only', () => {
  const result = parseWrArgs(['claude', '-p', 'headless']);
  assert.equal(result.ok, false);
  assert.match(result.reason, /interactive sessions only/);
});

test('parseWrArgs: bare "claude" with no trailing args has no prompt field', () => {
  const result = parseWrArgs(['claude']);
  assert.equal(result.ok, true);
  assert.equal('prompt' in result, false);
});

// ── parseEnvFile ────────────────────────────────────────────────

test('parseEnvFile: parses export KEY=value lines (macbook-hooks-install.sh format)', () => {
  const contents = [
    'export WAR_ROOM_TOKEN=abc123',
    'export WAR_ROOM_URL=https://nexus.example:8484',
    'export WAR_ROOM_MACHINE=MACBOOK',
  ].join('\n');
  assert.deepEqual(parseEnvFile(contents), {
    WAR_ROOM_TOKEN: 'abc123',
    WAR_ROOM_URL: 'https://nexus.example:8484',
    WAR_ROOM_MACHINE: 'MACBOOK',
  });
});

test('parseEnvFile: tolerates plain KEY=value, comments, blank lines, quoted values', () => {
  const contents = [
    '# a comment',
    '',
    'WAR_ROOM_MACHINE=MINI',
    'WAR_ROOM_TOKEN="quoted value"',
    "WAR_ROOM_URL='single quoted'",
    'not a valid line at all',
    '=noKey',
  ].join('\n');
  assert.deepEqual(parseEnvFile(contents), {
    WAR_ROOM_MACHINE: 'MINI',
    WAR_ROOM_TOKEN: 'quoted value',
    WAR_ROOM_URL: 'single quoted',
  });
});

test('parseEnvFile: non-string input never throws', () => {
  assert.deepEqual(parseEnvFile(undefined), {});
  assert.deepEqual(parseEnvFile(null), {});
});

// ── resolveWrConfig ─────────────────────────────────────────────

test('resolveWrConfig: flags beat process.env beat env-file beat defaults', () => {
  const resolved = resolveWrConfig(
    { url: 'https://flag', machine: undefined },
    { WAR_ROOM_URL: 'https://procenv', WAR_ROOM_MACHINE: 'FROM-ENV', WAR_ROOM_TOKEN: 'tok' },
    { WAR_ROOM_URL: 'https://filenv', WAR_ROOM_MACHINE: 'FROM-FILE' },
  );
  assert.deepEqual(resolved, {
    ok: true,
    url: 'https://flag',
    token: 'tok',
    machine: 'FROM-ENV',
  });
});

test('resolveWrConfig: falls back to the built-in default URL', () => {
  const resolved = resolveWrConfig({}, {}, { WAR_ROOM_MACHINE: 'MACBOOK' });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.url, DEFAULT_SERVER_URL);
});

test('resolveWrConfig: no machine anywhere is an honest config error, never a guess', () => {
  const resolved = resolveWrConfig({}, {}, {});
  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /no machine label/);
});

// ── buildSessionDispatchRequest ─────────────────────────────────

test("buildSessionDispatchRequest: matches CallModal's action:session shape + launchedVia:wrapper", () => {
  const msg = buildSessionDispatchRequest({
    machine: 'MACBOOK',
    cwd: '/Users/greg/code/war-room',
    prompt: 'hello',
    model: 'fable',
    effort: 'high',
    permissionMode: 'plan',
  });
  assert.equal(msg.type, 'dispatchRequest');
  assert.equal(msg.action, 'session');
  assert.equal(msg.provider, 'claude');
  assert.equal(msg.machine, 'MACBOOK');
  assert.equal(msg.cwd, '/Users/greg/code/war-room');
  assert.equal(msg.prompt, 'hello');
  assert.equal(msg.model, 'fable');
  assert.equal(msg.effort, 'high');
  assert.equal(msg.permissionMode, 'plan');
  assert.equal(msg.launchedVia, 'wrapper');
  assert.equal(typeof msg.requestId, 'string');
  assert.ok(msg.requestId.length > 0);
});

test('buildSessionDispatchRequest: optional fields omitted (never sent as undefined-valued keys)', () => {
  const msg = buildSessionDispatchRequest({ machine: 'M1', cwd: '/tmp' });
  assert.equal('prompt' in msg, false);
  assert.equal('model' in msg, false);
  assert.equal('effort' in msg, false);
  assert.equal('permissionMode' in msg, false);
});

// ── classifyDispatchBroadcast ────────────────────────────────────

test('classifyDispatchBroadcast: accept/deny/expired/ignore-other-request/ignore-ringing', () => {
  const rid = 'req-1';
  assert.deepEqual(
    classifyDispatchBroadcast(
      { type: 'dispatchUpdate', requestId: rid, status: 'answered', id: 'd1', pid: 42 },
      rid,
    ),
    { kind: 'accepted', dispatchId: 'd1', pid: 42 },
  );
  assert.deepEqual(
    classifyDispatchBroadcast(
      {
        type: 'dispatchUpdate',
        requestId: rid,
        status: 'denied',
        reason: 'sessions-not-allowlisted',
      },
      rid,
    ),
    { kind: 'denied', reason: 'sessions-not-allowlisted' },
  );
  assert.deepEqual(
    classifyDispatchBroadcast({ type: 'dispatchUpdate', requestId: rid, status: 'expired' }, rid),
    { kind: 'denied', reason: 'expired' },
  );
  // A DIFFERENT client's broadcast for a different request — must be ignored.
  assert.deepEqual(
    classifyDispatchBroadcast(
      { type: 'dispatchUpdate', requestId: 'other', status: 'answered', id: 'd2' },
      rid,
    ),
    { kind: 'ignore' },
  );
  // Still ringing — not a decision yet.
  assert.deepEqual(
    classifyDispatchBroadcast({ type: 'dispatchUpdate', requestId: rid, status: 'ringing' }, rid),
    { kind: 'ignore' },
  );
  // A totally unrelated message type.
  assert.deepEqual(classifyDispatchBroadcast({ type: 'agentCreated' }, rid), { kind: 'ignore' });
  assert.deepEqual(classifyDispatchBroadcast(null, rid), { kind: 'ignore' });
});

// ── wsUrlFor ─────────────────────────────────────────────────────

test('wsUrlFor: http(s) -> ws(s) + /ws, matching webview-v3 connection.ts', () => {
  assert.equal(wsUrlFor('https://nexus.example:8484'), 'wss://nexus.example:8484/ws');
  assert.equal(wsUrlFor('http://127.0.0.1:3141'), 'ws://127.0.0.1:3141/ws');
});

// ── tmuxSessionNameFor ────────────────────────────────────────────

test('tmuxSessionNameFor: matches bin/lib/managed-sessions.mjs exactly (shared import)', () => {
  assert.equal(tmuxSessionNameFor('abc-123'), 'war-room-abc-123');
});

// ── FAIL_CLOSED_MESSAGE / FIRST_RUN_BANNER — content pins ────────

test('FAIL_CLOSED_MESSAGE: exact text required by the plan (§2 non-negotiable)', () => {
  assert.equal(
    FAIL_CLOSED_MESSAGE,
    'war-room server unreachable — launch plain `claude` yourself if you want an unmanaged session.',
  );
});

test('FIRST_RUN_BANNER: names the tmux scrollback change', () => {
  assert.match(FIRST_RUN_BANNER, /scrollback/i);
  assert.match(FIRST_RUN_BANNER, /prefix/i);
});

// ── requestManagedSession (bin/wr.mjs) — fake WebSocket ──────────

/** Minimal fake matching the browser/global WebSocket event-target surface
 *  this module actually uses (addEventListener('open'|'message'|'error'|
 *  'close'), send, close) — no real network. */
class FakeWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    this.closed = false;
  }
  addEventListener(type, handler) {
    this.on(type, handler);
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  // test helpers
  open() {
    this.emit('open');
  }
  message(data) {
    this.emit('message', { data: JSON.stringify(data) });
  }
}

test('requestManagedSession: resolves on a matching accept broadcast', async () => {
  let created;
  const WebSocketImpl = function (url) {
    created = new FakeWebSocket(url);
    queueMicrotask(() => created.open());
    return created;
  };
  const request = { type: 'dispatchRequest', action: 'session', requestId: 'r1', machine: 'M1' };
  const promise = requestManagedSession(
    { url: 'ws://x/ws', request },
    { WebSocketImpl, timeoutMs: 2000 },
  );
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(created.sent.length, 1);
  assert.deepEqual(JSON.parse(created.sent[0]), request);
  created.message({
    type: 'dispatchUpdate',
    requestId: 'r1',
    status: 'answered',
    id: 'd1',
    pid: 7,
  });
  const result = await promise;
  assert.deepEqual(result, { dispatchId: 'd1', pid: 7 });
  assert.equal(created.closed, true);
});

test('requestManagedSession: rejects with reason "denied" on a deny broadcast', async () => {
  let created;
  const WebSocketImpl = function (url) {
    created = new FakeWebSocket(url);
    queueMicrotask(() => created.open());
    return created;
  };
  const request = { type: 'dispatchRequest', action: 'session', requestId: 'r2', machine: 'M1' };
  const promise = requestManagedSession(
    { url: 'ws://x/ws', request },
    { WebSocketImpl, timeoutMs: 2000 },
  );
  await new Promise((r) => setTimeout(r, 5));
  created.message({
    type: 'dispatchUpdate',
    requestId: 'r2',
    status: 'denied',
    reason: 'sessions-not-allowlisted',
  });
  await assert.rejects(promise, (err) => {
    assert.equal(err.reason, 'denied');
    assert.equal(err.detail, 'sessions-not-allowlisted');
    return true;
  });
});

test('requestManagedSession: an UNRELATED broadcast is ignored, then the real one still resolves', async () => {
  let created;
  const WebSocketImpl = function (url) {
    created = new FakeWebSocket(url);
    queueMicrotask(() => created.open());
    return created;
  };
  const request = { type: 'dispatchRequest', action: 'session', requestId: 'r3', machine: 'M1' };
  const promise = requestManagedSession(
    { url: 'ws://x/ws', request },
    { WebSocketImpl, timeoutMs: 2000 },
  );
  await new Promise((r) => setTimeout(r, 5));
  created.message({
    type: 'dispatchUpdate',
    requestId: 'someone-else',
    status: 'answered',
    id: 'x',
  });
  created.message({ type: 'dispatchUpdate', requestId: 'r3', status: 'ringing' });
  created.message({ type: 'dispatchUpdate', requestId: 'r3', status: 'answered', id: 'd3' });
  const result = await promise;
  assert.equal(result.dispatchId, 'd3');
});

test('requestManagedSession: FAIL CLOSED — times out honestly if no decision ever arrives', async () => {
  const WebSocketImpl = function (url) {
    const fake = new FakeWebSocket(url);
    queueMicrotask(() => fake.open());
    return fake;
  };
  const request = { type: 'dispatchRequest', action: 'session', requestId: 'r4', machine: 'M1' };
  await assert.rejects(
    requestManagedSession({ url: 'ws://x/ws', request }, { WebSocketImpl, timeoutMs: 20 }),
    (err) => {
      assert.equal(err.reason, 'timeout');
      return true;
    },
  );
});

test('requestManagedSession: FAIL CLOSED — a connect error is reported, never swallowed into a fake accept', async () => {
  const WebSocketImpl = function (url) {
    const fake = new FakeWebSocket(url);
    queueMicrotask(() => fake.emit('error'));
    return fake;
  };
  const request = { type: 'dispatchRequest', action: 'session', requestId: 'r5', machine: 'M1' };
  await assert.rejects(
    requestManagedSession({ url: 'ws://x/ws', request }, { WebSocketImpl, timeoutMs: 2000 }),
    (err) => {
      assert.equal(err.reason, 'connect-failed');
      return true;
    },
  );
});

test('requestManagedSession: a constructor throw (unreachable host) is reported, never thrown uncaught', async () => {
  const WebSocketImpl = function () {
    throw new Error('ENOTFOUND nexus.invalid');
  };
  const request = { type: 'dispatchRequest', action: 'session', requestId: 'r6', machine: 'M1' };
  await assert.rejects(
    requestManagedSession({ url: 'ws://x/ws', request }, { WebSocketImpl, timeoutMs: 2000 }),
    (err) => {
      assert.equal(err.reason, 'connect-failed');
      assert.match(err.detail, /ENOTFOUND/);
      return true;
    },
  );
});

// ── waitForTmuxSession (T4 offline/failure hardening) ─────────────

test('waitForTmuxSession: resolves ok as soon as tmux reports the session alive', async () => {
  let calls = 0;
  const execFileImpl = async () => {
    calls++;
    if (calls < 3) throw new Error('no session');
    return { stdout: '' };
  };
  const result = await waitForTmuxSession('war-room-abc', {
    execFileImpl,
    timeoutMs: 5000,
    pollMs: 1,
    sleep: () => Promise.resolve(),
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
});

test('waitForTmuxSession: FAIL CLOSED — bounded timeout, clear reason, never hangs forever', async () => {
  const execFileImpl = async () => {
    throw new Error('no session');
  };
  const result = await waitForTmuxSession('war-room-missing', {
    execFileImpl,
    timeoutMs: 5,
    pollMs: 1,
    sleep: () => Promise.resolve(),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /never appeared/);
});

// ── attachAndDeriveExitCode (T2b exit-code re-derivation) ─────────

test("attachAndDeriveExitCode: re-derives the inner exit code from the marker file, not tmux's own status", async () => {
  const markerPathsWritten = [];
  const fsImpl = {
    promises: { rm: async () => {} },
    readFileSync: () => '17\n',
  };
  const spawnImpl = () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0)); // tmux itself exits 0 regardless
    return child;
  };
  const execFileImpl = async (_bin, args) => {
    markerPathsWritten.push(args);
    return { stdout: '' };
  };
  const code = await attachAndDeriveExitCode('war-room-abc', { spawnImpl, execFileImpl, fsImpl });
  assert.equal(code, 17);
  assert.equal(markerPathsWritten[0][0], 'set-hook');
});

test('attachAndDeriveExitCode: no marker (detach-only, or hook unsupported) degrades to 0, never throws', async () => {
  const fsImpl = {
    promises: { rm: async () => {} },
    readFileSync: () => {
      throw new Error('ENOENT');
    },
  };
  const spawnImpl = () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0));
    return child;
  };
  const execFileImpl = async () => {
    throw new Error('tmux too old for set-hook pane-exited');
  };
  const code = await attachAndDeriveExitCode('war-room-abc', { spawnImpl, execFileImpl, fsImpl });
  assert.equal(code, 0);
});
