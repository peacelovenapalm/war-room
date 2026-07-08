/**
 * Dispatch (v1 mechanic #6b — "call a coworker") pure logic + status
 * registry, split out of the components so it can be unit-tested with no
 * rendering harness (same convention shiftReport.ts uses for ShiftPanel).
 *
 * Single source of truth for: the tray's glyph+word chips, the help-content
 * completeness test (webview-ui/test/helpContent.test.ts), and the
 * auto-clear/sticky-denied timing rule. Mirrors core/src/messages.ts'
 * DispatchStatusValue/DispatchActionValue and dispatchStore.ts's
 * DISPATCH_PROVIDERS/DISPATCH_PROMPT_MAX_CHARS without importing the
 * server-facing generated types or server code into the webview bundle.
 */

export const DISPATCH_PROVIDERS = ['claude', 'codex', 'gemini'] as const;
export type DispatchProvider = (typeof DISPATCH_PROVIDERS)[number];

export const DISPATCH_STATUSES = ['ringing', 'answered', 'denied', 'expired', 'exited'] as const;
export type DispatchStatusValue = (typeof DISPATCH_STATUSES)[number];

export type DispatchActionValue = 'dispatch' | 'focus';

/** Mirrors dispatchStore.ts DISPATCH_PROMPT_MAX_CHARS — the modal's textarea cap. */
export const DISPATCH_PROMPT_MAX_CHARS = 4000;

/** DENIED chips are sticky (dismiss only); every other terminal status
 *  auto-clears after this long so the tray doesn't grow forever. */
export const DISPATCH_AUTOCLEAR_MS = 60_000;

export interface DispatchStatusSpec {
  /** Distinct shape per status — the primary signal together with the word. */
  glyph: string;
  /** Uppercase text label — the other primary signal (colorblind rule). */
  word: string;
}

/** Colorblind rule: every tray chip is GLYPH + WORD, color reinforcement only. */
export const DISPATCH_STATUS_CHIPS: Record<DispatchStatusValue, DispatchStatusSpec> = {
  ringing: { glyph: '◎', word: 'RINGING' },
  answered: { glyph: '✓', word: 'ANSWERED' },
  denied: { glyph: '⊘', word: 'DENIED' },
  expired: { glyph: '○', word: 'EXPIRED' },
  exited: { glyph: '■', word: 'EXITED' },
};

/** Mirrors DispatchBroadcast (core/src/messages.ts DispatchUpdate) — the shape
 *  the tray/reducer/tests operate on, plus a client-side receipt timestamp
 *  (the broadcast plane carries no timestamp of its own). */
export interface DispatchEntry {
  id: string;
  action: DispatchActionValue;
  status: DispatchStatusValue;
  machine: string;
  provider?: string;
  promptPreview?: string;
  reason?: string;
  pid?: number;
  exitCode?: number;
  /** Client receipt time — anchors the auto-clear timer. */
  receivedAt: number;
}

/** Pure auto-clear rule: RINGING/ANSWERED are still in flight (never auto-
 *  clear); DENIED is sticky (dismiss only, never auto-clears); EXPIRED/
 *  EXITED clear once older than DISPATCH_AUTOCLEAR_MS. */
export function shouldAutoClear(status: DispatchStatusValue, ageMs: number): boolean {
  if (status === 'ringing' || status === 'answered' || status === 'denied') return false;
  return ageMs >= DISPATCH_AUTOCLEAR_MS;
}

/** One line of tray chip text, e.g. "◎ RINGING", "⊘ DENIED — path-not-allowlisted",
 *  "■ EXITED (code 0)". */
export function dispatchChipLabel(
  entry: Pick<DispatchEntry, 'status' | 'reason' | 'exitCode'>,
): string {
  const { glyph, word } = DISPATCH_STATUS_CHIPS[entry.status];
  if (entry.status === 'denied' && entry.reason) {
    return `${glyph} ${word} — ${entry.reason}`;
  }
  if (entry.status === 'exited' && entry.exitCode !== undefined) {
    return `${glyph} ${word} (code ${entry.exitCode})`;
  }
  return `${glyph} ${word}`;
}

/** Insert-or-update by id (a dispatchUpdate is a lifecycle transition of an
 *  existing entry, or the first sighting of a new one). */
export function upsertDispatchEntry(
  entries: DispatchEntry[],
  update: Omit<DispatchEntry, 'receivedAt'>,
  now: number = Date.now(),
): DispatchEntry[] {
  const next: DispatchEntry = { ...update, receivedAt: now };
  const idx = entries.findIndex((e) => e.id === update.id);
  if (idx === -1) return [...entries, next];
  const copy = [...entries];
  copy[idx] = next;
  return copy;
}

/** Drop entries past their auto-clear age (DENIED never included — sticky). */
export function pruneDispatchEntries(
  entries: DispatchEntry[],
  now: number = Date.now(),
): DispatchEntry[] {
  return entries.filter((e) => !shouldAutoClear(e.status, now - e.receivedAt));
}

