/**
 * Unit tests for the `claude agents --json` normalizer (M4).
 *
 * Run with: node --test bin/test/   (npm run test:poller)
 *
 * Fixtures:
 *   - real-v2.1.202.json      — captured live from `claude agents --json` on
 *                               Claude Code 2.1.202 (research preview): blocked
 *                               + working background agents AND interactive
 *                               entries that carry NO `state` field at all.
 *   - documented-surface.json — the surface as documented (all 5 states,
 *                               waitingFor present).
 *   - malformed-cases.json    — per-entry garbage that must be skipped.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeAgents, VALID_STATES, WAITING_FOR_MAX_CHARS } from '../lib/normalize-agents.mjs';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const readFixture = (name) => fs.readFileSync(path.join(fixturesDir, name), 'utf8');

// ── Documented surface ──────────────────────────────────────────

test('documented surface: all five states normalize with full fields', () => {
  const result = normalizeAgents(readFixture('documented-surface.json'));
  assert.equal(result.ok, true);
  assert.equal(result.agents.length, 5);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.agents.map((a) => a.state).sort(), [...VALID_STATES].sort());
  const blocked = result.agents[0];
  assert.equal(blocked.id, 'aaaa1111');
  assert.equal(blocked.waitingFor, 'Permission: Bash(rm -rf node_modules)');
  assert.equal(blocked.cwd, '/Users/dev/projects/alpha');
  assert.equal(blocked.pid, 4242);
  assert.equal(blocked.startedAt, 1780900000000);
  // string startedAt passes through untouched
  assert.equal(result.agents[1].startedAt, '2026-07-06T12:00:00Z');
});

// ── Real 2.1.202 capture ────────────────────────────────────────

test('real 2.1.202 output: stated agents kept, stateless interactive entries skipped', () => {
  const result = normalizeAgents(readFixture('real-v2.1.202.json'));
  assert.equal(result.ok, true);
  // Fixture: 2 blocked + 1 working (background) + 2 interactive without state
  assert.equal(result.agents.length, 3);
  assert.equal(result.skipped, 2);
  assert.equal(result.agents.filter((a) => a.state === 'blocked').length, 2);
  // sessionId passthrough (server matches on it first)
  assert.equal(result.agents[0].sessionId, '824af38a-f0ed-43ee-afb4-568e9b97c5ee');
  // unknown fields (kind, name, status) are dropped
  for (const a of result.agents) {
    assert.equal('kind' in a, false);
    assert.equal('name' in a, false);
    assert.equal('status' in a, false);
  }
});

// ── Malformed / missing-field entries ───────────────────────────

test('malformed entries are skipped one by one, never fatal', () => {
  const { entries } = JSON.parse(readFixture('malformed-cases.json'));
  const result = normalizeAgents(JSON.stringify(entries));
  assert.equal(result.ok, true);
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].id, 'valid-sentinel');
  assert.equal(result.skipped, entries.length - 1);
});

test('malformed whole payloads return ok:false (tick skipped, no throw)', () => {
  for (const raw of [
    'not json at all',
    '',
    '   ',
    '{"broken": ',
    'null',
    '42',
    '"a string"',
    '{"agents": "not-an-array"}',
    '{"sessions": []}',
  ]) {
    const result = normalizeAgents(raw);
    assert.equal(result.ok, false, `expected ok:false for ${JSON.stringify(raw)}`);
    assert.equal(typeof result.reason, 'string');
  }
});

test('empty agent list is valid (POST still clears stale server state)', () => {
  const result = normalizeAgents('[]');
  assert.equal(result.ok, true);
  assert.equal(result.agents.length, 0);
  assert.equal(result.skipped, 0);
});

// ── Shape-churn tolerance ───────────────────────────────────────

test('accepts { agents: [...] } wrapper shape', () => {
  const result = normalizeAgents('{"agents": [{"id": "x1", "state": "blocked"}]}');
  assert.equal(result.ok, true);
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].state, 'blocked');
});

test('accepts already-parsed input (not just strings)', () => {
  const result = normalizeAgents([{ id: 'y1', state: 'stopped' }]);
  assert.equal(result.ok, true);
  assert.equal(result.agents[0].id, 'y1');
});

test('id falls back to sessionId; numeric ids are stringified', () => {
  const result = normalizeAgents(
    JSON.stringify([
      { sessionId: 'sess-only-uuid', state: 'blocked' },
      { id: 12345, state: 'working' },
    ]),
  );
  assert.equal(result.ok, true);
  assert.equal(result.agents[0].id, 'sess-only-uuid');
  assert.equal(result.agents[1].id, '12345');
});

test('field hygiene: bad pid/startedAt/waitingFor are dropped, not fatal', () => {
  const result = normalizeAgents(
    JSON.stringify([
      {
        id: 'h1',
        state: 'blocked',
        pid: -5,
        startedAt: NaN,
        waitingFor: '   ',
        cwd: 17,
        extraUnknownField: { nested: true },
      },
    ]),
  );
  assert.equal(result.ok, true);
  const a = result.agents[0];
  assert.deepEqual(a, { id: 'h1', state: 'blocked' });
});

test('waitingFor is trimmed and capped', () => {
  const result = normalizeAgents(
    JSON.stringify([{ id: 'w1', state: 'blocked', waitingFor: `  ${'x'.repeat(500)}  ` }]),
  );
  assert.equal(result.agents[0].waitingFor.length, WAITING_FOR_MAX_CHARS);
});
