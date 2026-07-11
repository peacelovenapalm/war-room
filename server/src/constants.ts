// ── JSONL File Watching ─────────────────────────────────────
export const JSONL_POLL_INTERVAL_MS = 1000;
export const FILE_WATCHER_POLL_INTERVAL_MS = 500;
export const PROJECT_SCAN_INTERVAL_MS = 1000;

// ── Heuristic Agent Status Detection ────────────────────────
// These timers are the fallback when CLI hooks are not active
// (hookDelivered = false). When hooks are working, these are
// suppressed and the server receives instant events instead.
/** Delay before sending agentToolDone (prevents UI flicker on rapid tool transitions) */
export const TOOL_DONE_DELAY_MS = 300;
/** Heuristic: time after a non-exempt tool starts before showing permission bubble.
 *  Not used for teammates -- false positives on slow tools (WebFetch/WebSearch).
 *  Teammates rely on the lead's routed Notification(permission_prompt) hook. */
export const PERMISSION_TIMER_DELAY_MS = 7000;
/** Heuristic: silence duration before marking a text-only turn as complete */
export const TEXT_IDLE_DELAY_MS = 5000;
/** Heuristic: idle threshold for per-agent /clear detection (content check prevents stealing) */
export const CLEAR_IDLE_THRESHOLD_MS = 2000;

// ── External Session Detection ──────────────────────────────
export const EXTERNAL_SCAN_INTERVAL_MS = 3000;
/** Only adopt JSONL files modified within this window */
export const EXTERNAL_ACTIVE_THRESHOLD_MS = 120_000; // 2 minutes
/** Remove external agents after this much inactivity */
// export const EXTERNAL_STALE_TIMEOUT_MS = 300_000; // 5 minutes - deprecated
export const EXTERNAL_STALE_CHECK_INTERVAL_MS = 30_000;
/** Cooldown after user closes an agent via X. Must be > EXTERNAL_ACTIVE_THRESHOLD_MS
 *  so the file's mtime becomes stale before the dismissal expires. */
export const DISMISSED_COOLDOWN_MS = 180_000; // 3 minutes

// ── Global Session Scanning ─────────────────────────────────
/** Only adopt global JSONL files larger than this (filters out empty/init-only sessions) */
export const GLOBAL_SCAN_ACTIVE_MIN_SIZE = 3_072; // 3KB
/** Only adopt global JSONL files modified within this window */
export const GLOBAL_SCAN_ACTIVE_MAX_AGE_MS = 600_000; // 10 minutes

// ── Display Truncation + Pixel Agents Server paths ──────────
// Centralized in core/src/constants.ts; re-exported here for back-compat.
export {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  HOOK_API_PREFIX,
  HOOK_SCRIPTS_DIR,
  SERVER_JSON_DIR,
  SERVER_JSON_NAME,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from '../../core/src/constants.js';

export const HOOK_EVENT_BUFFER_MS = 5_000;

// ── Remote agent output ingest (T1 remote live-tail, S1/S3) ─
/** POST /api/agents/output body caps (mirrors the poll route's ingest-cap
 *  style): a batch larger than this, a line longer than this, or a batch
 *  whose lines sum past MAX_AGENT_OUTPUT_TOTAL_LINE_BYTES, is an unusable
 *  body shape (400), not a resolution question.
 *
 *  MAX_AGENT_OUTPUT_LINE_BYTES was 16KB at S1; bumped to 256KB at S3 — a
 *  single assistant record carrying a Write tool_use's full file content
 *  routinely exceeds 16KB, and the old cap 400'd the WHOLE batch for one
 *  such line, silently killing a remote tail on legitimate traffic. The new
 *  MAX_AGENT_OUTPUT_TOTAL_LINE_BYTES cap (independent of the per-line cap)
 *  is what actually bounds a single POST's worst case, since
 *  MAX_AGENT_OUTPUT_LINES_PER_POST x MAX_AGENT_OUTPUT_LINE_BYTES alone
 *  would allow ~50MB. */
export const MAX_AGENT_OUTPUT_LINES_PER_POST = 200;
export const MAX_AGENT_OUTPUT_LINE_BYTES = 262_144; // 256KB
export const MAX_AGENT_OUTPUT_TOTAL_LINE_BYTES = 1_048_576; // 1MB
/** Fastify route-level bodyLimit for POST /api/agents/output — must exceed
 *  MAX_AGENT_OUTPUT_TOTAL_LINE_BYTES to leave room for JSON framing
 *  overhead (quoting/escaping every line, plus the sessionId/array
 *  syntax); Fastify 413s BEFORE this route's own parseAgentOutputBody caps
 *  ever run. Deliberately NOT the process-wide MAX_HOOK_BODY_SIZE (64KB) —
 *  that stays the default for every other route. 4MB = 2x headroom over
 *  the 1MB raw-lines cap for worst-case JSON escaping (codex review: a
 *  transcript line dense with quotes/backslashes/control chars can nearly
 *  double in size once escaped into a JSON string; 2MB left too little
 *  margin for a genuinely worst-case 1MB batch). */
export const MAX_AGENT_OUTPUT_BODY_BYTES = 4 * 1024 * 1024; // 4MB
/** Defensive cap on the remote transcript-path retention map (registerHookRoute) —
 *  bounds a runaway/malicious remote's ability to grow server memory via
 *  distinct (machine, sessionId) pairs. Oldest entry evicted first. */
export const MAX_REMOTE_TRANSCRIPT_PATHS = 500;

// ── Remote tail-instruction plane (T1 remote live-tail, S2) ─
/** Defensive cap on a machine's queued TailInstructions between polls
 *  (remoteTailDemand.ts) — bounds unbounded growth if a tailer stops
 *  polling (or a machine's queue never drains). Oldest-first eviction,
 *  matching MAX_REMOTE_TRANSCRIPT_PATHS' posture. Never hit in normal
 *  operation — one instruction per tail-on/off transition. */
export const MAX_TAIL_QUEUE_PER_MACHINE = 200;

/** Grace period after SessionEnd(reason=clear/resume) before triggering onSessionEnd.
 *  /clear and /resume fire SessionEnd then SessionStart within ms. This timeout is a
 *  safety net: if SessionStart never arrives (e.g. the CLI crashes mid-transition),
 *  the agent is cleaned up instead of staying as a zombie with pendingClear forever. */
export const SESSION_END_GRACE_MS = 2000;
export const MAX_HOOK_BODY_SIZE = 65_536; // 64KB

// ── Layout/Config Persistence ──────────────────────────────
export const LAYOUT_FILE_DIR = '.pixel-agents';
export const LAYOUT_FILE_NAME = 'layout.json';
export const LAYOUT_FILE_POLL_INTERVAL_MS = 2000;
export const LAYOUT_REVISION_KEY = 'layoutRevision';
export const CONFIG_FILE_NAME = 'config.json';
