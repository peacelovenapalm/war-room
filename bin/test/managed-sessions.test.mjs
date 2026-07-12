/**
 * Unit + integration tests for the managed-session substrate (T2 remote-
 * answer plane + T4 session launch — REMOTE-ANSWER-DESIGN.md).
 *
 * Pure-lib tests exercise bin/lib/managed-sessions.mjs with a fake
 * promisified-execFile (no real tmux server is ever touched); integration
 * tests drive dispatch-runner.mjs's tick() against a stub HTTP server with
 * the same injected execFileImpl, pinning the containment seams:
 * deny-by-default capability, manifest+alive answerability, one-shot
 * nonces, literal send-keys discipline, verbatim audit.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import * as assert from 'node:assert/strict';

import { buildSessionArgv, parseAllowlist, validateRequest } from '../lib/dispatch-rules.mjs';
import {
  ANSWER_TEXT_MAX_CHARS,
  checkTmuxVersion,
  createManagedSession,
  deliverAnswer,
  listTmuxSessions,
  readManifest,
  tmuxSessionName,
  validateAnswerText,
  writeManifest,
} from '../lib/managed-sessions.mjs';
import { tick } from '../dispatch-runner.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-sessions-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Fake promisified execFile for tmux. `sessions` = the set of live session
 * names; `version` = the `tmux -V` output. Records every call. new-session
 * adds to the live set; a `fail` matcher forces a rejection for a
 * subcommand.
 */
function fakeTmux({ sessions = new Set(), version = 'tmux 3.4', panePid = 777, fail = [] } = {}) {
  const calls = [];
  const live = new Set(sessions);
  const impl = async (file, args) => {
    calls.push({ file, args });
    if (file !== 'tmux') throw new Error(`unexpected binary: ${file}`);
    const sub = args[0];
    if (fail.includes(sub)) throw new Error(`forced ${sub} failure`);
    if (sub === '-V') return { stdout: `${version}\n`, stderr: '' };
    if (sub === 'list-sessions') return { stdout: [...live].join('\n'), stderr: '' };
    if (sub === 'has-session') {
      const target = args[args.indexOf('-t') + 1].replace(/^=/, '');
      if (live.has(target)) return { stdout: '', stderr: '' };
      throw new Error(`can't find session: ${target}`);
    }
    if (sub === 'new-session') {
      const name = args[args.indexOf('-s') + 1];
      live.add(name);
      return { stdout: '', stderr: '' };
    }
    if (sub === 'list-panes') return { stdout: `${panePid}\n`, stderr: '' };
    if (sub === 'send-keys') {
      // window-target form `=name:` — strip exact-match `=` and trailing `:`
      const target = args[args.indexOf('-t') + 1].replace(/^=/, '').replace(/:$/, '');
      if (!live.has(target)) throw new Error(`can't find session: ${target}`);
      return { stdout: '', stderr: '' };
    }
    throw new Error(`unhandled tmux subcommand: ${sub}`);
  };
  return { impl, calls, live };
}

// ── tmuxSessionName ───────────────────────────────────────────────

test('tmuxSessionName: accepts a uuid-shaped token, rejects everything else', () => {
  assert.equal(tmuxSessionName('abc-123-DEF'), 'war-room-abc-123-DEF');
  assert.equal(tmuxSessionName('a b'), null);
  assert.equal(tmuxSessionName('a;rm'), null);
  assert.equal(tmuxSessionName(''), null);
  assert.equal(tmuxSessionName('x'.repeat(65)), null);
  assert.equal(tmuxSessionName(42), null);
  assert.equal(tmuxSessionName(undefined), null);
});

// ── Manifest ──────────────────────────────────────────────────────

test('readManifest: missing, corrupt, and wrong-shape files all read as empty', () => {
  const p = path.join(tmpDir, 'none.json');
  assert.deepEqual(readManifest(p), []);
  fs.writeFileSync(p, 'not json', 'utf8');
  assert.deepEqual(readManifest(p), []);
  fs.writeFileSync(p, '{"a":1}', 'utf8');
  assert.deepEqual(readManifest(p), []);
  fs.writeFileSync(p, JSON.stringify([{ dispatchId: 'd1' }, { tmuxSession: 's' }, null]), 'utf8');
  assert.deepEqual(readManifest(p), []); // entries missing either key are dropped
});

