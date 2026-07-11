import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ANSWER_TEXT_MAX_CHARS,
  answerStatusLabel,
  fetchAnswerReceipts,
  parseAnswerOptions,
  pollAnswerOutcome,
  requestAnswer,
} from '../src/net/answerFacts';

describe('parseAnswerOptions (defensive AskUserQuestion-style parse)', () => {
  it('parses a numbered option list, stripping the numbering', () => {
    const waitingFor = 'Approve the migration?\n1. Yes, apply it\n2. No, skip\n3. Show me the diff';
    expect(parseAnswerOptions(waitingFor)).toEqual([
      'Yes, apply it',
      'No, skip',
      'Show me the diff',
    ]);
  });

  it('accepts ")" numbering too', () => {
    expect(parseAnswerOptions('1) yes\n2) no')).toEqual(['yes', 'no']);
  });

  it('falls back to [] (free-text only) when fewer than 2 option lines are found', () => {
    expect(parseAnswerOptions('Approve? (y/n)')).toEqual([]);
    expect(parseAnswerOptions('1. only one option')).toEqual([]);
  });

  it('falls back to [] for undefined/empty input — never invents options', () => {
    expect(parseAnswerOptions(undefined)).toEqual([]);
    expect(parseAnswerOptions('')).toEqual([]);
  });
});

describe('answerStatusLabel', () => {
  it('renders glyph + word, reason appended only when present', () => {
    expect(answerStatusLabel('pending')).toBe('… DELIVERING');
    expect(answerStatusLabel('delivered')).toBe('✓ DELIVERED');
    expect(answerStatusLabel('denied')).toBe('✗ FAILED');
    expect(answerStatusLabel('denied', 'session-dead')).toBe('✗ FAILED — session-dead');
  });
});

describe('ANSWER_TEXT_MAX_CHARS', () => {
  it('mirrors the server cap', () => {
    expect(ANSWER_TEXT_MAX_CHARS).toBe(4000);
  });
});

describe('wire helpers (fetch mocked)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requestAnswer posts { machine, pid, text } and returns the parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, id: 'req-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await requestAnswer('MACBOOK', 812, 'yes, apply it');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/answer',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ machine: 'MACBOOK', pid: 812, text: 'yes, apply it' }),
      }),
    );
    expect(result).toEqual({ ok: true, id: 'req-1' });
  });

  it('requestAnswer reports a failure honestly on a thrown fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await requestAnswer('MACBOOK', 812, 'x')).toEqual({
      ok: false,
      reason: 'request failed',
    });
  });

  it('pollAnswerOutcome returns null on a non-ok response or thrown fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await pollAnswerOutcome('req-1')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await pollAnswerOutcome('req-1')).toBeNull();
  });

  it('pollAnswerOutcome returns the parsed outcome on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'delivered' }) }),
    );
    expect(await pollAnswerOutcome('req-1')).toEqual({ status: 'delivered' });
  });

  it('fetchAnswerReceipts returns [] honestly on failure, the array on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchAnswerReceipts('MACBOOK')).toEqual([]);

    const receipt = {
      id: 'a-1',
      machine: 'MACBOOK',
      managedSessionRef: 'd-1',
      text: 'yes',
      status: 'delivered' as const,
      createdAt: 0,
      updatedAt: 0,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ answers: [receipt] }) }),
    );
    expect(await fetchAnswerReceipts('MACBOOK')).toEqual([receipt]);
  });
});
