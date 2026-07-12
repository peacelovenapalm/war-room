/**
 * Drawer verb eligibility + identity helpers — a faithful port of the
 * proven pure slices of webview-ui/src/dispatch.ts (the frozen fallback is
 * read-only for WS-A). Pure so the honest disabled states ("NO PID" vs
 * "NO RUNNER") are unit-testable without a rendering harness.
 */

/** A machine advertisement from GET /api/dispatch/machines. */
export interface DispatchMachine {
  machine: string;
  providers: string[];
  roots: string[];
  focus: boolean;
  /** T2/T4 managed sessions — deny-by-default, same posture as `focus`. */
  sessions: boolean;
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

/** True when `machine` has ANY live runner advertisement — kill isn't gated
 *  by the allowlist's `focus` flag (a runner honors a stop instruction
 *  unconditionally; the runner's own registry is the real containment). */
export function machineHasLiveRunner(
  machines: DispatchMachine[],
  machine: string | undefined,
): boolean {
  if (!machine) return false;
  return machines.some((m) => m.machine === machine);
}

/** KILL button eligibility (KICKOFF v1.1 item 3): needs a real pid (from
 *  server hook telemetry) AND a live runner on that machine to have any
 *  chance of delivering the stop instruction. */
export function canKillAgent(
  pid: number | undefined,
  machines: DispatchMachine[],
  machine: string | undefined,
): boolean {
  return pid !== undefined && machineHasLiveRunner(machines, machine);
}

// ── CALL modal + dispatch tray (stage-3 port of webview-ui/src/dispatch.ts) ──
//
// Faithful port of the proven pure slices (the frozen fallback is read-only
// for WS-A). Mirrors core/src/messages.ts's DispatchStatusValue/
// DispatchActionValue/DispatchRequest.

export const DISPATCH_PROVIDERS = ['claude', 'codex', 'gemini'] as const;
export type DispatchProvider = (typeof DISPATCH_PROVIDERS)[number];

/** Providers offered in the CALL modal's picker — gemini stays valid on the
 *  wire (DISPATCH_PROVIDERS) but is UI-filtered (mirrors webview-ui's
 *  2026-07-08 scope change: Google killed the CLI's free tier). */
export const DISPATCH_UI_PROVIDERS: readonly DispatchProvider[] = ['claude', 'codex'];

export const DISPATCH_STATUSES = [
  'ringing',
  'answered',
  'denied',
  'expired',
  'exited',
  'killed',
  // T5 fleet controls: capped (runner-timer-ended, distinct from
  // killed/exited) and queued-budget (held, never sent to a runner).
  'capped',
  'queued-budget',
] as const;
export type DispatchStatusValue = (typeof DISPATCH_STATUSES)[number];

export type DispatchActionValue = 'dispatch' | 'focus' | 'session';

/** Mirrors server/src/dispatchStore.ts DISPATCH_PROMPT_MAX_CHARS. */
export const DISPATCH_PROMPT_MAX_CHARS = 4000;

/** Mirrors server/src/dispatchStore.ts DISPATCH_TIMEOUT_MAX_SEC (T5 fleet
 *  controls) — client-side hint only, the server validates for real. */
export const DISPATCH_TIMEOUT_MAX_SEC = 3600;

/** Mirrors server/src/dispatchStore.ts DISPATCH_EFFORT_VALUES. */
export const DISPATCH_EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type DispatchEffort = (typeof DISPATCH_EFFORT_VALUES)[number];

/** Providers with a real --effort-equivalent flag — gates whether the CALL
 *  modal shows an EFFORT dropdown for the selected provider. */
export const DISPATCH_EFFORT_PROVIDERS: readonly DispatchProvider[] = ['claude'];

export interface DispatchModelOption {
  value: string;
  label: string;
}

/** Per-provider MODEL dropdown options — client-side hint only, the server
 *  validates for real. Mirrors webview-ui's curated set (2026-07-08). */
export const DISPATCH_MODEL_OPTIONS: Partial<Record<DispatchProvider, DispatchModelOption[]>> = {
  claude: [
    { value: '', label: 'default (no flag)' },
    { value: 'fable', label: 'fable' },
    { value: 'opus', label: 'opus' },
    { value: 'sonnet', label: 'sonnet' },
    { value: 'haiku', label: 'haiku' },
  ],
  codex: [
    { value: '', label: 'default (no flag)' },
    { value: 'gpt-5.5', label: 'gpt-5.5 (verified — ChatGPT plan)' },
  ],
};

/** DENIED chips are sticky (dismiss only); every other terminal status
 *  auto-clears after this long. */
export const DISPATCH_AUTOCLEAR_MS = 60_000;

interface DispatchStatusSpec {
  /** Distinct shape per status — the primary signal together with the word. */
  glyph: string;
  /** Uppercase text label — the other primary signal (colorblind rule). */
  word: string;
}

/** Colorblind rule: every tray chip is GLYPH + WORD, color reinforcement only.
 *
 *  `answered` means only "a runner ACCEPTED the request" (it is set before
 *  anything spawns) — the chip must never read as lasting success. The
 *  word splits on the broadcast's pid: no pid yet → ACCEPTED (accepted,
 *  not yet spawned), pid present (the runner's 'started' report) →
 *  RUNNING. Neither gets the ✓ glyph — that stays reserved for a real
 *  outcome. See dispatchChipLabel. */
export const DISPATCH_STATUS_CHIPS: Record<DispatchStatusValue, DispatchStatusSpec> = {
  ringing: { glyph: '◎', word: 'RINGING' },
  answered: { glyph: '▸', word: 'ACCEPTED' },
  denied: { glyph: '⊘', word: 'DENIED' },
  expired: { glyph: '○', word: 'EXPIRED' },
  exited: { glyph: '■', word: 'EXITED' },
  killed: { glyph: '✕', word: 'KILLED' },
  capped: { glyph: '✗', word: 'CAPPED' },
  'queued-budget': { glyph: '⏸', word: 'HELD' },
};

/** Mirrors core's DispatchUpdate broadcast, plus a client receipt timestamp
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
  resultTail?: string;
  /** T5 fleet controls, PER-DISPATCH TIME CAP — echo of the request's
   *  timeoutSec, present only when the request carried one. Lets a
   *  `capped` chip render "(Ns)" without a second round trip. */
  timeoutSec?: number;
  /** Echo of the requestId THIS client (or another) sent with its
   *  dispatchRequest — the send-failure detector's exact correlation key.
   *  Absent for server-originated dispatches (chains, standing orders). */
  requestId?: string;
  receivedAt: number;
}

