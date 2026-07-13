import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  carriesDistillSkipTag,
  DeterministicSessionDistiller,
  distillEndedSession,
  readTranscriptTextLines,
} from '../src/memoryDistiller.js';
import { MemoryStore } from '../src/memoryStore.js';

let tmpDir: string;
let transcriptPath: string;

function writeTranscript(userLines: string[], assistantLines: string[] = []): void {
  const records = [
    ...userLines.map((text) => ({ type: 'user', message: { content: text } })),
    ...assistantLines.map((text) => ({
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
    })),
  ];
  fs.writeFileSync(transcriptPath, records.map((record) => JSON.stringify(record)).join('\n'));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-distiller-'));
  transcriptPath = path.join(tmpDir, 'session.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('transcript extraction and deterministic fallback', () => {
  it('reads text blocks tolerantly and preserves JSONL line receipts', () => {
    fs.writeFileSync(
      transcriptPath,
      [
        '{broken',
        JSON.stringify({ type: 'user', message: { content: 'Fact: hooks are the trigger' } }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Decision[write mode]: STAGED' }] },
        }),
      ].join('\n'),
    );
    const lines = readTranscriptTextLines(transcriptPath);
    expect(lines).toEqual([
      { lineNumber: 2, role: 'user', text: 'Fact: hooks are the trigger' },
      { lineNumber: 3, role: 'assistant', text: 'Decision[write mode]: STAGED' },
    ]);

    const note = new DeterministicSessionDistiller().distill(lines, {
      sessionId: 'session-1',
      date: '2026-07-13',
      model: 'deterministic-v1',
      distilledAt: '2026-07-13T12:00:00.000Z',
    });
    expect(note.decisions[0]).toMatchObject({
      topic: 'write mode',
      verdict: 'STAGED',
      verbatim: 'Decision[write mode]: STAGED',
      lineNumber: 3,
    });
    expect(note.facts[0]?.text).toBe('hooks are the trigger');
    expect(note.links).toEqual(['write mode']);
  });

  it('honors the skip tag only in user-authored lines', () => {
    expect(
      carriesDistillSkipTag([
        { lineNumber: 1, role: 'assistant', text: 'Mention #wr-skip-distill in docs' },
      ]),
    ).toBe(false);
    expect(
      carriesDistillSkipTag([
        { lineNumber: 1, role: 'user', text: 'Please stop #WR-SKIP-DISTILL' },
      ]),
    ).toBe(true);
  });
});

describe('distillEndedSession', () => {
  it('receipts a skip tag and writes no note', () => {
    writeTranscript(['first prompt', '#wr-skip-distill']);
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    const result = distillEndedSession({
      sessionId: 'session-skip',
      transcriptPath,
      model: 'claude',
      now: Date.parse('2026-07-13T12:00:00Z'),
      store,
    });
    expect(result.outcome).toBe('skipped');
    const stagedDir = path.join(tmpDir, '_inbox', 'war-room-distill');
    expect(fs.readdirSync(stagedDir).filter((file) => file.endsWith('.md'))).toEqual([]);
    expect(fs.readFileSync(path.join(stagedDir, '_ledger.jsonl'), 'utf8')).toContain('skip-tag');
  });

  it('unset vault env disables before transcript access, including a nonexistent path', () => {
    const store = new MemoryStore({ env: {}, notifyPromotion: () => undefined });
    const result = distillEndedSession({
      sessionId: 'session-disabled',
      transcriptPath: path.join(tmpDir, 'does-not-exist.jsonl'),
      model: 'claude',
      store,
    });
    expect(result).toEqual({ outcome: 'disabled', receiptId: null });
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('an unwritable/malformed configured root fails honestly without escaping session end', () => {
    const notADirectory = path.join(tmpDir, 'vault-is-a-file');
    fs.writeFileSync(notADirectory, 'not a directory');
    writeTranscript(['Fact: safe content']);
    const store = new MemoryStore({
      vaultRoot: notADirectory,
      notifyPromotion: () => undefined,
    });
    expect(() =>
      distillEndedSession({
        sessionId: 'session-bad-root',
        transcriptPath,
        model: 'deterministic-v1',
        store,
      }),
    ).not.toThrow();
    expect(
      distillEndedSession({
        sessionId: 'session-bad-root',
        transcriptPath,
        model: 'deterministic-v1',
        store,
      }),
    ).toMatchObject({ outcome: 'failed', reason: 'audit-ledger-unavailable' });
  });
});
