import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DistilledNote } from '../src/memoryDistiller.js';
import { MemoryStore } from '../src/memoryStore.js';

let tmpDir: string;

function note(
  date: string,
  sessionId: string,
  overrides: Partial<DistilledNote> = {},
): DistilledNote {
  return {
    sessionId,
    date,
    model: 'deterministic-v1',
    distilledAt: `${date}T12:00:00.000Z`,
    confidence: 'EXTRACTED',
    decisions: [
      {
        topic: 'write mode',
        verdict: 'STAGED',
        sessionId,
        date,
        verbatim: 'Decision[write mode]: STAGED',
        lineNumber: 4,
      },
    ],
    facts: [{ text: 'The hook sees session end', verbatim: 'Fact: hook sees end', lineNumber: 5 }],
    openThreads: [{ text: 'Review after seven days', verbatim: 'Open: review', lineNumber: 6 }],
    links: ['write mode'],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-store-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('single write chokepoint', () => {
  it('the production singleton posture is disabled under VITEST unless a temp root is explicit', () => {
    const store = new MemoryStore({
      env: { VITEST: 'true', WAR_ROOM_VAULT_DIR: tmpDir },
      notifyPromotion: () => undefined,
    });
    expect(store.getStatus().enabled).toBe(false);
    expect(store.writeNote(note('2026-07-13', 'guarded'))).toEqual({
      outcome: 'disabled',
      receiptId: null,
    });
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it.each([
    ['finances-accounts', 'Fact: bank account balance is stable'],
    ['health-struggles', 'Fact: therapy helped with anxiety'],
    ['named-private-person', 'Fact: I spoke with Alice Smith yesterday'],
    ['named-private-person', 'Fact: my friend alice visited'],
    ['named-private-person', 'Fact: Alice Smith visited'],
  ])('quarantines %s without a markdown or sensitive ledger copy', (denyClass, sensitive) => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    const candidate = note('2026-07-13', `deny-${denyClass}`, {
      facts: [{ text: sensitive, verbatim: sensitive, lineNumber: 1 }],
    });
    const result = store.writeNote(candidate, Date.parse('2026-07-13T12:00:00Z'));
    expect(result).toMatchObject({ outcome: 'quarantined', reason: 'denylist-violation' });
    expect(result.denyClasses).toContain(denyClass);
    const stagedDir = path.join(tmpDir, '_inbox', 'war-room-distill');
    expect(fs.readdirSync(stagedDir).filter((file) => file.endsWith('.md'))).toEqual([]);
    const ledger = fs.readFileSync(path.join(stagedDir, '_ledger.jsonl'), 'utf8');
    expect(ledger).toContain(denyClass);
    expect(ledger).not.toContain(sensitive);
  });

  it('rejects malformed audit identity instead of sanitizing a filename', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    const result = store.writeNote(note('2026-07-13', '../escape'));
    expect(result).toMatchObject({ outcome: 'quarantined', reason: 'malformed-frontmatter' });
    expect(fs.existsSync(path.join(tmpDir, 'escape.md'))).toBe(false);
  });

  it('rejects impossible dates and malformed graph-link fields at the chokepoint', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    expect(store.writeNote(note('2026-02-31', 'bad-date'))).toMatchObject({
      outcome: 'quarantined',
      reason: 'malformed-frontmatter',
    });
    expect(
      store.writeNote(note('2026-02-28', 'bad-link', { links: ['topic]]\n# injected'] })),
    ).toMatchObject({ outcome: 'quarantined', reason: 'malformed-frontmatter' });
    expect(fs.existsSync(path.join(tmpDir, '_inbox', 'war-room-distill', 'bad-link.md'))).toBe(
      false,
    );
  });

  it('writes staged by default with citable audit frontmatter and an append-only ledger', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    const result = store.writeNote(note('2026-07-13', 'session-1'));
    expect(result.outcome).toBe('written');
    expect(result.path).toBe(
      path.join(tmpDir, '_inbox', 'war-room-distill', '2026-07-13-session-1.md'),
    );
    const markdown = fs.readFileSync(result.path as string, 'utf8');
    expect(markdown).toContain('status: staged');
    expect(markdown).toContain('session_id: "session-1"');
    expect(markdown).toContain('distilled_by: "deterministic-v1"');
    expect(markdown).toContain('verbatim: "Decision[write mode]: STAGED"');
    expect(markdown).toContain('**[[write mode]]**');
    const ledgerLines = fs
      .readFileSync(path.join(tmpDir, '_inbox', 'war-room-distill', '_ledger.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { action: string; receiptId: string });
    expect(ledgerLines.map((entry) => entry.action)).toEqual(['write-planned', 'written']);
    expect(ledgerLines[0]?.receiptId).toBe(ledgerLines[1]?.receiptId);
  });

  it('a repeated session end is receipted and never overwrites the existing note', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    const first = store.writeNote(note('2026-07-13', 'session-repeat'));
    const firstText = fs.readFileSync(first.path as string, 'utf8');
    const second = store.writeNote(
      note('2026-07-13', 'session-repeat', {
        facts: [{ text: 'different retry body', verbatim: 'Fact: retry', lineNumber: 8 }],
      }),
    );
    expect(second).toMatchObject({ outcome: 'skipped', reason: 'already-written' });
    expect(fs.readFileSync(first.path as string, 'utf8')).toBe(firstText);
  });
});

describe('clean-day promotion and revocation', () => {
  it('counts consecutive calendar days, is idempotent per day, and resets on a later same-day bad write', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    store.writeNote(note('2026-07-13', 'session-a'));
    store.writeNote(note('2026-07-13', 'session-b'));
    expect(store.getState().cleanDayCount).toBe(1);
    store.writeNote(note('2026-07-14', 'session-c'));
    expect(store.getState().cleanDayCount).toBe(2);
    const bad = note('2026-07-14', 'session-bad', {
      facts: [{ text: 'bank account', verbatim: 'Fact: bank account', lineNumber: 1 }],
    });
    store.writeNote(bad);
    expect(store.getState()).toMatchObject({
      cleanDayCount: 0,
      lastOutcomeClean: false,
      lastBadReason: 'denylist-violation',
    });
  });

  it('a gap is not a consecutive clean day', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    store.writeNote(note('2026-07-13', 'session-a'));
    store.writeNote(note('2026-07-15', 'session-b'));
    expect(store.getState().cleanDayCount).toBe(1);
  });

  it('defaults STAGED, promotes only on the seventh clean day, announces once, and revokes instantly', () => {
    const announce = vi.fn();
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: announce });
    expect(store.getState().mode).toBe('staged');
    expect(store.promoteIfEligible()).toEqual({ ok: false, reason: 'not-eligible' });

    for (let day = 13; day <= 19; day++) {
      const date = `2026-07-${String(day)}`;
      store.writeNote(note(date, `session-${String(day)}`), Date.parse(`${date}T12:00:00Z`));
    }
    expect(store.getState()).toMatchObject({ mode: 'direct', cleanDayCount: 7 });
    expect(announce).toHaveBeenCalledTimes(1);
    const promotionEntries = fs
      .readFileSync(path.join(tmpDir, '_inbox', 'war-room-distill', '_ledger.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { action: string; receiptId: string })
      .filter((entry) => entry.action.includes('promot'));
    expect(promotionEntries.map((entry) => entry.action)).toEqual([
      'promotion-planned',
      'promoted',
    ]);
    expect(promotionEntries[0]?.receiptId).toBe(promotionEntries[1]?.receiptId);

    const direct = store.writeNote(note('2026-07-20', 'session-direct'));
    expect(direct.path).toContain(path.join('Memory', 'War Room Distill'));
    expect(store.revokeDirect(Date.parse('2026-07-20T13:00:00Z'))).toEqual({
      ok: true,
      changed: true,
    });
    expect(store.getState().mode).toBe('staged');
    expect(store.getState().cleanDayCount).toBe(0);
    const stagedAgain = store.writeNote(note('2026-07-21', 'session-revoked'));
    expect(stagedAgain.path).toContain(path.join('_inbox', 'war-room-distill'));
  });

  it('confirmed-wrong and Greg-revert outcomes reset the counter with receipts', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    store.writeNote(note('2026-07-13', 'session-a'));
    expect(store.recordBadOutcome('greg-revert', '2026-07-14')).toEqual({ ok: true });
    expect(store.getState()).toMatchObject({ cleanDayCount: 0, lastBadReason: 'greg-revert' });
    store.writeNote(note('2026-07-15', 'session-b'));
    store.recordBadOutcome('contradiction-confirmed-wrong', '2026-07-16');
    expect(store.getState()).toMatchObject({
      cleanDayCount: 0,
      lastBadReason: 'contradiction-confirmed-wrong',
    });
  });
});

