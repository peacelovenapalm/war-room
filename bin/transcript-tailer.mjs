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
 *        may not have written yet) and is retried every pass. The
 *        allowlist is RE-CHECKED on every subsequent read pass too, not
 *        just at tail-on — a path reopened by name every pass could
 *        otherwise be swapped for a symlink pointing outside the roots
 *        between passes (TOCTOU); a pass that fails re-validation tears
 *        the tail down immediately (codex review).
 *      - tail-off: a BOUNDED final drain (reads until EOF or
 *        MAX_FINAL_DRAIN_PASSES) forwards bytes written since the last
 *        regular pass before the tail is removed — deleting first would
 *        silently drop a session's final output (codex review) — then
 *        forwarder.drop() flushes and frees that session's buffer state.
 *   3. One read pass over every active tail: offset-tracked incremental
 *      read (64KB cap per pass per file — server/src/fileWatcher.ts's
 *      readNewLines discipline, reimplemented dependency-free here; bin/
 *      never imports server code). Line-buffering carries UNDECODED BYTES
 *      (never a decoded string) across passes and splits on the 0x0A byte,
 *      so a multibyte UTF-8 character straddling a 64KB pass boundary is
 *      never corrupted by decoding a partial sequence (codex review). The
 *      byte carry itself is capped (MAX_CARRY_BYTES) — a newline-free
 *      growing file can't accumulate it without limit; past the cap it's
 *      dropped and the reader resyncs at the next real newline (bounded,
 *      honest loss). Each complete line is filtered (fast
 *      '"type":"assistant"' substring pre-check in byte space, then a real
 *      JSON.parse confirm) — only assistant records cross the wire. An
 *      oversized line (over the server's per-line cap) is skipped locally
 *      with a ⚠ log (honest bounded loss), never sent.
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
/** Cap on the unterminated-line BYTE carry (codex review: a newline-free
 *  growing file must not accumulate carry without limit). 2x the line cap
 *  — generous enough that a legitimate line right at MAX_LINE_BYTES never
 *  trips it, but a pathological file wins eventually. Exceeding it drops
 *  the carry and resyncs at the next real newline (bounded, honest loss —
 *  see readNewAssistantLines' `resync` handling). */
const MAX_CARRY_BYTES = MAX_LINE_BYTES * 2;
/** Bounded final drain on tail-off (codex review: processInstruction used
 *  to delete the tail before ever reading bytes written since the last
 *  regular pass). Caps total final-drain reads at
 *  MAX_FINAL_DRAIN_PASSES x MAX_READ_BYTES_PER_PASS (~1MB) so a
 *  still-rapidly-growing file can't stall shutdown indefinitely. */
const MAX_FINAL_DRAIN_PASSES = 16;

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

/** Split a Buffer on 0x0A (newline) BYTES, returning complete-line byte
 *  slices plus the trailing unterminated remainder. Splitting in byte
 *  space (never decoding first) is the point: 0x0A is a single-byte ASCII
 *  character that can never appear as a continuation byte of a multibyte
 *  UTF-8 sequence, so this never misidentifies a line boundary — unlike
 *  decoding each 64KB block independently and splitting the resulting
 *  STRING, which corrupts (or throws away, via U+FFFD replacement) any
 *  multibyte character whose bytes straddle a read-pass boundary (codex
 *  review). */
function splitOnNewline(buffer) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0a) {
      lines.push(buffer.subarray(start, i));
      start = i + 1;
    }
  }
  return { lines, remainder: buffer.subarray(start) };
}