/** Explicit dismiss (the only way a DENIED chip clears). */
export function dismissDispatchEntry(entries: DispatchEntry[], id: string): DispatchEntry[] {
  return entries.filter((e) => e.id !== id);
}

/** Characters remaining before DISPATCH_PROMPT_MAX_CHARS — negative once over. */
export function promptRemaining(prompt: string): number {
  return DISPATCH_PROMPT_MAX_CHARS - prompt.length;
}

/** One-line copy-able identity for the drawer's COPY ID button:
 *  "MACHINE · /project/dir · session-id". Missing fields render honestly
 *  rather than silently dropping a separator. */
export function buildCopyIdLine(
  machine: string | undefined,
  cwd: string | undefined,
  sessionId: string | undefined,
): string {
  return [machine ?? '(no machine)', cwd ?? '(no cwd)', sessionId ?? '(no session id)'].join(' · ');
}

/** A machine advertisement from GET /api/dispatch/machines. */
export interface DispatchMachine {
  machine: string;
  providers: string[];
  roots: string[];
  focus: boolean;
}

/** True when `machine` has a live runner advertisement with focus capability
 *  enabled — drives the drawer's FOCUS button enable/disable + "⚠ NO RUNNER" text. */
export function machineSupportsFocus(
  machines: DispatchMachine[],
  machine: string | undefined,
): boolean {
  if (!machine) return false;
  return machines.some((m) => m.machine === machine && m.focus);
}

/** Drawer FOCUS button eligibility (mechanic #6b): needs BOTH a real pid
 *  (from server hook telemetry, AgentCreated/ExistingAgents/agentPidUpdate)
 *  and a live runner on that machine advertising focus support. Pure so the
 *  two honest disabled states ("NO PID" vs "NO RUNNER") are unit-testable
 *  without a rendering harness. */
export function canFocusAgent(
  pid: number | undefined,
  machines: DispatchMachine[],
  machine: string | undefined,
): boolean {
  return pid !== undefined && machineSupportsFocus(machines, machine);
}

// ── Send-failure detection ──────────────────────────────────────────
//
// dispatchRequest has NO ack on the wire: an invalid send (bad provider,
// missing field, >5-ringing-per-machine cap) is silently dropped — no
// dispatchUpdate ever arrives, and enqueue() never hands the sender the
// server-generated id to correlate against. The only honest signal
// available client-side is absence: if no entry for the same
// machine+action shows up within DISPATCH_SEND_TIMEOUT_MS of the send,
// treat it as never queued (colorblind rule still applies — GLYPH+WORD,
// not silence).

/** A send this client made, tracked locally until either a matching
 *  DispatchEntry appears (resolved silently — the real chip is now in the
 *  tray) or the timeout elapses (failed — see detectSendFailures). */
export interface PendingSend {
  id: string;
  machine: string;
  action: DispatchActionValue;
  sentAt: number;
}

/** How long to wait for a ringing dispatchUpdate before assuming the send
 *  was silently dropped server-side. */
export const DISPATCH_SEND_TIMEOUT_MS = 1_500;

/** A send confirmed never queued — client-local only, never sent by the
 *  server (so it is NOT one of DISPATCH_STATUSES/DISPATCH_STATUS_CHIPS). */
export interface SendFailure {
  id: string;
  machine: string;
  action: DispatchActionValue;
  detectedAt: number;
}

/** Splits pending sends into those still waiting and those that just timed
 *  out with no matching entry received since they were sent — pure so the
 *  timeout math is directly testable. */
export function detectSendFailures(
  pending: PendingSend[],
  entries: DispatchEntry[],
  now: number,
): { stillPending: PendingSend[]; failed: PendingSend[] } {
  const stillPending: PendingSend[] = [];
  const failed: PendingSend[] = [];
  for (const p of pending) {
    const matched = entries.some(
      (e) => e.machine === p.machine && e.action === p.action && e.receivedAt >= p.sentAt,
    );
    if (matched) continue; // resolved silently — the real entry is now in the tray
    if (now - p.sentAt >= DISPATCH_SEND_TIMEOUT_MS) {
      failed.push(p);
    } else {
      stillPending.push(p);
    }
  }
  return { stillPending, failed };
}

/** Send-failure chips auto-clear on the same schedule as terminal dispatch
 *  entries — they're informational, not sticky like DENIED. */
export const SEND_FAILURE_AUTOCLEAR_MS = DISPATCH_AUTOCLEAR_MS;

export function pruneSendFailures(failures: SendFailure[], now: number): SendFailure[] {
  return failures.filter((f) => now - f.detectedAt < SEND_FAILURE_AUTOCLEAR_MS);
}

/** One line of tray chip text for a send failure, e.g. "⚠ NOT QUEUED — MACBOOK". */
export function sendFailureChipLabel(failure: Pick<SendFailure, 'machine'>): string {
  return `⚠ NOT QUEUED — ${failure.machine}`;
}
