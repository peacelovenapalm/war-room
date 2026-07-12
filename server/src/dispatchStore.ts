/**
 * Dispatch queue store (v1 mechanic #6b — "call a coworker").
 *
 * The server NEVER shells out. This is a queue only: the webview enqueues a
 * `dispatch` (start a real headless CLI run) or `focus` (front a session's
 * terminal) request; a per-machine dispatch runner (opt-in, runbook-
 * installed, `bin/dispatch-runner.mjs`) polls it over the authed channel
 * (`POST /api/dispatch/poll`) and decides locally against its own allowlist
 * — the server cannot override that decision. See
 * `.planning/DISPATCH-6B-DESIGN.md` for the full threat model.
 *
 * Deny is a decision, not an error: `decide()` and `reportStatus()` return
 * `{ ok: true }` even for an unknown/already-terminal id — callers (the
 * HTTP routes) always reply 2xx on the decision plane, never 403/404.
 *
 * Persisted like progressionStore.ts (file-backed, tolerant, throttle-free —
 * a live queue mutates far less often than progression but every mutation
 * matters for restart survival, so writes are NOT throttled here). Every
 * transition also appends a JSONL line to the audit log (append-only, both
 * ends — the runner keeps its own).
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR } from './constants.js';

const DISPATCH_FILE_NAME = 'dispatch-queue.json';
const DISPATCH_AUDIT_FILE_NAME = 'dispatch-audit.jsonl';

/** A ringing request unanswered this long is swept to `expired`. */
export const DISPATCH_TTL_MS = 600_000; // 10 minutes
/** Per-machine cap on simultaneously RINGING requests (backpressure). */
export const DISPATCH_RINGING_CAP = 5;
/** A machine's runner advertisement (providers/roots/focus) older than this
 *  is treated as absent — a machine without a live runner is honestly
 *  missing from GET /api/dispatch/machines rather than stale-listed. */
export const DISPATCH_MACHINE_AD_TTL_MS = 30_000;
/** Cap on the HUMAN-typed prompt (validated at enqueue, before the 4B
 *  context preamble is prefixed) — the persisted/runner-bound prompt may
 *  exceed this by DISPATCH_CONTEXT_PREAMBLE.length, a server-owned
 *  constant cost, never wire-controlled. */
export const DISPATCH_PROMPT_MAX_CHARS = 4000;
/** promptPreview length on the broadcast plane — the full prompt never
 *  travels here (only on the Bearer-authed runner poll). */
export const DISPATCH_PROMPT_PREVIEW_MAX_CHARS = 120;
/** resultTail cap, applied again here even though the runner already caps
 *  its read (~8KB) — never trust the wire for a size limit twice enforced is
 *  a limit actually held. Keeps the WS broadcast plane and the persisted
 *  queue file bounded regardless of what a runner sends. */
export const DISPATCH_RESULT_TAIL_MAX_CHARS = 8192;

/** LLM providers — a `dispatch` with one of these requires a prompt. */
export const DISPATCH_PROVIDERS = ['claude', 'codex', 'gemini'] as const;
/** `shell` (T8 Mini compute, MINI-COMPUTE-NODE.md) is a NON-LLM provider:
 *  it carries a scriptId + args instead of a prompt/cwd, resolved entirely
 *  against the runner's machine-local `compute` registry (the server never
 *  knows the interpreter/path — the wire carries intent, not capability). */
export const ALL_DISPATCH_PROVIDERS = [...DISPATCH_PROVIDERS, 'shell'] as const;
export type DispatchProvider = (typeof ALL_DISPATCH_PROVIDERS)[number];
/** An opaque compute scriptId (never a path) — same token shape the runner's
 *  dispatch-rules.mjs enforces. */
const COMPUTE_SCRIPT_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
/** Server-side arg-count ceiling for a `shell` dispatch — the runner's
 *  registry may lower it per-script (COMPUTE_MAX_ARGS_CEILING in
 *  dispatch-rules.mjs); this is the outer backstop before it ever rings. */
const COMPUTE_MAX_ARGS_CEILING = 16;
/** Per-arg charset+length gate, MIRRORED from the runner's COMPUTE_ARG_PATTERN
 *  (dispatch-rules.mjs) so an oversized/metacharacter arg is rejected BEFORE
 *  it rides server persistence (dispatch-queue.json) + the audit log — never
 *  trust the wire for a limit the runner already holds, twice-enforced is a
 *  limit actually held (same discipline as DISPATCH_RESULT_TAIL_MAX_CHARS). */
const COMPUTE_ARG_PATTERN = /^[a-zA-Z0-9._/=:@,+-]{1,256}$/;
/** 4B skill advertisement — MIRRORS the runner's SKILL_NAME_PATTERN
 *  (bin/dispatch-runner.mjs): dir-name tokens only. Re-enforced here
 *  because the CALL modal inserts these names into editable prompt text. */
const SKILL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const SKILLS_ADVERTISED_MAX = 200;

/** Providers a runner actually has an `--effort`-equivalent flag for
 *  (bin/lib/dispatch-rules.mjs buildArgv is the enforcement point) — the
 *  enum here is intentionally broader than any one provider supports, since
 *  effort is validated once at the request level and providers without a
 *  matching flag simply omit it. */
export const DISPATCH_EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type DispatchEffort = (typeof DISPATCH_EFFORT_VALUES)[number];

/** 4B permission-mode toggle. CLOSED enum, validated here AND mapped to a
 *  flag only through the runner's own member check — a free-text mode would
 *  be an arbitrary-flag injection surface on the dispatched CLI. `default`
 *  = omit the flag (whatever the CLI does unattended today); `plan` =
 *  `--permission-mode plan` (claude only — other providers silently omit,
 *  same discipline as effort). */
export const DISPATCH_PERMISSION_MODE_VALUES = ['default', 'plan'] as const;
export type DispatchPermissionMode = (typeof DISPATCH_PERMISSION_MODE_VALUES)[number];

/** 4B/5 dispatch context preamble — prefixed onto every non-empty LLM prompt
 *  at ENQUEUE time (never in pendingFor) so the persisted record, the audit
 *  log, and the runner all carry the EXACT same text. Rationale: a
 *  dispatched agent otherwise has zero idea a console drove it (verified
 *  live 2026-07-12 — it couldn't say what UI it ran under). Sessions
 *  launched with no brief stay bare — injecting a preamble there would turn
 *  a bare TUI launch into a running turn. promptPreview strips this prefix
 *  (the human's own words are the useful preview; the audit keeps it all).
 *  Phase 5 split: jobs and sessions share a base but diverge on the
 *  interaction contract — a one-shot job must never stall on a question
 *  (nobody can answer it), while a managed session CAN be answered from the
 *  board (T2 remote-answer plane). Both tell the agent to restate this
 *  context when spawning subagents — Greg's dispatched gsd agent proved
 *  skill-spawned subagents otherwise self-report "not in war room". */
const DISPATCH_PREAMBLE_BASE =
  '[WAR ROOM] You were dispatched from the War Room console. Your final output ' +
  'is read on a phone dashboard tray — lead with the outcome and keep it tight. ' +
  'The knowledge vault lives at /Users/greg/Brain2/vault (knowledge graph: ' +
  'python3 vault/scripts/graph_query.py --help, run from /Users/greg/Brain2/vault) — ' +
  'consult it before re-deriving project context. If other agents may share ' +
  'your checkout, prefer an isolated git worktree for writes. If you spawn ' +
  'subagents (or invoke a skill that does), restate this dispatch context in ' +
  'their prompts — they cannot see it otherwise. ';
export const DISPATCH_CONTEXT_PREAMBLE =
  DISPATCH_PREAMBLE_BASE +
  'This is a ONE-SHOT job: no human can answer questions mid-run, so never stop ' +
  'to ask — state your assumptions and proceed.\n\n---\n\n';
