/**
 * Unit tests for the dispatch runner daemon (v1 mechanic #6b).
 *
 * `tick()` and `attemptFocus()` are exported for direct testing with a stub
 * `node:http` server and injected `spawn`/`fetch`/`readAllowlist`/
 * `attemptFocus` dependencies — no real `claude`/`codex`/`gemini` binary or
 * AppleScript call is ever exercised here. Startup guards (refuse without
 * token/allowlist) are exercised as real subprocess runs.
 */

import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { attemptFocus, tick } from '../dispatch-runner.mjs';

const RUNNER_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dispatch-runner.mjs',
);

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-runner-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Startup guards (real subprocess) ─────────────────────────────

test('startup: refuses to run without WAR_ROOM_TOKEN', () => {
  assert.throws(() => {
    execFileSync('node', [RUNNER_PATH, '--once'], {
      env: { ...process.env, WAR_ROOM_TOKEN: '' },
      stdio: 'pipe',
    });
  }, /Command failed/);
});

test('startup: refuses to run without an existing allowlist file', () => {
  const missingAllowlist = path.join(tmpDir, 'does-not-exist.json');
  assert.throws(() => {
    execFileSync(
      'node',
      [RUNNER_PATH, '--once', '--allowlist', missingAllowlist, '--url', 'http://127.0.0.1:1'],
      { env: { ...process.env, WAR_ROOM_TOKEN: 'test-token' }, stdio: 'pipe' },
    );
  }, /Command failed/);
});

// ── tick() against a stub http server ────────────────────────────

function startStubServer(handler) {
  return new Promise((resolve) => {
    const captured = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsedBody = body ? JSON.parse(body) : {};
        captured.push({ url: req.url, method: req.method, body: parsedBody, headers: req.headers });
        handler(req, res, parsedBody, captured);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, captured, port: server.address().port }));
  });
}

function stubHandler({ pending = [] } = {}) {
  return (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/api/dispatch/poll') {
      res.end(JSON.stringify({ pending }));
    } else {
      res.end(JSON.stringify({ ok: true }));
    }
  };
}

function baseCfg(port, overrides = {}) {
  return {
    url: `http://127.0.0.1:${port}`,
    token: 'test-token',
    machine: 'TESTMACHINE',
    intervalMs: 5000,
    logDir: path.join(tmpDir, 'runs'),
    auditLog: path.join(tmpDir, 'audit.log'),
    allowlistPath: path.join(tmpDir, 'dispatch.json'),
    ...overrides,
  };
}

function fakeChild(exitCode = 0) {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => child.emit('exit', exitCode));
  return child;
}

test('tick: advertises the current allowlist on every poll', async () => {
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  await tick(cfg, { handled: new Set() }, { readAllowlist: () => allowlist });
  server.close();

  const pollReq = captured.find((c) => c.url === '/api/dispatch/poll');
  assert.deepEqual(pollReq.body, allowlist);
  assert.equal(pollReq.headers['x-machine'], 'TESTMACHINE');
  assert.equal(pollReq.headers.authorization, 'Bearer test-token');
});

