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

/** Providers offered in the CALL modal's picker (scope change 2026-07-08):
 *  gemini dropped from dispatch — Google killed the CLI's free tier
 *  (IneligibleTierError, confirmed live even on an upgraded gemini-cli).
 *  'gemini' stays valid on DISPATCH_PROVIDERS/the wire protocol/runner argv
 *  so nothing ripples through generated types or wave-1 tests; this is a
 *  UI-level filter only, applied against whatever a runner advertises. */
export const DISPATCH_UI_PROVIDERS: readonly DispatchProvider[] = ['claude', 'codex'];

export const DISPATCH_STATUSES = [
  'ringing',
  'answered',
  'denied',
  'expired',
  'exited',
  'killed',
] as const;
export type DispatchStatusValue = (typeof DISPATCH_STATUSES)[number];

export type DispatchActionValue = 'dispatch' | 'focus';

/** Mirrors dispatchStore.ts DISPATCH_PROMPT_MAX_CHARS — the modal's textarea cap. */
export const DISPATCH_PROMPT_MAX_CHARS = 4000;

/** Mirrors dispatchStore.ts DISPATCH_EFFORT_VALUES — the modal's EFFORT dropdown options. */
export const DISPATCH_EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type DispatchEffort = (typeof DISPATCH_EFFORT_VALUES)[number];

/** Providers with a real --effort-equivalent flag (bin/lib/dispatch-rules.mjs
 *  buildArgv is the enforcement point) — gates whether the modal even shows
 *  an EFFORT dropdown for the selected provider. */
export const DISPATCH_EFFORT_PROVIDERS: readonly DispatchProvider[] = ['claude'];

/** Mirrors dispatchStore.ts's model pattern — client-side hint only, the
 *  server validates for real. */
export const DISPATCH_MODEL_PATTERN = /^[a-zA-Z0-9._/-]{1,64}$/;

/** One MODEL dropdown entry: `value: ''` renders as "default (no flag)" and
 *  is omitted from argv entirely (buildArgv only appends --model when a
 *  non-empty value is present). */
export interface DispatchModelOption {
  value: string;
  label: string;
}

/** Per-provider MODEL dropdown options (CallModal — scope change 2026-07-08:
 *  free-text MODEL box replaced with a curated dropdown after Greg typed
 *  "4.6" into it and codex rejected it: `The '4.6' model is not supported
 *  when using Codex with a ChatGPT account.`).
 *
 *  - claude: aliases from `claude --help`'s --model description ("Provide an
 *    alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a
 *    model's full name") — fable/opus/sonnet/haiku each track a live Claude
 *    model family, verified 2026-07-08.
 *  - codex: Greg's Codex CLI runs on a ChatGPT plan, not an API key — most
 *    model ids 4xx immediately ("... not supported when using Codex with a
 *    ChatGPT account"), confirmed live for 'gpt-5.5-codex' this session
 *    (`codex exec -m gpt-5.5-codex` → the same 400 as the '4.6' failure).
 *    Bare 'gpt-5.5' is the only id confirmed to run
 *    (`~/.codex/config.toml`'s `[tui.model_availability_nux]` also lists only
 *    "gpt-5.5"). Re-verify with a real `codex exec` run before adding more
 *    entries — don't extrapolate from the 5.5 family naming pattern.
 *
 *  This enum is intentionally NOT enforced server-side (dispatchStore.ts
 *  keeps the old permissive regex) — a stale dropdown should degrade to "the
 *  option Greg wants isn't listed yet," never "the server 400s a model that
 *  started working after this file was written." */
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
  // `answered` = "a runner accepted", set BEFORE anything spawns — never a
  // ✓-success chip. pid present (runner's 'started' report) → RUNNING.
  answered: { glyph: '▸', word: 'ACCEPTED' },
  denied: { glyph: '⊘', word: 'DENIED' },
  expired: { glyph: '○', word: 'EXPIRED' },
  exited: { glyph: '■', word: 'EXITED' },
  // KICKOFF v1.1 item 3 (worker session kill) — a distinct terminal status,
  // never conflated with a natural EXITED.
  killed: { glyph: '✕', word: 'KILLED' },
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
  /** Capped tail of the run's log (dispatch action, exited status only) —
   *  the only place a run's actual output reaches the dashboard. */
  resultTail?: string;
  /** Client receipt time — anchors the auto-clear timer. */
  receivedAt: number;
}

/** Only `exited` entries carry a resultTail worth viewing (DENIED already
 *  shows its reason inline in the chip; EXPIRED means nobody ever ran
 *  anything, so there is no output to show) — this gates whether a tray
 *  chip is clickable to open the result view. */
export function hasViewableResult(entry: Pick<DispatchEntry, 'status'>): boolean {
  return entry.status === 'exited';
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
  entry: Pick<DispatchEntry, 'status' | 'reason' | 'exitCode' | 'pid'>,
): string {
  const { glyph, word } = DISPATCH_STATUS_CHIPS[entry.status];
  if (entry.status === 'answered' && entry.pid !== undefined) {
    return `${glyph} RUNNING`;
  }
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

// ── Subpath selection (CallModal: root dropdown + free-text subpath) ────
//
// The runner's own allowlist containment check (realpath + relative, see
// bin/lib/dispatch-rules.mjs validateRequest) is the REAL trust boundary —
// these are client-side conveniences only: joining a chosen root with a
// typed subpath, and rejecting an obvious `..` escape before it's even sent
// (an honest early "no" rather than a round trip that comes back denied).

export interface SubpathJoinResult {
  ok: boolean;
  cwd?: string;
  reason?: string;
}

/** Join an allowlisted root with a user-typed subpath into one cwd. Denies
 *  (client-side only — the runner denies again, for real) any `..` segment
 *  or a leading `/` (which would silently ignore the chosen root). */
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

/** Reverse of joinRootSubpath — given a full cwd (e.g. from a BRIEFING
 *  todo's DISPATCH prefill) and a machine's advertised roots, find which
 *  root it's under and what the remaining subpath is. Returns null if no
 *  advertised root contains it (the prefilled cwd may predate this machine's
 *  current allowlist, or belong to a different machine). */
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

/** True when `machine` has ANY live runner advertisement — unlike
 *  machineSupportsFocus, kill isn't gated by the allowlist's `focus` flag
 *  (a runner honors a stop instruction unconditionally; see
 *  dispatchStore.ts's StopInstruction doc for the two containment
 *  mechanisms that gate it instead). */
export function machineHasLiveRunner(
  machines: DispatchMachine[],
  machine: string | undefined,
): boolean {
  if (!machine) return false;
  return machines.some((m) => m.machine === machine);
}

/** Drawer KILL button eligibility (KICKOFF v1.1 item 3 — reach: any worker
 *  with a known pid, not just runner-spawned dispatches). Needs a real pid
 *  AND a live runner on that machine to have any chance of delivering the
 *  stop instruction — pure so the two honest disabled states ("NO PID" vs
 *  "NO RUNNER") are unit-testable without a rendering harness. */
export function canKillAgent(
  pid: number | undefined,
  machines: DispatchMachine[],
  machine: string | undefined,
): boolean {
  return pid !== undefined && machineHasLiveRunner(machines, machine);
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
