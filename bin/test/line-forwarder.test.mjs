/**
 * Unit tests for the coalescing line forwarder (T1 remote live-tail, S3).
 * All network I/O goes through an injected fetch fake — no real server, no
 * real timers beyond short test-scoped flush windows.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { createLineForwarder } from '../lib/line-forwarder.mjs';

function fakeFetch(responseBody = { ok: true }) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, json: async () => responseBody };
  };
  return { calls, impl };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('coalesces pushes below the byte/line thresholds into one timed flush', async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createLineForwarder({
    url: 'http://server',
    token: 'tok',
    machine: 'MACBOOK',
    fetchImpl: impl,
    flushMs: 30,
  });

  fwd.push('sess-1', ['line-a']);
  fwd.push('sess-1', ['line-b']);
  assert.equal(calls.length, 0, 'nothing posts before the timer fires');

  await sleep(80);
  assert.equal(calls.length, 1, 'one coalesced POST');
  assert.equal(calls[0].url, 'http://server/api/agents/output');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
  assert.equal(calls[0].init.headers['x-machine'], 'MACBOOK');
  assert.deepEqual(calls[0].body, { sessionId: 'sess-1', lines: ['line-a', 'line-b'] });
});

test('flushes immediately when a session reaches the byte threshold', async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createLineForwarder({
    url: 'http://server',
    token: 'tok',
    machine: 'M',
    fetchImpl: impl,
    flushMs: 60_000,
    maxBytes: 10,
  });

  fwd.push('sess-1', ['x'.repeat(20)]);
  await sleep(20);
  assert.equal(calls.length, 1, 'threshold flush without waiting for the timer');
  assert.equal(calls[0].body.lines[0], 'x'.repeat(20));
  await fwd.stop();
});

test('flushes immediately when a session reaches the line-count threshold', async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createLineForwarder({
    url: 'http://server',
    token: 'tok',
    machine: 'M',
    fetchImpl: impl,
    flushMs: 60_000,
    maxLines: 3,
  });

  fwd.push('sess-1', ['a', 'b', 'c']);
  await sleep(20);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.lines, ['a', 'b', 'c']);
  await fwd.stop();
});

test('a single push exceeding maxLines is chunked into multiple POSTs, never one oversized batch', async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createLineForwarder({
    url: 'http://server',
    token: 'tok',
    machine: 'M',
    fetchImpl: impl,
    flushMs: 60_000,
    maxLines: 2,
  });

  fwd.push('sess-1', ['a', 'b', 'c', 'd', 'e']); // one read pass, 5 new lines
  await sleep(20);
  assert.equal(calls.length, 3, 'chunked into ceil(5/2) POSTs');
  assert.deepEqual(
    calls.map((c) => c.body.lines),
    [['a', 'b'], ['c', 'd'], ['e']],
  );
});

test('buffers sessions independently', async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createLineForwarder({
    url: 'http://server',
    token: 'tok',
    machine: 'M',
    fetchImpl: impl,
    flushMs: 60_000,
  });

  fwd.push('sess-a', ['from-a']);
  fwd.push('sess-b', ['from-b']);
  await fwd.stop(); // final flush of both

  assert.equal(calls.length, 2);
  const bySession = Object.fromEntries(calls.map((c) => [c.body.sessionId, c.body.lines]));
  assert.deepEqual(bySession['sess-a'], ['from-a']);
  assert.deepEqual(bySession['sess-b'], ['from-b']);
});

test("flush(sessionId) force-flushes only that session (tail-off's final flush)", async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createLineForwarder({
    url: 'http://server',
    token: 'tok',
    machine: 'M',
    fetchImpl: impl,
    flushMs: 60_000,
  });

  fwd.push('sess-a', ['final-a']);
  fwd.push('sess-b', ['still-buffered-b']);
  await fwd.flush('sess-a');

  assert.equal(calls.length, 1, 'only sess-a flushed');
  assert.deepEqual(calls[0].body, { sessionId: 'sess-a', lines: ['final-a'] });

  await fwd.stop();
  assert.equal(calls.length, 2, 'sess-b flushed on stop()');
});

test('stop() performs the final flush of every session and halts the loop', async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createLineForwarder({
    url: 'http://server',
    token: 'tok',
    machine: 'M',
    fetchImpl: impl,
    flushMs: 60_000,
  });

  fwd.push('sess-1', ['last words']);
  await fwd.stop();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { sessionId: 'sess-1', lines: ['last words'] });

  await fwd.stop(); // idempotent
  assert.equal(calls.length, 1);
  fwd.push('sess-1', ['after-stop']); // must be a no-op
  await sleep(20);
  assert.equal(calls.length, 1);
});

test('empty/no-op pushes are ignored (no empty POST bodies)', async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createLineForwarder({
    url: 'http://server',
    token: 'tok',
    machine: 'M',
    fetchImpl: impl,
    flushMs: 10,
  });
  fwd.push('sess-1', []);
  fwd.push('sess-1', undefined);
  await sleep(40);
  await fwd.stop();
  assert.equal(calls.length, 0);
});

test('a dead server never throws or blocks: pushes and stop survive rejecting fetch', async () => {
  const logs = [];
  let attempts = 0;
  const failingFetch = async () => {
    attempts++;
    throw new Error('ECONNREFUSED 127.0.0.1:3141');
  };
  const fwd = createLineForwarder({
    url: 'http://server',
    token: 'tok',
    machine: 'M',
    fetchImpl: failingFetch,
    flushMs: 10,
    log: (m) => logs.push(m),
  });

  fwd.push('sess-1', ['doomed-1']);
  await sleep(50);
  fwd.push('sess-1', ['doomed-2']);
  await assert.doesNotReject(() => fwd.stop());

  assert.equal(attempts, 2, 'both flushes were attempted');
  assert.ok(
    logs.some((m) => m.includes('line POST failed')),
    'failure is logged, not thrown',
  );
});

test('a hung server bounds the POST backlog: excess flushes are dropped, never queued', async () => {
  const logs = [];
  const calls = [];
  const resolvers = [];
  let released = false;
  const hungFetch = (url, init) => {
    calls.push(JSON.parse(init.body));
    if (released) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    return new Promise((resolve) =>
      resolvers.push(() => resolve({ ok: true, json: async () => ({ ok: true }) })),
    );
  };
  const fwd = createLineForwarder({
    url: 'http://server',
    token: 'tok',
    machine: 'M',
    fetchImpl: hungFetch,
    flushMs: 60_000,
    maxLines: 1, // every push flushes immediately
    maxPendingPosts: 3,
    log: (m) => logs.push(m),
  });

  for (let i = 0; i < 10; i++) fwd.push('sess-1', [`line-${i}`]);

  const drops = () => logs.filter((m) => m.includes('line backlog full')).length;
  assert.equal(drops(), 7, '3 queued at the cap, the other 7 dropped');

  released = true;
  for (let i = 0; i < 10 && resolvers.length > 0; i++) {
    resolvers.shift()();
    await sleep(5);
  }
  await fwd.stop();
  assert.equal(calls.length, 3, 'exactly maxPendingPosts POSTs ever reached fetch');
  assert.deepEqual(
    calls.map((c) => c.lines[0]),
    ['line-0', 'line-1', 'line-2'],
  );
});

test('a 2xx {ok:false} response invokes onDenied and the forwarder stops sending for that session', async () => {
  const denied = [];
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.sessionId === 'sess-denied') {
      return { ok: true, json: async () => ({ ok: false, reason: 'unknown-session' }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const fwd = createLineForwarder({
    url: 'http://server',
    token: 'tok',
    machine: 'M',
    fetchImpl: impl,
    flushMs: 60_000,
    maxLines: 1,
    onDenied: (sessionId, reason) => denied.push({ sessionId, reason }),
  });

  fwd.push('sess-denied', ['line-1']);
  await sleep(20);
  assert.deepEqual(denied, [{ sessionId: 'sess-denied', reason: 'unknown-session' }]);

  // drop() (called by the daemon's onDenied handler) clears buffered state —
  // a subsequent push for the same session starts a fresh buffer.
  fwd.drop('sess-denied');
  fwd.push('sess-denied', ['line-2']);
  await sleep(20);
  assert.equal(
    calls.length,
    2,
    'the forwarder itself keeps working; the daemon decides not to push again',
  );

  await fwd.stop();
});

test('an ok:true (or non-JSON) 2xx response never calls onDenied', async () => {
  const denied = [];
  const { impl } = fakeFetch({ ok: true });
  const fwd = createLineForwarder({
    url: 'http://server',
    token: 'tok',
    machine: 'M',
    fetchImpl: impl,
    flushMs: 60_000,
    maxLines: 1,
    onDenied: (sessionId, reason) => denied.push({ sessionId, reason }),
  });
  fwd.push('sess-1', ['fine']);
  await sleep(20);
  assert.deepEqual(denied, []);
  await fwd.stop();
});