/** `exited` and `capped` (T5 fleet controls — the runner reports a
 *  resultTail alongside a cap, same as any other terminal dispatch) entries
 *  carry a resultTail worth viewing. */
export function hasViewableResult(entry: Pick<DispatchEntry, 'status'>): boolean {
  return entry.status === 'exited' || entry.status === 'capped';
}

/** Pure auto-clear rule: RINGING/ANSWERED/DENIED never auto-clear;
 *  EXPIRED/EXITED/KILLED/CAPPED clear once older than DISPATCH_AUTOCLEAR_MS.
 *  QUEUED-BUDGET (T5 fleet controls) is sticky like DENIED — it needs an
 *  explicit release (or the date-rollover release), never a silent
 *  disappearance while still genuinely held. */
export function shouldAutoClear(status: DispatchStatusValue, ageMs: number): boolean {
  if (
    status === 'ringing' ||
    status === 'answered' ||
    status === 'denied' ||
    status === 'queued-budget'
  ) {
    return false;
  }
  return ageMs >= DISPATCH_AUTOCLEAR_MS;
}

/** One line of tray chip text, e.g. "◎ RINGING", "⊘ DENIED — reason",
 *  "■ EXITED (code 0)", "✗ CAPPED (300s)", "⏸ HELD — reason". */