test('writeManifest/readManifest: atomic roundtrip', () => {
  const p = path.join(tmpDir, 'nested', 'manifest.json');
  const entries = [{ dispatchId: 'd1', tmuxSession: 'war-room-d1', panePid: 9, cwd: '/x' }];
  assert.equal(writeManifest(p, entries), true);
  assert.deepEqual(readManifest(p), entries);
  assert.equal(fs.existsSync(`${p}.tmp`), false, 'temp file must not linger');
});

// ── validateAnswerText ────────────────────────────────────────────

test('validateAnswerText: accepts plain text, rejects empties/caps/control chars', () => {
  assert.deepEqual(validateAnswerText('yes, option 2 — go ahead $(true)'), { ok: true });
  assert.equal(validateAnswerText('').reason, 'invalid-text');
  assert.equal(validateAnswerText(42).reason, 'invalid-text');
  assert.equal(validateAnswerText('x'.repeat(ANSWER_TEXT_MAX_CHARS + 1)).reason, 'text-too-long');
  assert.equal(validateAnswerText('line1\nline2').reason, 'control-chars-rejected');
  assert.equal(validateAnswerText('esc\u001b[Aup').reason, 'control-chars-rejected');
  assert.equal(validateAnswerText('nul\u0000').reason, 'control-chars-rejected');
  assert.equal(validateAnswerText('del\u007f').reason, 'control-chars-rejected');
});

// ── tmux helpers ──────────────────────────────────────────────────

test('checkTmuxVersion: >=3.2 ok, older/unparseable/absent all deny', async () => {
  assert.equal((await checkTmuxVersion(fakeTmux({ version: 'tmux 3.2' }).impl)).ok, true);
  assert.equal((await checkTmuxVersion(fakeTmux({ version: 'tmux 3.4a' }).impl)).ok, true);
  const old = await checkTmuxVersion(fakeTmux({ version: 'tmux 2.9' }).impl);
  assert.equal(old.ok, false);
  assert.match(old.reason, /tmux-too-old/);
  const weird = await checkTmuxVersion(fakeTmux({ version: 'tmux next' }).impl);
  assert.equal(weird.reason, 'tmux-version-unparseable');
  const gone = await checkTmuxVersion(async () => {
    throw new Error('ENOENT');
  });
  assert.equal(gone.reason, 'tmux-unavailable');
});

test('listTmuxSessions: parses names; any failure reads as an empty set', async () => {
  const live = await listTmuxSessions(fakeTmux({ sessions: ['a', 'war-room-x'] }).impl);
  assert.deepEqual([...live].sort(), ['a', 'war-room-x']);
  const none = await listTmuxSessions(async () => {
    throw new Error('no server running');
  });
  assert.equal(none.size, 0);
});

// ── createManagedSession ──────────────────────────────────────────

test('createManagedSession: launches detached with argv-exec and returns the pane pid', async () => {
  const tmux = fakeTmux({ panePid: 4141 });
  const result = await createManagedSession(
    { dispatchId: 'd-1', cwd: '/proj', argv: ['claude', '--model', 'fable'] },
    tmux.impl,
  );
  assert.deepEqual(result, { ok: true, tmuxSession: 'war-room-d-1', panePid: 4141 });
  const newSession = tmux.calls.find((c) => c.args[0] === 'new-session');
  assert.deepEqual(newSession.args, [
    'new-session',
    '-d',
    '-s',
    'war-room-d-1',
    '-c',
    '/proj',
    '--',
    'claude',
    '--model',
    'fable',
  ]);
});

test('createManagedSession: denies bad ids, old tmux, duplicates, launch failures', async () => {
  const ok = fakeTmux();
  assert.equal(
    (await createManagedSession({ dispatchId: 'bad id', cwd: '/p', argv: ['claude'] }, ok.impl))
      .reason,
    'invalid-dispatch-id',
  );
  const old = fakeTmux({ version: 'tmux 3.1a' });
  assert.match(
    (await createManagedSession({ dispatchId: 'd2', cwd: '/p', argv: ['claude'] }, old.impl))
      .reason,
    /tmux-too-old/,
  );
  const dup = fakeTmux({ sessions: ['war-room-d3'] });
  assert.equal(
    (await createManagedSession({ dispatchId: 'd3', cwd: '/p', argv: ['claude'] }, dup.impl))
      .reason,
    'session-already-exists',
  );
  const broken = fakeTmux({ fail: ['new-session'] });
  assert.match(
    (await createManagedSession({ dispatchId: 'd4', cwd: '/p', argv: ['claude'] }, broken.impl))
      .reason,
    /tmux-launch-failed/,
  );
});