export const DISPATCH_SESSION_PREAMBLE =
  DISPATCH_PREAMBLE_BASE +
  'This is a PERSISTENT session: an operator can send answers remotely from the ' +
  'console. If genuinely blocked, ask ONE concise question and wait.\n\n---\n\n';
/** Neither variant prefixes the other (suffixes diverge at the first char
 *  past the shared base), so a plain startsWith sweep is unambiguous. */
const DISPATCH_PREAMBLES = [DISPATCH_CONTEXT_PREAMBLE, DISPATCH_SESSION_PREAMBLE] as const;
export function stripDispatchPreamble(prompt: string): string {
  for (const p of DISPATCH_PREAMBLES) {
    if (prompt.startsWith(p)) return prompt.slice(p.length);
  }
  return prompt;
}

/** A short model identifier/alias (e.g. 'fable', 'claude-fable-5', 'o3') —
 *  intentionally permissive (covers every provider's own naming scheme)
 *  while still rejecting anything that couldn't be a single argv token. */
const DISPATCH_MODEL_PATTERN = /^[a-zA-Z0-9._/-]{1,64}$/;
/** requestId cap (mirrors asyncapi maxLength 64) — overlong ids are DROPPED,
 *  never truncated: a truncated echo would mis-correlate on the client. */
const REQUEST_ID_MAX_CHARS = 64;
/** Per-dispatch timeoutSec upper bound (mirrors asyncapi's maximum: 3600) —
 *  T5 fleet controls, PER-DISPATCH TIME CAP. */
export const DISPATCH_TIMEOUT_MAX_SEC = 3600;

export type DispatchAction = 'dispatch' | 'focus' | 'session';
/** `capped` (T5 fleet controls): the dispatch hit its optional timeoutSec
 *  and was ended by the runner's own timer — a DISTINCT terminal status,
 *  never conflated with `killed` (human-initiated) or a natural `exited`.
 *  `queued-budget` (T5 fleet controls): accepted but HELD — never sent to a
 *  runner — because today's real fleet token spend crossed the configured
 *  daily ceiling; non-terminal, releases to `ringing` via an explicit
 *  override or an automatic local-date rollover. */
export type DispatchStatus =
  'ringing' | 'answered' | 'denied' | 'expired' | 'exited' | 'killed' | 'capped' | 'queued-budget';

/** A queued instruction attached to the NEXT poll response for the target
 *  machine (KICKOFF v1.1 item 3 — the first server->runner IMPERATIVE
 *  channel; everything before this was runner-polls-and-decides). Two
 *  distinct, never-conflated targeting kinds:
 *   - 'dispatch': kill a child THIS runner itself spawned, identified by the
 *     dispatch queue id — the runner honors this ONLY if `id` is in its own
 *     in-memory live-children registry (bin/dispatch-runner.mjs). No
 *     registry match => a reported 'not-found' outcome, NEVER a raw
 *     process.kill(pid) fallback.
 *   - 'pid': kill an OBSERVED session (any worker with a known pid,
 *     including one this runner never spawned) — the runner honors this
 *     ONLY after locally verifying the target pid is actually a claude
 *     process (name/cmdline check via `ps`). A verification failure denies
 *     with a reason, never a raw signal on an unverified target.
 *  Delivered at-most-once (drained on read, same fire-and-forget tolerance
 *  as the rest of this file's best-effort POSTs) — a lost delivery just
 *  means the human can click kill again. */
export type StopInstruction =
  { kind: 'dispatch'; id: string } | { kind: 'pid'; id: string; pid: number };

export type PidKillStatus = 'pending' | 'killed' | 'denied';

/** An observed-session kill request (mechanic: worker session kill, reach =
 *  "any worker with a known pid", not just runner-spawned dispatches). Kept
 *  in-memory only (not persisted) — a transient user action, same tolerance
 *  as the frontend's own ephemeral send-failure tracking; a lost record on
 *  server restart just means an in-flight kill request's outcome is no
 *  longer queryable, not that anything unsafe happened. */
interface PidKillRecord {
  id: string;
  machine: string;
  pid: number;
  status: PidKillStatus;
  reason?: string;
  createdAt: number;
  updatedAt: number;
}

/** One dispatch queue entry, persisted in full (including the prompt) on the
 *  server's own machine — separate from the WS broadcast plane, which only
 *  ever carries `promptPreview`. */
interface DispatchRecord {
  id: string;
  action: DispatchAction;
  machine: string;
  provider?: DispatchProvider;
  cwd?: string;
  prompt?: string;
  sessionId?: string;
  pid?: number;
  model?: string;
  effort?: DispatchEffort;
  /** 4B permission-mode toggle — closed enum, validated in enqueue(). */
  permissionMode?: DispatchPermissionMode;
  /** T8 Mini compute — opaque scriptId + plain-token args for a `shell`
   *  dispatch (resolved to interpreter/path ONLY by the runner's local
   *  registry; the server never knows the path). */
  scriptId?: string;
  args?: string[];
  /** T5 fleet controls, PER-DISPATCH TIME CAP — optional wall-clock cap in
   *  seconds, threaded to the runner via pendingFor()'s DispatchRunnerItem. */
  timeoutSec?: number;
  status: DispatchStatus;
  reason?: string;
  exitCode?: number;
  /** Tail of the run's log, reported by the runner alongside `exited` — the
   *  only place a run's actual output reaches the dashboard. Capped at
   *  DISPATCH_RESULT_TAIL_MAX_CHARS regardless of what the runner sends. */
  resultTail?: string;
  /** Chain correlation (v2 mechanic G3, GAME-DESIGN.md §7.1) — additive,
   *  optional, set only when this dispatch is one step of a chain run.
   *  chainOrchestrator.ts is the only writer (via enqueue()); a manual
   *  CallModal dispatch never carries these. */
  chainRunId?: string;
  chainStep?: number;
  /** Employee correlation (v2 mechanic G3, §7.3) — set when a chain step or
   *  standing order dispatches on behalf of a specific employee. Consumed
   *  by httpServer.ts's status route to fire employeeStore.recordDispatchExit
   *  on a real exit ("employeeWorkCompleted", GAME-DESIGN §7.3's one
   *  dispatch-driven XP integration point). */
  employeeId?: string;
  /** Contract correlation (v2 mechanic G4, §6.2) — an explicit field set by
   *  the webview's BRIEFING→DISPATCH prefill action, never inferred by
   *  string-matching the prompt text (the fix for a brittleness the design
   *  flagged in its own risk list). On a terminal exit 0, httpServer.ts's
   *  status route calls contractStore.completeByDispatch(contractId). */
  contractId?: string;
  /** Send correlation (asyncapi DispatchRequest.requestId) — client-
   *  generated, echoed on every broadcast for this record. */
  requestId?: string;
  createdAt: number;
  updatedAt: number;
}

/** Input to `enqueue()` — mirrors the DispatchRequest WS message. */
export interface DispatchEnqueueInput {
  action: DispatchAction;
  machine: string;
  provider?: string;
  cwd?: string;
  prompt?: string;
  sessionId?: string;
  pid?: number;
  model?: string;
  effort?: string;
  /** 4B permission-mode toggle — validated against
   *  DISPATCH_PERMISSION_MODE_VALUES in enqueue(). */
  permissionMode?: string;
  /** T8 Mini compute — opaque scriptId + plain-token args (shell provider). */
  scriptId?: string;
  args?: string[];
  /** T5 fleet controls, PER-DISPATCH TIME CAP — validated against
   *  DISPATCH_TIMEOUT_MAX_SEC in enqueue(). */
  timeoutSec?: number;
  /** Chain correlation (G3, §7.1) — set only by chainOrchestrator.ts. */
  chainRunId?: string;
  chainStep?: number;
  /** Employee correlation (G3, §7.3) — set by chainOrchestrator.ts/
   *  standingOrderStore.ts when dispatching on behalf of an employee. */
  employeeId?: string;
  /** Contract correlation (G4, §6.2) — set explicitly by the webview's
   *  BRIEFING→DISPATCH prefill action. */
  contractId?: string;
  /** Send correlation (asyncapi DispatchRequest.requestId) — a client-
   *  generated id echoed verbatim on every broadcast for this record, so
   *  the sending client's silent-drop detector matches exactly. Capped at
   *  REQUEST_ID_MAX_CHARS; anything longer is dropped (never truncated —
   *  a truncated id would mis-correlate). */
  requestId?: string;
}

