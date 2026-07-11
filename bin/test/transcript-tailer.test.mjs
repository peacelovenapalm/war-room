/**
 * Unit + integration tests for bin/transcript-tailer.mjs (T1 remote
 * live-tail, S3). Read-discipline and instruction-processing tests use a
 * real temp directory (fs.realpathSync-backed containment needs real
 * paths, same rationale as tailer-roots.test.mjs); network tests use an
 * injected fetch fake — no real server.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  parseArgs,
  pollTick,
  processInstruction,
  readNewAssistantLines,
  readPass,
  runTailer,
} from '../transcript-tailer.mjs';

let tmpBase;

before(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-tailer-test-'));
});

after(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

let fileCounter = 0;
function tmpFile(name = `session-${fileCounter++}.jsonl`) {
  return path.join(tmpBase, name);
}

const assistantText = (text) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function noopLog() {}

// ── parseArgs ─────────────────────────────────────────────────────

test('parseArgs: env defaults', () => {
  const saved = {
    WAR_ROOM_URL: process.env.WAR_ROOM_URL,
    WAR_ROOM_TOKEN: process.env.WAR_ROOM_TOKEN,
    WAR_ROOM_MACHINE: process.env.WAR_ROOM_MACHINE,
    WAR_ROOM_TAILER_POLL_MS: process.env.WAR_ROOM_TAILER_POLL_MS,
  };
  process.env.WAR_ROOM_URL = 'http://example:9999/';
  process.env.WAR_ROOM_TOKEN = 'tok-env';
  process.env.WAR_ROOM_MACHINE = 'env machine!';
  process.env.WAR_ROOM_TAILER_POLL_MS = '9000';
  try {
    const cfg = parseArgs([]);
    assert.equal(cfg.url, 'http://example:9999'); // trailing slash stripped
    assert.equal(cfg.token, 'tok-env');
    assert.equal(cfg.machine, 'ENV-MACHINE-'); // sanitized+uppercased
    assert.equal(cfg.intervalMs, 9000);
    assert.equal(cfg.once, false);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('parseArgs: flags override env, --once sets cfg.once, interval floors at MIN', () => {
  const cfg = parseArgs([
    '--url',
    'http://flagged:1',
    '--machine',
    'flagged',
    '--interval',
    '10',
    '--once',
  ]);
  assert.equal(cfg.url, 'http://flagged:1');
  assert.equal(cfg.machine, 'flagged'); // flags are NOT sanitized (matches needs-input-poller's cfg.machine flag)
  assert.equal(cfg.intervalMs, 5000); // 10ms < MIN_INTERVAL_MS(2000) -> floors to the 5000 default
  assert.equal(cfg.once, true);
});

test('parseArgs: roots default includes ~/.claude/projects', () => {
  const cfg = parseArgs([]);
  assert.ok(cfg.roots.some((r) => r.endsWith(path.join('.claude', 'projects'))));
});

// ── readNewAssistantLines ─────────────────────────────────────────

test('readNewAssistantLines: returns missing:true for a file that does not exist yet', () => {
  const tail = { path: tmpFile(), offset: 0, lineBuffer: '' };
  const result = readNewAssistantLines(tail, fs, noopLog);
  assert.deepEqual(result, { lines: [], missing: true });
});

test('readNewAssistantLines: only assistant records are forwarded; non-assistant and malformed are skipped', () => {
  const file = tmpFile();
  const content =
    [
      assistantText('hello'),
      JSON.stringify({ type: 'user', message: { content: 'not assistant' } }),
      'not even json',
      assistantText('world'),
    ].join('\n') + '\n';
  fs.writeFileSync(file, content);
  const tail = { path: file, offset: 0, lineBuffer: '' };
  const { lines, missing } = readNewAssistantLines(tail, fs, noopLog);
  assert.equal(missing, false);
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).message.content[0].text, 'hello');
  assert.equal(JSON.parse(lines[1]).message.content[0].text, 'world');
});

test('readNewAssistantLines: carries a partial (unterminated) line across successive reads', () => {
  const file = tmpFile();
  fs.writeFileSync(file, ''); // start empty
  const tail = { path: file, offset: 0, lineBuffer: '' };

  fs.appendFileSync(file, assistantText('partial').slice(0, 10)); // no trailing newline
  let result = readNewAssistantLines(tail, fs, noopLog);
  assert.deepEqual(result.lines, [], 'nothing complete yet');
  assert.notEqual(tail.lineBuffer, '', 'the partial bytes are buffered');

  fs.appendFileSync(file, assistantText('partial').slice(10) + '\n');
  result = readNewAssistantLines(tail, fs, noopLog);
  assert.equal(result.lines.length, 1);
  assert.equal(JSON.parse(result.lines[0]).message.content[0].text, 'partial');
});

test('readNewAssistantLines: caps a single pass at 64KB, picking up the remainder on the next call', () => {
  const file = tmpFile();
  // ~2000 lines x ~60 bytes = ~120KB total, comfortably over the 64KB cap.
  const lines = Array.from({ length: 2000 }, (_, i) => assistantText(`line-${i}`));
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const totalBytes = fs.statSync(file).size;
  assert.ok(totalBytes > 65_536, 'fixture must exceed the pass cap for this test to mean anything');

  const tail = { path: file, offset: 0, lineBuffer: '' };
  const first = readNewAssistantLines(tail, fs, noopLog);
  assert.ok(tail.offset <= 65_536, 'offset never advances past the per-pass cap');
  assert.ok(tail.offset < totalBytes, 'the whole file was NOT consumed in one pass');
  assert.ok(first.lines.length > 0 && first.lines.length < 2000, 'a partial batch, not everything');

  // Keep reading until the file is fully consumed.
  let allLines = [...first.lines];
  while (tail.offset < totalBytes) {
    const next = readNewAssistantLines(tail, fs, noopLog);
    allLines = allLines.concat(next.lines);
  }
  assert.equal(allLines.length, 2000, 'every line eventually arrives across passes');
});

test('readNewAssistantLines: skips an oversized assistant line and logs a warning, never sends it', () => {
  const file = tmpFile();
  const bigText = 'y'.repeat(300 * 1024); // the JSON line comfortably exceeds MAX_LINE_BYTES (256KB)
  fs.writeFileSync(file, assistantText(bigText) + '\n' + assistantText('short') + '\n');
  const tail = { path: file, offset: 0, lineBuffer: '' };
  const totalBytes = fs.statSync(file).size;

  const logs = [];
  let lines = [];
  while (tail.offset < totalBytes) {
    const result = readNewAssistantLines(tail, fs, (m) => logs.push(m));
    lines = lines.concat(result.lines);
  }
  assert.equal(lines.length, 1, 'only the short line was forwarded');
  assert.equal(JSON.parse(lines[0]).message.content[0].text, 'short');
  assert.ok(
    logs.some((m) => m.includes('oversized')),
    'the oversized line was logged, not thrown',
  );
});

// ── processInstruction ─────────────────────────────────────────────

function fakeForwarder() {
  const flushed = [];
  const dropped = [];
  return {
    flushed,
    dropped,
    push() {},
    flush(sessionId) {
      flushed.push(sessionId);
      return Promise.resolve();
    },
    drop(sessionId) {
      dropped.push(sessionId);
    },
  };
}

test('processInstruction: tail-on with fromStart:true starts at offset 0 even for an existing non-empty file', () => {
  const file = tmpFile();
  fs.writeFileSync(file, assistantText('already here') + '\n');
  const tails = new Map();
  const fwd = fakeForwarder();
  processInstruction(
    { kind: 'tail-on', sessionId: 's1', transcriptPath: file, fromStart: true },
    tails,
    fwd,
    [tmpBase],
    fs,
    noopLog,
  );
  assert.equal(tails.get('s1').offset, 0);
});

test('processInstruction: tail-on with fromStart:false starts at EOF (only new output)', () => {
  const file = tmpFile();
  fs.writeFileSync(file, assistantText('pre-existing') + '\n');
  const size = fs.statSync(file).size;
  const tails = new Map();
  const fwd = fakeForwarder();
  processInstruction(
    { kind: 'tail-on', sessionId: 's2', transcriptPath: file },
    tails,
    fwd,
    [tmpBase],
    fs,
    noopLog,
  );
  assert.equal(tails.get('s2').offset, size);
});

test('processInstruction: tail-on for a missing file keeps the tail active at offset 0, logs once', () => {
  const file = tmpFile('never-written.jsonl');
  const tails = new Map();
  const fwd = fakeForwarder();
  const logs = [];
  processInstruction(
    { kind: 'tail-on', sessionId: 's3', transcriptPath: file, fromStart: false },
    tails,
    fwd,
    [tmpBase],
    fs,
    (m) => logs.push(m),
  );
  assert.ok(tails.has('s3'), 'tail stays active');
  assert.equal(tails.get('s3').offset, 0);
});

test('processInstruction: tail-on is idempotent for an already-active session', () => {
  const file = tmpFile();
  fs.writeFileSync(file, assistantText('x') + '\n');
  const tails = new Map();
  const fwd = fakeForwarder();
  processInstruction(
    { kind: 'tail-on', sessionId: 's4', transcriptPath: file, fromStart: true },
    tails,
    fwd,
    [tmpBase],
    fs,
    noopLog,
  );
  const before = { ...tails.get('s4') };
  // A second tail-on for the SAME session, even with different args, must
  // not reset offset/state.
  processInstruction(
    { kind: 'tail-on', sessionId: 's4', transcriptPath: tmpFile(), fromStart: false },
    tails,
    fwd,
    [tmpBase],
    fs,
    noopLog,
  );
  assert.deepEqual(tails.get('s4'), before);
});

test('processInstruction: tail-on for a path outside the allowlisted roots is refused, never added', () => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-root-'));
  const file = path.join(outsideDir, 'session.jsonl');
  fs.writeFileSync(file, '');
  const tails = new Map();
  const fwd = fakeForwarder();
  const logs = [];
  processInstruction(
    { kind: 'tail-on', sessionId: 's5', transcriptPath: file, fromStart: true },
    tails,
    fwd,
    [tmpBase], // outsideDir is NOT one of the allowed roots
    fs,
    (m) => logs.push(m),
  );
  assert.equal(tails.has('s5'), false);
  assert.ok(logs.some((m) => m.includes('refused')));
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

test('processInstruction: tail-off performs a final flush and drops the tail', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '');
  const tails = new Map();
  const fwd = fakeForwarder();
  processInstruction(
    { kind: 'tail-on', sessionId: 's6', transcriptPath: file, fromStart: true },
    tails,
    fwd,
    [tmpBase],
    fs,
    noopLog,
  );
  assert.ok(tails.has('s6'));
  processInstruction({ kind: 'tail-off', sessionId: 's6' }, tails, fwd, [tmpBase], fs, noopLog);
  assert.equal(tails.has('s6'), false);
  assert.deepEqual(fwd.flushed, ['s6']);
});

test('processInstruction: tail-off for an unknown session is a no-op', () => {
  const tails = new Map();
  const fwd = fakeForwarder();
  processInstruction({ kind: 'tail-off', sessionId: 'ghost' }, tails, fwd, [tmpBase], fs, noopLog);
  assert.deepEqual(fwd.flushed, []);
});

// ── pollTick ─────────────────────────────────────────────────────

function cfgFor(roots) {
  return { url: 'http://server', token: 'tok', machine: 'M1', roots: roots ?? [tmpBase] };
}

test('pollTick: a dead server skips the tick, logs, and leaves tails untouched', async () => {
  const logs = [];
  const tails = new Map();
  const fwd = fakeForwarder();
  const deps = {
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
    fsImpl: fs,
    log: (m) => logs.push(m),
  };
  await pollTick(cfgFor(), tails, fwd, deps);
  assert.equal(tails.size, 0);
  assert.ok(logs.some((m) => m.includes('poll POST failed')));
});

test('pollTick: a non-2xx response skips the tick with a log', async () => {
  const logs = [];
  const deps = {
    fetchImpl: async () => ({ ok: false, status: 500 }),
    fsImpl: fs,
    log: (m) => logs.push(m),
  };
  await pollTick(cfgFor(), new Map(), fakeForwarder(), deps);
  assert.ok(logs.some((m) => m.includes('server responded 500')));
});

test('pollTick: a malformed (non-JSON) response body skips the tick with a log', async () => {
  const logs = [];
  const deps = {
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    }),
    fsImpl: fs,
    log: (m) => logs.push(m),
  };
  await pollTick(cfgFor(), new Map(), fakeForwarder(), deps);
  assert.ok(logs.some((m) => m.includes('malformed poll response')));
});

test('pollTick: the request body advertises the currently-active sessionIds', async () => {
  let sentBody;
  const deps = {
    fetchImpl: async (url, init) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ tail: [] }) };
    },
    fsImpl: fs,
    log: noopLog,
  };
  const tails = new Map([
    ['s-a', { path: 'x', offset: 0, lineBuffer: '' }],
    ['s-b', { path: 'y', offset: 0, lineBuffer: '' }],
  ]);
  await pollTick(cfgFor(), tails, fakeForwarder(), deps);
  assert.deepEqual(new Set(sentBody.active), new Set(['s-a', 's-b']));
});

test('pollTick: processes returned instructions (tail-on lands in the tails map)', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, '');
  const deps = {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        tail: [{ kind: 'tail-on', sessionId: 's-new', transcriptPath: file, fromStart: true }],
      }),
    }),
    fsImpl: fs,
    log: noopLog,
  };
  const tails = new Map();
  await pollTick(cfgFor([tmpBase]), tails, fakeForwarder(), deps);
  assert.ok(tails.has('s-new'));
});

// ── readPass ─────────────────────────────────────────────────────

test('readPass: pushes newly-read assistant lines into the forwarder, keyed by sessionId', () => {
  const file = tmpFile();
  fs.writeFileSync(file, assistantText('hi') + '\n');
  const tails = new Map([['s-x', { path: file, offset: 0, lineBuffer: '', missingLogged: false }]]);
  const pushed = [];
  const fwd = { push: (sessionId, lines) => pushed.push({ sessionId, lines }) };
  readPass(tails, fwd, { fsImpl: fs, log: noopLog });
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].sessionId, 's-x');
  assert.equal(pushed[0].lines.length, 1);
});

test('readPass: a missing file logs "will retry" exactly once, never re-logs every pass', () => {
  const file = tmpFile('not-yet.jsonl');
  const tails = new Map([['s-y', { path: file, offset: 0, lineBuffer: '', missingLogged: false }]]);
  const logs = [];
  const fwd = { push: () => {} };
  readPass(tails, fwd, { fsImpl: fs, log: (m) => logs.push(m) });
  readPass(tails, fwd, { fsImpl: fs, log: (m) => logs.push(m) });
  readPass(tails, fwd, { fsImpl: fs, log: (m) => logs.push(m) });
  assert.equal(logs.filter((m) => m.includes('will retry')).length, 1);
});

// ── runTailer (integration, --once) ─────────────────────────────

test('runTailer --once: polls, tails a fresh session, reads it, and forwards its lines in one pass', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, assistantText('remote hello') + '\n');
  const outputCalls = [];
  const deps = {
    fetchImpl: async (url, init) => {
      if (url.endsWith('/api/tailer/poll')) {
        return {
          ok: true,
          json: async () => ({
            tail: [{ kind: 'tail-on', sessionId: 's-once', transcriptPath: file, fromStart: true }],
          }),
        };
      }
      if (url.endsWith('/api/agents/output')) {
        outputCalls.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ ok: true }) };
      }
      throw new Error(`unexpected URL ${url}`);
    },
    fsImpl: fs,
    log: noopLog,
  };
  await runTailer(
    { url: 'http://server', token: 'tok', machine: 'M1', roots: [tmpBase], once: true },
    deps,
  );
  assert.equal(outputCalls.length, 1);
  assert.equal(outputCalls[0].sessionId, 's-once');
  assert.equal(JSON.parse(outputCalls[0].lines[0]).message.content[0].text, 'remote hello');
});

test('runTailer --once: a 2xx {ok:false} from /api/agents/output stops forwarding for that session', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, assistantText('one') + '\n');
  const deniedLogs = [];
  const deps = {
    fetchImpl: async (url, init) => {
      if (url.endsWith('/api/tailer/poll')) {
        return {
          ok: true,
          json: async () => ({
            tail: [
              { kind: 'tail-on', sessionId: 's-denied', transcriptPath: file, fromStart: true },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: false, reason: 'unknown-session' }) };
    },
    fsImpl: fs,
    log: (m) => deniedLogs.push(m),
  };
  await runTailer(
    { url: 'http://server', token: 'tok', machine: 'M1', roots: [tmpBase], once: true },
    deps,
  );
  assert.ok(deniedLogs.some((m) => m.includes('denied by server')));
});
