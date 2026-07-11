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
export const DISPATCH_PROMPT_MAX_CHARS = 4000;
/** promptPreview length on the broadcast plane — the full prompt never
 *  travels here (only on the Bearer-authed runner poll). */
export const DISPATCH_PROMPT_PREVIEW_MAX_CHARS = 120;
/** resultTail cap, applied again here even though the runner already caps
 *  its read (~8KB) — never trust the wire for a size limit twice enforced is
 *  a limit actually held. Keeps the WS broadcast plane and the persisted
 *  queue file bounded regardless of what a runner sends. */
export const DISPATCH_RESULT_TAIL_MAX_CHARS = 8192;

export const DISPATCH_PROVIDERS = ['claude', 'codex', 'gemini'] as const;
export type DispatchProvider = (typeof DISPATCH_PROVIDERS)[number];

/** Providers a runner actually has an `--effort`-equivalent flag for
 *  (bin/lib/dispatch-rules.mjs buildArgv is the enforcement point) — the
 *  enum here is intentionally broader than any one provider supports, since
 *  effort is validated once at the request level and providers without a
 *  matching flag simply omit it. */
export const DISPATCH_EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type DispatchEffort = (typeof DISPATCH_EFFORT_VALUES)[number];

/** A short model identifier/alias (e.g. 'fable', 'claude-fable-5', 'o3') —
 *  intentionally permissive (covers every provider's own naming scheme)
 *  while still rejecting anything that couldn't be a single argv token. */
const DISPATCH_MODEL_PATTERN = /^[a-zA-Z0-9._/-]{1,64}$/;
/** requestId cap (mirrors asyncapi maxLength 64) — overlong ids are DROPPED,
 *  never truncated: a truncated echo would mis-correlate on the client. */
const REQUEST_ID_MAX_CHARS = 64;

export type DispatchAction = 'dispatch' | 'focus';
export type DispatchStatus = 'ringing' | 'answered' | 'denied' | 'expired' | 'exited' | 'killed';

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
}

/** A runner's self-advertised capability, refreshed on every poll tick. */
export interface DispatchMachineAdvertisement {
  machine: string;
  providers: string[];
  roots: string[];
  focus: boolean;
  lastSeenAt: number;
}

function defaultDispatchFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, DISPATCH_FILE_NAME);
}

function defaultAuditFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, DISPATCH_AUDIT_FILE_NAME);
}

function isValidAction(value: unknown): value is DispatchAction {
  return value === 'dispatch' || value === 'focus';
}

function isValidProvider(value: unknown): value is DispatchProvider {
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

  private explicitPath: string | undefined;
  private resolvedPath: string | undefined;
  private usingDefaultPath = false;

  private explicitAuditPath: string | undefined;
  private resolvedAuditPath: string | undefined;

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

  // ── Enqueue (webview → server) ──────────────────────────────────

  enqueue(input: DispatchEnqueueInput, now: number = Date.now()): DispatchEnqueueResult {
    if (!isValidAction(input.action)) return { ok: false, reason: 'invalid-action' };
    if (typeof input.machine !== 'string' || input.machine.trim() === '') {
      return { ok: false, reason: 'missing-machine' };
    }

    if (input.action === 'dispatch') {
      if (!isValidProvider(input.provider)) return { ok: false, reason: 'invalid-provider' };
      if (typeof input.cwd !== 'string' || input.cwd.trim() === '') {
        return { ok: false, reason: 'missing-cwd' };
      }
      if (typeof input.prompt !== 'string' || input.prompt.trim() === '') {
        return { ok: false, reason: 'missing-prompt' };
      }
      if (input.prompt.length > DISPATCH_PROMPT_MAX_CHARS) {
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
    } else {
      // action === 'focus'
      if (!input.sessionId && !input.pid) {
        return { ok: false, reason: 'missing-focus-target' };
      }
    }

    const records = this.ensureLoaded();
    const ringingForMachine = [...records.values()].filter(
      (r) => r.machine === input.machine && r.status === 'ringing',
    ).length;
    if (ringingForMachine >= DISPATCH_RINGING_CAP) {
      return { ok: false, reason: 'ringing-cap-exceeded' };
    }

    const record: DispatchRecord = {
      id: randomUUID(),
      action: input.action,
      machine: input.machine,
      provider: input.action === 'dispatch' ? (input.provider as DispatchProvider) : undefined,
      cwd: input.action === 'dispatch' ? input.cwd : undefined,
      prompt: input.action === 'dispatch' ? input.prompt : undefined,
      sessionId: input.sessionId,
      pid: input.action === 'focus' ? input.pid : undefined,
      model: input.action === 'dispatch' ? input.model : undefined,
      effort:
        input.action === 'dispatch' ? (input.effort as DispatchEffort | undefined) : undefined,
      status: 'ringing',
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
    };
    records.set(record.id, record);
    this.persist();
    this.audit('enqueue', record);
    this.emit(record);
    return { ok: true, record };
  }

  // ── Runner-facing ────────────────────────────────────────────────

  /** Refresh a machine's advertised dispatch capability. Called on every
   *  `POST /api/dispatch/poll` tick — a runner that stops polling silently
   *  ages out of `getMachines()` after DISPATCH_MACHINE_AD_TTL_MS. */
  recordAdvertisement(
    machine: string,
    ad: { providers: string[]; roots: string[]; focus: boolean },
    now: number = Date.now(),
  ): void {
    this.machines.set(machine, { machine, ...ad, lastSeenAt: now });
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
   *  explicitly killed via the stop channel). A 'killed' event with
   *  `killOutcome` set (the runner's registry had no matching entry) is
   *  audit-only — it must NEVER downgrade or invent a state transition for
   *  a dispatch the runner didn't actually touch; only a bare `event:
   *  'killed'` (the runner really signaled its own registered child) moves
   *  the record to the distinct terminal `killed` status, and only from
   *  `answered` (never re-terminalizes an already-terminal record). */
  reportStatus(
    id: string,
    input: {
      event: 'started' | 'exited' | 'killed';
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
    };
  }

  /** Non-terminal entries (ringing/answered) — replayed to a freshly
   *  connected WebSocket client, same rationale as poll-state replay. */
  getActive(): DispatchBroadcast[] {
    const records = this.ensureLoaded();
    return [...records.values()]
      .filter((r) => r.status === 'ringing' || r.status === 'answered')
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
      promptPreview: record.prompt?.slice(0, DISPATCH_PROMPT_PREVIEW_MAX_CHARS),
      reason: record.reason,
      pid: record.pid,
      exitCode: record.exitCode,
      resultTail: record.resultTail,
      chainRunId: record.chainRunId,
      chainStep: record.chainStep,
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
