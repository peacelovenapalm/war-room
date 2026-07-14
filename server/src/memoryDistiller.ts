/**
 * V7-1 deterministic post-session distiller (server-side orchestration).
 *
 * The pure extraction logic lives in memoryDistillerCore.ts so the Claude
 * hook bundle (running on the session's OWN machine) can share it without
 * pulling in memoryStore/env/Fastify. This module owns the parts that DO
 * touch the vault: the server-local distill path (distillEndedSession) and
 * the V8 session-end orchestrator that also accepts an already-distilled
 * note (or failure marker) computed client-side by the hook script.
 *
 * The interface is deliberately model-shaped so an existing dispatch-plane
 * worker can replace the fallback later; this module opens no API client and
 * consumes no key itself.
 */

import { MEMORY_DISTILL_MAX_ITEMS } from './constants.js';
import type {
  DecisionReceipt,
  DistillContext,
  DistilledNote,
  SessionDistiller,
  TranscriptTextLine,
} from './memoryDistillerCore.js';
import {
  carriesDistillSkipTag,
  DeterministicSessionDistiller,
  readTranscriptTextLines,
} from './memoryDistillerCore.js';
import type { MemoryWriteResult } from './memoryStore.js';
import { memoryStore } from './memoryStore.js';

export const DISTILLER_SYSTEM_INSTRUCTION =
  'Extract only decisions, established facts, and open threads. Preserve verbatim source lines and topic links. Never include finances/accounts, health/struggles, or named private people. The server denylist is authoritative and quarantines the whole note.';

// Re-exported for existing consumers (memoryStore.ts types, tests).
export type {
  DecisionReceipt,
  DistillContext,
  DistilledNote,
  SessionDistiller,
  TranscriptTextLine,
};
export { carriesDistillSkipTag, DeterministicSessionDistiller, readTranscriptTextLines };

export interface DistillEndedSessionInput {
  sessionId: string;
  transcriptPath: string;
  model: string;
  now?: number;
  distiller?: SessionDistiller;
  store?: Pick<typeof memoryStore, 'isEnabled' | 'receiptSkip' | 'receiptFailure' | 'writeNote'>;
}

/**
 * Session-end job entry point for the SERVER-LOCAL path only (a session
 * whose transcript this process can actually read). It returns a
 * receipt-shaped result for tests and observability; callers may
 * fire-and-forget because every failure is converted to an honest receipt
 * instead of escaping the lifecycle path.
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

// ── V8: client-side distill (SessionEnd carries a note/marker from the hook) ──

/** What a Claude SessionEnd hook event may carry once client-side distill
 *  runs on the session's own machine. Mirrors AgentEvent's sessionEnd kind
 *  (core/src/provider.ts) — see ClientDistilledNote there for the wire shape. */
