/**
 * Integration test for the coworker adapter's Codex end-once lifecycle.
 *
 * Regression: an idle-but-fresh rollout (mtime between CODEX_IDLE_END_MS
 * and CODEX_FRESH_MS) was re-adopted and re-ended on EVERY tick — observed
 * in production 2026-07-13 as ~5 synthetic SessionEnd POSTs/sec against
 * /api/hooks/codex. The fix records the mtime a file was ended at and
 * skips re-adoption until the file grows past it.
 *
 * Run with: node --test bin/test/   (npm run test:poller)
 */

import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ADAPTER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'coworker-adapter.mjs',
);

const SESSION_ID = '11111111-2222-3333-4444-555555555555';

function startCaptureServer() {
  return new Promise((resolve) => {
    const captured = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          captured.push({ url: req.url, event: JSON.parse(body) });
        } catch {
          captured.push({ url: req.url, event: null });
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, captured, port: server.address().port }));
  });
}

function writeIdleRollout(dir) {
  // Mirror the real layout: sessions/YYYY/MM/DD/rollout-*.jsonl
  const day = path.join(dir, '2026', '07', '13');
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, `rollout-2026-07-13T10-00-00-${SESSION_ID}.jsonl`);
  const meta = {
    type: 'session_meta',
    payload: { session_id: SESSION_ID, cwd: '/tmp/proj' },
  };
  fs.writeFileSync(file, `${JSON.stringify(meta)}\n`);
  // Idle: older than CODEX_IDLE_END_MS (30 min) but inside CODEX_FRESH_MS (24 h).
  const idle = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(file, idle, idle);
  return file;
}

test('codex idle rollout emits synthetic SessionEnd exactly once across ticks', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-coworker-adapter-'));
  const codexDir = path.join(tmp, 'sessions');
  writeIdleRollout(codexDir);
  const { server, captured, port } = await startCaptureServer();

  const child = spawn(process.execPath, [ADAPTER, '--providers', 'codex'], {
    env: {
      ...process.env,
      WAR_ROOM_URL: `http://127.0.0.1:${port}`,
      WAR_ROOM_TOKEN: 'test-token',
      WAR_ROOM_MACHINE: 'TESTBOX',
      WAR_ROOM_COWORKER_MS: '1000', // MIN_INTERVAL_MS floor
      WAR_ROOM_CODEX_DIR: codexDir,
      WAR_ROOM_GEMINI_DIR: path.join(tmp, 'no-gemini'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    // 3 full ticks: the un-fixed adapter re-ends the idle file on each one.
    await new Promise((r) => setTimeout(r, 3500));
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
    server.close();
  }

  const ends = captured.filter(
    (c) =>
      c.url === '/api/hooks/codex' &&
      c.event?.hook_event_name === 'SessionEnd' &&
      c.event?.session_id === SESSION_ID,
  );
  assert.equal(
    ends.length,
    1,
    `expected exactly 1 synthetic SessionEnd, got ${ends.length} ` +
      `(end-once regression: idle rollout re-ended on every tick)`,
  );

  fs.rmSync(tmp, { recursive: true, force: true });
});
