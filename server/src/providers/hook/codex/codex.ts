import * as path from 'path';

import type { AgentEvent, HookProvider } from '../../../../../core/src/provider.js';
import {
  CODEX_FAILURE_STATUSES,
  CODEX_HOOK_EVENT_NAMES,
  CODEX_SYNTHETIC_SESSION_END_EVENT,
  CODEX_TOOL_COMPLETED_STATUS,
  CODEX_TOOL_FAILED_STATUS,
} from './constants.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;
}

function finiteNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function basename(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? path.basename(value) : undefined;
}

function normalizedToolName(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (lower === 'shell' || lower === 'local_shell' || lower === 'container.exec') return 'exec';
  return toolName;
}

/** Keep only fields needed to derive a short display status. Commands, patch
 * bodies, MCP arguments, prompts, and all other tool inputs are discarded. */
function displaySafeToolInput(toolName: string, input: unknown): UnknownRecord | undefined {
  const record = asRecord(input);
  if (!record) return undefined;
  const lower = toolName.toLowerCase();
  if (lower === 'read' || lower === 'read_file') {
    const file = basename(record.file_path ?? record.path);
    return file ? { file } : undefined;
  }
  if (lower === 'grep' || lower === 'search_files' || lower === 'glob') {
    const directory = basename(record.path ?? record.directory);
    return directory ? { directory } : undefined;
  }
  return undefined;
}

export function formatToolStatus(toolName: string, input?: unknown): string {
  const record = asRecord(input);
  const lower = toolName.toLowerCase();
  const file = typeof record?.file === 'string' ? record.file : undefined;
  const directory = typeof record?.directory === 'string' ? record.directory : undefined;

  if (
    lower === 'exec' ||
    lower === 'exec_command' ||
    lower === 'unified_exec' ||
    lower === 'bash'
  ) {
    return 'Running command';
  }
  if (lower === 'apply_patch' || lower === 'patch') return 'Applying patch';
  if (lower === 'read' || lower === 'read_file') return file ? `Reading ${file}` : 'Reading file';
  if (lower === 'grep' || lower === 'search_files') {
    return directory ? `Searching ${directory}` : 'Searching code';
  }
  if (lower === 'glob') return directory ? `Scanning ${directory}` : 'Scanning files';
  if (lower === 'web_search' || lower === 'websearch') return 'Searching the web';
  if (lower === 'web_fetch' || lower === 'webfetch') return 'Fetching web content';
  if (lower.startsWith('mcp__') || lower.startsWith('mcp_') || lower.includes('mcp')) {
    return `Using MCP tool ${toolName}`;
  }
  if (lower === 'request_user_input') return 'Waiting for your answer';
  if (lower === 'spawn_agent' || lower === 'subagent') return 'Running subagent';
  return `Using ${toolName || 'tool'}`;
}

function toolResponseFailed(toolResponse: unknown): boolean {
  const response = asRecord(toolResponse);
  if (!response) return false;
  if (response.success === false || response.is_error === true) return true;
  if (typeof response.exit_code === 'number' && response.exit_code !== 0) return true;
  if (typeof response.status === 'string') {
    return CODEX_FAILURE_STATUSES.has(response.status.toLowerCase());
  }
  return false;
}

function toolDurationMs(raw: UnknownRecord): number | undefined {
  const response = asRecord(raw.tool_response);
  return (
    finiteNonNegativeNumber(raw.duration_ms) ??
    finiteNonNegativeNumber(response?.duration_ms) ??
    finiteNonNegativeNumber(response?.duration)
  );
}

function stringField(raw: UnknownRecord, key: string, fallback = ''): string {
  return typeof raw[key] === 'string' ? raw[key] : fallback;
}

