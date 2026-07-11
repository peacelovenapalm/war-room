#!/usr/bin/env node

/**
 * War Room remote transcript tailer (T1 remote live-tail plane, S3 —
 * .planning/v2/REMOTE-TAILER-DESIGN.md). One instance per machine, opt-in
 * (no tailer installed = no streaming, honestly absent — same posture as
 * the needs-input poller and dispatch runner).
 *
 * Every tick:
 *   1. POST /api/tailer/poll { active: [sessionIds currently tailed] }
 *      (Bearer + X-Machine) — drains this machine's queued
 *      TailInstruction[] AND carries any reconciliation re-issues (a
 *      restarted tailer's empty `active` self-heals via the server's
 *      advertisement-mismatch logic; see remoteTailDemand.ts).
 *   2. Process each instruction:
 *      - tail-on: validate transcriptPath against the LOCAL roots
 *        allowlist (bin/lib/tailer-roots.mjs) BEFORE ever opening it — the
 *        server cannot make this tailer read an arbitrary file, mirroring
 *        "the server cannot override the runner's allowlist" (dispatch
 *        runner's own posture). Idempotent for an already-active session.
 *        fromStart:true starts at offset 0; otherwise at EOF (only new
 *        output streams). A missing file keeps the tail active (a session
 *        may not have written yet) and is retried every pass.
 *      - tail-off: final per-session flush, then drop the tail.
 *   3. One read pass over every active tail: offset-tracked incremental
 *      read (64KB cap per pass per file — server/src/fileWatcher.ts's
 *      readNewLines discipline, reimplemented dependency-free here; bin/
 *      never imports server code), line-buffered across partial reads.
 *      Each complete line is filtered (fast '"type":"assistant"' substring
 *      pre-check, then a real JSON.parse confirm) — only assistant records
 *      cross the wire. An oversized line (over the server's per-line cap)
 *      is skipped locally with a ⚠ log (honest bounded loss), never sent.
 *
 * Forwarding rides bin/lib/line-forwarder.mjs (coalesce + sequential POST
 * chain to POST /api/agents/output). A 2xx {ok:false} response is treated
 * as tail-off for that session (the design doc's wire contract) — the
 * tailer drops its local state, it never retries against a session the
 * server has already denied.
 *
 * Failure policy: a malformed poll response or an unreachable server SKIPS
 * that tick's instruction processing with a ⚠ log; the read pass and
 * forwarder loop are otherwise unaffected. The tailer never crashes on bad
 * data (same posture as every other daemon in bin/).
 *
 * Restart posture: all tail state (offsets, active sessions) is IN-MEMORY
 * ONLY. A restart drops every tail; the next poll's empty `active`
 * advertisement drives the server's reconciliation to re-issue tail-on for
 * every still-demanded session — the designed recovery path, not a bug.
 *
 * Zero dependencies: node:fs + node:path + node:os + global fetch (node >= 18).
 *
 * Config (env, overridable by flags):
 *   WAR_ROOM_URL              server base URL   (default http://127.0.0.1:3141)
 *   WAR_ROOM_TOKEN             bearer token      (REQUIRED)
 *   WAR_ROOM_MACHINE            machine TEXT label (default: short hostname, uppercased)
 *   WAR_ROOM_TAILER_POLL_MS    poll interval ms  (default 5000, min 2000)
 *   WAR_ROOM_TAILER_ROOTS       extra allowlisted transcript roots, path.delimiter-
 *                              separated — ADDITIVE to the default
 *                              ~/.claude/projects/ (see bin/lib/tailer-roots.mjs)
 * Flags: --url <u> --machine <m> --interval <ms> --once --help
 */

import * as fs from 'node:fs';
import * as os from 'node:os';

import { createLineForwarder } from './lib/line-forwarder.mjs';
import { defaultTailerRoot, isPathAllowed, parseTailerRoots } from './lib/tailer-roots.mjs';

const MIN_INTERVAL_MS = 2_000;
const POST_TIMEOUT_MS = 10_000;
/** Single-pass read cap per active tail — server/src/fileWatcher.ts's
 *  readNewLines discipline (same 64KB rationale: bound one pass's blocking
 *  read on a massive JSONL dump; the remainder is picked up next tick). */
const MAX_READ_BYTES_PER_PASS = 65_536;
/** Mirrors server/src/constants.ts MAX_AGENT_OUTPUT_LINE_BYTES (S3's
 *  256KB bump) — kept as a literal here rather than an import: bin/ is
 *  zero-dependency and never imports server code. A line over this is
 *  skipped locally (honest bounded loss) rather than sent to be 400'd. */
const MAX_LINE_BYTES = 262_144;

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

