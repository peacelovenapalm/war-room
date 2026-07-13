/**
 * Coworker event mapping (v1 mechanic #6a) — pure functions, no I/O.
 *
 * Translates Codex / Gemini CLI session activity into provider-native hook
 * payloads. The adapter POSTs them to the authed ingest at
 * /api/hooks/<provider>; the server records the provider id and renders the
 * session as a coworker (distinct badge silhouette + [PROVIDER] text label).
 *
 * Failure policy mirrors the poller: malformed records return [] (skip),
 * never throw.
 */

// ── Codex (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) ────────

/**
 * Session state carried across lines of one rollout file.
 * @typedef {{ sessionId?: string, cwd?: string }} CodexSessionState
 */

/** Derive the session UUID from a rollout filename (fallback when the
 *  session_meta line was skipped by end-seeding). */
export function sessionIdFromRolloutName(basename) {
  const m =
    /rollout-.*?-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(
      basename,
    );
  return m ? m[1] : undefined;
}

/** Best-effort human tool mapping for Codex function calls. */
function codexToolEvent(payload, base) {
  const name = typeof payload.name === 'string' ? payload.name : 'Tool';
  let toolName = name;
  let toolInput = {};
  if (name === 'shell' || name === 'local_shell' || name === 'container.exec') {
    toolName = 'exec';
    try {
      const args = JSON.parse(payload.arguments ?? '{}');
      const cmd = Array.isArray(args.command) ? args.command.join(' ') : args.command;
      if (typeof cmd === 'string') toolInput = { command: cmd };
    } catch {
      /* unparseable arguments → generic Bash */
    }
  } else if (name === 'apply_patch') {
    toolName = 'apply_patch';
  }
  const toolUseId =
    typeof payload.call_id === 'string'
      ? payload.call_id
      : typeof payload.id === 'string'
        ? payload.id
        : undefined;
  if (!toolUseId) return undefined;
  return {
    ...base,
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_use_id: toolUseId,
    tool_input: toolInput,
  };
}

function codexToolEnd(payload, base) {
  const toolUseId =
    typeof payload.call_id === 'string'
      ? payload.call_id
      : typeof payload.id === 'string'
        ? payload.id
        : undefined;
  if (!toolUseId) return undefined;
  const toolResponse = {};
  if (typeof payload.success === 'boolean') toolResponse.success = payload.success;
  if (typeof payload.status === 'string') toolResponse.status = payload.status;
  if (typeof payload.duration_ms === 'number') toolResponse.duration_ms = payload.duration_ms;
  if (typeof payload.duration === 'number') toolResponse.duration = payload.duration;
  return {
    ...base,
    hook_event_name: 'PostToolUse',
    tool_use_id: toolUseId,
    tool_response: toolResponse,
  };
}

function pairedCompletion(base, toolUseId, toolName, toolResponse = {}) {
  if (!toolUseId) return [];
  return [
    {
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: toolName,
      tool_use_id: toolUseId,
      tool_input: {},
    },
    {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_use_id: toolUseId,
      tool_response: toolResponse,
    },
  ];
}

/**
 * Map one parsed Codex rollout line to hook events (0..2 per line).
 * Mutates `state` when the line carries session identity (session_meta).
 *
 * @param {Record<string, unknown>} rec parsed JSONL record
 * @param {CodexSessionState} state per-file session state
 * @returns {Array<Record<string, unknown>>} hook-shaped payloads
 */
