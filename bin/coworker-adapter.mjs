#!/usr/bin/env node

/**
 * War Room coworker adapter (v1 mechanic #6a) — one instance per machine.
 *
 * Tails Codex and Gemini CLI session files and POSTs their activity as
 * normalized hook events to the War Room server's authenticated per-provider
 * ingest (POST /api/hooks/codex, /api/hooks/gemini — Bearer token +
 * X-Machine label). The office renders these sessions as COWORKERS: distinct
 * badge silhouette + [CODEX] / [GEMINI] text label (colorblind rule).
 *
 * Sources (read-only):
 *   Codex:  ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl  (JSONL, appended)
 *   Gemini: ~/.gemini/tmp/<project>/logs.json             (array, rewritten)
 *
 * Only NEW activity streams: pre-existing rollout files are seeded at EOF
 * (their session_meta line is read for identity), and the first Gemini scan
 * only indexes. No message content is forwarded — tool names/commands only
 * for Codex, bare heartbeats for Gemini.
 *
 * Failure policy: unreadable files and unreachable servers skip the tick
 * with a ⚠ log line; the adapter never crashes on bad data.
 *
 * Config (env, overridable by flags):
 *   WAR_ROOM_URL         server base URL     (default http://127.0.0.1:3141)
 *   WAR_ROOM_TOKEN       bearer token        (REQUIRED)
 *   WAR_ROOM_MACHINE     machine TEXT label  (default: short hostname, uppercased)
 *   WAR_ROOM_COWORKER_MS scan interval ms    (default 3000, min 1000)
 *   WAR_ROOM_CODEX_DIR   codex sessions root (default ~/.codex/sessions)
 *   WAR_ROOM_GEMINI_DIR  gemini tmp root     (default ~/.gemini/tmp)
 * Flags: --url <u> --machine <m> --interval <ms> --providers codex,gemini
 *        --once --replay (don't seed at EOF; stream file history) --help
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  diffGeminiLog,
  geminiActivityEvents,
  geminiIdleEvents,
  mapCodexLine,
  sessionIdFromRolloutName,
} from './lib/coworker-map.mjs';

const POST_TIMEOUT_MS = 10_000;
const MIN_INTERVAL_MS = 1_000;
/** A Gemini session with no new messages for this long goes idle. */
const GEMINI_IDLE_MS = 45_000;
/** Only tail rollout files touched within this window (bound the scan). */
const CODEX_FRESH_MS = 24 * 60 * 60 * 1000;

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
    intervalMs: Number(process.env.WAR_ROOM_COWORKER_MS) || 3_000,
    codexDir: process.env.WAR_ROOM_CODEX_DIR || path.join(os.homedir(), '.codex', 'sessions'),
    geminiDir: process.env.WAR_ROOM_GEMINI_DIR || path.join(os.homedir(), '.gemini', 'tmp'),
    providers: ['codex', 'gemini'],
    once: false,
    replay: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') cfg.url = argv[++i] ?? cfg.url;
    else if (a === '--machine') cfg.machine = argv[++i] ?? cfg.machine;
    else if (a === '--interval') cfg.intervalMs = Number(argv[++i]) || cfg.intervalMs;
    else if (a === '--providers') {
      cfg.providers = (argv[++i] ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    } else if (a === '--once') cfg.once = true;
    else if (a === '--replay') cfg.replay = true;
    else if (a === '--help') {
      console.log(
        'usage: coworker-adapter.mjs [--url <u>] [--machine <m>] [--interval <ms>] ' +
          '[--providers codex,gemini] [--once] [--replay]',
      );
      process.exit(0);
    }
  }
  cfg.intervalMs = Math.max(MIN_INTERVAL_MS, cfg.intervalMs);
  return cfg;
}

// ── POST helper ─────────────────────────────────────────────────

async function postEvents(cfg, provider, events) {
  for (const event of events) {
    try {
      const res = await fetch(`${cfg.url}/api/hooks/${provider}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.token}`,
          'x-machine': cfg.machine,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.log(`⚠ ${provider}: server ${res.status} for ${event.hook_event_name}`);
      }
    } catch (err) {
      console.log(`⚠ ${provider}: POST failed (${err?.message ?? err}) — skipping event`);
    }
  }
}

// ── Codex tailer ────────────────────────────────────────────────

/** file → { offset, buf, state:{sessionId,cwd} } */
const codexFiles = new Map();

function listRecentRollouts(root, now) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
        try {
          const st = fs.statSync(p);
          if (now - st.mtimeMs <= CODEX_FRESH_MS) out.push({ file: p, size: st.size });
        } catch {
          /* raced with deletion */
        }
      }
    }
  };
  walk(root, 0);
  return out;
}