// ── deliverAnswer ─────────────────────────────────────────────────

test('deliverAnswer: literal -l send then a SEPARATE Enter send', async () => {
  const tmux = fakeTmux({ sessions: ['war-room-d5'] });
  const result = await deliverAnswer(
    { tmuxSession: 'war-room-d5', text: 'option 2; $(echo pwned) `whoami`' },
    tmux.impl,
  );
  assert.deepEqual(result, { ok: true });
  const sends = tmux.calls.filter((c) => c.args[0] === 'send-keys');
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0].args, [
    'send-keys',
    '-t',
    '=war-room-d5:',
    '-l',
    '--',
    'option 2; $(echo pwned) `whoami`',
  ]);
  assert.deepEqual(sends[1].args, ['send-keys', '-t', '=war-room-d5:', 'Enter']);
});

test('deliverAnswer: dead session denies before any keystroke is sent', async () => {
  const tmux = fakeTmux(); // nothing live
  const result = await deliverAnswer({ tmuxSession: 'war-room-gone', text: 'hi' }, tmux.impl);
  assert.equal(result.reason, 'session-dead');
  assert.equal(
    tmux.calls.filter((c) => c.args[0] === 'send-keys').length,
    0,
    'no send-keys may ever target a dead session',
  );
});

// ── dispatch-rules: sessions capability + interactive argv ───────

test('parseAllowlist: sessions granted ONLY by the literal boolean true', () => {
  assert.equal(parseAllowlist('{"sessions": true}').allowlist.sessions, true);
  assert.equal(parseAllowlist('{"sessions": "true"}').allowlist.sessions, false);
  assert.equal(parseAllowlist('{"sessions": 1}').allowlist.sessions, false);
  assert.equal(parseAllowlist('{}').allowlist.sessions, false);
});

test('validateRequest: session action is deny-by-default, then dispatch-grade checks', () => {
  const base = { providers: ['claude'], roots: [tmpDir], focus: false };
  const request = { action: 'session', provider: 'claude', cwd: tmpDir };
  assert.equal(validateRequest(request, base).reason, 'sessions-not-allowlisted');
  assert.deepEqual(validateRequest(request, { ...base, sessions: true }), { ok: true });
  assert.equal(
    validateRequest({ ...request, provider: 'codex' }, { ...base, sessions: true }).reason,
    'provider-not-allowlisted',
  );
  assert.equal(
    validateRequest({ ...request, cwd: os.tmpdir() }, { ...base, roots: [tmpDir], sessions: true })
      .reason,
    'path-not-allowlisted',
  );
});

test('buildSessionArgv: interactive shapes per provider (no -p, no exec)', () => {
  assert.deepEqual(
    buildSessionArgv({ provider: 'claude', model: 'fable', effort: 'high', prompt: 'go' }),
    ['claude', '--model', 'fable', '--effort', 'high', 'go'],
  );
  assert.deepEqual(buildSessionArgv({ provider: 'claude' }), ['claude']);
  assert.deepEqual(buildSessionArgv({ provider: 'codex', prompt: 'hi' }), ['codex', 'hi']);
  assert.deepEqual(buildSessionArgv({ provider: 'gemini', prompt: 'hi' }), ['gemini', '-i', 'hi']);
  assert.deepEqual(buildSessionArgv({ provider: 'gemini' }), ['gemini']);
  assert.equal(buildSessionArgv({ provider: 'nope' }), null);
});

// ── tick() integration (stub server + fake tmux) ─────────────────

function startStubServer(handler) {
  return new Promise((resolve) => {
    const captured = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsedBody = body ? JSON.parse(body) : {};
        captured.push({ url: req.url, method: req.method, body: parsedBody, headers: req.headers });
        handler(req, res, parsedBody);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, captured, port: server.address().port }));
  });
}

function stubHandler({ pending = [], stop = [], answer = [] } = {}) {
  return (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/api/dispatch/poll') {
      res.end(JSON.stringify({ pending, stop, answer }));
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
    manifestPath: path.join(tmpDir, 'managed-sessions.json'),
    ...overrides,
  };
}