export type DispatchEnqueueResult =
  { ok: true; record: Readonly<DispatchRecord> } | { ok: false; reason: string };

/** Broadcast-friendly snapshot (WS `dispatchUpdate` / replay on connect). */
export interface DispatchBroadcast {
  type: 'dispatchUpdate';
  id: string;
  action: DispatchAction;
  status: DispatchStatus;
  machine: string;
  provider?: DispatchProvider;
  promptPreview?: string;
  reason?: string;
  pid?: number;
  exitCode?: number;
  /** Terminal-run output tail (dispatch action, `exited` status only) — the
   *  same trust level as promptPreview: capped, never the full log. */
  resultTail?: string;
  /** Chain correlation (G3, §7.1) — present only for chain-step dispatches.
   *  chainOrchestrator.ts is the sole subscriber that acts on these; the
   *  webview client is free to ignore them. */
  chainRunId?: string;
  chainStep?: number;
  /** T5 fleet controls — verbatim echo, present only when the request
   *  carried one (lets a `capped` render "(Ns)" without a second round trip). */
  timeoutSec?: number;
  /** Send correlation echo (asyncapi DispatchUpdate.requestId) — present
   *  only when the originating client supplied one. */
  requestId?: string;
}

/** What a runner receives on `POST /api/dispatch/poll` — the ONLY place the
 *  full prompt travels over the wire, and only Bearer-authed. */
export interface DispatchRunnerItem {
  id: string;
  action: DispatchAction;
  provider?: DispatchProvider;
  cwd?: string;
  prompt?: string;
  sessionId?: string;
  pid?: number;
  model?: string;
  effort?: DispatchEffort;
  /** 4B permission-mode toggle — the runner maps enum members to a flag,
   *  never free text (dispatch-rules.mjs permissionModeFlag). */
  permissionMode?: DispatchPermissionMode;
  /** T8 Mini compute — the runner resolves scriptId + args against its own
   *  registry (buildComputeArgv); the wire never carries interpreter/path. */
  scriptId?: string;
  args?: string[];
  /** T5 fleet controls, PER-DISPATCH TIME CAP — the runner arms its own
   *  timer on spawn when present. */
  timeoutSec?: number;
}

/** A runner's self-advertised capability, refreshed on every poll tick. */
export interface DispatchMachineAdvertisement {
  machine: string;
  providers: string[];
  roots: string[];
  focus: boolean;
  /** T2/T4 managed sessions — true only when the runner's allowlist carries
   *  the literal `"sessions": true` (deny-by-default, same as focus). */
  sessions: boolean;
  /** T8 Mini compute — the NAMES of the machine's registered compute scripts
   *  (never the interpreter/path). Drives the CALL tray's script picker so a
   *  shell dispatch is always a pick, never free-text. */
  scriptIds: string[];
  /** 4B skill picker — the machine's global skill NAMES (~/.claude/skills
   *  dir names, pattern-filtered + capped by the runner AND re-filtered
   *  here). Names only: the picker composes a visible `/name` prefix into
   *  the prompt client-side; no skill field ever rides a dispatch. */
  skills: string[];
  lastSeenAt: number;
}

// ── T2 remote-answer plane (REMOTE-ANSWER-DESIGN.md) ─────────────

/** One managed session as advertised by its runner on every poll tick —
 *  entries the runner just re-derived as alive-in-tmux from its own
 *  manifest. The server NEVER invents these; the advertisement is the only
 *  source, and it goes stale with the machine advertisement (TTL). */
export interface ManagedSessionAd {
  dispatchId: string;
  tmuxSession: string;
  panePid?: number;
  cwd?: string;
  provider?: string;
  createdAt?: number;
}

/** What rides the poll response's `answer` array — the same drained
 *  at-most-once imperative channel as stop[]. `nonce` is minted here
 *  (one per request) and consumed exactly once runner-side. */
export interface AnswerInstruction {
  id: string;
  managedSessionRef: string;
  text: string;
  nonce: string;
}

export type AnswerStatus = 'pending' | 'delivered' | 'denied';

/** Answer request lifecycle record. In-memory only (a transient human
 *  action, same tolerance as PidKillRecord) — but every transition ALSO
 *  lands in the append-only audit JSONL with the VERBATIM text, which is
 *  the durable receipt the design requires. */
interface AnswerRecord {
  id: string;
  machine: string;
  managedSessionRef: string;
  text: string;
  nonce: string;
  status: AnswerStatus;
  reason?: string;
  createdAt: number;
  updatedAt: number;
}

/** Wire-facing receipt (drawer render) — the verbatim text IS the receipt
 *  (one-tap-real). Same trust plane as the rest of the tailnet read API. */
export interface AnswerReceipt {
  id: string;
  machine: string;
  managedSessionRef: string;
  text: string;
  status: AnswerStatus;
  reason?: string;
  createdAt: number;
  updatedAt: number;
}

/** Answer text cap — matches the runner's own ANSWER_TEXT_MAX_CHARS
 *  (bin/lib/managed-sessions.mjs); twice-enforced is a limit actually held. */
export const ANSWER_TEXT_MAX_CHARS = 4000;
/** A pending answer never drained/reported within this window sweeps to a
 *  terminal denied/'expired' — the board must never show DELIVERING…
 *  forever for a runner that vanished. Same TTL as ringing dispatches. */
export const ANSWER_TTL_MS = DISPATCH_TTL_MS;
/** Receipts kept per machine (in-memory ring; the audit JSONL is the
 *  unbounded durable record). */
const ANSWER_RECEIPTS_MAX = 50;

/** Control characters are rejected server-side too (the runner re-checks) —
 *  Enter is delivered separately by the runner, never embedded. */

const ANSWER_CONTROL_CHARS = /[\x00-\x1F\x7F]/;

function defaultDispatchFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, DISPATCH_FILE_NAME);
}

function defaultAuditFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, DISPATCH_AUDIT_FILE_NAME);
}

function isValidAction(value: unknown): value is DispatchAction {
  return value === 'dispatch' || value === 'focus' || value === 'session';
}

function isValidProvider(value: unknown): value is DispatchProvider {
  return typeof value === 'string' && (ALL_DISPATCH_PROVIDERS as readonly string[]).includes(value);
}
/** LLM providers only — a `shell` dispatch takes a scriptId, not a prompt. */
function isLlmProvider(value: unknown): boolean {
  return typeof value === 'string' && (DISPATCH_PROVIDERS as readonly string[]).includes(value);
}

export class DispatchStore {
  private records: Map<string, DispatchRecord> | null = null;
  private readonly machines = new Map<string, DispatchMachineAdvertisement>();
  private listeners: Array<(broadcast: DispatchBroadcast) => void> = [];

  /** Stop instructions queued per machine — drained (popped) by the poll
   *  route, never persisted (see StopInstruction doc). */
  private readonly stopQueue = new Map<string, StopInstruction[]>();
  /** Observed-session pid-kill requests, keyed by their own generated id
   *  (there is no dispatch record to key against) — in-memory only. */
  private readonly pidKillRequests = new Map<string, PidKillRecord>();

  /** T2 remote-answer plane: per-machine advertised managed sessions
   *  (refreshed every poll tick, TTL'd like the machine ad), the per-machine
   *  answer instruction queue (drained at-most-once), and the answer
   *  lifecycle records (in-memory; the audit JSONL is the durable receipt). */
  private readonly managedSessions = new Map<
    string,
    { sessions: ManagedSessionAd[]; lastSeenAt: number }
  >();
  private readonly answerQueue = new Map<string, AnswerInstruction[]>();
  private readonly answerRequests = new Map<string, AnswerRecord>();