test('tick: denies a dispatch request outside the allowlisted roots', async () => {
  // A real, EXISTING directory that is simply not in the allowlist's roots
  // (a nonexistent path would instead hit the cwd-not-found branch).
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-runner-outside-'));
  const item = {
    id: 'req-1',
    action: 'dispatch',
    provider: 'claude',
    cwd: outsideDir,
    prompt: 'hi',
  };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  await tick(cfg, { handled: new Set() }, { readAllowlist: () => allowlist });
  server.close();

  const decision = captured.find((c) => c.url === '/api/dispatch/req-1/decision');
  assert.ok(decision, 'expected a decision POST');
  assert.equal(decision.body.decision, 'deny');
  assert.equal(decision.body.reason, 'path-not-allowlisted');
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

test('tick: a corrupt/vanished allowlist denies every pending request', async () => {
  const item = { id: 'req-2', action: 'dispatch', provider: 'claude', cwd: tmpDir, prompt: 'hi' };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  // readAllowlist deps override simulates the real function's vanish/corrupt fallback.
  await tick(
    cfg,
    { handled: new Set() },
    { readAllowlist: () => ({ providers: [], roots: [], focus: false }) },
  );
  server.close();

  const decision = captured.find((c) => c.url === '/api/dispatch/req-2/decision');
  assert.equal(decision.body.decision, 'deny');
  assert.equal(decision.body.reason, 'provider-not-allowlisted');
});

test('tick: accepts a valid dispatch request, spawns it, and reports started + exited', async () => {
  const item = {
    id: 'req-3',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'list files',
  };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  const spawned = [];
  await tick(
    cfg,
    { handled: new Set() },
    {
      readAllowlist: () => allowlist,
      spawn: (cmd, args, opts) => {
        spawned.push({ cmd, args, opts });
        return fakeChild(0);
      },
    },
  );
  // Let the fake child's exit event AND the resulting status POSTs
  // (real localhost network round trips against the stub server) flush
  // before asserting and closing the server.
  await new Promise((resolve) => setTimeout(resolve, 150));
  server.close();

  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args, ['-p', 'list files']); // prompt is ONE argv element
  assert.equal(spawned[0].opts.shell, false);

  const decision = captured.find((c) => c.url === '/api/dispatch/req-3/decision');
  assert.equal(decision.body.decision, 'accept');
  const started = captured.find(
    (c) => c.url === '/api/dispatch/req-3/status' && c.body.event === 'started',
  );
  assert.equal(started.body.pid, 4242);
  const exited = captured.find(
    (c) => c.url === '/api/dispatch/req-3/status' && c.body.event === 'exited',
  );
  assert.equal(exited.body.exitCode, 0);
});

test('tick: focus reports its outcome AS the decision (accept/deny), never a separate status', async () => {
  const item = { id: 'req-4', action: 'focus', pid: 999 };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: [], roots: [], focus: true };
  await tick(
    cfg,
    { handled: new Set() },
    {
      readAllowlist: () => allowlist,
      attemptFocus: async () => ({ ok: true }),
    },
  );
  server.close();

  const decision = captured.find((c) => c.url === '/api/dispatch/req-4/decision');
  assert.equal(decision.body.decision, 'accept');
  assert.equal(
    captured.some((c) => c.url === '/api/dispatch/req-4/status'),
    false,
  );
});

test('tick: focus denies when the allowlist does not grant focus', async () => {
  const item = { id: 'req-5', action: 'focus', pid: 999 };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  await tick(
    cfg,
    { handled: new Set() },
    {
      readAllowlist: () => ({ providers: [], roots: [], focus: false }),
      attemptFocus: async () => ({ ok: true }), // must not even be consulted
    },
  );
  server.close();

  const decision = captured.find((c) => c.url === '/api/dispatch/req-5/decision');
  assert.equal(decision.body.decision, 'deny');
  assert.equal(decision.body.reason, 'focus-not-allowlisted');
});

test('tick: idempotency — a request already in state.handled is never re-decided or re-spawned', async () => {
  const item = { id: 'req-6', action: 'dispatch', provider: 'claude', cwd: tmpDir, prompt: 'hi' };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  const state = { handled: new Set(['req-6']) }; // pre-seeded as already handled
  let spawnCalls = 0;
  await tick(cfg, state, {
    readAllowlist: () => allowlist,
    spawn: () => {
      spawnCalls++;
      return fakeChild(0);
    },
  });
  server.close();
  assert.equal(spawnCalls, 0);
  assert.equal(
    captured.some((c) => c.url === '/api/dispatch/req-6/decision'),
    false,
  );
});

test('tick: an unreachable server skips the tick without throwing', async () => {
  const cfg = baseCfg(1); // port 1 — nothing listening, connection refused
  await assert.doesNotReject(() =>
    tick(
      cfg,
      { handled: new Set() },
      { readAllowlist: () => ({ providers: [], roots: [], focus: false }) },
    ),
  );
});

test('tick: appends an audit line for a denied request', async () => {
  const item = { id: 'req-7', action: 'dispatch', provider: 'claude', cwd: '/nope', prompt: 'hi' };
  const { server, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  await tick(
    cfg,
    { handled: new Set() },
    { readAllowlist: () => ({ providers: ['claude'], roots: [tmpDir], focus: false }) },
  );
  server.close();

  const lines = fs
    .readFileSync(cfg.auditLog, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(
    lines.some((l) => l.event === 'denied' && l.id === 'req-7'),
    true,
  );
});

// ── attemptFocus ──────────────────────────────────────────────────

test('attemptFocus: denies a missing/non-integer pid without invoking osascript', async () => {
  let execCalled = false;
  const fakeExec = async () => {
    execCalled = true;
    return { stdout: '', stderr: '' };
  };
  const result = await attemptFocus({ pid: undefined }, fakeExec);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-pid');
  assert.equal(execCalled, false);
});

test('attemptFocus: reports a failed osascript invocation as a deny reason, not a throw', async () => {
  const failingExec = async () => {
    throw new Error('osascript: process not found');
  };
  const result = await attemptFocus({ pid: 123 }, failingExec);
  assert.equal(result.ok, false);
  assert.match(result.reason, /focus-failed/);
});
