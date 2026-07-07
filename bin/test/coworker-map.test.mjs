/**
 * Unit tests for the coworker event mapping (v1 mechanic #6a).
 *
 * Run with: node --test bin/test/coworker-map.test.mjs (npm run test:poller)
 *
 * Codex record shapes are taken from a real ~/.codex/sessions rollout capture
 * (codex-cli 0.142.5, 2026-07-07); Gemini shapes from a real
 * ~/.gemini/tmp/<project>/logs.json (gemini-cli 0.40.0).
 */

import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  diffGeminiLog,
  geminiActivityEvents,
  geminiIdleEvents,
  mapCodexLine,
  sessionIdFromRolloutName,
} from '../lib/coworker-map.mjs';

const SID = '019f3bd7-9fd9-7de0-b3f8-bed6f0967db2';

// ── Codex ───────────────────────────────────────────────────────

test('codex: session_meta captures identity, emits nothing', () => {
  const state = {};
  const events = mapCodexLine(
    {
      type: 'session_meta',
      payload: { session_id: SID, id: SID, cwd: '/Users/greg/code/AmericanMadeCompany' },
    },
    state,
  );
  assert.deepEqual(events, []);
  assert.equal(state.sessionId, SID);
  assert.equal(state.cwd, '/Users/greg/code/AmericanMadeCompany');
});

test('codex: task_started → PreToolUse(Codex); task_complete → PostToolUse + Stop', () => {
  const state = { sessionId: SID, cwd: '/x' };
  const start = mapCodexLine(
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 't-1' } },
    state,
  );
  assert.equal(start.length, 1);
  assert.equal(start[0].hook_event_name, 'PreToolUse');
  assert.equal(start[0].tool_name, 'Codex');
  assert.equal(start[0].session_id, SID);
  assert.equal(start[0].cwd, '/x');

  const done = mapCodexLine(
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 't-1' } },
    state,
  );
  assert.deepEqual(
    done.map((e) => e.hook_event_name),
    ['PostToolUse', 'Stop'],
  );
});

test('codex: shell function_call maps to Bash with the real command', () => {
  const state = { sessionId: SID };
  const events = mapCodexLine(
    {
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell',
        arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }),
      },
    },
    state,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].tool_name, 'Bash');
  assert.deepEqual(events[0].tool_input, { command: 'bash -lc npm test' });
});

test('codex: approval requests map to a permission_prompt Notification (NEEDS INPUT)', () => {
  const state = { sessionId: SID };
  for (const type of ['exec_approval_request', 'apply_patch_approval_request']) {
    const events = mapCodexLine({ type: 'event_msg', payload: { type } }, state);
    assert.equal(events.length, 1, type);
    assert.equal(events[0].hook_event_name, 'Notification');
    assert.equal(events[0].notification_type, 'permission_prompt');
  }
});

test('codex: lines before identity, unknown types, and garbage are skipped', () => {
  const state = {};
  assert.deepEqual(
    mapCodexLine({ type: 'event_msg', payload: { type: 'task_started' } }, state),
    [],
  );
  assert.deepEqual(
    mapCodexLine({ type: 'response_item', payload: { type: 'reasoning' } }, state),
    [],
  );
  assert.deepEqual(mapCodexLine(null, state), []);
  assert.deepEqual(mapCodexLine('garbage', state), []);
});

test('codex: rollout filename yields the session UUID fallback', () => {
  assert.equal(
    sessionIdFromRolloutName(
      'rollout-2026-07-07T02-10-14-019f3bd7-9fd9-7de0-b3f8-bed6f0967db2.jsonl',
    ),
    SID,
  );
  assert.equal(sessionIdFromRolloutName('not-a-rollout.txt'), undefined);
});

// ── Gemini ──────────────────────────────────────────────────────

const gLog = (sid, ids) => ids.map((messageId) => ({ sessionId: sid, messageId, type: 'user' }));

test('gemini: first scan indexes without reporting activity (no history replay)', () => {
  const { active, nextLastSeen } = diffGeminiLog({}, gLog('s1', [0, 1, 2]));
  assert.deepEqual(active, []);
  assert.deepEqual(nextLastSeen, { s1: 2 });
});

test('gemini: a new messageId marks the session active exactly once', () => {
  const first = diffGeminiLog({}, gLog('s1', [0]));
  const second = diffGeminiLog(first.nextLastSeen, gLog('s1', [0, 1]), true);
  assert.deepEqual(second.active, ['s1']);
  // unchanged log → no activity
  const third = diffGeminiLog(second.nextLastSeen, gLog('s1', [0, 1]), true);
  assert.deepEqual(third.active, []);
});

test('gemini: a brand-new session AFTER the seed scan is live activity (one-prompt sessions)', () => {
  const seedScan = diffGeminiLog({}, gLog('s1', [0]));
  // s2 appears later with its first-ever message — that IS activity
  const later = diffGeminiLog(
    seedScan.nextLastSeen,
    [...gLog('s1', [0]), ...gLog('s2', [0])],
    true,
  );
  assert.deepEqual(later.active, ['s2']);
});

test('gemini: malformed logs are tolerated', () => {
  assert.deepEqual(diffGeminiLog({}, 'nope').active, []);
  assert.deepEqual(diffGeminiLog({}, [null, {}, { sessionId: 5 }]).active, []);
});

test('gemini: activity/idle event shapes carry session + cwd', () => {
  const act = geminiActivityEvents('s1', '/proj');
  assert.equal(act[0].hook_event_name, 'PreToolUse');
  assert.equal(act[0].tool_name, 'Gemini');
  assert.equal(act[0].cwd, '/proj');
  const idle = geminiIdleEvents('s1', '/proj');
  assert.deepEqual(
    idle.map((e) => e.hook_event_name),
    ['PostToolUse', 'Stop'],
  );
  assert.ok(idle.every((e) => e.session_id === 's1'));
});
