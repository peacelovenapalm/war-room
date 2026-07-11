/**
 * Unit tests for the dispatch runner daemon (v1 mechanic #6b).
 *
 * `tick()` and `attemptFocus()` are exported for direct testing with a stub
 * `node:http` server and injected `spawn`/`fetch`/`readAllowlist`/
 * `attemptFocus` dependencies — no real `claude`/`codex`/`gemini` binary or
 * AppleScript call is ever exercised here. Startup guards (refuse without
 * token/allowlist) are exercised as real subprocess runs.
 */

import { execFileSync, spawn as spawnReal } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { attemptFocus, tick, verifyClaudeProcess } from '../dispatch-runner.mjs';

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

function stubHandler({ pending = [], stop = [] } = {}) {
  return (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/api/dispatch/poll') {
      res.end(JSON.stringify({ pending, stop }));
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
  await tick(cfg, { handled: new Set(), children: new Map() }, { readAllowlist: () => allowlist });
  server.close();

  const pollReq = captured.find((c) => c.url === '/api/dispatch/poll');
  // managedSessions rides every poll (T2 remote-answer plane) — empty here
  // since this allowlist has no sessions capability.
  assert.deepEqual(pollReq.body, { ...allowlist, managedSessions: [] });
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
  await tick(cfg, { handled: new Set(), children: new Map() }, { readAllowlist: () => allowlist });
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
    { handled: new Set(), children: new Map() },
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
    { handled: new Set(), children: new Map() },
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

test('tick: exited status carries a resultTail read from the per-run log', async () => {
  const item = {
    id: 'req-tail',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'say hi',
  };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  await tick(
    cfg,
    { handled: new Set(), children: new Map() },
    {
      readAllowlist: () => allowlist,
      spawn: () => {
        // Built by hand (not fakeChild) so stdout 'data' is guaranteed to
        // fire — and be captured by the log stream — strictly before 'exit'.
        const child = new EventEmitter();
        child.pid = 4242;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from('CODEX DISPATCH OK\n'));
          setImmediate(() => child.emit('exit', 0));
        });
        return child;
      },
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  server.close();

  const exited = captured.find(
    (c) => c.url === '/api/dispatch/req-tail/status' && c.body.event === 'exited',
  );
  assert.ok(exited, 'expected an exited status POST');
  assert.match(exited.body.resultTail, /CODEX DISPATCH OK/);
});

test('tick: child stdout/stderr are forwarded to /api/dispatch/:id/output (final flush on exit)', async () => {
  const item = {
    id: 'req-fwd',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'stream me',
  };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  await tick(
    cfg,
    { handled: new Set(), children: new Map() },
    {
      readAllowlist: () => allowlist,
      spawn: () => {
        const child = new EventEmitter();
        child.pid = 4242;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from('live line 1\n'));
          child.stdout.emit('data', Buffer.from('live line 2\n'));
          child.stderr.emit('data', Buffer.from('warn line\n'));
          setImmediate(() => child.emit('exit', 0));
        });
        return child;
      },
    },
  );
  // The forwarder's default window is 1s; the child's exit triggers the
  // final flush immediately — the settle below is for the POSTs themselves.
  await new Promise((resolve) => setTimeout(resolve, 150));
  server.close();

  const outputPosts = captured.filter((c) => c.url === '/api/dispatch/req-fwd/output');
  const stdout = outputPosts.find((c) => c.body.stream === 'stdout');
  const stderr = outputPosts.find((c) => c.body.stream === 'stderr');
  assert.ok(stdout, 'expected a coalesced stdout output POST');
  assert.equal(stdout.body.chunk, 'live line 1\nlive line 2\n'); // coalesced, in order
  assert.equal(stdout.body.seq, 0);
  assert.equal(stdout.headers.authorization, 'Bearer test-token');
  assert.ok(stderr, 'expected a stderr output POST');
  assert.equal(stderr.body.chunk, 'warn line\n');
  // Output NEVER rides the poll/status planes: exit reporting is unchanged.
  const exited = captured.find(
    (c) => c.url === '/api/dispatch/req-fwd/status' && c.body.event === 'exited',
  );
  assert.ok(exited, 'exited status POST still happens');
});