/** Read the identity line (session_meta) without consuming the tail. */
function seedCodexIdentity(file, state) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const firstLine = buf.toString('utf8', 0, n).split('\n')[0];
    mapCodexLine(JSON.parse(firstLine), state);
  } catch {
    /* fall back to filename UUID */
  }
  if (!state.sessionId) state.sessionId = sessionIdFromRolloutName(path.basename(file));
}

async function tickCodex(cfg) {
  const events = [];
  for (const { file, size } of listRecentRollouts(cfg.codexDir, Date.now())) {
    let entry = codexFiles.get(file);
    if (!entry) {
      entry = { offset: cfg.replay ? 0 : size, buf: '', state: {} };
      seedCodexIdentity(file, entry.state);
      codexFiles.set(file, entry);
      if (cfg.replay) entry.state = {}; // replay re-reads session_meta in-stream
      continue; // stream only growth after first sight (unless replaying)
    }
    if (size <= entry.offset) continue;
    let chunk;
    try {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(size - entry.offset);
      const n = fs.readSync(fd, buf, 0, buf.length, entry.offset);
      fs.closeSync(fd);
      chunk = buf.toString('utf8', 0, n);
    } catch (err) {
      console.log(`⚠ codex: read failed for ${path.basename(file)} (${err?.message ?? err})`);
      continue;
    }
    entry.offset = size;
    entry.buf += chunk;
    const lines = entry.buf.split('\n');
    entry.buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        events.push(...mapCodexLine(JSON.parse(line), entry.state));
      } catch {
        /* malformed line — skip */
      }
    }
  }
  if (events.length > 0) await postEvents(cfg, 'codex', events);
  return events.length;
}

// ── Gemini tailer ───────────────────────────────────────────────

/** sessionId → highest messageId seen (across all project dirs). */
let geminiLastSeen = {};
/** sessionId → { cwd, lastActiveAt, idleSent } */
const geminiSessions = new Map();
let geminiSeeded = false;

function readProjectRoot(dir) {
  try {
    const p = fs.readFileSync(path.join(dir, '.project_root'), 'utf8').trim();
    if (p) return p;
  } catch {
    /* fall through */
  }
  return dir;
}

async function tickGemini(cfg) {
  const now = Date.now();
  let projectDirs;
  try {
    projectDirs = fs
      .readdirSync(cfg.geminiDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(cfg.geminiDir, e.name));
  } catch {
    return 0; // no gemini install — quiet skip
  }

  let sent = 0;
  for (const dir of projectDirs) {
    const logFile = path.join(dir, 'logs.json');
    let entries;
    try {
      entries = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    } catch {
      continue; // no logs.json or malformed — skip project
    }
    const { active, nextLastSeen } = diffGeminiLog(geminiLastSeen, entries);
    geminiLastSeen = nextLastSeen;
    if (!geminiSeeded) continue; // first scan only indexes (no replay)
    for (const sid of active) {
      const cwd = readProjectRoot(dir);
      geminiSessions.set(sid, { cwd, lastActiveAt: now, idleSent: false });
      await postEvents(cfg, 'gemini', geminiActivityEvents(sid, cwd));
      sent++;
    }
  }
  geminiSeeded = true;

  // Idle sweep: quiet sessions go DONE/idle.
  for (const [sid, s] of geminiSessions) {
    if (!s.idleSent && now - s.lastActiveAt >= GEMINI_IDLE_MS) {
      s.idleSent = true;
      await postEvents(cfg, 'gemini', geminiIdleEvents(sid, s.cwd));
      sent++;
    }
  }
  return sent;
}

// ── Main loop ───────────────────────────────────────────────────

const cfg = parseArgs(process.argv);
if (!cfg.token) {
  console.error('✗ WAR_ROOM_TOKEN is required (bearer token for the authed ingest)');
  process.exit(1);
}
console.log(
  `[coworker-adapter] providers=${cfg.providers.join(',')} machine=${cfg.machine} → ${cfg.url} (token: set)`,
);

async function tick() {
  try {
    if (cfg.providers.includes('codex')) await tickCodex(cfg);
  } catch (err) {
    console.log(`⚠ codex tick failed: ${err?.message ?? err}`);
  }
  try {
    if (cfg.providers.includes('gemini')) await tickGemini(cfg);
  } catch (err) {
    console.log(`⚠ gemini tick failed: ${err?.message ?? err}`);
  }
}

await tick();
if (!cfg.once) {
  setInterval(() => void tick(), cfg.intervalMs);
}
