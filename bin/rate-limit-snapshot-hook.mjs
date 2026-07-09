#!/usr/bin/env node

/**
 * Rate-limit snapshot hook (v2 mechanic G3 — GAME-DESIGN.md §7.4, Option B
 * "decoupled" — the default until Greg rules on the open decision). A
 * standalone Claude Code statusline hook, separate from Greg's own
 * ~/.claude/statusline.js: it receives the SAME stdin payload every prompt
 * render, but writes ONLY ~/.pixel-agents/rate-limit-snapshot.json.
 * statusline.js is never edited, read, or otherwise touched by this file.
 *
 * ── RUNBOOK (Greg-owned config change — GATED, apply yourself) ──────────
 *
 * Register this script as an additional statusLine hook command in your
 * Claude Code settings (wherever ~/.claude/statusline.js is currently
 * wired — typically ~/.claude/settings.json's "statusLine" hook config).
 * Point it at this file's absolute path, e.g.:
 *
 *     node /Users/greg/code/war-room/bin/rate-limit-snapshot-hook.mjs
 *
 * It reads the identical stdin JSON your existing statusline.js hook
 * already receives on every render and writes only the budget snapshot
 * file below. This is a config-only change (adding a second hook command
 * alongside the existing one) — no edit to statusline.js itself.
 *
 * Until this hook is registered, bin/needs-input-poller.mjs finds no
 * snapshot file to forward, and the game's budget guardrail correctly
 * fail-safe-pauses every automation trigger (see budgetStore.ts) — by
 * design, never a crash, never a silent automation green-light.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parseRateLimitSnapshot } from './lib/rate-limit-snapshot.mjs';

const SNAPSHOT_DIR = path.join(os.homedir(), '.pixel-agents');
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, 'rate-limit-snapshot.json');
const STDIN_TIMEOUT_MS = 3_000;

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      // Run manually with no piped input — nothing to read, resolve now
      // rather than hanging until the timeout.
      resolve('');
      return;
    }
    let input = '';
    const timeout = setTimeout(() => resolve(input), STDIN_TIMEOUT_MS);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      resolve(input);
    });
  });
}

function writeSnapshot(snapshot) {
  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const tmpPath = `${SNAPSHOT_FILE}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(snapshot));
    fs.renameSync(tmpPath, SNAPSHOT_FILE);
  } catch {
    /* snapshot-write failure must never crash the statusline render */
  }
}

async function main() {
  const input = await readStdin();
  const result = parseRateLimitSnapshot(input);
  // Never exit nonzero — a hook that fails the statusline render over a
  // malformed/missing payload would break Greg's prompt. This is a
  // best-effort side channel, not a required part of the render.
  if (result.ok && result.snapshot !== null) {
    writeSnapshot(result.snapshot);
  }
  process.exit(0);
}

main();
