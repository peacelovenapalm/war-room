/**
 * V7 memory write chokepoint and staged-promotion state.
 *
 * Every caller must pass through writeNote(). It applies the code-level hard
 * denylist to every human-derived field before rendering, then writes only to
 * the env-rooted vault. WAR_ROOM_VAULT_DIR unset means the whole path is
 * honestly disabled: no homedir fallback and no read or write side effect.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import {
  MEMORY_DECISION_STALE_DAYS,
  MEMORY_DECISIONS_FILE_NAME,
  MEMORY_DIRECT_RELATIVE_DIR,
  MEMORY_LEDGER_FILE_NAME,
  MEMORY_PROMOTION_CLEAN_DAYS,
  MEMORY_STAGED_RELATIVE_DIR,
  MEMORY_STATE_FILE_NAME,
} from './constants.js';
import { inspectMemoryText, type MemoryDenyClass } from './memoryDenylist.js';
import type { DecisionReceipt, DistilledNote } from './memoryDistiller.js';
import { notifyBigMoment } from './notifyBark.js';

export type MemoryMode = 'staged' | 'direct';
export type MemoryBadOutcome =
  'denylist-violation' | 'malformed-frontmatter' | 'contradiction-confirmed-wrong' | 'greg-revert';

export interface MemoryState {
  mode: MemoryMode;
  cleanDayCount: number;
  lastOutcomeDate: string | null;
  lastOutcomeClean: boolean | null;
  lastBadReason: MemoryBadOutcome | null;
  lastBadAt: string | null;
  promotedAt: string | null;
  revokedAt: string | null;
}

export interface MemoryWriteResult {
  outcome: 'disabled' | 'written' | 'quarantined' | 'skipped' | 'failed';
  receiptId: string | null;
  path?: string;
  reason?: string;
  denyClasses?: MemoryDenyClass[];
}

export interface MemoryLedgerEntry {
  receiptId: string;
  ts: string;
  action:
    | 'write-planned'
    | 'written'
    | 'quarantined'
    | 'skipped'
    | 'failed'
    | 'promotion-planned'
    | 'promoted'
    | 'revocation-planned'
    | 'revoked'
    | 'bad-outcome';
  sessionId?: string;
  date?: string;
  mode?: MemoryMode;
  relativePath?: string;
  reason?: string;
  denyClasses?: MemoryDenyClass[];
}

interface DecisionIndexEntry extends DecisionReceipt {
  receiptId: string;
  notePath: string;
  recordedAt: string;
  contradicts: string[];
}

export interface DecisionSearchReceipt {
  receiptId: string;
  sessionId: string;
  date: string;
  verbatim: string;
  lineNumber: number;
  notePath: string;
}

export interface DecisionSearchMatch {
  topic: string;
  answer: string;
  receipts: DecisionSearchReceipt[];
  stale: boolean;
  contradiction: boolean;
  competingAnswers: string[];
}

export interface DecisionSearchLane {
  available: boolean;
  matches: DecisionSearchMatch[];
}

function emptyState(): MemoryState {
  return {
    mode: 'staged',
    cleanDayCount: 0,
    lastOutcomeDate: null,
    lastOutcomeClean: null,
    lastBadReason: null,
    lastBadAt: null,
    promotedAt: null,
    revokedAt: null,
  };
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isSafeSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

function nextCalendarDay(previous: string, current: string): boolean {
  const dayMs = 24 * 60 * 60_000;
  return Date.parse(`${current}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`) === dayMs;
}

function normalizeDecision(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function noteSensitiveText(note: DistilledNote): string {
  return [
    ...note.decisions.flatMap((decision) => [decision.topic, decision.verdict, decision.verbatim]),
    ...note.facts.flatMap((fact) => [fact.text, fact.verbatim]),
    ...note.openThreads.flatMap((thread) => [thread.text, thread.verbatim]),
    ...note.links,
  ].join('\n');
}

function noteShapeValid(note: DistilledNote): boolean {
  if (!isSafeSessionId(note.sessionId) || !isDate(note.date)) return false;
  if (
    typeof note.model !== 'string' ||
    note.model.trim() === '' ||
    typeof note.distilledAt !== 'string' ||
    !Number.isFinite(Date.parse(note.distilledAt))
  ) {
    return false;
  }
  if (note.confidence !== 'EXTRACTED') return false;
  if (
    !Array.isArray(note.decisions) ||
    !Array.isArray(note.facts) ||
    !Array.isArray(note.openThreads) ||
    !Array.isArray(note.links)
  ) {
    return false;
  }
  const safeLine = (value: unknown): value is string =>
    typeof value === 'string' && value.trim() !== '' && !/[\r\n\0]/.test(value);
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;
  return (
    note.decisions.every(
      (decision) =>
        record(decision) &&
        decision.sessionId === note.sessionId &&
        decision.date === note.date &&
        safeLine(decision.topic) &&
        !/[\[\]#|]/.test(decision.topic) &&
        safeLine(decision.verdict) &&
        safeLine(decision.verbatim) &&
        Number.isInteger(decision.lineNumber) &&
        decision.lineNumber > 0,
    ) &&
    [...note.facts, ...note.openThreads].every(
      (item) =>
        record(item) &&
        safeLine(item.text) &&
        safeLine(item.verbatim) &&
        Number.isInteger(item.lineNumber) &&
        item.lineNumber > 0,
    ) &&
    note.links.every((link) => safeLine(link) && !/[\[\]#|]/.test(link))
  );
}

function renderNote(
  note: DistilledNote,
  receiptId: string,
  mode: MemoryMode,
  contradictions: Map<number, string[]>,
): string {
  const lines = [
    '---',
    'type: war-room-distill',
    `status: ${mode}`,
    `session_id: ${yamlString(note.sessionId)}`,
    `session_date: ${yamlString(note.date)}`,
    `distilled_by: ${yamlString(note.model)}`,
    `distilled_at: ${yamlString(note.distilledAt)}`,
    `receipt_id: ${yamlString(receiptId)}`,
    `confidence: ${note.confidence}`,
    'decision_receipts:',
  ];
  if (note.decisions.length === 0) {
    lines[lines.length - 1] = 'decision_receipts: []';
  }
  for (const [index, decision] of note.decisions.entries()) {
    lines.push(
      `  - topic: ${yamlString(decision.topic)}`,
      `    verdict: ${yamlString(decision.verdict)}`,
      `    session_id: ${yamlString(decision.sessionId)}`,
      `    date: ${yamlString(decision.date)}`,
      `    line_number: ${String(decision.lineNumber)}`,
      `    verbatim: ${yamlString(decision.verbatim)}`,
      `    contradicts: ${JSON.stringify(contradictions.get(index) ?? [])}`,
    );
  }
  lines.push('---', '', `# Session distillation — ${note.date}`, '');

  const section = (title: string, items: string[]) => {
    lines.push(`## ${title}`, '');
    if (items.length === 0) lines.push('- ⊘ none extracted');
    else lines.push(...items.map((item) => `- ${item}`));
    lines.push('');
  };
  section(
    'Decisions',
    note.decisions.map((decision, index) => {
      const flag = (contradictions.get(index)?.length ?? 0) > 0 ? ' ⚑ CONTRADICTION' : '';
      return `**[[${decision.topic}]]** — ${decision.verdict}${flag}`;
    }),
  );
  section(
    'Facts',
    note.facts.map((fact) => fact.text),
  );
  section(
    'Open threads',
    note.openThreads.map((thread) => `◷ OPEN — ${thread.text}`),
  );
  section(
    'Links',
    note.links.map((link) => `[[${link}]]`),
  );
  return `${lines.join('\n')}\n`;
}

function renderedFrontmatterValid(markdown: string, receiptId: string): boolean {
  const close = markdown.indexOf('\n---\n', 4);
  if (!markdown.startsWith('---\n') || close < 0) return false;
  const frontmatter = markdown.slice(0, close);
  return [
    'type: war-room-distill',
    'session_id:',
    'session_date:',
    'distilled_by:',
    'distilled_at:',
    `receipt_id: ${yamlString(receiptId)}`,
  ].every((field) => frontmatter.includes(field));
}

export interface MemoryStoreOptions {
  vaultRoot?: string;
  env?: NodeJS.ProcessEnv;
  notifyPromotion?: (text: string) => void;
}

export class MemoryStore {
  private readonly explicitRoot: string | undefined;
  private readonly env: NodeJS.ProcessEnv;
  private readonly notifyPromotion: (text: string) => void;

  constructor(options: MemoryStoreOptions = {}) {
    this.explicitRoot = options.vaultRoot;
    this.env = options.env ?? process.env;
    this.notifyPromotion =
      options.notifyPromotion ??
      ((text) => {
        notifyBigMoment('memory-promoted', text);
      });
  }

  private root(): string | null {
    // Test processes never read or write an env-configured real vault through
    // the production singleton. Tests must pass an explicit temp root.
    if (this.explicitRoot === undefined && this.env.VITEST) return null;
    const raw = this.explicitRoot ?? this.env.WAR_ROOM_VAULT_DIR;
    return raw && raw.trim() !== '' ? path.resolve(raw.trim()) : null;
  }

  isEnabled(): boolean {
    return this.root() !== null;
  }

  private stagedDir(): string | null {
    const root = this.root();
    return root ? path.join(root, MEMORY_STAGED_RELATIVE_DIR) : null;
  }

  private statePath(): string | null {
    const dir = this.stagedDir();
    return dir ? path.join(dir, MEMORY_STATE_FILE_NAME) : null;
  }

  private ledgerPath(): string | null {
    const dir = this.stagedDir();
    return dir ? path.join(dir, MEMORY_LEDGER_FILE_NAME) : null;
  }

  private decisionsPath(): string | null {
    const dir = this.stagedDir();
    return dir ? path.join(dir, MEMORY_DECISIONS_FILE_NAME) : null;
  }

  getState(): MemoryState {
    const statePath = this.statePath();
    if (!statePath) return emptyState();
    try {
      const raw = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<MemoryState>;
      if (
        (raw.mode === 'staged' || raw.mode === 'direct') &&
        typeof raw.cleanDayCount === 'number'
      ) {
        return { ...emptyState(), ...raw };
      }
    } catch {
      // Missing/corrupt state is staged + zero. Never infer direct mode.
    }
    return emptyState();
  }

  getStatus(): { enabled: boolean; state: MemoryState; promotionEligible: boolean } {
    const state = this.getState();
    return {
      enabled: this.isEnabled(),
      state,
      promotionEligible: state.cleanDayCount >= MEMORY_PROMOTION_CLEAN_DAYS,
    };
  }

  private persistState(state: MemoryState): void {
    const target = this.statePath();
    if (!target) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${String(process.pid)}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state), 'utf8');
    fs.renameSync(temp, target);
  }

  private appendLedger(entry: MemoryLedgerEntry): void {
    const target = this.ledgerPath();
    if (!target) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  private receiptId(): string {
    return `wrm-${crypto.randomUUID()}`;
  }

  private recordDayOutcome(
    date: string,
    clean: boolean,
    reason: MemoryBadOutcome | null,
    now: number,
  ): MemoryState {
    const state = this.getState();
    if (state.lastOutcomeDate === date) {
      // A same-day repeat is idempotent unless a later bad write invalidates
      // an earlier clean result. Once bad, that date can never turn clean.
      if (!clean && state.lastOutcomeClean === true) {
        state.cleanDayCount = 0;
        state.lastOutcomeClean = false;
        state.lastBadReason = reason;
        state.lastBadAt = new Date(now).toISOString();
        this.persistState(state);
      }
      return state;
    }

    if (clean) {
      state.cleanDayCount =
        state.lastOutcomeDate &&
        state.lastOutcomeClean === true &&
        nextCalendarDay(state.lastOutcomeDate, date)
          ? state.cleanDayCount + 1
          : 1;
    } else {
      state.cleanDayCount = 0;
      state.lastBadReason = reason;
      state.lastBadAt = new Date(now).toISOString();
    }
    state.lastOutcomeDate = date;
    state.lastOutcomeClean = clean;
    this.persistState(state);
    return state;
  }

  private loadDecisions(): { available: boolean; entries: DecisionIndexEntry[] } {
    const target = this.decisionsPath();
    if (!target) return { available: false, entries: [] };
    if (!fs.existsSync(target)) return { available: true, entries: [] };
    try {
      const entries = fs
        .readFileSync(target, 'utf8')
        .split('\n')
        .flatMap((line) => {
          if (line.trim() === '') return [];
          try {
            const entry = JSON.parse(line) as DecisionIndexEntry;
            return entry && typeof entry.topic === 'string' && typeof entry.verdict === 'string'
              ? [entry]
              : [];
          } catch {
            return [];
          }
        });
      return { available: true, entries };
    } catch {
      return { available: false, entries: [] };
    }
  }

  private existingDecisions(): DecisionIndexEntry[] {
    return this.loadDecisions().entries;
  }

  private contradictionMap(note: DistilledNote): Map<number, string[]> {
    const existing = this.existingDecisions();
    const result = new Map<number, string[]>();
    for (const [index, decision] of note.decisions.entries()) {
      const conflicts = existing
        .filter(
          (entry) =>
            normalizeDecision(entry.topic) === normalizeDecision(decision.topic) &&
            normalizeDecision(entry.verdict) !== normalizeDecision(decision.verdict),
        )
        .map((entry) => entry.receiptId);
      for (const [otherIndex, other] of note.decisions.entries()) {
        if (
          otherIndex !== index &&
          normalizeDecision(other.topic) === normalizeDecision(decision.topic) &&
          normalizeDecision(other.verdict) !== normalizeDecision(decision.verdict)
        ) {
          conflicts.push(`same-note:${String(otherIndex + 1)}`);
        }
      }
      if (conflicts.length > 0) result.set(index, conflicts);
    }
    return result;
  }

  private appendDecisions(
    note: DistilledNote,
    receiptId: string,
    notePath: string,
    contradictions: Map<number, string[]>,
  ): void {
    if (note.decisions.length === 0) return;
    const target = this.decisionsPath();
    if (!target) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const lines = note.decisions.map((decision, index) =>
      JSON.stringify({
        ...decision,
        receiptId,
        notePath,
        recordedAt: note.distilledAt,
        contradicts: contradictions.get(index) ?? [],
      } satisfies DecisionIndexEntry),
    );
    fs.appendFileSync(target, `${lines.join('\n')}\n`, 'utf8');
  }

  receiptSkip(sessionId: string, date: string, reason: string, now: number): MemoryWriteResult {
    if (!this.isEnabled()) return { outcome: 'disabled', receiptId: null };
    const receiptId = this.receiptId();
    this.appendLedger({
      receiptId,
      ts: new Date(now).toISOString(),
      action: 'skipped',
      sessionId,
      date,
      reason,
    });
    return { outcome: 'skipped', receiptId, reason };
  }

  receiptFailure(sessionId: string, date: string, reason: string, now: number): MemoryWriteResult {
    if (!this.isEnabled()) return { outcome: 'disabled', receiptId: null };
    const receiptId = this.receiptId();
    this.appendLedger({
      receiptId,
      ts: new Date(now).toISOString(),
      action: 'failed',
      sessionId,
      date,
      reason,
    });
    return { outcome: 'failed', receiptId, reason };
  }

  writeNote(note: DistilledNote, now: number = Date.now()): MemoryWriteResult {
    const root = this.root();
    if (!root) return { outcome: 'disabled', receiptId: null };
    const receiptId = this.receiptId();
    if (!noteShapeValid(note)) {
      this.appendLedger({
        receiptId,
        ts: new Date(now).toISOString(),
        action: 'quarantined',
        reason: 'malformed-frontmatter',
      });
      if (isDate(note.date)) this.recordDayOutcome(note.date, false, 'malformed-frontmatter', now);
      if (this.getState().mode === 'direct') this.revokeDirect(now, 'bad-write');
      return { outcome: 'quarantined', receiptId, reason: 'malformed-frontmatter' };
    }

    const denyFindings = inspectMemoryText(noteSensitiveText(note));
    if (denyFindings.length > 0) {
      const denyClasses = denyFindings.map((finding) => finding.class);
      this.appendLedger({
        receiptId,
        ts: new Date(now).toISOString(),
        action: 'quarantined',
        sessionId: note.sessionId,
        date: note.date,
        reason: 'denylist-violation',
        denyClasses,
      });
      this.recordDayOutcome(note.date, false, 'denylist-violation', now);
      if (this.getState().mode === 'direct') this.revokeDirect(now, 'bad-write');
      return {
        outcome: 'quarantined',
        receiptId,
        reason: 'denylist-violation',
        denyClasses,
      };
    }

    const state = this.getState();
    const mode = state.mode;
    const relativeDir = mode === 'direct' ? MEMORY_DIRECT_RELATIVE_DIR : MEMORY_STAGED_RELATIVE_DIR;
    const relativePath = path.join(relativeDir, `${note.date}-${note.sessionId}.md`);
    const target = path.join(root, relativePath);
    const fileName = `${note.date}-${note.sessionId}.md`;
    const existingPath = [MEMORY_STAGED_RELATIVE_DIR, MEMORY_DIRECT_RELATIVE_DIR]
      .map((dir) => path.join(root, dir, fileName))
      .find((candidate) => fs.existsSync(candidate));
    if (existingPath) {
      this.appendLedger({
        receiptId,
        ts: new Date(now).toISOString(),
        action: 'skipped',
        sessionId: note.sessionId,
        date: note.date,
        mode,
        relativePath: path.relative(root, existingPath),
        reason: 'already-written',
      });
      return { outcome: 'skipped', receiptId, path: existingPath, reason: 'already-written' };
    }
    const contradictions = this.contradictionMap(note);
    const markdown = renderNote(note, receiptId, mode, contradictions);
    if (!renderedFrontmatterValid(markdown, receiptId)) {
      this.appendLedger({
        receiptId,
        ts: new Date(now).toISOString(),
        action: 'quarantined',
        sessionId: note.sessionId,
        date: note.date,
        reason: 'malformed-frontmatter',
      });
      this.recordDayOutcome(note.date, false, 'malformed-frontmatter', now);
      if (this.getState().mode === 'direct') this.revokeDirect(now, 'bad-write');
      return { outcome: 'quarantined', receiptId, reason: 'malformed-frontmatter' };
    }

    let tempPath: string | null = null;
    try {
      this.appendLedger({
        receiptId,
        ts: new Date(now).toISOString(),
        action: 'write-planned',
        sessionId: note.sessionId,
        date: note.date,
        mode,
        relativePath,
      });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      tempPath = `${target}.${String(process.pid)}.tmp`;
      fs.writeFileSync(tempPath, markdown, { encoding: 'utf8', flag: 'wx' });
      // Hard-linking a fully-written temp file gives us no-clobber publish:
      // linkSync fails on an existing target, whereas renameSync overwrites
      // it on POSIX (silent deletion of the earlier knowledge note).
      fs.linkSync(tempPath, target);
      fs.unlinkSync(tempPath);
      tempPath = null;
      this.appendDecisions(note, receiptId, relativePath, contradictions);
      this.appendLedger({
        receiptId,
        ts: new Date(now).toISOString(),
        action: 'written',
        sessionId: note.sessionId,
        date: note.date,
        mode,
        relativePath,
      });
      const updated = this.recordDayOutcome(note.date, true, null, now);
      if (updated.cleanDayCount >= MEMORY_PROMOTION_CLEAN_DAYS && updated.mode === 'staged') {
        this.promoteIfEligible(now);
      }
      return { outcome: 'written', receiptId, path: target };
    } catch {
      if (tempPath) {
        try {
          fs.rmSync(tempPath, { force: true });
        } catch {
          // The failure receipt below remains the durable signal.
        }
      }
      this.appendLedger({
        receiptId,
        ts: new Date(now).toISOString(),
        action: 'failed',
        sessionId: note.sessionId,
        date: note.date,
        mode,
        relativePath,
        reason: 'write-failed',
      });
      return { outcome: 'failed', receiptId, reason: 'write-failed' };
    }
  }

  promoteIfEligible(
    now: number = Date.now(),
  ): { ok: true; changed: boolean } | { ok: false; reason: 'disabled' | 'not-eligible' } {
    if (!this.isEnabled()) return { ok: false, reason: 'disabled' };
    const state = this.getState();
    if (state.mode === 'direct') return { ok: true, changed: false };
    if (state.cleanDayCount < MEMORY_PROMOTION_CLEAN_DAYS) {
      return { ok: false, reason: 'not-eligible' };
    }
    const receiptId = this.receiptId();
    state.mode = 'direct';
    state.promotedAt = new Date(now).toISOString();
    this.appendLedger({
      receiptId,
      ts: state.promotedAt,
      action: 'promotion-planned',
      mode: 'direct',
      reason: `${String(state.cleanDayCount)}-clean-days`,
    });
    this.persistState(state);
    this.appendLedger({
      receiptId,
      ts: state.promotedAt,
      action: 'promoted',
      mode: 'direct',
      reason: `${String(state.cleanDayCount)}-clean-days`,
    });
    this.notifyPromotion(
      `Memory writes promoted to DIRECT after ${String(state.cleanDayCount)} clean days. Revocation remains available in War Room.`,
    );
    return { ok: true, changed: true };
  }

  revokeDirect(
    now: number = Date.now(),
    reason: 'operator-flag' | 'bad-write' = 'operator-flag',
  ): { ok: boolean; changed: boolean } {
    if (!this.isEnabled()) return { ok: false, changed: false };
    const state = this.getState();
    if (state.mode === 'staged') return { ok: true, changed: false };
    const receiptId = this.receiptId();
    state.mode = 'staged';
    // Revocation starts a fresh observation window. Keeping a count of 7
    // would let the very next clean write auto-flip DIRECT again.
    state.cleanDayCount = 0;
    state.lastOutcomeDate = null;
    state.lastOutcomeClean = null;
    state.revokedAt = new Date(now).toISOString();
    this.appendLedger({
      receiptId,
      ts: state.revokedAt,
      action: 'revocation-planned',
      mode: 'staged',
      reason,
    });
    this.persistState(state);
    this.appendLedger({
      receiptId,
      ts: state.revokedAt,
      action: 'revoked',
      mode: 'staged',
      reason,
    });
    return { ok: true, changed: true };
  }

  recordBadOutcome(
    reason: Extract<MemoryBadOutcome, 'contradiction-confirmed-wrong' | 'greg-revert'>,
    date: string,
    now: number = Date.now(),
  ): { ok: boolean } {
    if (!this.isEnabled() || !isDate(date)) return { ok: false };
    this.recordDayOutcome(date, false, reason, now);
    if (this.getState().mode === 'direct') this.revokeDirect(now, 'bad-write');
    this.appendLedger({
      receiptId: this.receiptId(),
      ts: new Date(now).toISOString(),
      action: 'bad-outcome',
      date,
      reason,
    });
    return { ok: true };
  }

  searchDecisions(query: string, now: number = Date.now()): DecisionSearchLane {
    if (!this.isEnabled()) return { available: false, matches: [] };
    const low = query
      .trim()
      .toLowerCase()
      .replace(/^what\s+did\s+we\s+decide\s+(?:about|on)\s+/, '')
      .replace(/[?]+$/, '')
      .trim();
    const loaded = this.loadDecisions();
    if (!loaded.available) return { available: false, matches: [] };
    const entries = loaded.entries;
    if (low === '') return { available: true, matches: [] };

    const topicKeys = [
      ...new Set(
        entries
          .filter(
            (entry) =>
              entry.topic.toLowerCase().includes(low) || entry.verdict.toLowerCase().includes(low),
          )
          .map((entry) => normalizeDecision(entry.topic)),
      ),
    ];
    const staleMs = MEMORY_DECISION_STALE_DAYS * 24 * 60 * 60_000;
    const matches = topicKeys.map((topicKey) => {
      const topicEntries = entries
        .filter((entry) => normalizeDecision(entry.topic) === topicKey)
        .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
      const latest = topicEntries[0] as DecisionIndexEntry;
      const answersByKey = new Map<string, string>();
      for (const entry of topicEntries) {
        const key = normalizeDecision(entry.verdict);
        if (!answersByKey.has(key)) answersByKey.set(key, entry.verdict);
      }
      const answers = [...answersByKey.values()];
      return {
        topic: latest.topic,
        answer: latest.verdict,
        receipts: topicEntries.map((entry) => ({
          receiptId: entry.receiptId,
          sessionId: entry.sessionId,
          date: entry.date,
          verbatim: entry.verbatim,
          lineNumber: entry.lineNumber,
          notePath: entry.notePath,
        })),
        stale: now - Date.parse(latest.recordedAt) > staleMs,
        contradiction:
          answers.map(normalizeDecision).filter((v, i, all) => all.indexOf(v) === i).length > 1,
        competingAnswers: answers.slice(1),
      } satisfies DecisionSearchMatch;
    });
    return { available: true, matches };
  }
}

export const memoryStore = new MemoryStore();