export function mapCodexLine(rec, state) {
  if (!rec || typeof rec !== 'object') return [];
  const payload = rec.payload && typeof rec.payload === 'object' ? rec.payload : {};

  if (rec.type === 'session_meta') {
    if (typeof payload.session_id === 'string') state.sessionId = payload.session_id;
    else if (typeof payload.id === 'string') state.sessionId = payload.id;
    if (typeof payload.cwd === 'string') state.cwd = payload.cwd;
    return [];
  }
  if (rec.type === 'turn_context') {
    if (typeof payload.cwd === 'string') state.cwd = payload.cwd;
    return [];
  }
  if (!state.sessionId) return []; // no identity yet — nothing to attribute

  const base = { session_id: state.sessionId, cwd: state.cwd };

  if (rec.type === 'event_msg') {
    switch (payload.type) {
      case 'task_started':
        if (typeof payload.turn_id !== 'string') return [];
        return [
          {
            ...base,
            hook_event_name: 'PreToolUse',
            tool_name: 'Codex',
            tool_use_id: `turn:${payload.turn_id}`,
            tool_input: {},
          },
        ];
      case 'task_complete':
        if (typeof payload.turn_id !== 'string') return [{ ...base, hook_event_name: 'Stop' }];
        return [
          {
            ...base,
            hook_event_name: 'PostToolUse',
            tool_use_id: `turn:${payload.turn_id}`,
            tool_response: { status: 'completed' },
          },
          { ...base, hook_event_name: 'Stop' },
        ];
      case 'turn_aborted':
        return [{ ...base, hook_event_name: 'Stop' }];
      case 'exec_approval_request':
      case 'apply_patch_approval_request':
        // Codex is waiting on a human approval → NEEDS INPUT (fire at the desk).
        return [
          {
            ...base,
            hook_event_name: 'PermissionRequest',
            tool_name: payload.type === 'exec_approval_request' ? 'exec' : 'apply_patch',
          },
        ];
      case 'patch_apply_end': {
        const end = codexToolEnd(payload, base);
        return end ? [end] : [];
      }
      case 'mcp_tool_call_end': {
        const invocation =
          payload.invocation && typeof payload.invocation === 'object' ? payload.invocation : {};
        const server =
          typeof invocation.server === 'string'
            ? invocation.server
            : typeof payload.server === 'string'
              ? payload.server
              : 'server';
        const tool =
          typeof invocation.tool === 'string'
            ? invocation.tool
            : typeof invocation.tool_name === 'string'
              ? invocation.tool_name
              : typeof payload.tool_name === 'string'
                ? payload.tool_name
                : 'tool';
        return pairedCompletion(
          base,
          typeof payload.call_id === 'string' ? payload.call_id : undefined,
          `mcp__${server}__${tool}`,
          typeof payload.duration === 'number' ? { duration: payload.duration } : {},
        );
      }
      case 'web_search_end':
        return pairedCompletion(
          base,
          typeof payload.call_id === 'string' ? payload.call_id : undefined,
          'web_search',
        );
      default:
        return [];
    }
  }

  if (rec.type === 'response_item') {
    switch (payload.type) {
      case 'function_call':
      case 'custom_tool_call': {
        const start = codexToolEvent(payload, base);
        return start ? [start] : [];
      }
      case 'function_call_output':
      case 'custom_tool_call_output': {
        const end = codexToolEnd(payload, base);
        return end ? [end] : [];
      }
      default:
        return [];
    }
  }

  return [];
}

// ── Gemini (~/.gemini/tmp/<project>/logs.json) ──────────────────

/**
 * Diff a Gemini logs.json array against the last-seen index.
 * Gemini rewrites the whole array, so "new" = (sessionId, messageId) pairs
 * we haven't seen. Returns the sessions with fresh user activity.
 *
 * @param {Record<string, number>} lastSeen sessionId → highest messageId seen
 * @param {unknown} entries parsed logs.json content
 * @param {boolean} seeded true once the first index-only scan has run —
 *   after that, a session we've NEVER seen is live activity (its first
 *   message just happened), not history.
 * @returns {{ active: string[], nextLastSeen: Record<string, number> }}
 */
export function diffGeminiLog(lastSeen, entries, seeded = false) {
  const nextLastSeen = { ...lastSeen };
  const active = new Set();
  if (!Array.isArray(entries)) return { active: [], nextLastSeen };
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const sid = typeof e.sessionId === 'string' ? e.sessionId : undefined;
    const mid = typeof e.messageId === 'number' ? e.messageId : undefined;
    if (!sid || mid === undefined) continue;
    // Sessions first seen THIS scan are history, not activity — index them
    // silently (keyed off the caller's lastSeen, not nextLastSeen, so a
    // session's own later messages in the same scan don't self-activate).
    const knownBefore = lastSeen[sid] !== undefined;
    if (nextLastSeen[sid] === undefined || mid > nextLastSeen[sid]) {
      nextLastSeen[sid] = mid;
      // Activity = a message newer than the session's index, OR a session
      // that appeared entirely after the seed scan (one-prompt sessions).
      if ((knownBefore && mid > lastSeen[sid]) || (!knownBefore && seeded)) active.add(sid);
    }
  }
  return { active: [...active], nextLastSeen };
}

/** Hook events announcing a Gemini session became active (heartbeat model). */
export function geminiActivityEvents(sessionId, cwd) {
  return [
    {
      session_id: sessionId,
      cwd,
      hook_event_name: 'PreToolUse',
      tool_name: 'Gemini',
      tool_input: {},
    },
  ];
}

/** Hook events marking a Gemini session idle after the quiet period. */
export function geminiIdleEvents(sessionId, cwd) {
  return [
    { session_id: sessionId, cwd, hook_event_name: 'PostToolUse' },
    { session_id: sessionId, cwd, hook_event_name: 'Stop' },
  ];
}
