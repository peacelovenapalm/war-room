import { describe, expect, it } from 'vitest';

import { codexProvider } from '../src/providers/hook/codex/codex.js';

const common = {
  session_id: 'sess-codex-1',
  transcript_path: '/tmp/rollout-sess-codex-1.jsonl',
  cwd: '/workspace',
  model: 'gpt-5.6-codex',
  permission_mode: 'on-request',
};

describe('codexProvider', () => {
  it('declares Codex identity and tool taxonomies', () => {
    expect(codexProvider.id).toBe('codex');
    expect(codexProvider.protocolVersion).toBe(1);
    expect(codexProvider.readingTools.has('read_file')).toBe(true);
    expect(codexProvider.subagentToolNames.has('spawn_agent')).toBe(true);
    expect(codexProvider.permissionExemptTools.has('wait')).toBe(true);
  });

  it('normalizes SessionStart from the documented payload', () => {
    expect(
      codexProvider.normalizeHookEvent({
        ...common,
        hook_event_name: 'SessionStart',
        source: 'startup',
      }),
    ).toEqual({
      sessionId: common.session_id,
      event: {
        kind: 'sessionStart',
        source: 'startup',
        transcriptPath: common.transcript_path,
        cwd: common.cwd,
      },
    });
  });

  it('normalizes PreToolUse with the native tool_use_id and safe status', () => {
    const result = codexProvider.normalizeHookEvent({
      ...common,
      hook_event_name: 'PreToolUse',
      turn_id: 'turn-1',
      tool_name: 'exec',
      tool_use_id: 'call-1',
      tool_input: { command: 'cat /private/customer-secrets.txt' },
    });
    expect(result).toEqual({
      sessionId: common.session_id,
      event: {
        kind: 'toolStart',
        toolId: 'call-1',
        toolName: 'exec',
        status: 'Running command',
        input: undefined,
      },
    });
  });

  it('normalizes PostToolUse with matching id, duration, and inferred failure', () => {
    const result = codexProvider.normalizeHookEvent({
      ...common,
      hook_event_name: 'PostToolUse',
      turn_id: 'turn-1',
      tool_name: 'exec',
      tool_use_id: 'call-1',
      tool_response: {
        exit_code: 1,
        duration_ms: 42,
        output: 'private command output',
      },
    });
    expect(result).toEqual({
      sessionId: common.session_id,
      event: {
        kind: 'toolEnd',
        toolId: 'call-1',
        failed: true,
        status: 'Failed',
        durationMs: 42,
      },
    });
  });

  it('normalizes successful PostToolUse without retaining tool_response', () => {
    const result = codexProvider.normalizeHookEvent({
      ...common,
      hook_event_name: 'PostToolUse',
      tool_use_id: 'call-2',
      tool_response: { success: true, content: 'private response' },
    });
    expect(result?.event).toEqual({
      kind: 'toolEnd',
      toolId: 'call-2',
      failed: false,
      status: 'Completed',
      durationMs: undefined,
    });
  });

  it('normalizes PermissionRequest as the loud needs-input signal', () => {
    expect(
      codexProvider.normalizeHookEvent({
        ...common,
        hook_event_name: 'PermissionRequest',
        turn_id: 'turn-1',
        tool_name: 'apply_patch',
        tool_input: { patch: 'private patch body' },
        description: 'private approval description',
      })?.event,
    ).toEqual({
      kind: 'permissionRequest',
      toolName: 'apply_patch',
      status: 'Approval required for apply_patch',
    });
  });

  it('normalizes Stop without retaining last_assistant_message', () => {
    expect(
      codexProvider.normalizeHookEvent({
        ...common,
        hook_event_name: 'Stop',
        turn_id: 'turn-1',
        stop_hook_active: false,
        last_assistant_message: 'private final response',
      })?.event,
    ).toEqual({ kind: 'turnEnd' });
  });

  it('normalizes SubagentStart and SubagentStop with agent_id correlation', () => {
    expect(
      codexProvider.normalizeHookEvent({
        ...common,
        hook_event_name: 'SubagentStart',
        turn_id: 'turn-1',
        agent_id: 'agent-7',
        agent_type: 'explorer',
      })?.event,
    ).toEqual({
      kind: 'subagentStart',
      parentToolId: 'agent-7',
      toolId: 'agent-7',
      toolName: 'explorer',
      status: 'Subagent: explorer',
    });
    expect(
      codexProvider.normalizeHookEvent({
        ...common,
        hook_event_name: 'SubagentStop',
        turn_id: 'turn-1',
        agent_id: 'agent-7',
        agent_type: 'explorer',
        last_assistant_message: 'private subagent response',
      })?.event,
    ).toEqual({ kind: 'subagentEnd', parentToolId: 'agent-7', toolId: 'agent-7' });
  });

  it.each(['UserPromptSubmit', 'PreCompact', 'PostCompact'])(
    'ignores %s in v1',
    (hookEventName) => {
      expect(
        codexProvider.normalizeHookEvent({
          ...common,
          hook_event_name: hookEventName,
          turn_id: 'turn-1',
          prompt: 'private prompt body',
          trigger: 'auto',
        }),
      ).toBeNull();
    },
  );

  it('accepts the fallback lane synthetic SessionEnd', () => {
    expect(
      codexProvider.normalizeHookEvent({
        ...common,
        hook_event_name: 'SessionEnd',
        reason: 'idle-timeout',
      })?.event,
    ).toEqual({ kind: 'sessionEnd', reason: 'idle-timeout' });
  });

  it('never lets prompt, reasoning, command, patch, or response bodies survive normalization', () => {
    const secrets = [
      'PROMPT_SECRET',
      'REASONING_SECRET',
      'COMMAND_SECRET',
      'PATCH_SECRET',
      'RESPONSE_SECRET',
    ];
    const raw = {
      ...common,
      hook_event_name: 'PostToolUse',
      tool_name: 'exec',
      tool_use_id: 'privacy-call',
      prompt: secrets[0],
      reasoning: secrets[1],
      tool_input: { command: secrets[2], patch: secrets[3] },
      tool_response: { success: false, output: secrets[4] },
    };
    const serialized = JSON.stringify(codexProvider.normalizeHookEvent(raw));
    for (const secret of secrets) expect(serialized).not.toContain(secret);
  });

  it('formats exec, apply_patch, MCP, web, and read tools safely', () => {
    expect(codexProvider.formatToolStatus('exec')).toBe('Running command');
    expect(codexProvider.formatToolStatus('apply_patch')).toBe('Applying patch');
    expect(codexProvider.formatToolStatus('mcp__github__get_issue')).toBe(
      'Using MCP tool mcp__github__get_issue',
    );
    expect(codexProvider.formatToolStatus('web_search')).toBe('Searching the web');
    expect(codexProvider.formatToolStatus('read_file', { file: 'provider.ts' })).toBe(
      'Reading provider.ts',
    );
  });
});