export function parseArgs(argv) {
  const cfg = {
    url: process.env.WAR_ROOM_URL || 'http://127.0.0.1:3141',
    token: process.env.WAR_ROOM_TOKEN || '',
    machine: machineLabelDefault(),
    intervalMs: Number(process.env.WAR_ROOM_TAILER_POLL_MS) || 5_000,
    roots: parseTailerRoots(process.env.WAR_ROOM_TAILER_ROOTS),
    once: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && argv[i + 1]) cfg.url = argv[++i];
    else if (a === '--machine' && argv[i + 1]) cfg.machine = argv[++i];
    else if (a === '--interval' && argv[i + 1]) cfg.intervalMs = Number(argv[++i]);
    else if (a === '--once') cfg.once = true;
    else if (a === '--help') {
      console.log(
        'Usage: transcript-tailer.mjs [--url <base>] [--machine <label>] ' +
          '[--interval <ms>] [--once]\n' +
          'Requires WAR_ROOM_TOKEN in the environment (never passed as a flag).\n' +
          `Default allowlisted root: ${defaultTailerRoot()} ` +
          '(extend via WAR_ROOM_TAILER_ROOTS, path.delimiter-separated).',
      );
      process.exit(0);
    }
  }
  if (!Number.isFinite(cfg.intervalMs) || cfg.intervalMs < MIN_INTERVAL_MS) {
    cfg.intervalMs = 5_000;
  }
  cfg.url = cfg.url.replace(/\/+$/, '');
  return cfg;
}

// ── Read discipline (server/src/fileWatcher.ts readNewLines,
//    reimplemented dependency-free — bin/ never imports server code) ────

/**
 * One incremental read pass over a single tail. Never throws — a read
 * error other than ENOENT is logged and treated as "nothing new this
 * pass" so one bad file can't wedge the daemon.
 *
 * @param {{ path: string, offset: number, lineBuffer: string }} tail
 * @param {typeof import('node:fs')} fsImpl
 * @param {(msg: string) => void} log
 * @returns {{ lines: string[], missing: boolean }}
 */
export function readNewAssistantLines(tail, fsImpl, log) {
  let stat;
  try {
    stat = fsImpl.statSync(tail.path);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { lines: [], missing: true };
    log(`⚠ read error for ${tail.path}: ${shortErr(err)}`);
    return { lines: [], missing: false };
  }
  // A shrunk file (rotated/truncated out from under us) can't be resumed
  // from the old offset — restart from 0 rather than reading garbage or
  // skipping content forever.
  if (stat.size < tail.offset) {
    tail.offset = 0;
    tail.lineBuffer = '';
  }
  if (stat.size <= tail.offset) return { lines: [], missing: false };

  const bytesToRead = Math.min(stat.size - tail.offset, MAX_READ_BYTES_PER_PASS);
  const buf = Buffer.alloc(bytesToRead);
  let fd;
  try {
    fd = fsImpl.openSync(tail.path, 'r');
    fsImpl.readSync(fd, buf, 0, buf.length, tail.offset);
  } catch (err) {
    log(`⚠ read error for ${tail.path}: ${shortErr(err)}`);
    return { lines: [], missing: false };
  } finally {
    if (fd !== undefined) {
      try {
        fsImpl.closeSync(fd);
      } catch {
        /* already closed or never opened successfully */
      }
    }
  }
  tail.offset += bytesToRead;

  const text = tail.lineBuffer + buf.toString('utf8');
  const parts = text.split('\n');
  tail.lineBuffer = parts.pop() || '';

  const assistantLines = [];
  for (const line of parts) {
    if (!line.trim()) continue;
    // Fast pre-check before the real parse — the bulk of a transcript
    // (tool results, progress records, file-history snapshots) never
    // reaches JSON.parse.
    if (!line.includes('"type":"assistant"')) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      log(`⚠ skipped an oversized assistant line for ${tail.path} (>${MAX_LINE_BYTES} bytes)`);
      continue;
    }
    try {
      const record = JSON.parse(line);
      if (record && typeof record === 'object' && record.type === 'assistant') {
        assistantLines.push(line);
      }
    } catch {
      // Malformed JSON on an otherwise-matching line: skip, never crash.
    }
  }
  return { lines: assistantLines, missing: false };
}

// ── Instruction processing ─────────────────────────────────────

/**
 * @param {Map<string, { path: string, offset: number, lineBuffer: string, missingLogged: boolean }>} tails
 * @param {ReturnType<typeof createLineForwarder>} forwarder
 * @param {string[]} roots
 * @param {typeof import('node:fs')} fsImpl
 * @param {(msg: string) => void} log
 */