describe('decision index and recall', () => {
  it('indexes receipts and flags same-topic conflicting verdicts without deleting either', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    store.writeNote(note('2026-07-13', 'session-a'));
    store.writeNote(
      note('2026-07-14', 'session-b', {
        decisions: [
          {
            topic: 'write mode',
            verdict: 'DIRECT',
            sessionId: 'session-b',
            date: '2026-07-14',
            verbatim: 'Decision[write mode]: DIRECT',
            lineNumber: 7,
          },
        ],
      }),
    );
    const lane = store.searchDecisions('write mode', Date.parse('2026-07-15T00:00:00Z'));
    expect(lane.available).toBe(true);
    expect(lane.matches[0]).toMatchObject({
      topic: 'write mode',
      answer: 'DIRECT',
      contradiction: true,
      competingAnswers: ['STAGED'],
    });
    expect(lane.matches[0]?.receipts.map((receipt) => receipt.sessionId)).toEqual([
      'session-b',
      'session-a',
    ]);
    const newerMarkdown = fs.readFileSync(
      path.join(tmpDir, '_inbox', 'war-room-distill', '2026-07-14-session-b.md'),
      'utf8',
    );
    expect(newerMarkdown).toContain('⚑ CONTRADICTION');
    expect(
      store.searchDecisions(
        'What did we decide about write mode?',
        Date.parse('2026-07-15T00:00:00Z'),
      ).matches[0]?.answer,
    ).toBe('DIRECT');
  });

  it('marks an unreconfirmed decision stale after the centralized threshold', () => {
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    store.writeNote(note('2026-01-01', 'session-old'), Date.parse('2026-01-01T12:00:00Z'));
    expect(
      store.searchDecisions('write', Date.parse('2026-05-01T12:00:00Z')).matches[0]?.stale,
    ).toBe(true);
  });
});
