/**
 * Remote-answer plane client helpers (T2/T4, REMOTE-ANSWER-DESIGN.md) — the
 * real POST /api/agents/answer + GET /api/agents/answer/:id + GET
 * /api/agents/answers?machine= calls, kept pure/testable the same way
 * killAgent.ts extracted the KILL wire path out of AgentDrawer.tsx.
 *
 * The board addresses a managed session the same way KILL does — (machine,
 * pid) — the server resolves that to a managedSessionRef against the
 * runner's live advertisement (dispatchFacts.ts's `managed: true` flag on
 * the agent is the UI's only license to show any of this).
 */

/** Mirrors server/src/dispatchStore.ts's ANSWER_TEXT_MAX_CHARS. */
export const ANSWER_TEXT_MAX_CHARS = 4000;

/** Answer-outcome poll cadence + honest give-up (mirrors killAgent.ts). */
export const ANSWER_POLL_INTERVAL_MS = 1_000;
export const ANSWER_RESULT_TIMEOUT_MS = 15_000;

export interface AnswerRequestResult {
  ok: boolean;
  id?: string;
  reason?: string;
}

export async function requestAnswer(
  machine: string,
  pid: number,
  text: string,
): Promise<AnswerRequestResult> {
  try {
    const res = await fetch('/api/agents/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine, pid, text }),
    });
    return (await res.json()) as AnswerRequestResult;
  } catch {
    return { ok: false, reason: 'request failed' };
  }
}

export type AnswerOutcomeStatus = 'pending' | 'delivered' | 'denied';

export interface AnswerOutcome {
  status: AnswerOutcomeStatus;
  reason?: string;
}

/** Returns `null` on a fetch/parse failure — same "still pending vs.
 *  timeout" decision the caller makes for kill outcomes. */
export async function pollAnswerOutcome(requestId: string): Promise<AnswerOutcome | null> {
  try {
    const res = await fetch(`/api/agents/answer/${requestId}`);
    if (!res.ok) return null;
    return (await res.json()) as AnswerOutcome;
  } catch {
    return null;
  }
}

/** Wire-facing receipt shape (mirrors server's AnswerReceipt) — the
 *  verbatim text IS the receipt (one-tap-real). */
export interface AnswerReceipt {
  id: string;
  machine: string;
  managedSessionRef: string;
  text: string;
  status: AnswerOutcomeStatus;
  reason?: string;
  createdAt: number;
  updatedAt: number;
}

/** Machine-level receipts (the drawer cannot reliably learn its own
 *  managedSessionRef — the answer POST response only echoes the request
 *  id, never the ref — so this stays scoped to the machine, the honest
 *  fallback the design calls out). Returns [] on any fetch/parse failure. */
export async function fetchAnswerReceipts(machine: string): Promise<AnswerReceipt[]> {
  try {
    const res = await fetch(`/api/agents/answers?machine=${encodeURIComponent(machine)}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { answers?: AnswerReceipt[] };
    return body.answers ?? [];
  } catch {
    return [];
  }
}

interface AnswerStatusSpec {
  /** Distinct shape per status — the primary signal together with the word. */
  glyph: string;
  word: string;
}

/** Colorblind rule: every receipt row is GLYPH + WORD, color reinforcement
 *  only. 'pending' reads as "DELIVERING…" per the design's no-fake-states
 *  requirement (never an optimistic "sent"). */
export const ANSWER_STATUS_CHIPS: Record<AnswerOutcomeStatus, AnswerStatusSpec> = {
  pending: { glyph: '…', word: 'DELIVERING' },
  delivered: { glyph: '✓', word: 'DELIVERED' },
  denied: { glyph: '✗', word: 'FAILED' },
};

/** One line of receipt/outcome status, e.g. "… DELIVERING", "✓ DELIVERED",
 *  "✗ FAILED — session-dead". */
export function answerStatusLabel(status: AnswerOutcomeStatus, reason?: string): string {
  const { glyph, word } = ANSWER_STATUS_CHIPS[status];
  return reason ? `${glyph} ${word} — ${reason}` : `${glyph} ${word}`;
}

/**
 * Defensive parse of an AskUserQuestion-style numbered option list out of a
 * raw `waitingFor` string. Only trusts the text when at least two lines
 * unambiguously look like "1. option" / "2) option" — any ambiguity falls
 * back to [] (free-text only), per REMOTE-ANSWER-DESIGN.md's "never invent
 * options" rule. Returned strings are the option text ONLY (numbering
 * stripped) — the confirm step still shows exactly what gets typed.
 */
const OPTION_LINE_RE = /^\s*\d+[.)]\s*(.+?)\s*$/;

export function parseAnswerOptions(waitingFor: string | undefined): string[] {
  if (!waitingFor) return [];
  const lines = waitingFor.split(/\r?\n/);
  const options: string[] = [];
  for (const line of lines) {
    const match = OPTION_LINE_RE.exec(line);
    if (match && match[1].trim() !== '') options.push(match[1].trim());
  }
  return options.length >= 2 ? options : [];
}