export function normalizeHookEvent(
  raw: UnknownRecord,
): { sessionId: string; event: AgentEvent } | null {
  const eventName = raw.hook_event_name;
  const sessionId = raw.session_id;
  if (typeof eventName !== 'string' || typeof sessionId !== 'string') return null;

  switch (eventName) {
    case CODEX_HOOK_EVENT_NAMES.SESSION_START:
      return {
        sessionId,
        event: {
          kind: 'sessionStart',
          source: typeof raw.source === 'string' ? raw.source : undefined,
          transcriptPath: typeof raw.transcript_path === 'string' ? raw.transcript_path : undefined,
          cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
        },
      };

    case CODEX_HOOK_EVENT_NAMES.PRE_TOOL_USE: {
      const toolName = normalizedToolName(stringField(raw, 'tool_name', 'tool'));
      const toolId = stringField(raw, 'tool_use_id');
      if (!toolId) return null;
      const input = displaySafeToolInput(toolName, raw.tool_input);
      return {
        sessionId,
        event: {
          kind: 'toolStart',
          toolId,
          toolName,
          status: formatToolStatus(toolName, input),
          input,
        },
      };
    }

    case CODEX_HOOK_EVENT_NAMES.POST_TOOL_USE: {
      const toolId = stringField(raw, 'tool_use_id');
      if (!toolId) return null;
      const failed = toolResponseFailed(raw.tool_response);
      return {
        sessionId,
        event: {
          kind: 'toolEnd',
          toolId,
          failed,
          status: failed ? CODEX_TOOL_FAILED_STATUS : CODEX_TOOL_COMPLETED_STATUS,
          durationMs: toolDurationMs(raw),
        },
      };
    }

    case CODEX_HOOK_EVENT_NAMES.PERMISSION_REQUEST: {
      const toolName = normalizedToolName(stringField(raw, 'tool_name', 'tool'));
      return {
        sessionId,
        event: {
          kind: 'permissionRequest',
          toolName,
          status: `Approval required for ${toolName}`,
        },
      };
    }

    case CODEX_HOOK_EVENT_NAMES.STOP:
      return { sessionId, event: { kind: 'turnEnd' } };

    case CODEX_HOOK_EVENT_NAMES.SUBAGENT_START: {
      const agentId = stringField(raw, 'agent_id');
      if (!agentId) return null;
      const agentType = stringField(raw, 'agent_type', 'subagent');
      return {
        sessionId,
        event: {
          kind: 'subagentStart',
          parentToolId: agentId,
          toolId: agentId,
          toolName: agentType,
          status: `Subagent: ${agentType}`,
        },
      };
    }

    case CODEX_HOOK_EVENT_NAMES.SUBAGENT_STOP: {
      const agentId = stringField(raw, 'agent_id');
      if (!agentId) return null;
      return {
        sessionId,
        event: { kind: 'subagentEnd', parentToolId: agentId, toolId: agentId },
      };
    }

    // Codex has no native SessionEnd. The rollout adapter retains its 30-minute
    // idle heuristic and emits this synthetic event for external sessions.
    case CODEX_SYNTHETIC_SESSION_END_EVENT:
      return {
        sessionId,
        event: {
          kind: 'sessionEnd',
          reason: typeof raw.reason === 'string' ? raw.reason : undefined,
        },
      };

    case CODEX_HOOK_EVENT_NAMES.USER_PROMPT_SUBMIT:
    case CODEX_HOOK_EVENT_NAMES.PRE_COMPACT:
    case CODEX_HOOK_EVENT_NAMES.POST_COMPACT:
    default:
      return null;
  }
}

function installHooks(): Promise<void> {
  return Promise.reject(
    new Error('Codex hooks must be installed with the gated codex-hooks-install.sh runbook'),
  );
}

function uninstallHooks(): Promise<void> {
  return Promise.reject(
    new Error('Codex hooks must be removed with the gated codex-hooks-install.sh runbook undo'),
  );
}

function areHooksInstalled(): Promise<boolean> {
  // Trust approval is interactive and cannot be verified safely from the server.
  return Promise.resolve(false);
}

export const codexProvider: HookProvider = {
  kind: 'hook',
  id: 'codex',
  displayName: 'Codex',
  protocolVersion: 1,
  normalizeHookEvent,
  installHooks,
  uninstallHooks,
  areHooksInstalled,
  formatToolStatus,
  permissionExemptTools: new Set(['request_user_input', 'spawn_agent', 'wait']),
  subagentToolNames: new Set(['spawn_agent', 'subagent']),
  readingTools: new Set([
    'read',
    'read_file',
    'grep',
    'search_files',
    'glob',
    'web_search',
    'web_fetch',
  ]),
  terminalNamePrefix: 'Codex',
};