  private explicitPath: string | undefined;
  private resolvedPath: string | undefined;
  private usingDefaultPath = false;

  private explicitAuditPath: string | undefined;
  private resolvedAuditPath: string | undefined;

  /** T5 fleet controls, DAILY FLEET SPEND CEILING — an injected closure, set
   *  once at server startup (httpServer.ts), NOT a direct import of
   *  autoExecutorStore/shiftStats (one-way layering, same discipline
   *  worldEventStore's deps-object keeps: this store doesn't know WHAT
   *  feeds the ceiling/spend numbers, only that enqueue() should hold new
   *  dispatch requests once spend has crossed it). `null`/undefined-return
   *  means no ceiling configured — current (unbounded) behavior. */
  private budgetGate: (() => { ceiling: number; spend: number } | null) | undefined;

  /** Codex fix round finding 1 — an injected closure (same one-way-layering
   *  discipline as budgetGate), consulted ONLY by the automatic rollover
   *  sweep. Returns true while STOP ALL's kill switch is engaged, which
   *  freezes sweepHeldRollover() entirely; a human's explicit releaseHeld()
   *  is deliberately NOT gated by this — the kill switch suppresses
   *  unattended automation, never a conscious human override. */
  private heldReleaseGate: (() => boolean) | undefined;

  constructor(persistPath?: string, auditPath?: string) {
    this.explicitPath = persistPath;
    this.explicitAuditPath = auditPath;
  }

