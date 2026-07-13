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

// ── Hook source metadata ────────────────────────────────────
/** Authenticated header used by fallback adapters to identify synthetic events. */
export const HOOK_SOURCE_HEADER = 'x-war-room-hook-source';
/** Header/tag value for the rollout-tail fallback lane. */
export const COWORKER_ADAPTER_HOOK_SOURCE = 'coworker-adapter';

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

// ── Ops Advisor (T3 self-healing ladder, rung 1 — read-only) ─
/** Analyze-on-demand cache, mirroring briefingProvider.ts's own 60s TTL
 *  cache pattern — no new polling loop. */
export const OPS_ADVISOR_CACHE_TTL_MS = 60_000;
/** Blocked-age thresholds — deliberately the SAME numbers as
 *  webview-v3/src/state/crisis.ts's FIRE_AT_MS/ALARM_AT_MS (that file can't
 *  be imported server-side; this mirrors the same operator-facing aging
 *  bands rather than inventing a second set of numbers). */
export const OPS_BLOCKED_WARN_MS = 90_000;
export const OPS_BLOCKED_ALERT_MS = 240_000;
/** How far back into dispatchStore's ledger the DISPATCH-WASTE finding
 *  source scans (dispatchStore.getRecent's own default is 20 — too short a
 *  window to see a repeated-failure pattern). Read-only, no new
 *  persistence — same ledger, just a bigger read. */
export const OPS_DISPATCH_HISTORY_LIMIT = 100;
/** Cap on how many raw ledger entries a single finding cites as receipts —
 *  bounds payload size when a waste pattern spans dozens of entries. */
export const OPS_RECEIPT_SAMPLE_LIMIT = 5;
/** Same-provider dispatch failures within OPS_DISPATCH_HISTORY_LIMIT before
 *  DISPATCH-WASTE calls it a repeated-failure pattern (not just one bad
 *  run). */
export const OPS_DISPATCH_FAILURE_REPEAT_THRESHOLD = 2;
/** DEAD-TELEMETRY escalates a stale dispatch-runner advertisement from
 *  warn to alert once it's this many multiples of
 *  DISPATCH_MACHINE_AD_TTL_MS old (a machine JUST past the TTL is a
 *  routine blip; one that's been dark for multiples of it is a real
 *  outage). */
export const OPS_MACHINE_STALE_ALERT_MULTIPLIER = 3;

// ── Auto-Executor (T3 self-healing ladder, rung 3 — auto with guardrails) ─
/** Rides its own setInterval (repo has no shared tick primitive — see
 *  httpServer.ts's standingOrderTimer comment); same order as the other
 *  advisor-adjacent ticks. */
export const AUTO_EXECUTOR_TICK_INTERVAL_MS = 60_000;
/** Default max auto-requeues per ORIGINAL (root) dispatch id, before a
 *  human has to act — config-overridable per action via the whitelist
 *  file's params.maxPerId. */
export const AUTO_REQUEUE_DEFAULT_MAX_PER_ID = 2;
/** Default cooldown between two auto-requeues of the same lineage —
 *  config-overridable via params.cooldownMs. */
export const AUTO_REQUEUE_DEFAULT_COOLDOWN_MS = 10 * 60_000;
/** Two auto-fired attempts in a row that themselves fail stops the
 *  lineage for good (human's turn) — NOT config-overridable; this is a
 *  hard safety ceiling, not a tuning knob. */
export const AUTO_REQUEUE_CONSECUTIVE_FAILURE_STOP = 2;
/** Receipts ledger retention (capped, oldest pruned) — mirrors
 *  worldEventStore's EVENT_LOG_CAP convention. */
export const AUTO_EXECUTOR_RECEIPT_CAP = 200;

// ── Self-Heal (V6-4 autonomy rung 1 — four pre-approved action classes) ─
/** Receipts ledger retention (capped, oldest pruned) — mirrors
 *  autoExecutor.ts's AUTO_EXECUTOR_RECEIPT_CAP convention. */
export const SELF_HEAL_RECEIPT_CAP = 200;
/** restart-dead-runner: a machine's dispatch advertisement age past this
 *  is called dead. Deliberately a larger multiple of
 *  dispatchStore.DISPATCH_MACHINE_AD_TTL_MS (30s) than opsAdvisor's own
 *  DEAD-TELEMETRY alert threshold (3x) — self-heal only fires a receipted
 *  decision on a genuinely sustained outage, not a routine blip opsAdvisor
 *  already flags at a lower bar. */
