import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MEMORY_DISTILL_MAX_ITEMS } from '../src/constants.js';
import {
  carriesDistillSkipTag,
  DeterministicSessionDistiller,
  distillEndedSession,
  distillFromSessionEnd,
  readTranscriptTextLines,
  validateClientDistilledNote,
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

function validNote(sessionId: string, date: string) {
  return {
    sessionId,
    date,
    model: 'deterministic-v1',
    distilledAt: `${date}T12:00:00.000Z`,
    confidence: 'EXTRACTED' as const,
    decisions: [
      {
        topic: 'write mode',
        verdict: 'STAGED',
        sessionId,
        date,
        verbatim: 'Decision[write mode]: STAGED',
        lineNumber: 3,
      },
    ],
    facts: [
      { text: 'hooks are the trigger', verbatim: 'Fact: hooks are the trigger', lineNumber: 2 },
    ],
    openThreads: [],
    links: ['write mode'],
  };
}

describe('validateClientDistilledNote', () => {
  it('reconstructs a clean note from only known fields, forcing sessionId/date', () => {
    const raw = { ...validNote('client-claimed-session', '2020-01-01'), evil: 'field' };
    const result = validateClientDistilledNote(raw, 'trusted-session', '2026-07-13');
    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe('trusted-session');
    expect(result?.date).toBe('2026-07-13');
    expect(result?.decisions[0]?.sessionId).toBe('trusted-session');
    expect(result?.decisions[0]?.date).toBe('2026-07-13');
    expect(result).not.toHaveProperty('evil');
  });

  it('clamps decisions/facts/openThreads/links arrays to MEMORY_DISTILL_MAX_ITEMS', () => {
    const oversized = {
      ...validNote('sess', '2026-07-13'),
      decisions: Array.from({ length: MEMORY_DISTILL_MAX_ITEMS + 20 }, (_, i) => ({
        topic: `t${String(i)}`,
        verdict: `v${String(i)}`,
        sessionId: 'sess',
        date: '2026-07-13',
        verbatim: `Decision[t${String(i)}]: v${String(i)}`,
        lineNumber: i + 1,
      })),
      links: Array.from({ length: MEMORY_DISTILL_MAX_ITEMS + 20 }, (_, i) => `link-${String(i)}`),
    };
    const result = validateClientDistilledNote(oversized, 'sess', '2026-07-13');
    expect(result?.decisions).toHaveLength(MEMORY_DISTILL_MAX_ITEMS);
    expect(result?.links).toHaveLength(MEMORY_DISTILL_MAX_ITEMS);
  });

  it('rejects a payload that is not shaped like a note', () => {
    expect(validateClientDistilledNote('not an object', 'sess', '2026-07-13')).toBeNull();
    expect(validateClientDistilledNote(null, 'sess', '2026-07-13')).toBeNull();
    expect(validateClientDistilledNote({ model: 'x' }, 'sess', '2026-07-13')).toBeNull();
    expect(
      validateClientDistilledNote(
        { ...validNote('sess', '2026-07-13'), confidence: 'GUESSED' },
        'sess',
        '2026-07-13',
      ),
    ).toBeNull();
  });

  it('drops malformed individual items instead of rejecting the whole note', () => {
    const mixed = {
      ...validNote('sess', '2026-07-13'),
      decisions: [
        { topic: 'ok', verdict: 'ok-verdict', verbatim: 'v', lineNumber: 1 },
        { topic: 'bad', verdict: 123 }, // wrong type, dropped
      ],
    };
    const result = validateClientDistilledNote(mixed, 'sess', '2026-07-13');
    expect(result?.decisions).toHaveLength(1);
    expect(result?.decisions[0]?.topic).toBe('ok');
  });
});

describe('distillFromSessionEnd: V8 four (+skip) receipt paths', () => {
  it('path 1 -- client note present: validates and writes through the MemoryStore chokepoint', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    const result = distillFromSessionEnd({
      sessionId: 'session-client-note',
      transcriptPath: '', // hooks-only remote session -- client note bypasses this entirely
      model: 'deterministic-v1',
      now: Date.parse('2026-07-13T12:00:00Z'),
      store,
      clientDistill: { distilledNote: validNote('session-client-note', '2026-07-13') },
    });
    expect(result.outcome).toBe('written');
    const stagedDir = path.join(tmpDir, '_inbox', 'war-room-distill');
    expect(fs.readdirSync(stagedDir).some((f) => f.includes('session-client-note'))).toBe(true);
  });

  it('path 1b -- a malformed client note is rejected, never written, with a distinct reason', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    const result = distillFromSessionEnd({
      sessionId: 'session-bad-note',
      transcriptPath: '',
      model: 'deterministic-v1',
      now: Date.parse('2026-07-13T12:00:00Z'),
      store,
      clientDistill: { distilledNote: { not: 'a valid note shape' } },
    });
    expect(result).toMatchObject({ outcome: 'failed', reason: 'client-distill-failed' });
    const stagedDir = path.join(tmpDir, '_inbox', 'war-room-distill');
    expect(
      fs.existsSync(stagedDir) ? fs.readdirSync(stagedDir).filter((f) => f.endsWith('.md')) : [],
    ).toEqual([]);
  });

  it('client skip-tag marker records the same honest skip receipt as the server-local path', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    const result = distillFromSessionEnd({
      sessionId: 'session-client-skip',
      transcriptPath: '',
      model: 'deterministic-v1',
      now: Date.parse('2026-07-13T12:00:00Z'),
      store,
      clientDistill: { distillSkipped: true },
    });
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('skip-tag');
  });

  it('path 2 -- client failure marker: honest failure receipt, reason client-distill-failed', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    const result = distillFromSessionEnd({
      sessionId: 'session-client-failed',
      transcriptPath: '',
      model: 'deterministic-v1',
      now: Date.parse('2026-07-13T12:00:00Z'),
      store,
      clientDistill: { distillFailed: true, distillFailReason: 'no-transcript-path' },
    });
    expect(result).toMatchObject({ outcome: 'failed', reason: 'client-distill-failed' });
  });

  it('path 3 -- no client payload, transcriptPath present: unchanged server-local distill path', () => {
    writeTranscript(['Fact: server-local path still works']);
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    const result = distillFromSessionEnd({
      sessionId: 'session-server-local',
      transcriptPath,
      model: 'deterministic-v1',
      now: Date.parse('2026-07-13T12:00:00Z'),
      store,
    });
    expect(result.outcome).toBe('written');
  });

  it('path 4 -- no client payload, transcriptPath empty: transcript-unavailable, not the old generic reason', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    const result = distillFromSessionEnd({
      sessionId: 'session-remote-unavailable',
      transcriptPath: '',
      model: 'deterministic-v1',
      now: Date.parse('2026-07-13T12:00:00Z'),
      store,
    });
    expect(result).toMatchObject({ outcome: 'failed', reason: 'transcript-unavailable' });
  });

  it('is a no-op when the store is disabled, before any path is evaluated', () => {
    const store = new MemoryStore({ env: {}, notifyPromotion: () => undefined });
    const result = distillFromSessionEnd({
      sessionId: 'session-disabled',
      transcriptPath: '',
      model: 'deterministic-v1',
      store,
      clientDistill: { distilledNote: validNote('session-disabled', '2026-07-13') },
    });
    expect(result).toEqual({ outcome: 'disabled', receiptId: null });
  });
});