export interface ClientDistillPayload {
  /** Untrusted wire note. Must be validated (validateClientDistilledNote)
   *  before ever reaching MemoryStore.writeNote. */
  distilledNote?: unknown;
  distillSkipped?: boolean;
  distillFailed?: boolean;
  distillFailReason?: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneReceiptItem(
  value: unknown,
): { text: string; verbatim: string; lineNumber: number } | null {
  if (!isPlainRecord(value)) return null;
  const { text, verbatim, lineNumber } = value;
  if (typeof text !== 'string' || typeof verbatim !== 'string' || typeof lineNumber !== 'number') {
    return null;
  }
  return { text, verbatim, lineNumber };
}

function cloneDecision(value: unknown, sessionId: string, date: string): DecisionReceipt | null {
  if (!isPlainRecord(value)) return null;
  const { topic, verdict, verbatim, lineNumber } = value;
  if (
    typeof topic !== 'string' ||
    typeof verdict !== 'string' ||
    typeof verbatim !== 'string' ||
    typeof lineNumber !== 'number'
  ) {
    return null;
  }
  return { topic, verdict, sessionId, date, verbatim, lineNumber };
}

/**
 * Trust boundary for the client-distilled note carried on the (already
 * Bearer-authenticated) SessionEnd hook POST. Reconstructs a clean
 * DistilledNote from only the known fields — unknown fields are dropped by
 * construction — and clamps every item array to MEMORY_DISTILL_MAX_ITEMS.
 * sessionId/date are always forced from the trusted server-side event
 * context, never trusted from the client payload, so a compromised or buggy
 * hook script cannot claim a different session or backdate a receipt.
 * Returns null when the payload isn't even shaped like a note; the caller
 * treats that as a distill failure, never a silent drop.
 */
export function validateClientDistilledNote(
  raw: unknown,
  sessionId: string,
  date: string,
): DistilledNote | null {
  if (!isPlainRecord(raw)) return null;
  const { model, distilledAt, confidence, decisions, facts, openThreads, links } = raw;
  if (typeof model !== 'string' || model.trim() === '') return null;
  if (typeof distilledAt !== 'string' || !Number.isFinite(Date.parse(distilledAt))) return null;
  if (confidence !== 'EXTRACTED') return null;
  if (
    !Array.isArray(decisions) ||
    !Array.isArray(facts) ||
    !Array.isArray(openThreads) ||
    !Array.isArray(links)
  ) {
    return null;
  }

  const cleanDecisions = decisions
    .slice(0, MEMORY_DISTILL_MAX_ITEMS)
    .map((decision) => cloneDecision(decision, sessionId, date))
    .filter((decision): decision is DecisionReceipt => decision !== null);
  const cleanFacts = facts
    .slice(0, MEMORY_DISTILL_MAX_ITEMS)
    .map(cloneReceiptItem)
    .filter(
      (fact): fact is { text: string; verbatim: string; lineNumber: number } => fact !== null,
    );
  const cleanOpenThreads = openThreads
    .slice(0, MEMORY_DISTILL_MAX_ITEMS)
    .map(cloneReceiptItem)
    .filter(
      (thread): thread is { text: string; verbatim: string; lineNumber: number } => thread !== null,
    );
  const cleanLinks = links
    .filter((link): link is string => typeof link === 'string')
    .slice(0, MEMORY_DISTILL_MAX_ITEMS);

  return {
    sessionId,
    date,
    model,
    distilledAt,
    confidence: 'EXTRACTED',
    decisions: cleanDecisions,
    facts: cleanFacts,
    openThreads: cleanOpenThreads,
    links: cleanLinks,
  };
}

export interface DistillFromSessionEndInput {
  sessionId: string;
  /** '' for hooks-only external sessions whose transcript lives on a remote
   *  machine the server can never read (see V8 kickoff doc). */
  transcriptPath: string;
  model: string;
  now?: number;
  distiller?: SessionDistiller;
  store?: Pick<typeof memoryStore, 'isEnabled' | 'receiptSkip' | 'receiptFailure' | 'writeNote'>;
  /** Present when the SessionEnd hook event carried client-side distill
   *  results (or a failure marker) computed on the session's own machine. */
  clientDistill?: ClientDistillPayload;
}

/**
 * V8 session-end entry point. Four receipt paths, in priority order:
 *   1. clientDistill.distilledNote present -> validate + writeNote (dedupe,
 *      denylist, and shape re-check all happen inside the existing chokepoint).
 *   2. clientDistill.distillSkipped -> honest skip receipt (skip-tag), same
 *      outcome as the server-local skip-tag path.
 *   3. clientDistill.distillFailed (or a client note that fails validation)
 *      -> honest failure receipt, reason 'client-distill-failed' (distinct
 *      from the server-local failure reason so the two causes never blur
 *      together in the ledger).
 *   4. Neither: transcriptPath === '' (hooks-only remote session, the
 *      original V7 bug) -> honest failure receipt, reason
 *      'transcript-unavailable'. transcriptPath non-empty -> unchanged
 *      server-local distillEndedSession path.
 */
export function distillFromSessionEnd(input: DistillFromSessionEndInput): MemoryWriteResult {
  const store = input.store ?? memoryStore;
  if (!store.isEnabled()) return { outcome: 'disabled', receiptId: null };

  const now = input.now ?? Date.now();
  const date = new Date(now).toISOString().slice(0, 10);
  const clientDistill = input.clientDistill;

  if (clientDistill?.distilledNote !== undefined) {
    const note = validateClientDistilledNote(clientDistill.distilledNote, input.sessionId, date);
    if (note) return store.writeNote(note, now);
    return store.receiptFailure(input.sessionId, date, 'client-distill-failed', now);
  }
  if (clientDistill?.distillSkipped) {
    return store.receiptSkip(input.sessionId, date, 'skip-tag', now);
  }
  if (clientDistill?.distillFailed) {
    return store.receiptFailure(input.sessionId, date, 'client-distill-failed', now);
  }
  if (input.transcriptPath !== '') {
    return distillEndedSession({
      sessionId: input.sessionId,
      transcriptPath: input.transcriptPath,
      model: input.model,
      now: input.now,
      distiller: input.distiller,
      store,
    });
  }
  return store.receiptFailure(input.sessionId, date, 'transcript-unavailable', now);
}