export function dispatchChipLabel(
  entry: Pick<DispatchEntry, 'status' | 'reason' | 'exitCode' | 'timeoutSec' | 'pid'>,
): string {
  const { glyph, word } = DISPATCH_STATUS_CHIPS[entry.status];
  if (entry.status === 'answered' && entry.pid !== undefined) {
    // pid arrives with the runner's 'started' report — the child is
    // actually running, not merely accepted.
    return `${glyph} RUNNING`;
  }
  if (entry.status === 'denied' && entry.reason) return `${glyph} ${word} — ${entry.reason}`;
  if (entry.status === 'queued-budget' && entry.reason) return `${glyph} ${word} — ${entry.reason}`;
  if (entry.status === 'capped' && entry.timeoutSec !== undefined) {
    return `${glyph} ${word} (${String(entry.timeoutSec)}s)`;
  }
  if (entry.status === 'exited' && entry.exitCode !== undefined) {
    return `${glyph} ${word} (code ${String(entry.exitCode)})`;
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

// ── Subpath selection (CallModal: root dropdown + free-text subpath) ────
//
// The runner's own allowlist containment check is the REAL trust boundary
// — these are client-side conveniences only.

export interface SubpathJoinResult {
  ok: boolean;
  cwd?: string;
  reason?: string;
}

/** Join an allowlisted root with a user-typed subpath into one cwd. */
export function joinRootSubpath(root: string, subpath: string): SubpathJoinResult {
  const trimmed = subpath.trim();
  if (trimmed === '') return { ok: true, cwd: root };
  if (trimmed.startsWith('/')) {
    return { ok: false, reason: 'subpath must be relative to the chosen root, not absolute' };
  }
  const segments = trimmed.split('/').filter((s) => s !== '');
  if (segments.some((s) => s === '..')) {
    return { ok: false, reason: 'subpath must not contain ".."' };
  }
  const normalizedRoot = root.replace(/\/+$/, '');
  return { ok: true, cwd: `${normalizedRoot}/${segments.join('/')}` };
}

/** Reverse of joinRootSubpath — given a full cwd and a machine's advertised
 *  roots, find which root it's under and what the remaining subpath is. */
export function splitCwdIntoRootSubpath(
  cwd: string,
  roots: string[],
): { root: string; subpath: string } | null {
  for (const root of roots) {
    const normalizedRoot = root.replace(/\/+$/, '');
    if (cwd === normalizedRoot) return { root, subpath: '' };
    if (cwd.startsWith(`${normalizedRoot}/`)) {
      return { root, subpath: cwd.slice(normalizedRoot.length + 1) };
    }
  }
  return null;
}

/** True when `machine` has a live runner advertisement with focus capability
 *  enabled. */
export function machineSupportsFocus(
  machines: DispatchMachine[],
  machine: string | undefined,
): boolean {
  if (!machine) return false;
  return machines.some((m) => m.machine === machine && m.focus);
}

/** True when `machine` has a live runner advertisement with the T2/T4
 *  managed-session capability enabled (deny-by-default — absent = false,
 *  same posture as machineSupportsFocus). */
export function machineSupportsSessions(
  machines: DispatchMachine[],
  machine: string | undefined,
): boolean {
  if (!machine) return false;
  return machines.some((m) => m.machine === machine && m.sessions);
}

// ── Send-failure detection ──────────────────────────────────────────
//
// dispatchRequest has NO ack on the wire: an invalid send is silently
// dropped. The only honest signal available client-side is absence — and
// absence is only decidable with EXACT correlation: the request carries a
// client-generated requestId the server echoes on every dispatchUpdate
// for that queue entry. (The old fuzzy machine+action+time match let one
// real ack mask a DIFFERENT dropped dispatch — panel finding,
// dispatchFacts.ts:283.)

export interface PendingSend {
  /** The requestId sent on the wire — matched against the echoed
   *  DispatchEntry.requestId, nothing fuzzier. */
  id: string;
  machine: string;
  action: DispatchActionValue;
  sentAt: number;
}

export const DISPATCH_SEND_TIMEOUT_MS = 1_500;

export interface SendFailure {
  id: string;
  machine: string;
  action: DispatchActionValue;
  detectedAt: number;
}

export function detectSendFailures(
  pending: PendingSend[],
  entries: DispatchEntry[],
  now: number,
): { stillPending: PendingSend[]; failed: PendingSend[] } {
  const stillPending: PendingSend[] = [];
  const failed: PendingSend[] = [];
  for (const p of pending) {
    const matched = entries.some((e) => e.requestId !== undefined && e.requestId === p.id);
    if (matched) continue;
    if (now - p.sentAt >= DISPATCH_SEND_TIMEOUT_MS) {
      failed.push(p);
    } else {
      stillPending.push(p);
    }
  }
  return { stillPending, failed };
}

export const SEND_FAILURE_AUTOCLEAR_MS = DISPATCH_AUTOCLEAR_MS;

export function pruneSendFailures(failures: SendFailure[], now: number): SendFailure[] {
  return failures.filter((f) => now - f.detectedAt < SEND_FAILURE_AUTOCLEAR_MS);
}

export function sendFailureChipLabel(failure: Pick<SendFailure, 'machine'>): string {
  return `⚠ NOT QUEUED — ${failure.machine}`;
}
