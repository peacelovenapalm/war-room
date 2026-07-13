/** Codex command-hook event names supported by codex-cli 0.144.1. */
export const CODEX_HOOK_EVENT_NAMES = {
  SESSION_START: 'SessionStart',
  SUBAGENT_START: 'SubagentStart',
  PRE_TOOL_USE: 'PreToolUse',
  PERMISSION_REQUEST: 'PermissionRequest',
  POST_TOOL_USE: 'PostToolUse',
  PRE_COMPACT: 'PreCompact',
  POST_COMPACT: 'PostCompact',
  USER_PROMPT_SUBMIT: 'UserPromptSubmit',
  SUBAGENT_STOP: 'SubagentStop',
  STOP: 'Stop',
} as const;

/** Complete native event set installed by the gated runbook. */
export const CODEX_HOOK_EVENTS = Object.values(CODEX_HOOK_EVENT_NAMES);

/** Output filename produced by esbuild for the telemetry forwarder. */
export const CODEX_HOOK_SCRIPT_NAME = 'codex-hook.js';

/** Human-run installer target, relative to the user's home directory. */
export const CODEX_HOOK_FORWARDER_PATH = '.war-room/codex-hook.sh';

export const CODEX_HOOK_API_PATH = '/api/hooks/codex';
export const CODEX_HOOK_POST_TIMEOUT_MS = 2_000;
export const CODEX_ANCESTOR_SCAN_TIMEOUT_MS = 250;
export const CODEX_ANCESTOR_SCAN_LIMIT = 24;
export const CODEX_HOOK_WORKER_ENV = 'WAR_ROOM_CODEX_HOOK_WORKER';
export const CODEX_HOOK_SYNC_ENV = 'WAR_ROOM_HOOK_SYNC';
export const CODEX_HOOK_STATUS_FILE_ENV = 'WAR_ROOM_HOOK_STATUS_FILE';
export const CODEX_DISCOVERED_PID_ENV = 'WAR_ROOM_CODEX_PID';

/** Synthetic lifecycle event emitted only by the rollout fallback lane. */
export const CODEX_SYNTHETIC_SESSION_END_EVENT = 'SessionEnd';

/** Tool-response status values that unambiguously indicate failure. */
export const CODEX_FAILURE_STATUSES = new Set(['error', 'failed', 'failure']);

/** Display-safe outcome labels; raw tool responses never cross normalization. */
export const CODEX_TOOL_COMPLETED_STATUS = 'Completed';
export const CODEX_TOOL_FAILED_STATUS = 'Failed';
