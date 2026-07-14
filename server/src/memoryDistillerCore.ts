/**
 * V7-1 deterministic distiller — pure core.
 *
 * Extracted from memoryDistiller.ts so the Claude hook bundle (which runs on
 * the SESSION's OWN MACHINE, not the server) can distill a transcript locally
 * at SessionEnd without dragging in server-only modules (memoryStore, env,
 * Fastify). This file must only ever import `fs` and other pure modules
 * (server/src/constants.ts has zero side-effect imports) — anything that
 * touches the vault, the store, or process.env belongs in memoryDistiller.ts
 * instead.
 *
 * Graphify conventions retained here: compact atomic facts, explicit topic
 * links, source receipts, and an honest EXTRACTED confidence label. The
 * code-level denylist in memoryStore remains authoritative regardless of
 * where the extractor ran.
 */

import * as fs from 'fs';

import { MEMORY_DISTILL_MAX_ITEMS, MEMORY_SKIP_TAG } from './constants.js';

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

/** V8: client-side distill fields, attached to the SessionEnd hook payload
 *  before it's POSTed (or emitted by the standalone distill CLI). Mirrors
 *  AgentEvent's sessionEnd kind (core/src/provider.ts). Runs on the
 *  session's OWN machine so the server never needs (or gets) the raw
 *  transcript -- only the finished note. */
export interface SessionEndDistillFields {
  distilledNote?: unknown;
  distillSkipped?: boolean;
  distillFailed?: boolean;
  distillFailReason?: string;
}

/** Never throws: any failure becomes an honest distillFailed marker so the
 *  server can record a distinct 'client-distill-failed' receipt instead of
 *  silently dropping the session. Never fabricates a note. Shared by
 *  claude-hook.ts (spawned per-event from the app) and the standalone
 *  war-room-distill.js CLI (spawned from the ~/.war-room/hook.sh forwarder
 *  on machines that don't run the bundled hook script). */
export function distillForSessionEnd(data: Record<string, unknown>): SessionEndDistillFields {
  try {
    const transcriptPath = typeof data.transcript_path === 'string' ? data.transcript_path : '';
    const sessionId = typeof data.session_id === 'string' ? data.session_id : '';
    if (transcriptPath === '') {
      return { distillFailed: true, distillFailReason: 'no-transcript-path' };
    }
    const lines = readTranscriptTextLines(transcriptPath);
    if (carriesDistillSkipTag(lines)) {
      return { distillSkipped: true };
    }
    const now = Date.now();
    const note = new DeterministicSessionDistiller().distill(lines, {
      sessionId,
      date: new Date(now).toISOString().slice(0, 10),
      model: 'deterministic-v1',
      distilledAt: new Date(now).toISOString(),
    });
    return { distilledNote: note };
  } catch (e) {
    return {
      distillFailed: true,
      distillFailReason: e instanceof Error ? e.message.slice(0, 200) : 'distill-error',
    };
  }
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