  /** Subscribe to dispatch lifecycle broadcasts. Returns an unsubscribe function. */
  onUpdate(listener: (broadcast: DispatchBroadcast) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** T5 fleet controls — wire (or clear, passing undefined) the daily
   *  spend-ceiling check. See the `budgetGate` field doc above. */
  setBudgetGate(gate: (() => { ceiling: number; spend: number } | null) | undefined): void {
    this.budgetGate = gate;
  }

  /** Codex fix round finding 1 — wire (or clear) the STOP ALL kill-switch
   *  check consulted by sweepHeldRollover(). See the field doc above. */
  setHeldReleaseGate(gate: (() => boolean) | undefined): void {
    this.heldReleaseGate = gate;
  }

  // ── Enqueue (webview → server) ──────────────────────────────────

  enqueue(input: DispatchEnqueueInput, now: number = Date.now()): DispatchEnqueueResult {
    if (!isValidAction(input.action)) return { ok: false, reason: 'invalid-action' };
    if (typeof input.machine !== 'string' || input.machine.trim() === '') {
      return { ok: false, reason: 'missing-machine' };
    }

    if (input.provider === 'shell') {
      // T8 Mini compute: a NON-LLM dispatch. No cwd/prompt/model/effort — the
      // wire carries only an opaque scriptId + plain-token args; the runner's
      // machine-local registry resolves and guards the rest. `shell` is
      // dispatch-only (never an interactive session).
      if (input.action !== 'dispatch') {
        return { ok: false, reason: 'shell-must-be-dispatch' };
      }
      if (typeof input.scriptId !== 'string' || !COMPUTE_SCRIPT_ID_PATTERN.test(input.scriptId)) {
        return { ok: false, reason: 'invalid-scriptId' };
      }
      if (input.args !== undefined) {
        if (!Array.isArray(input.args) || input.args.some((a) => typeof a !== 'string')) {
          return { ok: false, reason: 'invalid-args' };
        }
        if (input.args.length > COMPUTE_MAX_ARGS_CEILING) {
          return { ok: false, reason: 'too-many-args' };
        }
        // Per-arg charset+length, mirrored from the runner (codex 2B review):
        // reject an oversized/metacharacter arg BEFORE it rides server
        // persistence + the audit log, not one hop later at poll-consume time.
        if (input.args.some((a) => !COMPUTE_ARG_PATTERN.test(a))) {
          return { ok: false, reason: 'invalid-arg' };
        }
      }
    } else if (input.action === 'dispatch' || input.action === 'session') {
      if (!isValidProvider(input.provider) || !isLlmProvider(input.provider)) {
        return { ok: false, reason: 'invalid-provider' };
      }
      if (typeof input.cwd !== 'string' || input.cwd.trim() === '') {
        return { ok: false, reason: 'missing-cwd' };
      }
      // 'session' (T2/T4): the prompt is the OPTIONAL opening brief — a bare
      // interactive session is a legitimate launch. 'dispatch' keeps its
      // required prompt (a headless run without one does nothing).
      if (input.action === 'dispatch') {
        if (typeof input.prompt !== 'string' || input.prompt.trim() === '') {
          return { ok: false, reason: 'missing-prompt' };
        }
      } else if (input.prompt !== undefined && typeof input.prompt !== 'string') {
        return { ok: false, reason: 'invalid-prompt' };
      }
      if (typeof input.prompt === 'string' && input.prompt.length > DISPATCH_PROMPT_MAX_CHARS) {
        return { ok: false, reason: 'prompt-too-long' };
      }
      if (input.model !== undefined && !DISPATCH_MODEL_PATTERN.test(input.model)) {
        return { ok: false, reason: 'invalid-model' };
      }
      if (
        input.effort !== undefined &&
        !(DISPATCH_EFFORT_VALUES as readonly string[]).includes(input.effort)
      ) {
        return { ok: false, reason: 'invalid-effort' };
      }
      if (
        input.permissionMode !== undefined &&
        !(DISPATCH_PERMISSION_MODE_VALUES as readonly string[]).includes(input.permissionMode)
      ) {
        return { ok: false, reason: 'invalid-permission-mode' };
      }
      if (input.timeoutSec !== undefined) {
        // Sessions are interactive — the runner's cap timer only exists on
        // the headless spawn path, so accepting a cap here would silently
        // lie. Reject rather than drop (honesty over tolerance).
        if (input.action === 'session') {
          return { ok: false, reason: 'timeout-unsupported-for-session' };
        }
        if (
          !Number.isInteger(input.timeoutSec) ||
          input.timeoutSec <= 0 ||
          input.timeoutSec > DISPATCH_TIMEOUT_MAX_SEC
        ) {
          return { ok: false, reason: 'invalid-timeout' };
        }
      }
    } else {
      // action === 'focus'
      if (!input.sessionId && !input.pid) {
        return { ok: false, reason: 'missing-focus-target' };
      }
    }

    const records = this.ensureLoaded();

    // 'session' carries the same CLI-run identity fields as 'dispatch'
    // (provider/cwd/prompt/model/effort) — timeoutSec stays dispatch-only
    // (rejected above for sessions). A `shell` (compute) run carries NONE of
    // the LLM identity fields — only scriptId + args (the wire never even
    // carried a cwd/prompt for it).
    const isCliRun = input.action === 'dispatch' || input.action === 'session';
    const isShell = input.provider === 'shell';
    const isLlmRun = isCliRun && !isShell;
    // 4B context preamble: applied HERE (post-validation, pre-persist) so
    // record/audit/runner all carry identical text. Length-checked against
    // the human's prompt above — the preamble is server-owned constant cost.
    // Variant by action (Phase 5): jobs are told one-shot/no-questions,
    // sessions are told the board can answer them. Strip-then-reprefix:
    // a re-dispatch (getRedispatchInput) feeds the STORED prompt back
    // through enqueue — stripping first means it never double-prefixes,
    // and re-prefixing with THIS enqueue's action means a client pasting
    // the wrong variant (or redispatching a job as a session) always gets
    // the contract matching the run actually being started.
    const prompt =
      isLlmRun && typeof input.prompt === 'string' && input.prompt.trim() !== ''
        ? (input.action === 'session' ? DISPATCH_SESSION_PREAMBLE : DISPATCH_CONTEXT_PREAMBLE) +
          stripDispatchPreamble(input.prompt)
        : undefined;
    const commonFields = {
      id: randomUUID(),
      action: input.action,
      machine: input.machine,
      provider: isCliRun ? (input.provider as DispatchProvider) : undefined,
      cwd: isLlmRun ? input.cwd : undefined,
      prompt,
      sessionId: input.sessionId,
      pid: input.action === 'focus' ? input.pid : undefined,
      model: isLlmRun ? input.model : undefined,
      effort: isLlmRun ? (input.effort as DispatchEffort | undefined) : undefined,
      permissionMode: isLlmRun
        ? (input.permissionMode as DispatchPermissionMode | undefined)
        : undefined,
      // T8 Mini compute — carried only for a `shell` dispatch.
      scriptId: isShell ? input.scriptId : undefined,
      args: isShell ? input.args : undefined,
      timeoutSec: input.action === 'dispatch' && !isShell ? input.timeoutSec : undefined,
      chainRunId: input.chainRunId,
      chainStep: input.chainStep,
      employeeId: input.employeeId,
      contractId: input.contractId,
      requestId:
        typeof input.requestId === 'string' &&
        input.requestId.length > 0 &&
        input.requestId.length <= REQUEST_ID_MAX_CHARS
          ? input.requestId
          : undefined,
      createdAt: now,
      updatedAt: now,
    } as const;

    // T5 fleet controls, DAILY FLEET SPEND CEILING — checked BEFORE the
    // ringing cap: a held request never rings at all, so the ringing cap
    // (a backpressure limit on the runner poll queue) doesn't apply to it.
    // Only 'dispatch' holds — a 'focus' request fronts a terminal, it
    // spends nothing.
    if (input.action === 'dispatch') {
      const gate = this.budgetGate?.();
      if (gate && gate.spend >= gate.ceiling) {
        const record: DispatchRecord = {
          ...commonFields,
          status: 'queued-budget',
          reason: `HELD — daily ceiling ${String(gate.ceiling)} reached, spend ${String(gate.spend)}`,
        };
        records.set(record.id, record);
        this.persist();
        this.audit('enqueue-held', record);
        this.emit(record);
        return { ok: true, record };
      }
    }

    if (this.ringingCount(input.machine, records) >= DISPATCH_RINGING_CAP) {
      return { ok: false, reason: 'ringing-cap-exceeded' };
    }

    const record: DispatchRecord = { ...commonFields, status: 'ringing' };
    records.set(record.id, record);
    this.persist();
    this.audit('enqueue', record);
    this.emit(record);
    return { ok: true, record };
  }

  /** T5 fleet controls — release a HELD ('queued-budget') dispatch to ring
   *  normally. Explicit human override (POST /api/dispatch/:id/release);
   *  the automatic local-date-rollover release is sweepHeldRollover()
   *  below, a distinct path with its own audit event. */
  releaseHeld(id: string, now: number = Date.now()): { ok: true } | { ok: false; reason: string } {
    const record = this.ensureLoaded().get(id);
    if (!record) return { ok: false, reason: 'unknown-id' };
    if (record.status !== 'queued-budget') return { ok: false, reason: 'not-held' };
    // Codex fix round finding 6: the ringing cap could have filled while
    // this dispatch sat held — re-check it here, the SAME backpressure a
    // fresh enqueue() would hit. An explicit human override into a full
    // queue is an honest 2xx deny, never a bypass — but it DOES still work
    // even while STOP ALL's kill switch is engaged (a human verb beats the
    // kill switch; only the AUTOMATIC rollover release below is frozen).
    if (this.ringingCount(record.machine) >= DISPATCH_RINGING_CAP) {
      this.audit('release-ringing-cap', record);
      return { ok: false, reason: 'ringing-cap' };
    }
    record.status = 'ringing';
    record.reason = undefined;
    record.updatedAt = now;
    this.persist();
    this.audit('held-released', record);
    this.emit(record);
    return { ok: true };
  }

  /** T5 fleet controls — every HELD ('queued-budget') dispatch created
   *  before the start of `now`'s local calendar day auto-releases: a new
   *  day resets the ceiling it was held against. Returns the count
   *  released (0 = nothing to do, callers can skip the persist round-trip),
   *  same idiom as sweepExpired(). Codex fix round finding 1: frozen
   *  entirely while STOP ALL's kill switch is engaged (heldReleaseGate) —
   *  the automatic release is exactly the kind of unattended action the
   *  kill switch exists to suppress; a human's explicit releaseHeld() above
   *  is unaffected. Finding 6: each candidate re-checks the ringing cap —
   *  over-cap entries stay held and retry on the next sweep rather than
   *  bypassing backpressure; the cap is re-read from the live records on
   *  every iteration so an earlier release in THIS SAME sweep correctly
   *  counts against a later candidate on the same machine. */
  sweepHeldRollover(now: number = Date.now()): number {
    if (this.heldReleaseGate?.()) return 0;
    const records = this.ensureLoaded();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const start = todayStart.getTime();
    let count = 0;
    for (const record of records.values()) {
      if (record.status !== 'queued-budget') continue;
      if (record.createdAt >= start) continue;
      if (this.ringingCount(record.machine, records) >= DISPATCH_RINGING_CAP) {
        this.audit('held-rollover-blocked-ringing-cap', record);
        continue;
      }
      record.status = 'ringing';
      record.reason = undefined;
      record.updatedAt = now;
      this.audit('held-rollover-released', record);
      this.emit(record);
      count++;
    }
    if (count > 0) this.persist();
    return count;
  }

  /** Live ringing count for one machine — shared by enqueue()'s own cap
   *  check and the release/rollover re-checks (finding 6). Reads the
   *  PASSED-IN map when given (so a caller iterating and mutating the same
   *  map mid-loop sees its own just-applied changes), else loads fresh. */
  private ringingCount(machine: string, records?: Map<string, DispatchRecord>): number {
    const source = records ?? this.ensureLoaded();
    let count = 0;
    for (const r of source.values()) {
      if (r.machine === machine && r.status === 'ringing') count++;
    }
    return count;
  }

  // ── Runner-facing ────────────────────────────────────────────────

  /** Refresh a machine's advertised dispatch capability. Called on every
   *  `POST /api/dispatch/poll` tick — a runner that stops polling silently
   *  ages out of `getMachines()` after DISPATCH_MACHINE_AD_TTL_MS. */
  recordAdvertisement(
    machine: string,
    ad: {
      providers: string[];
      roots: string[];
      focus: boolean;
      sessions?: boolean;
      scriptIds?: string[];
      skills?: string[];
    },
    now: number = Date.now(),
  ): void {
    // sessions defaults false (deny-by-default) — an older runner that
    // doesn't send the flag simply can't launch managed sessions. scriptIds
    // defaults [] — a runner with no compute registry advertises no scripts.
    this.machines.set(machine, {
      machine,
      providers: ad.providers,
      roots: ad.roots,
      focus: ad.focus,
      sessions: ad.sessions === true,
      scriptIds: Array.isArray(ad.scriptIds)
        ? ad.scriptIds.filter((s) => typeof s === 'string')
        : [],
      // 4B skill picker — names only, re-filtered here with the runner's
      // own token pattern + cap (never trust the wire for a shape the
      // picker inserts into editable prompt text — a compromised runner
      // must not be able to advertise a prompt-breaking "name").
      skills: Array.isArray(ad.skills)
        ? ad.skills
            .filter((s) => typeof s === 'string' && SKILL_NAME_PATTERN.test(s))
            .slice(0, SKILLS_ADVERTISED_MAX)
        : [],
      lastSeenAt: now,
    });
  }

  /** Live machines only — a machine without a recent runner poll is
   *  honestly absent (never stale-listed). */
  getMachines(
    now: number = Date.now(),
    ttlMs: number = DISPATCH_MACHINE_AD_TTL_MS,
  ): DispatchMachineAdvertisement[] {
    return [...this.machines.values()].filter((m) => now - m.lastSeenAt <= ttlMs);
  }

  /** EVERY machine this process has ever seen an advertisement from,
   *  regardless of staleness — the inverse of getMachines()'s TTL filter.
   *  Read-only, no new persistence (T3 Ops Advisor, DEAD-TELEMETRY finding):
   *  a machine's runner going silent is itself the observation, so the
   *  advisor needs the STALE ones getMachines() deliberately hides. */
  getAllMachineAdvertisements(): DispatchMachineAdvertisement[] {
    return [...this.machines.values()];
  }

  // ── T2 remote-answer plane (REMOTE-ANSWER-DESIGN.md) ────────────

  /** Refresh a machine's advertised managed-session list — called on every
   *  poll tick alongside recordAdvertisement. The runner already pruned
   *  dead sessions; the server stores it verbatim (sanitized upstream by
   *  the route) and lets it go stale with the same TTL as the machine ad. */
  recordManagedSessions(
    machine: string,
    sessions: ManagedSessionAd[],
    now: number = Date.now(),
  ): void {
    this.managedSessions.set(machine, { sessions, lastSeenAt: now });
  }

  /** A machine's live managed sessions — [] when the runner's advertisement
   *  is stale (a silent runner's sessions are honestly NOT answerable,
   *  same posture as getMachines' TTL filter). */
  getManagedFor(
    machine: string,
    now: number = Date.now(),
    ttlMs: number = DISPATCH_MACHINE_AD_TTL_MS,
  ): ManagedSessionAd[] {
    const entry = this.managedSessions.get(machine);
    if (!entry || now - entry.lastSeenAt > ttlMs) return [];
    return entry.sessions;
  }

  /** Machines whose managed advertisement went stale are removed outright
   *  (piggybacked on the dispatch sweep timer) so the agent managed-flag
   *  propagation observes the transition and clears ANSWER honestly. */
  sweepStaleManaged(
    now: number = Date.now(),
    ttlMs: number = DISPATCH_MACHINE_AD_TTL_MS,
  ): string[] {
    const stale: string[] = [];
    for (const [machine, entry] of this.managedSessions) {
      if (now - entry.lastSeenAt > ttlMs && entry.sessions.length > 0) {
        this.managedSessions.set(machine, { sessions: [], lastSeenAt: entry.lastSeenAt });
        stale.push(machine);
      }
    }
    return stale;
  }

  /**
   * Queue an answer to a managed session, targeted the way the board
   * actually addresses agents: (machine, pid) — the same addressing the
   * observed-session kill path uses. The server resolves the pid to a
   * managed-session ref via the machine's LIVE advertisement; no live
   * advertisement covering that pid = honest deny (`not-managed`). The
   * one-shot nonce is minted HERE, one per request — the runner consumes it
   * exactly once and the first outcome report terminalizes the record
   * (belt and braces on both ends, per design).
   */
  requestAnswer(
    machine: string,
    pid: number,
    text: string,
    now: number = Date.now(),
  ): { ok: true; id: string } | { ok: false; reason: string } {
    if (typeof machine !== 'string' || machine.trim() === '') {
      return { ok: false, reason: 'missing-machine' };
    }
    if (!Number.isInteger(pid) || pid <= 0) {
      return { ok: false, reason: 'invalid-pid' };
    }
    if (typeof text !== 'string' || text.trim() === '') {
      return { ok: false, reason: 'invalid-text' };
    }
    if (text.length > ANSWER_TEXT_MAX_CHARS) {
      return { ok: false, reason: 'text-too-long' };
    }
    if (ANSWER_CONTROL_CHARS.test(text)) {
      return { ok: false, reason: 'control-chars-rejected' };
    }
    const managed = this.getManagedFor(machine, now).find((s) => s.panePid === pid);
    if (!managed) {
      return { ok: false, reason: 'not-managed' };
    }
    const record: AnswerRecord = {
      id: randomUUID(),
      machine,
      managedSessionRef: managed.dispatchId,
      text,
      nonce: randomUUID(),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.answerRequests.set(record.id, record);
    const queue = this.answerQueue.get(machine) ?? [];
    queue.push({
      id: record.id,
      managedSessionRef: record.managedSessionRef,
      text: record.text,
      nonce: record.nonce,
    });
    this.answerQueue.set(machine, queue);
    this.auditAnswer('answer-requested', record);
    return { ok: true, id: record.id };
  }

  /** Drain (pop + clear) this machine's queued answer instructions —
   *  at-most-once, exactly drainStopsFor's contract. An undelivered answer
   *  simply stays answerable; the human retries (design). */
  drainAnswersFor(machine: string): AnswerInstruction[] {
    const queue = this.answerQueue.get(machine);
    if (!queue || queue.length === 0) return [];
    this.answerQueue.delete(machine);
    return queue;
  }

  /** Runner-reported outcome. First report wins — a duplicate arriving
   *  after the record is terminal is DROPPED (audited, never re-applied):
   *  the server-side half of the replay defense. Unknown ids are a safe
   *  no-op (2xx decision plane). */
  reportAnswerStatus(
    id: string,
    event: 'delivered' | 'denied',
    reason: string | undefined,
    now: number = Date.now(),
  ): { ok: true } {
    const record = this.answerRequests.get(id);
    if (!record) return { ok: true };
    if (record.status !== 'pending') {
      this.auditAnswer('answer-duplicate-outcome-dropped', record);
      return { ok: true };
    }
    record.status = event;
    record.reason = reason;
    record.updatedAt = now;
    this.auditAnswer('answer-status', record);
    return { ok: true };
  }

  /** Webview-facing lookup for the drawer's answer-outcome poll. */
  getAnswerStatus(
    id: string,
  ): { found: true; status: AnswerStatus; reason?: string } | { found: false } {
    const record = this.answerRequests.get(id);
    if (!record) return { found: false };
    return { found: true, status: record.status, reason: record.reason };
  }

  /** Receipts for the drawer (one-tap-real: the VERBATIM text is the
   *  receipt). Most recent last, capped — the audit JSONL is the unbounded
   *  durable record. Optional ref filter scopes to one managed session. */
  getAnswerReceipts(machine: string, managedSessionRef?: string): AnswerReceipt[] {
    const out: AnswerReceipt[] = [];
    for (const r of this.answerRequests.values()) {
      if (r.machine !== machine) continue;
      if (managedSessionRef !== undefined && r.managedSessionRef !== managedSessionRef) continue;
      out.push({
        id: r.id,
        machine: r.machine,
        managedSessionRef: r.managedSessionRef,
        text: r.text,
        status: r.status,
        reason: r.reason,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      });
    }
    return out.sort((a, b) => a.createdAt - b.createdAt).slice(-ANSWER_RECEIPTS_MAX);
  }

  /** Sweep pending answers past the TTL to a terminal denied/'expired' —
   *  the board must never render DELIVERING… forever for a vanished
   *  runner. Piggybacked on the dispatch sweep timer. */
  sweepExpiredAnswers(now: number = Date.now(), ttlMs: number = ANSWER_TTL_MS): number {
    let count = 0;
    for (const record of this.answerRequests.values()) {
      if (record.status === 'pending' && now - record.createdAt > ttlMs) {
        record.status = 'denied';
        record.reason = 'expired';
        record.updatedAt = now;
        this.auditAnswer('answer-expired', record);
        count++;
      }
    }
    return count;
  }

  /** Requests still ringing for a machine, WITH the full prompt — the only
   *  place it travels over the wire (Bearer + X-Machine authed route). */
  pendingFor(machine: string): DispatchRunnerItem[] {
    const records = this.ensureLoaded();
    const out: DispatchRunnerItem[] = [];
    for (const r of records.values()) {
      if (r.machine !== machine || r.status !== 'ringing') continue;
      out.push({
        id: r.id,
        action: r.action,
        provider: r.provider,
        cwd: r.cwd,
        prompt: r.prompt,
        sessionId: r.sessionId,
        pid: r.pid,
        model: r.model,
        effort: r.effort,
        permissionMode: r.permissionMode,
        scriptId: r.scriptId,
        args: r.args,
        timeoutSec: r.timeoutSec,
      });
    }
    return out;
  }

  /**
   * Queue a stop instruction for the in-flight dispatch's machine. Only a
   * record actually `answered` (a runner accepted it and it's presumed
   * running) is stoppable — `ringing` has nothing spawned yet, and a
   * terminal record has nothing left to stop. Attached to that machine's
   * NEXT poll response; the runner decides FOR REAL whether it's actually in
   * its own registry (this method only queues the request, it never touches
   * the runner's containment guarantee).
   */
  requestStop(id: string): { ok: true } | { ok: false; reason: string } {
    const record = this.ensureLoaded().get(id);
    if (!record) return { ok: false, reason: 'unknown-id' };
    if (record.status !== 'answered') return { ok: false, reason: 'not-in-flight' };
    const queue = this.stopQueue.get(record.machine) ?? [];
    if (!queue.some((s) => s.kind === 'dispatch' && s.id === id)) {
      queue.push({ kind: 'dispatch', id });
    }
    this.stopQueue.set(record.machine, queue);
    this.audit('stop-requested', record);
    return { ok: true };
  }

  /** Queue an observed-session pid-kill request (reach: any worker with a
   *  known pid, not just runner-spawned dispatches — no dispatch record
   *  exists for these, hence the separate PidKillRecord/id scheme). */
  requestPidKill(
    machine: string,
    pid: number,
    now: number = Date.now(),
  ): { ok: true; id: string } | { ok: false; reason: string } {
    if (typeof machine !== 'string' || machine.trim() === '') {
      return { ok: false, reason: 'missing-machine' };
    }
    if (!Number.isInteger(pid) || pid <= 0) {
      return { ok: false, reason: 'invalid-pid' };
    }
    const id = randomUUID();
    const record: PidKillRecord = {
      id,
      machine,
      pid,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.pidKillRequests.set(id, record);
    const queue = this.stopQueue.get(machine) ?? [];
    queue.push({ kind: 'pid', id, pid });
    this.stopQueue.set(machine, queue);
    this.auditPidKill('pid-kill-requested', record);
    return { ok: true, id };
  }

  /** Runner-reported outcome of a pid-kill instruction. Unknown ids are a
   *  safe no-op (still `{ ok: true }`, same "deny is a decision" posture as
   *  the dispatch decision plane). */
  reportPidKillStatus(
    id: string,
    event: 'killed' | 'denied',
    reason: string | undefined,
    now: number = Date.now(),
  ): { ok: true } {
    const record = this.pidKillRequests.get(id);
    if (!record) {
      // Unknown id (e.g. a duplicate/late report) — safe no-op, still 2xx.
      return { ok: true };
    }
    record.status = event;
    record.reason = reason;
    record.updatedAt = now;
    this.auditPidKill('pid-kill-status', record);
    return { ok: true };
  }

  /** Webview-facing lookup for the AgentDrawer's kill-outcome poll. */
  getPidKillStatus(
    id: string,
  ): { found: true; status: PidKillStatus; reason?: string } | { found: false } {
    const record = this.pidKillRequests.get(id);
    if (!record) return { found: false };
    return { found: true, status: record.status, reason: record.reason };
  }

  /** Drain (pop + clear) this machine's queued stop instructions — at-most-
   *  once delivery, attached to the poll response that carries `pending`. */
  drainStopsFor(machine: string): StopInstruction[] {
    const queue = this.stopQueue.get(machine);
    if (!queue || queue.length === 0) return [];
    this.stopQueue.delete(machine);
    return queue;
  }

  /**
   * Runner decision on a queued request. Deny AND unknown/already-decided
   * ids are all `{ ok: true }` — the decision plane never 403/404s.
   */
  decide(
    id: string,
    decision: 'accept' | 'deny',
    opts: { reason?: string; pid?: number } = {},
    now: number = Date.now(),
  ): { ok: true } {
    const records = this.ensureLoaded();
    const record = records.get(id);
    if (!record) {
      this.audit('decision-unknown-id', { id, decision, ...opts } as unknown as DispatchRecord);
      return { ok: true };
    }
    if (record.status !== 'ringing') {
      // Already decided/expired — idempotent no-op, still 2xx.
      return { ok: true };
    }
    if (decision === 'accept') {
      record.status = 'answered';
      if (opts.pid !== undefined) record.pid = opts.pid;
    } else {
      record.status = 'denied';
      record.reason = opts.reason;
    }
    record.updatedAt = now;
    this.persist();
    this.audit('decision', record);
    this.emit(record);
    return { ok: true };
  }

  /** Runner-reported lifecycle event (spawn started / process exited /
   *  explicitly killed via the stop channel / capped by its own timeoutSec
   *  timer). A 'killed' event with `killOutcome` set (the runner's registry
   *  had no matching entry) is audit-only — it must NEVER downgrade or
   *  invent a state transition for a dispatch the runner didn't actually
   *  touch; only a bare `event: 'killed'` (the runner really signaled its
   *  own registered child) moves the record to the distinct terminal
   *  `killed` status, and only from `answered` (never re-terminalizes an
   *  already-terminal record). `capped` (T5 fleet controls) follows the
   *  identical from-`answered`-only discipline — a DISTINCT terminal status,
   *  never conflated with `killed` or `exited`. */
  reportStatus(
    id: string,
    input: {
      event: 'started' | 'exited' | 'killed' | 'capped';
      pid?: number;
      exitCode?: number;
      resultTail?: string;
      killOutcome?: 'not-found';
    },
    now: number = Date.now(),
  ): { ok: true } {
    const records = this.ensureLoaded();
    const record = records.get(id);
    if (!record) {
      this.audit('status-unknown-id', { id, ...input } as unknown as DispatchRecord);
      return { ok: true };
    }
    if (input.event === 'started') {
      if (input.pid !== undefined) record.pid = input.pid;
    } else if (input.event === 'killed') {
      if (input.killOutcome === 'not-found') {
        // Informational only — the runner never signaled anything (the id
        // wasn't in its registry). The record's real status stands.
        this.audit('kill-not-found', record);
        return { ok: true };
      }
      if (record.status !== 'answered') {
        // Already terminal by some other path (e.g. a natural exit raced
        // the stop instruction) — never overwrite a settled terminal state.
        this.audit('kill-already-terminal', record);
        return { ok: true };
      }
      record.status = 'killed';
      if (input.exitCode !== undefined) record.exitCode = input.exitCode;
      if (typeof input.resultTail === 'string') {
        record.resultTail = input.resultTail.slice(-DISPATCH_RESULT_TAIL_MAX_CHARS);
      }
    } else if (input.event === 'capped') {
      if (record.status !== 'answered') {
        // Already terminal by some other path (e.g. a natural exit raced
        // the cap timer) — never overwrite a settled terminal state.
        this.audit('cap-already-terminal', record);
        return { ok: true };
      }
      record.status = 'capped';
      if (input.exitCode !== undefined) record.exitCode = input.exitCode;
      if (typeof input.resultTail === 'string') {
        record.resultTail = input.resultTail.slice(-DISPATCH_RESULT_TAIL_MAX_CHARS);
      }
    } else {
      if (record.status !== 'answered') {
        // Duplicate/redelivered 'exited' report (retry wrapper, WS replay)
        // for a record already terminal by any path — never re-commit or
        // re-broadcast (would re-pile a dismissed rework crate and
        // double-count dossier exit telemetry downstream).
        this.audit('exit-already-terminal', record);
        return { ok: true };
      }
      record.status = 'exited';
      if (input.exitCode !== undefined) record.exitCode = input.exitCode;
      if (typeof input.resultTail === 'string') {
        record.resultTail = input.resultTail.slice(-DISPATCH_RESULT_TAIL_MAX_CHARS);
      }
    }
    record.updatedAt = now;
    this.persist();
    this.audit('status', record);
    this.emit(record);
    return { ok: true };
  }

  /** Sweep ringing requests past the TTL to `expired`. Returns the count
   *  swept (0 = nothing to do, callers can skip a persist round-trip). */
  sweepExpired(now: number = Date.now(), ttlMs: number = DISPATCH_TTL_MS): number {
    const records = this.ensureLoaded();
    let count = 0;
    for (const record of records.values()) {
      if (record.status === 'ringing' && now - record.createdAt > ttlMs) {
        record.status = 'expired';
        record.updatedAt = now;
        this.audit('expired', record);
        this.emit(record);
        count++;
      }
    }
    if (count > 0) this.persist();
    return count;
  }

  /** Server-side-only lookup (never sent over the wire) — the record's
   *  provider/employeeId correlation, consumed by httpServer.ts's status
   *  route to fire economy/employee/budget dispatch-exit side effects
   *  after reportStatus() commits the terminal transition. machine/cwd
   *  (v3 stage 2) resolve the owning staff lineage for the dossier and
   *  rivalry derivation planes — still server-side only. */
  getRecord(
    id: string,
  ):
    | Pick<
        DispatchRecord,
        | 'provider'
        | 'employeeId'
        | 'chainRunId'
        | 'chainStep'
        | 'contractId'
        | 'status'
        | 'machine'
        | 'cwd'
      >
    | undefined {
    const record = this.ensureLoaded().get(id);
    if (!record) return undefined;
    return {
      provider: record.provider,
      employeeId: record.employeeId,
      chainRunId: record.chainRunId,
      chainStep: record.chainStep,
      contractId: record.contractId,
      // Liveness gate for the output-telemetry route (slice 2.5): a
      // straggler output POST after terminal status must not resurrect an
      // evicted ring entry that no lifecycle site would ever evict again.
      status: record.status,
      machine: record.machine,
      cwd: record.cwd,
    };
  }

  /** Rework re-dispatch prefill (v3 Scrap & Rework Bin — KICKOFF-v3.1 §1
   *  "failure loop"): the ORIGINAL request parameters of a dispatch,
   *  shaped as a fresh enqueue input. Server-side only — the full prompt
   *  never rides the broadcast plane; the rework route feeds this straight
   *  back into enqueue(), so the re-dispatch passes every NORMAL gate
   *  (ringing cap, runner allowlist decision, TTL) — never a bypass.
   *  Deliberately drops chainRunId/chainStep/employeeId/contractId: a
   *  rework is a fresh conscious human act, not a replay of the old
   *  correlation. Only 'dispatch' actions qualify (focus has nothing to
   *  rework). */
  getRedispatchInput(id: string): DispatchEnqueueInput | undefined {
    const record = this.ensureLoaded().get(id);
    if (!record || record.action !== 'dispatch') return undefined;
    return {
      action: 'dispatch',
      machine: record.machine,
      provider: record.provider,
      cwd: record.cwd,
      prompt: record.prompt,
      model: record.model,
      effort: record.effort,
      // 4B: preserve the mode on re-dispatch — a plan-mode run must not
      // silently rerun unrestricted. (The stored prompt already carries the
      // context preamble; enqueue's startsWith guard keeps it single.)
      permissionMode: record.permissionMode,
      timeoutSec: record.timeoutSec,
    };
  }

  /** Non-terminal entries (ringing/answered/queued-budget) — replayed to a
   *  freshly connected WebSocket client, same rationale as poll-state
   *  replay. A HELD dispatch is non-terminal too (T5 fleet controls) — it
   *  must still be visible in the tray after a page refresh. */
  getActive(): DispatchBroadcast[] {
    const records = this.ensureLoaded();
    return [...records.values()]
      .filter(
        (r) => r.status === 'ringing' || r.status === 'answered' || r.status === 'queued-budget',
      )
      .map((r) => this.toBroadcast(r));
  }

  /** Last `limit` entries regardless of status (oldest first), including
   *  resultTail — GET /api/dispatch/recent's payload. Same trust level as
   *  the broadcast plane (no full prompt), so a page refresh doesn't lose
   *  in-flight or just-completed dispatch state the way a WS-only replay
   *  (getActive, non-terminal only) would. */
  getRecent(limit = 20): DispatchBroadcast[] {
    const records = this.ensureLoaded();
    return [...records.values()]
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(-limit)
      .map((r) => this.toBroadcast(r));
  }

  private toBroadcast(record: DispatchRecord): DispatchBroadcast {
    return {
      type: 'dispatchUpdate',
      id: record.id,
      action: record.action,
      status: record.status,
      machine: record.machine,
      provider: record.provider,
      promptPreview:
        record.prompt === undefined
          ? undefined
          : stripDispatchPreamble(record.prompt).slice(0, DISPATCH_PROMPT_PREVIEW_MAX_CHARS),
      reason: record.reason,
      pid: record.pid,
      exitCode: record.exitCode,
      resultTail: record.resultTail,
      chainRunId: record.chainRunId,
      chainStep: record.chainStep,
      timeoutSec: record.timeoutSec,
      requestId: record.requestId,
    };
  }

  private emit(record: DispatchRecord): void {
    const broadcast = this.toBroadcast(record);
    for (const listener of this.listeners) listener(broadcast);
  }

  // ── Persistence (tolerant — same pattern as progressionStore.ts) ──

  private persistPath(): string {
    if (!this.resolvedPath) {
      this.usingDefaultPath = this.explicitPath === undefined;
      this.resolvedPath = this.explicitPath ?? defaultDispatchFile();
    }
    return this.resolvedPath;
  }

  private auditPath(): string {
    if (!this.resolvedAuditPath) {
      this.resolvedAuditPath = this.explicitAuditPath ?? defaultAuditFile();
    }
    return this.resolvedAuditPath;
  }

  private ensureLoaded(): Map<string, DispatchRecord> {
    if (!this.records) {
      this.records = this.load() ?? new Map();
    }
    return this.records;
  }

  private load(): Map<string, DispatchRecord> | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath(), 'utf8')) as unknown;
      if (!Array.isArray(raw)) return null;
      const map = new Map<string, DispatchRecord>();
      for (const entry of raw as DispatchRecord[]) {
        if (entry && typeof entry.id === 'string') map.set(entry.id, entry);
      }
      return map;
    } catch {
      /* missing/corrupt → fresh queue */
    }
    return null;
  }

  private persist(): void {
    // Never let unit tests that exercise the process-wide singleton
    // indirectly write the REAL sidecar. Tests that construct their own
    // instance with an explicit temp path still write (same rule as
    // progressionStore.ts / shiftStats.ts).
    if (process.env.VITEST && this.usingDefaultPath) return;
    const target = this.persistPath();
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify([...this.ensureLoaded().values()]), 'utf8');
    } catch {
      /* queue loss on write failure is acceptable — never crash the server */
    }
  }

  private audit(event: string, record: DispatchRecord): void {
    if (process.env.VITEST && this.explicitAuditPath === undefined) return;
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), event, ...record });
      const target = this.auditPath();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.appendFileSync(target, `${line}\n`, 'utf8');
    } catch {
      /* audit-log loss must never crash the server */
    }
  }

  /** Same append-only audit log, for answer lifecycle events (T2 remote-
   *  answer plane). Carries the VERBATIM text + nonce — this line is the
   *  durable receipt the design requires ("every answer … a receipt with
   *  verbatim text + source"). */
  private auditAnswer(event: string, record: AnswerRecord): void {
    if (process.env.VITEST && this.explicitAuditPath === undefined) return;
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), event, ...record });
      const target = this.auditPath();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.appendFileSync(target, `${line}\n`, 'utf8');
    } catch {
      /* audit-log loss must never crash the server */
    }
  }

  /** Same append-only audit log as `audit()`, for pid-kill lifecycle events
   *  (a PidKillRecord, not a DispatchRecord — no dispatch id involved). */
  private auditPidKill(event: string, record: PidKillRecord): void {
    if (process.env.VITEST && this.explicitAuditPath === undefined) return;
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), event, ...record });
      const target = this.auditPath();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.appendFileSync(target, `${line}\n`, 'utf8');
    } catch {
      /* audit-log loss must never crash the server */
    }
  }
}

/** Process-wide instance (the server is single-process). */
export const dispatchStore = new DispatchStore();
