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

export type DispatchAction = 'dispatch' | 'focus';
export type DispatchStatus = 'ringing' | 'answered' | 'denied' | 'expired' | 'exited';

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
}

export type DispatchEnqueueResult =
  | { ok: true; record: Readonly<DispatchRecord> }
  | { ok: false; reason: string };

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

  /** Runner-reported lifecycle event (spawn started / process exited). */
  reportStatus(
    id: string,
    input: { event: 'started' | 'exited'; pid?: number; exitCode?: number; resultTail?: string },
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
    } else {
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
   *  after reportStatus() commits the terminal transition. */
  getRecord(
    id: string,
  ):
    | Pick<DispatchRecord, 'provider' | 'employeeId' | 'chainRunId' | 'chainStep' | 'contractId'>
    | undefined {
    const record = this.ensureLoaded().get(id);
    if (!record) return undefined;
    return {
      provider: record.provider,
      employeeId: record.employeeId,
      chainRunId: record.chainRunId,
      chainStep: record.chainStep,
      contractId: record.contractId,
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
}

/** Process-wide instance (the server is single-process). */
export const dispatchStore = new DispatchStore();
