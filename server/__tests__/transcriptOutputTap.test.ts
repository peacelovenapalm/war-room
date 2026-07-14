/**
 * Slice 2.4 (KICKOFF-v2.0 Phase 2) — local JSONL source for the output ring.
 *
 * Three planes, mirroring how the tap is wired in production:
 *   1. renderTranscriptLine unit coverage (compact rendering rules).
 *   2. readNewLines integration against REAL JSONL fixture files on disk —
 *      proving new assistant-text/tool-use lines land in the ring as
 *      {source:'agent', id:String(agentId), stream:'transcript'} chunks with
 *      correct seq, AND that pre-existing fileWatcher/transcriptParser
 *      behavior (line accounting, tool broadcasts, offset tracking) is
 *      untouched by the tap.
 *   3. Ring eviction when the agent is removed (httpServer's 'agentRemoved'
 *      subscription — the single choke point every removal path funnels
 *      through).
 *
 * outputRingStore is a process-wide singleton — every test uses a unique
 * numeric agent id and evicts it afterwards.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// fileWatcher.ts does `import * as vscode from 'vscode'` at module load; stub
// the APIs it touches so the module loads under vitest (same as
// fileWatcherDismissal.test.ts).
vi.mock('vscode', () => ({
  window: {
    activeTerminal: undefined,
    terminals: [],
  },
}));

// Isolated temp HOME for the eviction test's real server (it persists state
// under ~/.pixel-agents/ by default) — same rationale as tailSubscription.test.ts.
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { AgentStateStore } = await import('../src/agentStateStore.js');
const { OUTPUT_CHUNK_APPEND_BYTE_BUDGET } = await import('../src/constants.js');
const { readNewLines } = await import('../src/fileWatcher.js');
const { outputRingStore } = await import('../src/outputRingStore.js');
const { PixelAgentsServer } = await import('../src/server.js');
const { renderTranscriptLine, tapTranscriptLine } = await import('../src/transcriptOutputTap.js');

import type { AgentState as AgentStateType } from '../src/types.js';

/** Unique-per-test numeric agent ids so singleton ring state never collides. */
let nextTestAgentId = 910_000;
const usedAgentIds: number[] = [];

function newAgentId(): number {
  const id = nextTestAgentId++;
  usedAgentIds.push(id);
  return id;
}

function makeAgent(id: number, jsonlFile: string): AgentStateType {
  return {
    id,
    sessionId: path.basename(jsonlFile, '.jsonl'),
    terminalRef: undefined,
    isExternal: true,
    projectDir: path.dirname(jsonlFile),
    jsonlFile,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    hookDelivered: false,
    lastDataAt: Date.now(),
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    inputTokens: 0,
    outputTokens: 0,
  };
}

const assistantText = (text: string) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

const assistantUsage = (text: string, inputTokens: number, outputTokens: number) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: {
      content: [{ type: 'text', text }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    },
  });

const assistantTool = (name: string, input: Record<string, unknown>) =>
  JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: `toolu_${name}`, name, input }] },
  });

