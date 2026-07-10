/**
 * Unit tests for the coalescing output forwarder (KICKOFF-v2.0 Phase 2
 * slice 2.5). All network I/O goes through an injected fetch fake — no real
 * server, no real timers beyond short test-scoped flush windows.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { createOutputForwarder } from '../lib/output-forwarder.mjs';

function fakeFetch() {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true };
  };
  return { calls, impl };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('coalesces pushes below the byte threshold into one timed flush', async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createOutputForwarder({
    url: 'http://server',
    token: 'tok',
    id: 'd-1',
    fetchImpl: impl,
    flushMs: 30,
  });

  fwd.push('stdout', 'hello ');
  fwd.push('stdout', Buffer.from('world\n'));
  assert.equal(calls.length, 0, 'nothing posts before the timer fires');

  await sleep(80);
  assert.equal(calls.length, 1, 'one coalesced POST');
  assert.equal(calls[0].url, 'http://server/api/dispatch/d-1/output');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
  assert.deepEqual(calls[0].body, { stream: 'stdout', chunk: 'hello world\n', seq: 0 });
});

test('flushes immediately when a stream reaches the byte threshold', async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createOutputForwarder({
    url: 'http://server',
    token: 'tok',
    id: 'd-2',
    fetchImpl: impl,
    flushMs: 60_000, // the timer can never be the trigger here
    maxBytes: 64,
  });

  fwd.push('stdout', 'x'.repeat(100));
  await sleep(20); // let the chained POST settle
  assert.equal(calls.length, 1, 'threshold flush without waiting for the timer');
  assert.equal(calls[0].body.chunk, 'x'.repeat(100));
  await fwd.stop();
});

test('buffers stdout and stderr separately with independent seqs', async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createOutputForwarder({
    url: 'http://server',
    token: 'tok',
    id: 'd-3',
    fetchImpl: impl,
    flushMs: 60_000,
  });

  fwd.push('stdout', 'out-a');
  fwd.push('stderr', 'err-a');
  await fwd.stop(); // final flush of both streams
  fwd.push('stdout', 'after-stop'); // must be a no-op

  assert.equal(calls.length, 2);
  const byStream = Object.fromEntries(calls.map((c) => [c.body.stream, c.body]));
  assert.deepEqual(byStream.stdout, { stream: 'stdout', chunk: 'out-a', seq: 0 });
  assert.deepEqual(byStream.stderr, { stream: 'stderr', chunk: 'err-a', seq: 0 });
});

test('seq increments per stream across successive flushes', async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createOutputForwarder({
    url: 'http://server',
    token: 'tok',
    id: 'd-4',
    fetchImpl: impl,
    flushMs: 60_000,
    maxBytes: 8,
  });

  fwd.push('stdout', 'chunk-one'); // ≥8 bytes → flush (seq 0)
  fwd.push('stdout', 'chunk-two'); // ≥8 bytes → flush (seq 1)
  await fwd.stop();

  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.body.seq),
    [0, 1],
  );
  assert.deepEqual(
    calls.map((c) => c.body.chunk),
    ['chunk-one', 'chunk-two'],
  );
});

test('stop() performs the final flush and halts the loop', async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createOutputForwarder({
    url: 'http://server',
    token: 'tok',
    id: 'd-5',
    fetchImpl: impl,
    flushMs: 60_000, // timer would never fire inside the test
  });

  fwd.push('stderr', 'last words');
  await fwd.stop();
  assert.equal(calls.length, 1, 'stop() flushed the buffered chunk');
  assert.deepEqual(calls[0].body, { stream: 'stderr', chunk: 'last words', seq: 0 });

  await fwd.stop(); // idempotent
  assert.equal(calls.length, 1);
});

test('a dead server never throws or blocks: pushes and stop survive rejecting fetch', async () => {
  const logs = [];
  let attempts = 0;
  const failingFetch = async () => {
    attempts++;
    throw new Error('ECONNREFUSED 127.0.0.1:3141');
  };
  const fwd = createOutputForwarder({
    url: 'http://server',
    token: 'tok',
    id: 'd-6',
    fetchImpl: failingFetch,
    flushMs: 10,
    log: (m) => logs.push(m),
  });

  fwd.push('stdout', 'doomed-1');
  await sleep(50);
  fwd.push('stdout', 'doomed-2');
  await assert.doesNotReject(() => fwd.stop());

  assert.equal(attempts, 2, 'both flushes were attempted');
  assert.ok(
    logs.some((m) => m.includes('output POST failed')),
    'failure is logged, not thrown',
  );
});

test('empty pushes are ignored (no empty POST bodies)', async () => {
  const { calls, impl } = fakeFetch();
  const fwd = createOutputForwarder({
    url: 'http://server',
    token: 'tok',
    id: 'd-7',
    fetchImpl: impl,
    flushMs: 10,
  });
  fwd.push('stdout', '');
  fwd.push('stdout', Buffer.alloc(0));
  await sleep(40);
  await fwd.stop();
  assert.equal(calls.length, 0);
});
