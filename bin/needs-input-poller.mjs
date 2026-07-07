#!/usr/bin/env node

/**
 * War Room needs-input poller (M4) — one instance per machine.
 *
 * Every ~15s: run `claude agents --json`, normalize the output through the
 * tolerant normalizer (bin/lib/normalize-agents.mjs), and POST the normalized
 * agent list to the War Room server's authenticated poll ingest
 * (POST /api/agents/poll, Bearer token + X-Machine label). The server matches
 * entries to adopted agents and broadcasts `agentPollState`; `state:"blocked"`
 * renders as the loudest ⚠ NEEDS INPUT badge (SHAPE + TEXT — colorblind rule).
 *
 * Failure policy: a malformed CLI payload or an unreachable server SKIPS the
 * tick with a ⚠ log line. The poller never crashes on bad data.
 *
 * Zero dependencies: node:child_process + global fetch (node >= 18).
 *
 * Config (env, overridable by flags):
 *   WAR_ROOM_URL       server base URL   (default http://127.0.0.1:3141)
 *   WAR_ROOM_TOKEN     bearer token      (REQUIRED)
 *   WAR_ROOM_MACHINE   machine TEXT label (default: short hostname, uppercased)
 *   WAR_ROOM_POLL_MS   poll interval ms  (default 15000, min 2000)
 *   WAR_ROOM_AGENTS_CMD  command to run  (default "claude agents --json";
 *                        override for fixtures/tests, e.g. "cat fixture.json")
 * Flags: --url <u> --machine <m> --interval <ms> --cmd <c> --once --help
 */

import { exec } from 'node:child_process';
import * as os from 'node:os';
import { promisify } from 'node:util';

import { normalizeAgents } from './lib/normalize-agents.mjs';

const execAsync = promisify(exec);

const EXEC_TIMEOUT_MS = 20_000;
const POST_TIMEOUT_MS = 10_000;
const MIN_INTERVAL_MS = 2_000;

// ── Config ──────────────────────────────────────────────────────

function machineLabelDefault() {
  const raw = process.env.WAR_ROOM_MACHINE || os.hostname().split('.')[0] || 'LOCAL';
  return (
    raw
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '-')
      .slice(0, 32) || 'LOCAL'
  );
}

function parseArgs(argv) {
  const cfg = {
    url: process.env.WAR_ROOM_URL || 'http://127.0.0.1:3141',
    token: process.env.WAR_ROOM_TOKEN || '',
    machine: machineLabelDefault(),
    intervalMs: Number(process.env.WAR_ROOM_POLL_MS) || 15_000,
    cmd: process.env.WAR_ROOM_AGENTS_CMD || 'claude agents --json',
    once: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && argv[i + 1]) cfg.url = argv[++i];
    else if (a === '--machine' && argv[i + 1]) cfg.machine = argv[++i];
    else if (a === '--interval' && argv[i + 1]) cfg.intervalMs = Number(argv[++i]);
    else if (a === '--cmd' && argv[i + 1]) cfg.cmd = argv[++i];
    else if (a === '--once') cfg.once = true;
    else if (a === '--help') {
      console.log(
        'Usage: needs-input-poller.mjs [--url <base>] [--machine <label>] ' +
          '[--interval <ms>] [--cmd <command>] [--once]\n' +
          'Requires WAR_ROOM_TOKEN in the environment (never passed as a flag).',
      );
      process.exit(0);
    }
  }
  if (!Number.isFinite(cfg.intervalMs) || cfg.intervalMs < MIN_INTERVAL_MS) {
    cfg.intervalMs = 15_000;
  }
  cfg.url = cfg.url.replace(/\/+$/, '');
  return cfg;
}

// ── Tick ────────────────────────────────────────────────────────

/** One poll tick. Never throws — every failure path logs ⚠ and returns. */
async function tick(cfg) {
  // 1. Run the CLI (or fixture command)
  let stdout;
  try {
    ({ stdout } = await execAsync(cfg.cmd, {
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    }));
  } catch (err) {
    log(`⚠ skip tick — command failed: ${shortErr(err)}`);
    return;
  }

  // 2. Normalize (tolerant — malformed output skips the tick, never crashes)
  const result = normalizeAgents(stdout);
  if (!result.ok) {
    log(`⚠ skip tick — malformed agents output: ${result.reason}`);
    return;
  }

  // 3. POST to the server's authed poll ingest
  const blocked = result.agents.filter((a) => a.state === 'blocked').length;
  let res;
  try {
    res = await fetch(`${cfg.url}/api/agents/poll`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.token}`,
        'x-machine': cfg.machine,
      },
      body: JSON.stringify({ agents: result.agents }),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
  } catch (err) {
    log(`⚠ skip tick — POST failed: ${shortErr(err)}`);
    return;
  }
  if (!res.ok) {
    log(`⚠ skip tick — server responded ${res.status}`);
    return;
  }

  let summary = '';
  try {
    const body = await res.json();
    summary = ` → matched ${body.matched ?? '?'}, cleared ${body.cleared ?? '?'}`;
  } catch {
    /* non-JSON ack is fine */
  }
  log(
    `✓ tick — ${result.agents.length} agent(s), ${blocked} blocked, ${result.skipped} skipped${summary}`,
  );
}

// ── Main loop ───────────────────────────────────────────────────

function log(msg) {
  console.log(`[needs-input-poller] ${new Date().toISOString()} ${msg}`);
}

function shortErr(err) {
  const m = err instanceof Error ? err.message : String(err);
  return m.split('\n')[0].slice(0, 200);
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (!cfg.token) {
    console.error('[needs-input-poller] ✗ WAR_ROOM_TOKEN is not set — refusing to start.');
    process.exit(1);
  }
  log(
    `starting — machine=${cfg.machine} url=${cfg.url} interval=${cfg.intervalMs}ms cmd="${cfg.cmd}"`,
  );

  // Belt & braces: a poller must never die on an unexpected async error.
  process.on('unhandledRejection', (err) => log(`⚠ unhandled rejection: ${shortErr(err)}`));
  process.on('uncaughtException', (err) => log(`⚠ uncaught exception: ${shortErr(err)}`));

  // setTimeout chain (not setInterval) so slow ticks never overlap.
  for (;;) {
    await tick(cfg);
    if (cfg.once) return;
    await new Promise((resolve) => setTimeout(resolve, cfg.intervalMs));
  }
}

main();
