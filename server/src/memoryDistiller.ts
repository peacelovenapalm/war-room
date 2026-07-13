/**
 * V7-1 deterministic post-session distiller. The interface is deliberately
 * model-shaped so an existing dispatch-plane worker can replace the fallback
 * later; this module opens no API client and consumes no key itself.
 *
 * Graphify conventions retained here: compact atomic facts, explicit topic
 * links, source receipts, and an honest EXTRACTED confidence label. The
 * code-level denylist in memoryStore remains authoritative regardless of the
 * extractor used.
 */

import * as fs from 'fs';

import { MEMORY_DISTILL_MAX_ITEMS, MEMORY_SKIP_TAG } from './constants.js';
import type { MemoryWriteResult } from './memoryStore.js';
import { memoryStore } from './memoryStore.js';

export const DISTILLER_SYSTEM_INSTRUCTION =
  'Extract only decisions, established facts, and open threads. Preserve verbatim source lines and topic links. Never include finances/accounts, health/struggles, or named private people. The server denylist is authoritative and quarantines the whole note.';

export interface TranscriptTextLine {
  lineNumber: number;
  role: 'user' | 'assistant';
  text: string;
}

export interface DecisionReceipt {
  topic: string;
  verdict: string;
  sessionId: string;
  date: string;
  verbatim: string;
  lineNumber: number;
}

export interface DistilledNote {
  sessionId: string;
  date: string;
  model: string;
  distilledAt: string;
  confidence: 'EXTRACTED';
  decisions: DecisionReceipt[];
  facts: Array<{ text: string; verbatim: string; lineNumber: number }>;
  openThreads: Array<{ text: string; verbatim: string; lineNumber: number }>;
  links: string[];
}

export interface SessionDistiller {
  distill(lines: TranscriptTextLine[], context: DistillContext): DistilledNote;
}

export interface DistillContext {
  sessionId: string;
  date: string;
  model: string;
  distilledAt: string;
}

function textFromContent(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!block || typeof block !== 'object') return [];
    const text = (block as { text?: unknown }).text;
    return typeof text === 'string' ? [text] : [];
  });
}

/** Tolerant JSONL reader: corrupt/non-message records are ignored. */
export function readTranscriptTextLines(file: string): TranscriptTextLine[] {
  const lines: TranscriptTextLine[] = [];
  for (const [index, rawLine] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
    if (rawLine.trim() === '') continue;
    try {
      const raw = JSON.parse(rawLine) as Record<string, unknown>;
      const role = raw.type === 'user' ? 'user' : raw.type === 'assistant' ? 'assistant' : null;
      if (!role) continue;
      const message = raw.message;
      const content =
        message && typeof message === 'object'
          ? (message as { content?: unknown }).content
          : raw.content;
      for (const block of textFromContent(content)) {
        for (const text of block.split('\n')) {
          const trimmed = text.trim();
          if (trimmed !== '') lines.push({ lineNumber: index + 1, role, text: trimmed });
        }
      }
    } catch {
      // A partial/corrupt line cannot poison distillation of the rest.
    }
  }
  return lines;
}

export function carriesDistillSkipTag(lines: TranscriptTextLine[]): boolean {
  return lines.some(
    (line) => line.role === 'user' && line.text.toLowerCase().includes(MEMORY_SKIP_TAG),
  );
}

function parseDecision(line: TranscriptTextLine, context: DistillContext): DecisionReceipt | null {
  const bracketed = /^decision\s*\[([^\]]+)\]\s*:\s*(.+)$/i.exec(line.text);
  const separated = /^decision\s*:\s*([^:=—]+?)\s*(?:=>|=|—|:)\s*(.+)$/i.exec(line.text);
  const match = bracketed ?? separated;
  if (!match) return null;
  const topic = match[1]?.trim() ?? '';
  const verdict = match[2]?.trim() ?? '';
  if (topic === '' || verdict === '') return null;
  return {
    topic,
    verdict,
    sessionId: context.sessionId,
    date: context.date,
    verbatim: line.text,
    lineNumber: line.lineNumber,
  };
}

function topicLink(topic: string): string {
  return topic
    .trim()
    .replace(/[\[\]#|]/g, '')
    .replace(/\s+/g, ' ');
}

export class DeterministicSessionDistiller implements SessionDistiller {
  distill(lines: TranscriptTextLine[], context: DistillContext): DistilledNote {
    const decisions: DecisionReceipt[] = [];
    const facts: DistilledNote['facts'] = [];
    const openThreads: DistilledNote['openThreads'] = [];

    for (const line of lines) {
      const decision = parseDecision(line, context);
      if (decision && decisions.length < MEMORY_DISTILL_MAX_ITEMS) {
        decisions.push(decision);
        continue;
      }
      const fact = /^fact\s*:\s*(.+)$/i.exec(line.text);
      if (fact?.[1] && facts.length < MEMORY_DISTILL_MAX_ITEMS) {
        facts.push({ text: fact[1].trim(), verbatim: line.text, lineNumber: line.lineNumber });
        continue;
      }
      const open = /^(?:open|open thread|todo)\s*:\s*(.+)$/i.exec(line.text);
      if (open?.[1] && openThreads.length < MEMORY_DISTILL_MAX_ITEMS) {
        openThreads.push({
          text: open[1].trim(),
          verbatim: line.text,
          lineNumber: line.lineNumber,
        });
      }
    }

    return {
      ...context,
      confidence: 'EXTRACTED',
      decisions,
      facts,
      openThreads,
      links: [...new Set(decisions.map((decision) => topicLink(decision.topic)))].filter(Boolean),
    };
  }
}

export interface DistillEndedSessionInput {
  sessionId: string;
  transcriptPath: string;
  model: string;
  now?: number;
  distiller?: SessionDistiller;
  store?: Pick<typeof memoryStore, 'isEnabled' | 'receiptSkip' | 'receiptFailure' | 'writeNote'>;
}

/**
 * Session-end job entry point. It returns a receipt-shaped result for tests
 * and observability; callers may fire-and-forget because every failure is
 * converted to an honest receipt instead of escaping the lifecycle path.
 */
export function distillEndedSession(input: DistillEndedSessionInput): MemoryWriteResult {
  const store = input.store ?? memoryStore;
  if (!store.isEnabled()) return { outcome: 'disabled', receiptId: null };

  const now = input.now ?? Date.now();
  const date = new Date(now).toISOString().slice(0, 10);
  try {
    const lines = readTranscriptTextLines(input.transcriptPath);
    if (carriesDistillSkipTag(lines)) {
      return store.receiptSkip(input.sessionId, date, 'skip-tag', now);
    }

    const note = (input.distiller ?? new DeterministicSessionDistiller()).distill(lines, {
      sessionId: input.sessionId,
      date,
      model: input.model,
      distilledAt: new Date(now).toISOString(),
    });
    return store.writeNote(note, now);
  } catch {
    try {
      return store.receiptFailure(input.sessionId, date, 'session-distill-failed', now);
    } catch {
      // Even a misconfigured/unwritable env root must not escape into the
      // session-end lifecycle path. No receipt is fabricated as durable.
      return { outcome: 'failed', receiptId: null, reason: 'audit-ledger-unavailable' };
    }
  }
}