export function processInstruction(instr, tails, forwarder, roots, fsImpl, log) {
  if (!instr || typeof instr.sessionId !== 'string' || instr.sessionId === '') return;

  if (instr.kind === 'tail-on') {
    if (tails.has(instr.sessionId)) return; // idempotent — already tailing
    if (typeof instr.transcriptPath !== 'string' || instr.transcriptPath === '') {
      log(`⚠ tail-on refused for ${instr.sessionId} — no transcriptPath`);
      return;
    }
    if (!isPathAllowed(instr.transcriptPath, roots, fsImpl)) {
      log(`⚠ tail-on refused — path outside allowlisted roots: ${instr.transcriptPath}`);
      return;
    }
    let offset = 0;
    if (instr.fromStart !== true) {
      try {
        offset = fsImpl.statSync(instr.transcriptPath).size;
      } catch {
        // Not written yet — offset 0 is correct either way once it appears.
        offset = 0;
      }
    }
    tails.set(instr.sessionId, {
      path: instr.transcriptPath,
      offset,
      lineBuffer: '',
      missingLogged: false,
    });
    log(
      `✓ tail-on ${instr.sessionId} (fromStart=${instr.fromStart === true}, path=${instr.transcriptPath})`,
    );
    return;
  }

  if (instr.kind === 'tail-off') {
    if (!tails.has(instr.sessionId)) return;
    tails.delete(instr.sessionId);
    void forwarder.flush(instr.sessionId);
    log(`✓ tail-off ${instr.sessionId}`);
  }
}

// ── Tick ────────────────────────────────────────────────────────

/** One poll + instruction-processing step. Never throws. */
export async function pollTick(cfg, tails, forwarder, deps) {
  const active = [...tails.keys()];
  let res;
  try {
    res = await deps.fetchImpl(`${cfg.url}/api/tailer/poll`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.token}`,
        'x-machine': cfg.machine,
      },
      body: JSON.stringify({ active }),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
  } catch (err) {
    deps.log(`⚠ skip tick — poll POST failed: ${shortErr(err)}`);
    return;
  }
  if (!res.ok) {
    deps.log(`⚠ skip tick — server responded ${res.status}`);
    return;
  }
  let body;
  try {
    body = await res.json();
  } catch (err) {
    deps.log(`⚠ skip tick — malformed poll response: ${shortErr(err)}`);
    return;
  }
  const instructions = Array.isArray(body?.tail) ? body.tail : [];
  for (const instr of instructions) {
    processInstruction(instr, tails, forwarder, cfg.roots, deps.fsImpl, deps.log);
  }
}

/** One read pass over every active tail. Never throws. */
export function readPass(tails, forwarder, deps) {
  for (const [sessionId, tail] of tails) {
    const { lines, missing } = readNewAssistantLines(tail, deps.fsImpl, deps.log);
    if (missing) {
      if (!tail.missingLogged) {
        deps.log(`⚠ transcript not found yet for session ${sessionId} — will retry`);
        tail.missingLogged = true;
      }
      continue;
    }
    if (lines.length > 0) forwarder.push(sessionId, lines);
  }
}

// ── Main loop ───────────────────────────────────────────────────

function shortErr(err) {
  const m = err instanceof Error ? err.message : String(err);
  return m.split('\n')[0].slice(0, 200);
}

function defaultLog(msg) {
  console.log(`[transcript-tailer] ${new Date().toISOString()} ${msg}`);
}

/** Exported for tests — runs the tick/read-pass loop with injectable deps
 *  (fetchImpl, fsImpl, log) instead of the real network/filesystem/console. */
export async function runTailer(cfg, deps = {}) {
  const resolvedDeps = {
    fetchImpl: deps.fetchImpl ?? fetch,
    fsImpl: deps.fsImpl ?? fs,
    log: deps.log ?? defaultLog,
  };
  const tails = new Map();
  const forwarder = createLineForwarder({
    url: cfg.url,
    token: cfg.token,
    machine: cfg.machine,
    fetchImpl: resolvedDeps.fetchImpl,
    log: resolvedDeps.log,
    // The design doc's wire contract: a 2xx {ok:false} means the server no
    // longer wants this session — drop local state, never re-forward to a
    // session that has already denied us.
    onDenied: (sessionId, reason) => {
      if (tails.delete(sessionId)) {
        resolvedDeps.log(`⚠ ${sessionId} denied by server (${reason}) — dropped local tail`);
      }
      forwarder.drop(sessionId);
    },
  });

  // Belt & braces: a tailer must never die on an unexpected async error.
  const onUnhandled = (err) => resolvedDeps.log(`⚠ unhandled rejection: ${shortErr(err)}`);
  const onUncaught = (err) => resolvedDeps.log(`⚠ uncaught exception: ${shortErr(err)}`);
  process.on('unhandledRejection', onUnhandled);
  process.on('uncaughtException', onUncaught);

  try {
    for (;;) {
      await pollTick(cfg, tails, forwarder, resolvedDeps);
      readPass(tails, forwarder, resolvedDeps);
      if (cfg.once) {
        await forwarder.stop();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, cfg.intervalMs));
    }
  } finally {
    process.off('unhandledRejection', onUnhandled);
    process.off('uncaughtException', onUncaught);
  }
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (!cfg.token) {
    console.error('[transcript-tailer] ✗ WAR_ROOM_TOKEN is not set — refusing to start.');
    process.exit(1);
  }
  defaultLog(
    `starting — machine=${cfg.machine} url=${cfg.url} interval=${cfg.intervalMs}ms ` +
      `roots=${cfg.roots.join(',')}`,
  );
  await runTailer(cfg);
}

// Only run when invoked directly (node bin/transcript-tailer.mjs), not
// when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