describe('renderTranscriptLine (unit)', () => {
  it('renders assistant text blocks verbatim', () => {
    expect(renderTranscriptLine(assistantText('Deploy looks clean.'))).toBe('Deploy looks clean.');
  });

  it('renders a string-content assistant record verbatim', () => {
    expect(
      renderTranscriptLine(JSON.stringify({ type: 'assistant', content: 'plain reply' })),
    ).toBe('plain reply');
  });

  it('renders tool_use blocks as one-liners like "● Bash(npm test)"', () => {
    expect(renderTranscriptLine(assistantTool('Bash', { command: 'npm test' }))).toBe(
      '● Bash(npm test)',
    );
    expect(
      renderTranscriptLine(assistantTool('Read', { file_path: '/very/deep/path/notes.md' })),
    ).toBe('● Read(notes.md)');
    expect(renderTranscriptLine(assistantTool('Glob', { pattern: '**/*.ts' }))).toBe(
      '● Glob(**/*.ts)',
    );
    expect(renderTranscriptLine(assistantTool('EnterPlanMode', {}))).toBe('● EnterPlanMode');
  });

  it('joins mixed text + tool blocks with newlines, in block order', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Running the suite now.' },
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } },
        ],
      },
    });
    expect(renderTranscriptLine(line)).toBe('Running the suite now.\n● Bash(npm test)');
  });

  it('squashes multi-line tool args onto one line and truncates long ones', () => {
    const longCmd = `echo start\n${'x'.repeat(300)}`;
    const rendered = renderTranscriptLine(assistantTool('Bash', { command: longCmd }));
    expect(rendered).toMatch(/^● Bash\(echo start x+…\)$/);
    expect(rendered!.length).toBeLessThan(140);
    expect(rendered).not.toContain('\n');
  });

  it('returns undefined for non-assistant records, empty content, and malformed JSON', () => {
    expect(renderTranscriptLine(JSON.stringify({ type: 'user', message: { content: 'hi' } }))).toBe(
      undefined,
    );
    expect(renderTranscriptLine(JSON.stringify({ type: 'system', subtype: 'turn_duration' }))).toBe(
      undefined,
    );
    expect(renderTranscriptLine(JSON.stringify({ type: 'assistant', message: {} }))).toBe(
      undefined,
    );
    expect(
      renderTranscriptLine(
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '  ' }] } }),
      ),
    ).toBe(undefined);
    expect(renderTranscriptLine('{not json')).toBe(undefined);
  });

  it('tapTranscriptLine never throws, even on garbage', () => {
    const id = newAgentId();
    expect(() => tapTranscriptLine(id, '{broken')).not.toThrow();
    expect(() => tapTranscriptLine(id, JSON.stringify(null))).not.toThrow();
    expect(outputRingStore.replay('agent', String(id))).toEqual([]);
  });
});