/**
 * One incremental read pass over a single tail. Never throws — a read
 * error other than ENOENT is logged and treated as "nothing new this
 * pass" so one bad file can't wedge the daemon.
 *
 * @param {{ path: string, offset: number, carry: Buffer, resync?: boolean }} tail
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
    tail.carry = Buffer.alloc(0);
    tail.resync = false;
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

  const combined = Buffer.concat([tail.carry, buf]);
  const { lines: rawLines, remainder } = splitOnNewline(combined);

  let usableLines = rawLines;
  if (tail.resync) {
    // A previous pass dropped an oversized, newline-free carry (see the
    // cap check below). The first segment here is the tail end of that
    // ABANDONED line, not a real line — discard it. Once we've actually
    // crossed a newline (rawLines non-empty), resync is done; otherwise
    // still no boundary in sight, keep waiting.
    usableLines = usableLines.slice(1);
    if (rawLines.length > 0) tail.resync = false;
  }

  tail.carry = remainder;
  if (tail.carry.length > MAX_CARRY_BYTES) {
    log(
      `⚠ dropped an oversized newline-free carry for ${tail.path} (>${MAX_CARRY_BYTES} bytes) — resyncing at the next newline`,
    );
    tail.carry = Buffer.alloc(0);
    tail.resync = true;
  }

  const assistantLines = [];
  for (const lineBuf of usableLines) {
    if (lineBuf.length === 0) continue;
    // Byte-space pre-check before ever decoding — the bulk of a
    // transcript (tool results, progress records, file-history snapshots)
    // never reaches JSON.parse. Buffer#includes searches in the same
    // encoding the literal was written in (utf8), which is safe here
    // since the search string is pure ASCII.
    if (!lineBuf.includes('"type":"assistant"')) continue;
    if (lineBuf.length > MAX_LINE_BYTES) {
      log(`⚠ skipped an oversized assistant line for ${tail.path} (>${MAX_LINE_BYTES} bytes)`);
      continue;
    }
    const line = lineBuf.toString('utf8');
    if (!line.trim()) continue;
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
 * Re-validate `tail.path` against the LOCAL roots allowlist before every
 * single read (codex review — TOCTOU): the tail-on check ran once, but the
 * path is reopened BY NAME every pass; if it were swapped for a symlink
 * pointing outside the allowlisted roots between passes, a name-only
 * reopen would silently follow it. isPathAllowed is a realpath + prefix
 * check — cheap enough to repeat every pass. `denied: true` on failure
 * tells the caller to tear the tail down; it never attempts the read.
 *
 * @param {{ path: string, offset: number, carry: Buffer, resync?: boolean }} tail
 * @param {string[]} roots
 * @param {typeof import('node:fs')} fsImpl
 * @param {(msg: string) => void} log
 * @returns {{ lines: string[], missing: boolean, denied: boolean }}
 */
function readOneValidatedPass(tail, roots, fsImpl, log) {
  if (!isPathAllowed(tail.path, roots, fsImpl)) {
    return { lines: [], missing: false, denied: true };
  }
  const result = readNewAssistantLines(tail, fsImpl, log);
  return { ...result, denied: false };
}

/**
 * Bounded final drain before a tail-off actually removes the tail (codex
 * review: processInstruction used to delete the tail — losing its offset
 * state — before ever reading bytes written since the last regular pass,
 * silently dropping the session's final output). Loops until EOF (offset
 * stops advancing) or MAX_FINAL_DRAIN_PASSES, whichever first, so a
 * still-rapidly-growing file can't stall a tail-off indefinitely.
 */
function finalDrain(tail, sessionId, forwarder, roots, fsImpl, log) {
  for (let i = 0; i < MAX_FINAL_DRAIN_PASSES; i++) {
    const offsetBefore = tail.offset;
    const { lines, missing, denied } = readOneValidatedPass(tail, roots, fsImpl, log);
    if (denied) {
      log(`⚠ final drain skipped for ${sessionId} — path failed re-validation: ${tail.path}`);
      break;
    }
    if (lines.length > 0) forwarder.push(sessionId, lines);
    if (missing || tail.offset === offsetBefore) break; // caught up to EOF
  }
}

/**
 * @param {Map<string, { path: string, offset: number, carry: Buffer, resync?: boolean, missingLogged: boolean }>} tails
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
      carry: Buffer.alloc(0),
      missingLogged: false,
    });
    log(
      `✓ tail-on ${instr.sessionId} (fromStart=${instr.fromStart === true}, path=${instr.transcriptPath})`,
    );
    return;
  }

  if (instr.kind === 'tail-off') {
    const tail = tails.get(instr.sessionId);
    if (!tail) return;
    // Final drain BEFORE removing the tail — bytes written after the last
    // regular pass but before this tail-off must still reach the server.
    finalDrain(tail, instr.sessionId, forwarder, roots, fsImpl, log);
    tails.delete(instr.sessionId);
    // drop() flushes THEN removes the forwarder's own per-session buffer
    // state — flush() alone would leak an empty entry for the rest of the
    // process's life (codex review).
    void forwarder.drop(instr.sessionId);
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
export function readPass(tails, forwarder, roots, deps) {
  for (const [sessionId, tail] of tails) {
    const { lines, missing, denied } = readOneValidatedPass(tail, roots, deps.fsImpl, deps.log);
    if (denied) {
      // TOCTOU teardown (codex review): the path passed allowlist
      // validation at tail-on but fails it NOW — e.g. swapped for a
      // symlink pointing outside the roots between passes. Stop reading
      // immediately; never open it again.
      deps.log(
        `⚠ tail torn down for ${sessionId} — path failed re-validation (possible symlink swap outside allowlisted roots): ${tail.path}`,
      );
      tails.delete(sessionId);
      void forwarder.drop(sessionId);
      continue;
    }
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
      readPass(tails, forwarder, cfg.roots, resolvedDeps);
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