export const SELF_HEAL_RUNNER_DEAD_MS = 5 * 60_000; // 5 minutes
/** refresh-stale-clone: the routine inbox's newest entry mtime age past
 *  this is called stale (the vault clone/mirror hasn't produced anything
 *  new recently). */
export const SELF_HEAL_CLONE_STALE_MS = 26 * 60 * 60_000; // 26h (a daily routine + margin)
/** Per (class,target) cooldown between two receipted decisions — bounds
 *  receipt-ledger spam from a persistently-failing detection candidate
 *  (e.g. a machine that stays dead for hours) re-deciding every tick. */
export const SELF_HEAL_ACTION_COOLDOWN_MS = 15 * 60_000; // 15 minutes
/** Rides its own setInterval (repo has no shared tick primitive — see
 *  httpServer.ts's standingOrderTimer comment); same order as the
 *  Auto-Executor's own tick. */
export const SELF_HEAL_TICK_INTERVAL_MS = 60_000;

// ── Morning surface (V6-1 "one glance, one push", AMBIENT rung 1) ─
/** morning.json regenerates every local morning (nexus-notifier cron); a
 *  payload older than this is honestly STALE, not silently served as
 *  fresh — deliberately generous (regenerates ~daily) vs. the board-state
 *  bar below. */
export const MORNING_JSON_STALE_MS = 20 * 60 * 60_000; // 20h
/** Board-state sections are derived live from in-process stores on every
 *  request — this is the "seconds fine, minutes not" bar the view renders
 *  ◷ STALE past, mirroring V6-DESIGN's latency instrumentation ask even
 *  though dataAgeSeconds for a live derivation is normally ~0. */
export const MORNING_BOARD_STALE_MS = 120_000;
/** GET /api/morning's own short TTL cache — same analyze-on-demand
 *  pattern as opsAdvisor.ts/briefingProvider.ts, never a new poll loop. */
export const MORNING_SURFACE_CACHE_TTL_MS = 30_000;
/** Default local hour (0-23) the once-per-day push tick fires at, absent
 *  WAR_ROOM_MORNING_PUSH_HOUR — matches the notifier's existing 06:00
 *  America/Denver cron gate (V6-DESIGN "wires verified"). */
export const MORNING_PUSH_DEFAULT_HOUR = 6;
/** Default IANA zone the push tick evaluates "local hour" in, absent
 *  WAR_ROOM_MORNING_TZ — the container has no reason to run in Greg's own
 *  zone, so this is never assumed from Date.now() alone (see
 *  morningPush.ts header). */
export const MORNING_PUSH_DEFAULT_TZ = 'America/Denver';
/** How often the push scheduler checks whether it's the target local
 *  hour yet — a minute-granularity tick is plenty for a once-a-day gate
 *  and mirrors AUTO_EXECUTOR_TICK_INTERVAL_MS's "no shared tick
 *  primitive" posture. */
export const MORNING_PUSH_CHECK_INTERVAL_MS = 60_000;
/** Overnight receipts window (V6-1 "overnight summary"): the fixed
 *  18:00 -> 06:00 local band the design specifies, evaluated in the same
 *  zone as the push tick. */
export const MORNING_OVERNIGHT_START_HOUR = 18;
export const MORNING_OVERNIGHT_END_HOUR = 6;
/** V6-5 cross-model spot checks: sampled 1-in-N mornings (deterministic on
 *  the local calendar date, not process-lifetime random, so a restart
 *  never skews the sampling rate) plus every morning after a degraded
 *  one — see morningSpotCheck.ts. */
export const MORNING_SPOT_CHECK_SAMPLE_RATE = 3;
/** Narrative spot-check findings (V6-5) ingested from an external `codex
 *  exec` runner via POST /api/ops/narrative-finding — capped ledger,
 *  oldest pruned, same discipline as AUTO_EXECUTOR_RECEIPT_CAP. */
export const NARRATIVE_FINDING_CAP = 50;
/** A narrative finding older than this is no longer folded into
 *  GET /api/ops/review — a discrepancy about last week's morning isn't a
 *  live finding today. */
export const NARRATIVE_FINDING_MAX_AGE_MS = 7 * 24 * 60 * 60_000; // 7d

// ── Layout/Config Persistence ──────────────────────────────
export const LAYOUT_FILE_DIR = '.pixel-agents';
export const LAYOUT_FILE_NAME = 'layout.json';
export const LAYOUT_FILE_POLL_INTERVAL_MS = 2000;
export const LAYOUT_REVISION_KEY = 'layoutRevision';
export const CONFIG_FILE_NAME = 'config.json';