describe('readNewLines → ring integration (real JSONL fixtures)', () => {
  let tmpDir: string;
  let agents: InstanceType<typeof AgentStateStore>;
  let waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  let permissionTimers: Map<number, ReturnType<typeof setTimeout>>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-tap-home-'));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-tap-test-'));
    agents = new AgentStateStore();
    waitingTimers = new Map();
    permissionTimers = new Map();
  });

  afterEach(() => {
    for (const t of waitingTimers.values()) clearTimeout(t);
    for (const t of permissionTimers.values()) clearTimeout(t);
    for (const id of usedAgentIds.splice(0)) outputRingStore.evict('agent', String(id));
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  function seedAgentWithFile(lines: string[]): { id: number; file: string } {
    const id = newAgentId();
    const file = path.join(tmpDir, `${id}.jsonl`);
    fs.writeFileSync(file, lines.map((l) => `${l}\n`).join(''));
    agents.set(id, makeAgent(id, file));
    return { id, file };
  }

  it('coalesces assistant text and tool-use lines from one poll into one ring chunk', () => {
    const { id } = seedAgentWithFile([
      assistantText('Starting the fix.'),
      JSON.stringify({ type: 'user', message: { content: 'do it' } }),
      assistantTool('Bash', { command: 'npm test' }),
    ]);

    readNewLines(id, agents, waitingTimers, permissionTimers);

    const chunks = outputRingStore.replay('agent', String(id));
    expect(chunks.map((c) => c.chunk)).toEqual(['Starting the fix.\n● Bash(npm test)\n']);
    expect(chunks.map((c) => c.seq)).toEqual([0]);
    expect(chunks.every((c) => c.source === 'agent' && c.stream === 'transcript')).toBe(true);
    expect(chunks.every((c) => c.id === String(id))).toBe(true);
  });

  it('splits a large coalesced poll without losing its content or older retained history', () => {
    const olderChunk = 'already retained\n';
    const largeTexts = [
      `first:${'🙂'.repeat(4_500)}`,
      `second:${'界'.repeat(6_000)}`,
      `third:${'é'.repeat(9_000)}`,
    ];
    const expectedBatch = largeTexts.map((text) => `${text}\n`).join('');
    expect(Buffer.byteLength(expectedBatch, 'utf8')).toBeGreaterThan(
      OUTPUT_CHUNK_APPEND_BYTE_BUDGET,
    );
    const { id } = seedAgentWithFile(largeTexts.map(assistantText));
    outputRingStore.append('agent', String(id), 'transcript', olderChunk);

    readNewLines(id, agents, waitingTimers, permissionTimers);

    const replay = outputRingStore.replay('agent', String(id));
    const batchChunks = replay.slice(1);
    expect(batchChunks.length).toBeGreaterThan(1);
    expect(
      batchChunks.every(
        (chunk) => Buffer.byteLength(chunk.chunk, 'utf8') <= OUTPUT_CHUNK_APPEND_BYTE_BUDGET,
      ),
    ).toBe(true);
    expect(batchChunks.map((chunk) => chunk.chunk).join('')).toBe(expectedBatch);
    expect(replay.map((chunk) => chunk.chunk).join('')).toBe(`${olderChunk}${expectedBatch}`);
    expect(replay[0]).toMatchObject({ chunk: olderChunk, seq: 0, truncated: false });
    expect(replay.map((chunk) => chunk.seq)).toEqual(replay.map((_, index) => index));
  });

  it('broadcasts only the final token total for a multi-record poll', () => {
    const broadcasts: Array<Record<string, unknown>> = [];
    agents.on('broadcast', (message) => broadcasts.push(message));
    const { id } = seedAgentWithFile([
      assistantUsage('inspect', 100, 10),
      assistantUsage('edit', 200, 20),
      assistantUsage('test', 300, 30),
      assistantUsage('report', 400, 40),
    ]);

    readNewLines(id, agents, waitingTimers, permissionTimers);

    expect(outputRingStore.replay('agent', String(id)).map((chunk) => chunk.chunk)).toEqual([
      'inspect\nedit\ntest\nreport\n',
    ]);
    expect(broadcasts.filter((message) => message.type === 'agentTokenUsage')).toEqual([
      { type: 'agentTokenUsage', id, inputTokens: 1_000, outputTokens: 100 },
    ]);
  });

  it('appends across successive polls with a monotonic seq (only NEW lines land)', () => {
    const { id, file } = seedAgentWithFile([assistantText('first')]);
    readNewLines(id, agents, waitingTimers, permissionTimers);
    expect(outputRingStore.replay('agent', String(id)).map((c) => c.chunk)).toEqual(['first\n']);

    fs.appendFileSync(file, `${assistantText('second')}\n`);
    readNewLines(id, agents, waitingTimers, permissionTimers);

    const chunks = outputRingStore.replay('agent', String(id));
    expect(chunks.map((c) => c.chunk)).toEqual(['first\n', 'second\n']);
    expect(chunks.map((c) => c.seq)).toEqual([0, 1]);
  });

  it('does NOT change pre-existing behavior: parser state and tool broadcasts still flow', () => {
    const broadcasts: Array<Record<string, unknown>> = [];
    agents.on('broadcast', (m) => broadcasts.push(m));
    const { id } = seedAgentWithFile([
      assistantText('thinking'),
      assistantTool('Bash', { command: 'npm test' }),
    ]);

    readNewLines(id, agents, waitingTimers, permissionTimers);

    const agent = agents.get(id)!;
    // transcriptParser accounting untouched by the tap:
    expect(agent.linesProcessed).toBe(2);
    expect(agent.fileOffset).toBeGreaterThan(0);
    expect(agent.activeToolIds.has('toolu_Bash')).toBe(true);
    // agentToolStart broadcast still emitted exactly as before:
    const toolStart = broadcasts.find((b) => b.type === 'agentToolStart');
    expect(toolStart).toMatchObject({ id, toolId: 'toolu_Bash', toolName: 'Bash' });
  });

  it('malformed and non-assistant lines produce no chunks but still count as processed', () => {
    const { id } = seedAgentWithFile([
      '{broken json',
      JSON.stringify({ type: 'system', subtype: 'turn_duration' }),
    ]);

    readNewLines(id, agents, waitingTimers, permissionTimers);

    expect(outputRingStore.replay('agent', String(id))).toEqual([]);
    expect(agents.get(id)!.linesProcessed).toBe(2);
  });

  it('evicts the agent stream when the agent is removed (agentRemoved choke point)', async () => {
    const store = new AgentStateStore();
    const server = new PixelAgentsServer();
    await server.start({ embedded: false, store });
    try {
      const { id } = seedAgentWithFile([assistantText('short-lived')]);
      const agent = agents.get(id)!;
      store.set(id, agent);
      readNewLines(id, agents, waitingTimers, permissionTimers);
      expect(outputRingStore.replay('agent', String(id))).toHaveLength(1);

      store.delete(id);
      expect(outputRingStore.replay('agent', String(id))).toEqual([]);
    } finally {
      server.stop();
    }
  });
});
