/**
 * Transcript output tap (KICKOFF-v2.0 Phase 2 — streaming plane, slice 2.4;
 * DISPATCH-6B-DESIGN amendment #2).
 *
 * Feeds the lines fileWatcher.ts's readNewLines() already tails (500ms JSONL
 * poll) into the output ring buffer as `{source:'agent', id:<agent id>,
 * stream:'transcript'}` chunks — a compact, human-readable live tail of what
 * the agent is saying and doing:
 *
 *   - assistant TEXT blocks: verbatim
 *   - assistant TOOL_USE blocks: one-liners like `● Bash(npm test)`
 *
 * This is TELEMETRY ONLY and a purely ADDITIVE tap: it never mutates agent
 * state, never emits agent-plane broadcasts, and never changes
 * fileWatcher.ts/transcriptParser.ts behavior (/clear detection, timers,
 * events are untouched — the tap runs beside processTranscriptLine, not
 * inside it). It parses its own copy of the line and swallows every error,
 * so a malformed record can never break the poll loop.
 *
 * The ring `id` is the webview-facing NUMERIC agent id, stringified — the
 * same id every agent-plane ServerMessage (agentCreated, agentStatus, …)
 * carries, so a tailSubscribe client needs no session-id lookup. The stream
 * is evicted when the agent is removed (httpServer.ts subscribes to the
 * store's 'agentRemoved' — the single choke point every removal path
 * funnels through). Adopt-from-start / resume replays flow through
 * readNewLines too; the ring's per-stream byte budget bounds them, and a
 * late subscriber simply sees the retained tail (truncated:true).
 */

import * as path from 'path';

import { outputRingStore } from './outputRingStore.js';

/** Longest rendered argument inside a tool one-liner. */
const TOOL_ARG_DISPLAY_MAX_LENGTH = 120;

interface ContentBlock {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  input?: unknown;
}

/** Squash a tool argument onto one line and cap its length. */
function oneLineArg(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > TOOL_ARG_DISPLAY_MAX_LENGTH
    ? `${flat.slice(0, TOOL_ARG_DISPLAY_MAX_LENGTH)}…`
    : flat;
}

/** The primary human-readable argument of a tool call, or '' if none. */
function toolPrimaryArg(toolName: string, input: Record<string, unknown>): string {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const base = (v: unknown): string => (typeof v === 'string' ? path.basename(v) : '');
  switch (toolName) {
    case 'Bash':
      return str(input.command);
    case 'Read':
    case 'Edit':
    case 'Write':
      return base(input.file_path);
    case 'NotebookEdit':
      return base(input.notebook_path);
    case 'Glob':
    case 'Grep':
      return str(input.pattern);
    case 'WebFetch':
      return str(input.url);
    case 'WebSearch':
      return str(input.query);
    case 'Task':
    case 'Agent':
      return str(input.description);
    default: {
      // Best-effort: first string-valued input property, so unknown/MCP
      // tools still render something meaningful.
      for (const value of Object.values(input)) {
        if (typeof value === 'string') return value;
      }
      return '';
    }
  }
}

/**
 * Render one transcript JSONL line to compact tail text, or undefined when
 * the line carries nothing tail-worthy (non-assistant records, malformed
 * JSON, assistant records without text/tool_use blocks).
 */
export function renderTranscriptLine(line: string): string | undefined {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (record === null || typeof record !== 'object' || record.type !== 'assistant') {
    return undefined;
  }

  // Same resilient content extraction as transcriptParser.ts: support both
  // record.message.content and record.content across Claude Code versions.
  const message = record.message as Record<string, unknown> | undefined;
  const content = message?.content ?? record.content;

  if (typeof content === 'string') {
    return content.trim() === '' ? undefined : content;
  }
  if (!Array.isArray(content)) return undefined;

  const rendered: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      rendered.push(block.text);
    } else if (block.type === 'tool_use' && typeof block.name === 'string' && block.name !== '') {
      const input =
        block.input !== null && typeof block.input === 'object'
          ? (block.input as Record<string, unknown>)
          : {};
      const arg = oneLineArg(toolPrimaryArg(block.name, input));
      rendered.push(arg === '' ? `● ${block.name}` : `● ${block.name}(${arg})`);
    }
  }
  if (rendered.length === 0) return undefined;
  return rendered.join('\n');
}

/**
 * Tap one transcript line into the output ring. Never throws — a tap
 * failure must never reach the poll loop feeding it.
 */
export function tapTranscriptLine(agentId: number, line: string): void {
  try {
    const rendered = renderTranscriptLine(line);
    if (rendered === undefined) return;
    outputRingStore.append('agent', String(agentId), 'transcript', `${rendered}\n`);
  } catch {
    // Telemetry only: swallow everything.
  }
}