function freshState() {
  // C9-4: consumedNonces is now a Map<nonce, consumedAtMs> (TTL-bounded).
  return { handled: new Set(), children: new Map(), consumedNonces: new Map() };
}

/** Poll until `cond()` is true (or ~1s passes) — for fire-and-forget POSTs. */
async function waitFor(cond) {
  for (let i = 0; i < 100 && !cond(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('tick: a session request without the capability flag denies, never touches tmux', async () => {
  const item = { id: 'sess-1', action: 'session', provider: 'claude', cwd: tmpDir };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const tmux = fakeTmux();
  await tick(baseCfg(port), freshState(), {
    readAllowlist: () => ({ providers: ['claude'], roots: [tmpDir], focus: false }),
    execFileImpl: tmux.impl,
  });
  server.close();

  const decision = captured.find((c) => c.url === '/api/dispatch/sess-1/decision');
  assert.equal(decision.body.decision, 'deny');
  assert.equal(decision.body.reason, 'sessions-not-allowlisted');
  assert.equal(tmux.calls.length, 0, 'a denied session request must never reach tmux');
});

test('tick: accepts a session request — tmux launch, manifest entry, accept(pid) + started', async () => {
  const item = { id: 'sess-2', action: 'session', provider: 'claude', cwd: tmpDir, prompt: 'work' };
  const { server, captured, port } = await startStubServer(stubHandler({ pending: [item] }));
  const tmux = fakeTmux({ panePid: 5150 });
  const cfg = baseCfg(port);
  await tick(cfg, freshState(), {
    readAllowlist: () => ({ providers: ['claude'], roots: [tmpDir], focus: false, sessions: true }),
    execFileImpl: tmux.impl,
  });
  // The 'started' status POST is fire-and-forget (void postStatus) — give it
  // a beat to land on the stub before closing, same flush idiom as the
  // dispatch-runner exit tests.
  await waitFor(() => captured.some((c) => c.url === '/api/dispatch/sess-2/status'));
  server.close();

  const decision = captured.find((c) => c.url === '/api/dispatch/sess-2/decision');
  assert.equal(decision.body.decision, 'accept');
  assert.equal(decision.body.pid, 5150);
  const started = captured.find((c) => c.url === '/api/dispatch/sess-2/status');
  assert.equal(started.body.event, 'started');
  assert.equal(started.body.pid, 5150);

  const manifest = readManifest(cfg.manifestPath);
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].dispatchId, 'sess-2');
  assert.equal(manifest[0].tmuxSession, 'war-room-sess-2');
  assert.equal(manifest[0].panePid, 5150);

  const newSession = tmux.calls.find((c) => c.args[0] === 'new-session');
  assert.ok(newSession.args.includes('war-room-sess-2'));
  assert.deepEqual(newSession.args.slice(newSession.args.indexOf('--') + 1), ['claude', 'work']);
});

test('tick: sweep prunes dead sessions (exited posted) and advertises only live ones', async () => {
  const { server, captured, port } = await startStubServer(stubHandler({}));
  const cfg = baseCfg(port);
  writeManifest(cfg.manifestPath, [
    { dispatchId: 'live-1', tmuxSession: 'war-room-live-1', panePid: 1 },
    { dispatchId: 'dead-1', tmuxSession: 'war-room-dead-1', panePid: 2 },
  ]);
  const tmux = fakeTmux({ sessions: ['war-room-live-1'] });
  await tick(cfg, freshState(), {
    readAllowlist: () => ({ providers: ['claude'], roots: [tmpDir], focus: false, sessions: true }),
    execFileImpl: tmux.impl,
  });
  server.close();

  const exited = captured.find((c) => c.url === '/api/dispatch/dead-1/status');
  assert.equal(exited.body.event, 'exited');
  const poll = captured.find((c) => c.url === '/api/dispatch/poll');
  assert.equal(poll.body.sessions, true);
  assert.equal(poll.body.managedSessions.length, 1);
  assert.equal(poll.body.managedSessions[0].dispatchId, 'live-1');
  const manifest = readManifest(cfg.manifestPath);
  assert.deepEqual(
    manifest.map((e) => e.dispatchId),
    ['live-1'],
  );
});

test('tick: delivers an answer to a managed live session and reports delivered', async () => {
  const instr = {
    id: 'ans-1',
    managedSessionRef: 'sess-9',
    text: 'yes — option 2',
    nonce: 'nonce-1',
  };
  const { server, captured, port } = await startStubServer(stubHandler({ answer: [instr] }));
  const cfg = baseCfg(port);
  writeManifest(cfg.manifestPath, [
    { dispatchId: 'sess-9', tmuxSession: 'war-room-sess-9', panePid: 3 },
  ]);
  const tmux = fakeTmux({ sessions: ['war-room-sess-9'] });
  await tick(cfg, freshState(), {
    readAllowlist: () => ({ providers: ['claude'], roots: [tmpDir], focus: false, sessions: true }),
    execFileImpl: tmux.impl,
  });
  server.close();

  const status = captured.find((c) => c.url === '/api/answers/ans-1/status');
  assert.equal(status.body.event, 'delivered');
  const sends = tmux.calls.filter((c) => c.args[0] === 'send-keys');
  assert.equal(sends.length, 2);
  assert.equal(sends[0].args.at(-1), 'yes — option 2');
  assert.equal(sends[1].args.at(-1), 'Enter');

  const auditLines = fs.readFileSync(cfg.auditLog, 'utf8').trim().split('\n').map(JSON.parse);
  const delivered = auditLines.find((l) => l.event === 'answer-delivered');
  assert.equal(delivered.text, 'yes — option 2', 'audit carries the VERBATIM text');
  assert.equal(delivered.nonce, 'nonce-1');
});

test('tick: a replayed nonce denies even across ticks (one-shot, in-process)', async () => {
  const instr = { id: 'ans-2', managedSessionRef: 'sess-9', text: 'ok', nonce: 'nonce-dup' };
  const { server, captured, port } = await startStubServer(stubHandler({ answer: [instr] }));
  const cfg = baseCfg(port);
  writeManifest(cfg.manifestPath, [
    { dispatchId: 'sess-9', tmuxSession: 'war-room-sess-9', panePid: 3 },
  ]);
  const tmux = fakeTmux({ sessions: ['war-room-sess-9'] });
  const state = freshState();
  const deps = {
    readAllowlist: () => ({ providers: ['claude'], roots: [tmpDir], focus: false, sessions: true }),
    execFileImpl: tmux.impl,
  };
  await tick(cfg, state, deps);
  await tick(cfg, state, deps); // same instruction redelivered
  server.close();

  const statuses = captured.filter((c) => c.url === '/api/answers/ans-2/status');
  assert.equal(statuses[0].body.event, 'delivered');
  assert.equal(statuses[1].body.event, 'denied');
  assert.equal(statuses[1].body.reason, 'nonce-replayed');
  assert.equal(
    tmux.calls.filter((c) => c.args[0] === 'send-keys').length,
    2,
    'the replay must never send keystrokes again',
  );
});

test('tick: answers deny session-not-managed / control-chars without consuming state wrongly', async () => {
  const answers = [
    { id: 'ans-3', managedSessionRef: 'never-launched', text: 'hi', nonce: 'n3' },
    { id: 'ans-4', managedSessionRef: 'sess-9', text: 'bad\nnewline', nonce: 'n4' },
  ];
  const { server, captured, port } = await startStubServer(stubHandler({ answer: answers }));
  const cfg = baseCfg(port);
  writeManifest(cfg.manifestPath, [
    { dispatchId: 'sess-9', tmuxSession: 'war-room-sess-9', panePid: 3 },
  ]);
  const tmux = fakeTmux({ sessions: ['war-room-sess-9'] });
  const state = freshState();
  await tick(cfg, state, {
    readAllowlist: () => ({ providers: ['claude'], roots: [tmpDir], focus: false, sessions: true }),
    execFileImpl: tmux.impl,
  });
  server.close();

  assert.equal(
    captured.find((c) => c.url === '/api/answers/ans-3/status').body.reason,
    'session-not-managed',
  );
  assert.equal(
    captured.find((c) => c.url === '/api/answers/ans-4/status').body.reason,
    'control-chars-rejected',
  );
  assert.equal(state.consumedNonces.has('n3'), true, 'manifest-miss consumed its nonce (one-shot)');
  assert.equal(
    state.consumedNonces.has('n4'),
    false,
    'text rejected BEFORE nonce consumption — a corrected resend may reuse nothing anyway (server re-mints), but the runner must not burn nonces on unvalidated input',
  );
  assert.equal(tmux.calls.filter((c) => c.args[0] === 'send-keys').length, 0);
});
