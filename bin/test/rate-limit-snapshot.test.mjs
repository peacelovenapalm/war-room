/**
 * Unit tests for the rate-limit snapshot parser (v2 mechanic G3,
 * GAME-DESIGN.md §7.4). Covers: the real field names verified against
 * ~/.claude/statusline.js's own parse sites (five_hour/seven_day, each
 * {used_percentage, resets_at}), honest absence (no rate_limits yet),
 * malformed-payload tolerance, and the snapshot-file reader's
 * absent-vs-corrupt distinction.
 *
 * Run with: node --test bin/test/   (npm run test:poller)
 */

import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseRateLimitSnapshot, readSnapshotFile } from '../lib/rate-limit-snapshot.mjs';

// ── parseRateLimitSnapshot ──────────────────────────────────────

test('parses a real-shaped statusline stdin payload (both windows)', () => {
  const stdin = JSON.stringify({
    cost: { total_duration_ms: 1000 },
    rate_limits: {
      five_hour: { used_percentage: 42, resets_at: 1_800_000_000 },
      seven_day: { used_percentage: 17, resets_at: 1_800_500_000 },
    },
  });
  const result = parseRateLimitSnapshot(stdin);
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot, {
    five_hour: { used_percentage: 42, resets_at: 1_800_000_000 },
    seven_day: { used_percentage: 17, resets_at: 1_800_500_000 },
  });
});

test('accepts an already-parsed object (not just a string)', () => {
  const result = parseRateLimitSnapshot({
    rate_limits: { five_hour: { used_percentage: 5 } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.five_hour.used_percentage, 5);
});

test('a window missing used_percentage is dropped, not fabricated as 0', () => {
  const result = parseRateLimitSnapshot({
    rate_limits: { five_hour: { resets_at: 123 }, seven_day: { used_percentage: 9 } },
  });
  assert.equal(result.ok, true);
  assert.equal('five_hour' in result.snapshot, false);
  assert.equal(result.snapshot.seven_day.used_percentage, 9);
});

test('resets_at is omitted (not fabricated) when the CLI does not send it', () => {
  const result = parseRateLimitSnapshot({
    rate_limits: { five_hour: { used_percentage: 10 } },
  });
  assert.equal(result.ok, true);
  assert.equal('resets_at' in result.snapshot.five_hour, false);
});

test('honest absence: no rate_limits field yet is ok:true, snapshot:null (not an error)', () => {
  const result = parseRateLimitSnapshot({ cost: { total_duration_ms: 1 } });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot, null);
});

test('malformed stdin (not JSON) fails cleanly', () => {
  const result = parseRateLimitSnapshot('not json{{{');
  assert.equal(result.ok, false);
});

test('empty stdin fails cleanly', () => {
  assert.equal(parseRateLimitSnapshot('').ok, false);
});

test('rate_limits present but not an object fails cleanly', () => {
  assert.equal(parseRateLimitSnapshot({ rate_limits: 'nope' }).ok, false);
});

// ── readSnapshotFile ─────────────────────────────────────────────

test('readSnapshotFile: absent file is a distinct, non-error reason', () => {
  const fakeFs = {
    readFileSync: () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    },
  };
  const result = readSnapshotFile('/nonexistent', fakeFs);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'absent');
});

test('readSnapshotFile: corrupt JSON is a distinct reason from absence', () => {
  const fakeFs = { readFileSync: () => 'not json{{{' };
  const result = readSnapshotFile('/corrupt', fakeFs);
  assert.equal(result.ok, false);
  assert.notEqual(result.reason, 'absent');
});

test('readSnapshotFile: parses a real snapshot file', () => {
  const fakeFs = {
    readFileSync: () => JSON.stringify({ five_hour: { used_percentage: 55 } }),
  };
  const result = readSnapshotFile('/real', fakeFs);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.five_hour.used_percentage, 55);
});
