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
  assert.equal(start[0].tool_use_id, 'turn:t-1');
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

test('codex: shell function_call maps to exec with call_id correlation', () => {
  const state = { sessionId: SID };
  const events = mapCodexLine(
    {
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell',
        call_id: 'call-shell-1',
        arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }),
      },
    },
    state,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].tool_name, 'exec');
  assert.equal(events[0].tool_use_id, 'call-shell-1');
  assert.deepEqual(events[0].tool_input, { command: 'bash -lc npm test' });
});

test('codex: approval requests map to PermissionRequest (NEEDS INPUT)', () => {
  const state = { sessionId: SID };
  for (const type of ['exec_approval_request', 'apply_patch_approval_request']) {
    const events = mapCodexLine({ type: 'event_msg', payload: { type } }, state);
    assert.equal(events.length, 1, type);
    assert.equal(events[0].hook_event_name, 'PermissionRequest');
    assert.equal(events[0].tool_name, type === 'exec_approval_request' ? 'exec' : 'apply_patch');
  }
});

test('codex: custom_tool_call/output correlate start and end without output bodies', () => {
  const state = { sessionId: SID, cwd: '/x' };
  const start = mapCodexLine(
    {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'custom-1',
        input: 'SECRET COMMAND BODY',
      },
    },
    state,
  );
  assert.equal(start[0].hook_event_name, 'PreToolUse');
  assert.equal(start[0].tool_use_id, 'custom-1');

  const end = mapCodexLine(
    {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'custom-1',
        status: 'completed',
        output: 'SECRET TOOL OUTPUT',
      },
    },
    state,
  );
  assert.equal(end[0].hook_event_name, 'PostToolUse');
  assert.equal(end[0].tool_use_id, 'custom-1');
  assert.equal(JSON.stringify(end).includes('SECRET TOOL OUTPUT'), false);
});

test('codex: patch_apply_end emits safe correlated completion status', () => {
  const events = mapCodexLine(
    {
      type: 'event_msg',
      payload: {
        type: 'patch_apply_end',
        call_id: 'patch-1',
        status: 'failed',
        success: false,
        stdout: 'SECRET STDOUT',
        stderr: 'SECRET STDERR',
        changes: { '/secret/file': 'private diff' },
      },
    },
    { sessionId: SID },
  );
  assert.deepEqual(events, [
    {
      session_id: SID,
      cwd: undefined,
      hook_event_name: 'PostToolUse',
      tool_use_id: 'patch-1',
      tool_response: { success: false, status: 'failed' },
    },
  ]);
});

test('codex: mcp_tool_call_end emits a safe paired lifecycle with duration', () => {
  const events = mapCodexLine(
    {
      type: 'event_msg',
      payload: {
        type: 'mcp_tool_call_end',
        call_id: 'mcp-1',
        invocation: { server: 'github', tool: 'get_issue', arguments: { id: 'SECRET' } },
        result: 'SECRET RESULT',
        duration: 17,
      },
    },
    { sessionId: SID },
  );
  assert.deepEqual(
    events.map((event) => [event.hook_event_name, event.tool_use_id]),
    [
      ['PreToolUse', 'mcp-1'],
      ['PostToolUse', 'mcp-1'],
    ],
  );
  assert.equal(events[0].tool_name, 'mcp__github__get_issue');
  assert.equal(events[1].tool_response.duration, 17);
  assert.equal(JSON.stringify(events).includes('SECRET'), false);
});

test('codex: web_search_end emits paired lifecycle without the private query', () => {
  const events = mapCodexLine(
    {
      type: 'event_msg',
      payload: {
        type: 'web_search_end',
        call_id: 'web-1',
        action: 'search',
        query: 'SECRET SEARCH QUERY',
      },
    },
    { sessionId: SID },
  );
  assert.deepEqual(
    events.map((event) => event.hook_event_name),
    ['PreToolUse', 'PostToolUse'],
  );
  assert.equal(events[0].tool_name, 'web_search');
  assert.equal(JSON.stringify(events).includes('SECRET SEARCH QUERY'), false);
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
