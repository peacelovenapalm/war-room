/**
 * C9-4 (part 1): the dispatch runner's one-shot answer-nonce guard must stay
 * BOUNDED. It was an unbounded Set that grew for the whole process lifetime;
 * it is now a TTL-keyed Map pruned on every consume. These tests pin the
 * replay semantics AND the soak-bound: hundreds of consumptions over a moving
 * clock never grow the map past one TTL window's worth of entries.
 */

import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { consumeNonce } from '../dispatch-runner.mjs';

test('consumeNonce: first consume records, immediate replay is denied', () => {
  const consumed = new Map();
  assert.deepEqual(consumeNonce(consumed, 'n1', 1000), { replayed: false });
  assert.deepEqual(consumeNonce(consumed, 'n1', 1500), { replayed: true });
  assert.equal(consumed.size, 1);
});

test('consumeNonce: a nonce past the TTL is evicted and may be re-consumed', () => {
  const consumed = new Map();
  const ttl = 600_000;
  consumeNonce(consumed, 'n1', 0, ttl);
  // Still within the window → replay denied, still present.
  assert.deepEqual(consumeNonce(consumed, 'n1', ttl, ttl), { replayed: true });
  // Past the window → the entry is pruned, so it consumes fresh (not a replay).
  assert.deepEqual(consumeNonce(consumed, 'n1', ttl + 1, ttl), { replayed: false });
});

test('consumeNonce: soak — 1000 distinct nonces over a moving clock stay bounded', () => {
  const consumed = new Map();
  const ttl = 600_000;
  // One unique nonce every 1s for 1000 ticks (spanning ~16.7 min, well past
  // the 10-min TTL). A naive unbounded Set would hold all 1000; the TTL map
  // holds only those consumed within the last ttl window.
  for (let i = 0; i < 1000; i++) {
    const now = i * 1000;
    const res = consumeNonce(consumed, `nonce-${i}`, now, ttl);
    assert.equal(res.replayed, false, `distinct nonce ${i} must not read as a replay`);
    // The map can never exceed the count that fits inside one TTL window.
    assert.ok(
      consumed.size <= ttl / 1000 + 1,
      `map size ${consumed.size} exceeded the TTL-window bound at tick ${i}`,
    );
  }
  // After all ticks it is bounded, NOT linear in the 1000 total consumed.
  assert.ok(consumed.size <= ttl / 1000 + 1);
  assert.ok(consumed.size < 1000);
});