test('tick: the terminal status POST never overtakes the final output flush (server liveness-gate race)', async () => {
  // The real server evicts the ring entry on a terminal status POST and its
  // /output route rejects appends for terminal dispatches — so if the
  // exited status POST reaches the server BEFORE the final flush, the run's
  // last chunks are silently lost. This test slows only the /output POSTs
  // (a plausibly-reordered network) and asserts arrival ORDER at the server.
  const item = {
    id: 'req-race',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'last words',
  };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  const slowOutputFetch = async (url, init) => {
    if (String(url).includes('/output')) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return fetch(url, init);
  };
  await tick(
    cfg,
    { handled: new Set(), children: new Map() },
    {
      readAllowlist: () => allowlist,
      fetch: slowOutputFetch,
      spawn: () => {
        const child = new EventEmitter();
        child.pid = 4242;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setImmediate(() => {
          // Buffered below the byte threshold — still pending at exit, so it
          // travels in stop()'s final flush.
          child.stdout.emit('data', Buffer.from('final chunk\n'));
          setImmediate(() => child.emit('exit', 0));
        });
        return child;
      },
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  server.close();

  const outputIdx = captured.findIndex((c) => c.url === '/api/dispatch/req-race/output');
  const exitedIdx = captured.findIndex(
    (c) => c.url === '/api/dispatch/req-race/status' && c.body.event === 'exited',
  );
  assert.notEqual(outputIdx, -1, 'the final chunk POST reached the server');
  assert.notEqual(exitedIdx, -1, 'the exited status POST reached the server');
  assert.ok(
    outputIdx < exitedIdx,
    `final output flush (arrival #${outputIdx}) must reach the server BEFORE the terminal status (arrival #${exitedIdx})`,
  );
});

test('tick: a never-settling final flush cannot stall the terminal status POST past its bound', async () => {
  const item = {
    id: 'req-hung-flush',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'hi',
  };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  await tick(
    cfg,
    { handled: new Set(), children: new Map() },
    {
      readAllowlist: () => allowlist,
      spawn: () => fakeChild(0),
      // A forwarder whose POST chain never settles — the hung-server
      // worst case. Exit reporting must proceed after the bounded wait.
      createOutputForwarder: () => ({ push: () => {}, stop: () => new Promise(() => {}) }),
      finalFlushMaxWaitMs: 50,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  server.close();

  const exited = captured.find(
    (c) => c.url === '/api/dispatch/req-hung-flush/status' && c.body.event === 'exited',
  );
  assert.ok(exited, 'exited status POST still happens despite a hung final flush');
});

test('tick: a child with no output produces no output POSTs', async () => {
  const item = {
    id: 'req-silent',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'quiet',
  };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  await tick(
    cfg,
    { handled: new Set(), children: new Map() },
    { readAllowlist: () => allowlist, spawn: () => fakeChild(0) },
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  server.close();

  assert.equal(
    captured.some((c) => c.url === '/api/dispatch/req-silent/output'),
    false,
    'no empty output POSTs for a silent child',
  );
});

test('tick: a missing/unreadable log file yields an undefined resultTail, never throws', async () => {
  const item = {
    id: 'req-no-log',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'hi',
  };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  // logDir does not exist and cannot be created (points inside a file, not a dir).
  const blockedLogDir = path.join(tmpDir, 'blocked-log-dir');
  fs.writeFileSync(blockedLogDir, 'not a directory');
  const cfg = baseCfg(port, { logDir: path.join(blockedLogDir, 'nested') });
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  await tick(
    cfg,
    { handled: new Set(), children: new Map() },
    { readAllowlist: () => allowlist, spawn: () => fakeChild(0) },
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  server.close();

  const exited = captured.find(
    (c) => c.url === '/api/dispatch/req-no-log/status' && c.body.event === 'exited',
  );
  assert.ok(exited, 'expected an exited status POST despite the unwritable log dir');
  assert.equal(exited.body.resultTail, undefined);
});

test('tick: focus reports its outcome AS the decision (accept/deny), never a separate status', async () => {
  const item = { id: 'req-4', action: 'focus', pid: 999 };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: [], roots: [], focus: true };
  await tick(
    cfg,
    { handled: new Set(), children: new Map() },
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
    { handled: new Set(), children: new Map() },
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
  const state = { handled: new Set(['req-6']), children: new Map() }; // pre-seeded as already handled
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
      { handled: new Set(), children: new Map() },
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
    { handled: new Set(), children: new Map() },
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

// ── Worker session kill (KICKOFF v1.1 item 3) ────────────────────

test('runDispatch: registers the spawned child in the live-children registry, and clears it on exit', async () => {
  const item = {
    id: 'req-registry',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'hi',
  };
  const { server, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  const state = { handled: new Set(), children: new Map() };
  let child;
  await tick(cfg, state, {
    readAllowlist: () => allowlist,
    spawn: () => {
      child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      return child; // deliberately never auto-exits — this test drives it
    },
  });

  assert.equal(state.children.has('req-registry'), true);
  assert.equal(state.children.get('req-registry').killRequested, false);

  child.emit('exit', 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  server.close();

  assert.equal(state.children.has('req-registry'), false);
});

test('worker session kill: a stop instruction for a REGISTERED dispatch id sends SIGTERM and reports a DISTINCT "killed" status, never "exited" — the other concurrent dispatch is unaffected', async () => {
  const itemA = {
    id: 'req-kill-a',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'a',
  };
  const itemB = {
    id: 'req-kill-b',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'b',
  };
  const pollResponses = [
    { pending: [itemA, itemB], stop: [] },
    { pending: [], stop: [{ kind: 'dispatch', id: 'req-kill-a' }] },
  ];
  let pollCount = 0;
  const captured = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsedBody = body ? JSON.parse(body) : {};
      captured.push({ url: req.url, method: req.method, body: parsedBody });
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/api/dispatch/poll') {
        const resp = pollResponses[Math.min(pollCount, pollResponses.length - 1)];
        pollCount++;
        res.end(JSON.stringify(resp));
      } else {
        res.end(JSON.stringify({ ok: true }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  const state = { handled: new Set(), children: new Map() };

  const children = {};
  const spawnImpl = (_cmd, args) => {
    const child = new EventEmitter();
    child.pid = args[args.length - 1] === 'a' ? 1111 : 2222;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (signal) => {
      child.killedWith = signal;
    };
    children[child.pid] = child;
    return child;
  };

  // Tick 1: spawns and registers both concurrent dispatches.
  await tick(cfg, state, { readAllowlist: () => allowlist, spawn: spawnImpl });
  assert.equal(state.children.size, 2);

  // Tick 2: the poll response now carries a stop instruction for A only.
  await tick(cfg, state, { readAllowlist: () => allowlist, spawn: spawnImpl });

  const childA = children[1111];
  const childB = children[2222];
  assert.equal(childA.killedWith, 'SIGTERM');
  assert.equal(childB.killedWith, undefined, 'the OTHER concurrent dispatch must be untouched');

  // The OS actually terminating A is what triggers the terminal report —
  // never reported before the process really exits.
  childA.emit('exit', null);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const killedStatus = captured.find(
    (c) => c.url === '/api/dispatch/req-kill-a/status' && c.body.event === 'killed',
  );
  assert.ok(killedStatus, 'expected a distinct "killed" status POST for the killed dispatch');
  assert.equal(
    captured.some((c) => c.url === '/api/dispatch/req-kill-a/status' && c.body.event === 'exited'),
    false,
    'a killed dispatch must never ALSO report "exited"',
  );

  // B completes normally, unaffected by A's kill.
  childB.emit('exit', 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const exitedStatusB = captured.find(
    (c) => c.url === '/api/dispatch/req-kill-b/status' && c.body.event === 'exited',
  );
  assert.ok(exitedStatusB, 'the other concurrent dispatch must complete normally as "exited"');

  server.close();
});

test('worker session kill: a stop instruction for an UNREGISTERED dispatch id is a no-op reported as "not-found" — never a raw process.kill(pid) fallback', async () => {
  const { server, captured, port } = await startStubServer(
    stubHandler({ pending: [], stop: [{ kind: 'dispatch', id: 'ghost-dispatch' }] }),
  );
  const cfg = baseCfg(port);
  const state = { handled: new Set(), children: new Map() };
  await tick(cfg, state, { readAllowlist: () => ({ providers: [], roots: [], focus: false }) });
  server.close();

  const status = captured.find((c) => c.url === '/api/dispatch/ghost-dispatch/status');
  assert.ok(status, 'expected a status POST reporting the not-found outcome');
  assert.equal(status.body.event, 'killed');
  assert.equal(status.body.killOutcome, 'not-found');
});

test('worker session kill (observed pid): denies and NEVER signals when process verification fails', async () => {
  const { server, captured, port } = await startStubServer(
    stubHandler({ pending: [], stop: [{ kind: 'pid', id: 'pk-1', pid: 9999 }] }),
  );
  const cfg = baseCfg(port);
  const state = { handled: new Set(), children: new Map() };
  let killCalled = false;
  await tick(cfg, state, {
    readAllowlist: () => ({ providers: [], roots: [], focus: false }),
    verifyClaudeProcess: async () => ({ ok: false, reason: 'not-a-claude-process' }),
    killImpl: () => {
      killCalled = true;
    },
  });
  server.close();

  assert.equal(killCalled, false, 'must never signal an unverified pid');
  const status = captured.find((c) => c.url === '/api/pid-kills/pk-1/status');
  assert.ok(status);
  assert.equal(status.body.event, 'denied');
  assert.equal(status.body.reason, 'not-a-claude-process');
});

test('worker session kill (observed pid): signals SIGTERM and reports "killed" once verification passes', async () => {
  const { server, captured, port } = await startStubServer(
    stubHandler({ pending: [], stop: [{ kind: 'pid', id: 'pk-2', pid: 8888 }] }),
  );
  const cfg = baseCfg(port);
  const state = { handled: new Set(), children: new Map() };
  let killedPid;
  let killedSignal;
  await tick(cfg, state, {
    readAllowlist: () => ({ providers: [], roots: [], focus: false }),
    verifyClaudeProcess: async () => ({ ok: true }),
    killImpl: (pid, signal) => {
      killedPid = pid;
      killedSignal = signal;
    },
  });
  server.close();

  assert.equal(killedPid, 8888);
  assert.equal(killedSignal, 'SIGTERM');
  const status = captured.find((c) => c.url === '/api/pid-kills/pk-2/status');
  assert.ok(status);
  assert.equal(status.body.event, 'killed');
});

// ── verifyClaudeProcess (real `ps`, real processes — no mocking) ─

test('verifyClaudeProcess: denies a pid that does not exist', async () => {
  const result = await verifyClaudeProcess(999_999);
  assert.equal(result.ok, false);
});

test('verifyClaudeProcess: denies an invalid pid without invoking ps', async () => {
  let execCalled = false;
  const result = await verifyClaudeProcess(-1, async () => {
    execCalled = true;
    return { stdout: '' };
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-pid');
  assert.equal(execCalled, false);
});

test('verifyClaudeProcess: denies a REAL running process whose command line does not mention "claude"', async () => {
  // stdio 'ignore' — a plain sleep with no children of its own, but keeping
  // this consistent with the other real-process tests below avoids any
  // pipe-fd-holds-the-test-runner-open surprise.
  const child = spawnReal('sleep', ['5'], { stdio: 'ignore' });
  try {
    const result = await verifyClaudeProcess(child.pid);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not-a-claude-process');
  } finally {
    child.kill('SIGKILL');
  }
});

test('verifyClaudeProcess: accepts a REAL running process whose command line mentions "claude"', async () => {
  // `exec -a NAME` renames THIS SAME process's argv[0] (no bash-wraps-sleep
  // parent/child pair) — no real claude binary needed, `ps -o command=`
  // shows the bounded "claude" token, and there is no separate child to
  // orphan if this process is signaled. stdio 'ignore': spawning a plain
  // script here with inherited pipes would otherwise hold this test file's
  // node process open until the spawned process's own fd is closed.
  const child = spawnReal('bash', ['-c', 'exec -a claude-fake-session sleep 5'], {
    stdio: 'ignore',
  });
  try {
    const result = await verifyClaudeProcess(child.pid);
    assert.equal(result.ok, true);
  } finally {
    child.kill('SIGKILL');
  }
});

test('worker session kill (observed pid) END-TO-END: a real claude-like process is ACTUALLY terminated — verified via a fresh process probe, not just the HTTP response', async () => {
  // Same `exec -a` + stdio:'ignore' rationale as above — this test drives a
  // REAL SIGTERM through the REAL runner code path (no verify/kill mocks),
  // so a hung/orphaned child here would hang the whole suite for the
  // process's full lifetime (this exact bug was caught once already: an
  // earlier version of this test used a bash-wraps-sleep script with
  // inherited pipes and blocked the poller test suite for a full 300s).
  const child = spawnReal('bash', ['-c', 'exec -a claude-observed-session sleep 300'], {
    stdio: 'ignore',
  });
  await new Promise((resolve) => setTimeout(resolve, 150)); // let it actually start

  const { server, captured, port } = await startStubServer(
    stubHandler({ pending: [], stop: [{ kind: 'pid', id: 'observed-1', pid: child.pid }] }),
  );
  const cfg = baseCfg(port);
  const state = { handled: new Set(), children: new Map() };

  // Deliberately NOT mocking verifyClaudeProcess/killImpl — this exercises
  // the REAL `ps`-based verification and a REAL SIGTERM against a REAL pid.
  await tick(cfg, state, { readAllowlist: () => ({ providers: [], roots: [], focus: false }) });
  server.close();

  const status = captured.find((c) => c.url === '/api/pid-kills/observed-1/status');
  assert.ok(status, 'expected a pid-kill status POST');
  assert.equal(status.body.event, 'killed');

  await new Promise((resolve) => setTimeout(resolve, 300));
  let stillAlive = true;
  try {
    process.kill(child.pid, 0); // existence probe (signal 0) — throws ESRCH once gone
  } catch {
    stillAlive = false;
  }
  assert.equal(stillAlive, false, 'the real process must actually be dead, not just reported so');
});

// ── T5 fleet controls, PER-DISPATCH TIME CAP ─────────────────────

test('T5 cap: absent timeoutSec arms no timer — a long-lived child is never signaled', async () => {
  const item = {
    id: 'req-nocap',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'hi',
  };
  const { server, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  const state = { handled: new Set(), children: new Map() };
  let child;
  await tick(cfg, state, {
    readAllowlist: () => allowlist,
    spawn: () => {
      child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = (signal) => {
        child.killedWith = signal;
      };
      return child; // never auto-exits — this test drives it
    },
  });
  // Long enough that a WOULD-be cap (if wrongly armed with no timeoutSec)
  // has every opportunity to fire.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(child.killedWith, undefined, 'no timeoutSec must arm no timer at all');
  child.emit('exit', 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  server.close();
});

test('T5 cap: fires SIGTERM through the SAME live-children registry, escalates to SIGKILL if the child ignores it, and reports the DISTINCT "capped" status', async () => {
  // timeoutSec is fractional-seconds here (the runner just multiplies by
  // 1000ms with no re-validation of its own — the server enforces the
  // integer-seconds bound before this ever reaches the poll response) —
  // the fastest honest way to exercise a real setTimeout in this suite.
  const item = {
    id: 'req-cap',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'runs too long',
    timeoutSec: 0.03, // 30ms
  };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  const state = { handled: new Set(), children: new Map() };
  const signals = [];
  let child;
  await tick(cfg, state, {
    readAllowlist: () => allowlist,
    killGraceMs: 30,
    spawn: () => {
      child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      // Deliberately ignores SIGTERM (never emits 'exit' on its own) so the
      // escalation path is actually exercised — the SAME child object each
      // time, proving both signals go through the ONE registry entry, never
      // a second/raw path. Returns true = "delivered" (node's real kill()
      // contract; triggerCap only marks capped on a delivered TERM).
      child.kill = (signal) => {
        signals.push(signal);
        return true;
      };
      return child;
    },
  });

  // Wait past the cap AND the escalation grace period.
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(
    signals,
    ['SIGTERM', 'SIGKILL'],
    'expected TERM then an escalated KILL, both via child.kill()',
  );

  // The OS actually terminating it (simulated here) is what triggers the
  // terminal report — never reported before the process really exits.
  child.emit('exit', null);
  await new Promise((resolve) => setTimeout(resolve, 50));
  server.close();

  const cappedStatus = captured.find(
    (c) => c.url === '/api/dispatch/req-cap/status' && c.body.event === 'capped',
  );
  assert.ok(cappedStatus, 'expected a distinct "capped" status POST');
  assert.equal(
    captured.some(
      (c) =>
        c.url === '/api/dispatch/req-cap/status' &&
        (c.body.event === 'killed' || c.body.event === 'exited'),
    ),
    false,
    'a capped dispatch must never ALSO report killed or exited',
  );
});

test('T5 cap: a child that exits naturally BEFORE the cap fires is reported "exited", never "capped" — the timer is cleared, not just ignored', async () => {
  const item = {
    id: 'req-cap-beaten',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'finishes first',
    timeoutSec: 1, // 1000ms — comfortably longer than this test's own waits
  };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  const state = { handled: new Set(), children: new Map() };
  const signals = [];
  await tick(cfg, state, {
    readAllowlist: () => allowlist,
    spawn: () => {
      const child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = (signal) => signals.push(signal);
      setImmediate(() => child.emit('exit', 0)); // finishes almost immediately
      return child;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  server.close();

  assert.deepEqual(signals, [], 'the cap timer must never fire once the child already exited');
  const exited = captured.find(
    (c) => c.url === '/api/dispatch/req-cap-beaten/status' && c.body.event === 'exited',
  );
  assert.ok(exited, 'expected a normal "exited" report');
});

test("T5 cap: a concurrent, un-capped dispatch is entirely unaffected by another dispatch's cap", async () => {
  const cappedItem = {
    id: 'req-cap-a',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'capped',
    timeoutSec: 0.03,
  };
  const uncappedItem = {
    id: 'req-cap-b',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'uncapped',
  };
  const { server, captured, port } = await startStubServer(
    stubHandler({ pending: [cappedItem, uncappedItem] }),
  );
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  const state = { handled: new Set(), children: new Map() };
  const children = {};
  await tick(cfg, state, {
    readAllowlist: () => allowlist,
    killGraceMs: 20,
    spawn: (_cmd, args) => {
      const child = new EventEmitter();
      child.pid = args[args.length - 1] === 'capped' ? 1111 : 2222;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = (signal) => {
        child.killedWith = signal;
        return true; // delivered — triggerCap only marks capped on a delivered TERM
      };
      children[child.pid] = child;
      return child; // neither auto-exits — this test drives B explicitly
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(children[1111].killedWith, 'SIGKILL', 'A was capped and escalated');
  assert.equal(children[2222].killedWith, undefined, 'B (no cap) must be entirely untouched');

  children[1111].emit('exit', null);
  children[2222].emit('exit', 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  server.close();

  assert.equal(
    captured.find(
      (c) => c.url === '/api/dispatch/req-cap-a/status' && c.body.event === 'capped',
    ) !== undefined,
    true,
  );
  assert.equal(
    captured.find(
      (c) => c.url === '/api/dispatch/req-cap-b/status' && c.body.event === 'exited',
    ) !== undefined,
    true,
  );
});

test('T5 cap (codex fix round finding 5): a cap timer whose SIGTERM does NOT deliver (child already exiting) never marks capped — the natural "exited" report stands', async () => {
  const item = {
    id: 'req-cap-race',
    action: 'dispatch',
    provider: 'claude',
    cwd: tmpDir,
    prompt: 'exits as the cap fires',
    timeoutSec: 0.03, // 30ms
  };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const cfg = baseCfg(port);
  const allowlist = { providers: ['claude'], roots: [tmpDir], focus: false };
  const state = { handled: new Set(), children: new Map() };
  let child;
  await tick(cfg, state, {
    readAllowlist: () => allowlist,
    killGraceMs: 20,
    spawn: () => {
      child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      // The exact race: the child is already dead/exiting when the cap
      // timer fires, so kill() reports NOT delivered (node's contract) —
      // its real 'exit' event just hasn't been processed yet.
      child.kill = () => false;
      return child;
    },
  });

  // Let the cap timer fire against the not-deliverable child…
  await new Promise((resolve) => setTimeout(resolve, 60));
  // …then the natural exit lands.
  child.emit('exit', 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  server.close();

  const exited = captured.find(
    (c) => c.url === '/api/dispatch/req-cap-race/status' && c.body.event === 'exited',
  );
  assert.ok(exited, 'the natural "exited" report must stand');
  assert.equal(
    captured.some(
      (c) => c.url === '/api/dispatch/req-cap-race/status' && c.body.event === 'capped',
    ),
    false,
    'an undelivered TERM must never mislabel a natural exit as capped',
  );
});

test('worker session kill (observed pid): an UNKNOWN pid has no server/runner path at all — the UI disables the button instead (nothing to test at this layer)', () => {
  // Documented no-op: see AgentDrawer.tsx's disabled-button state and
  // KICKOFF v1.1 item 3's explicit "don't build a server/runner path for
  // this case" instruction.
  assert.ok(true);
});
