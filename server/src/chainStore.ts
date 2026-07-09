/**
 * Dispatch chain store (v2 mechanic G3 — GAME-DESIGN.md §7.1) — multi-step
 * dispatch sequences ("do X, then feed the result into Y"). Data + audit
 * only: this file owns ChainDef/ChainRun persistence and the terminal-state
 * bookkeeping helpers; chainOrchestrator.ts owns the actual advance
 * algorithm (subscribing to dispatchStore, deciding what happens next,
 * calling dispatchStore.enqueue()).
 *
 * Persisted like dispatchStore.ts (file-backed, tolerant, throttle-free —
 * a chain run mutates rarely but every transition matters for restart
 * survival) at ~/.pixel-agents/chain-defs.json + chain-runs.json, sharing
 * one append-only audit log at chain-audit.jsonl.
 *
 * CHAIN_MAX_STEPS=8, CHAIN_MAX_CONCURRENT_RUNS=3. CHAIN_STEP_TIMEOUT_MS is
 * strictly LESS than dispatchStore.ts's DISPATCH_TTL_MS (500_000 < 600_000)
 * — the chain's own timeout must trip before the dispatch-level TTL sweep,
 * or a chain could sit stuck in `running` for 5 extra minutes with a stale
 * currentStep (GAME-DESIGN §7.1 bug-fix #2's timeout backstop).
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR } from './constants.js';

const CHAIN_DEFS_FILE_NAME = 'chain-defs.json';
const CHAIN_RUNS_FILE_NAME = 'chain-runs.json';
const CHAIN_AUDIT_FILE_NAME = 'chain-audit.jsonl';

export const CHAIN_MAX_STEPS = 8;
export const CHAIN_MAX_CONCURRENT_RUNS = 3;
/** Strictly less than dispatchStore.ts's DISPATCH_TTL_MS (600_000) — see
 *  file header. Verified against dispatchStore.ts's live constant, not
 *  retyped from memory. */
export const CHAIN_STEP_TIMEOUT_MS = 500_000;

export interface ChainStepDef {
  /** Stable within a def — referenced by {{stepK...}} templates (1-based
   *  step NUMBER, not this id, is what templates use — see
   *  validateStepTemplates). */
  id: string;
  machine?: string;
  provider?: string;
  cwd?: string;
  /** May contain {{stepK.result}} / {{stepK.exitCode}} templates, K < this
   *  step's own 1-based position — validated at save time (createDef). */
  prompt: string;
  model?: string;
  effort?: string;
  /** resolveEmployeeDefaults() fills machine/provider/cwd/model gaps from
   *  this employee's record (§7.3) — explicit fields above always win. */
  employeeId?: string;
  /** A nonzero exit normally fails the run immediately. Setting this true
   *  lets the chain advance anyway (still never retries the failed step). */
  continueOnError?: boolean;
}

export interface ChainDef {
  id: string;
  name: string;
  steps: ChainStepDef[];
  createdAt: number;
  updatedAt: number;
}

export type ChainStepStatus = 'pending' | 'running' | 'exited' | 'denied' | 'expired' | 'killed';

export interface ChainStepRun {
  stepId: string;
  dispatchId?: string;
  status: ChainStepStatus;
  exitCode?: number;
  resultTail?: string;
  /** The actual prompt sent, post template-substitution — audit/UI value,
   *  distinct from the def's template-carrying prompt. */
  prompt?: string;
  startedAt?: number;
  finishedAt?: number;
}

export type ChainRunStatus = 'running' | 'completed' | 'failed' | 'halted';

export interface ChainRun {
  id: string;
  chainId: string;
  status: ChainRunStatus;
  /** 0-based index into steps — the step currently pending/running. */
  currentStep: number;
  steps: ChainStepRun[];
  failReason?: string;
  /** Set by STOP ALL (§7.5) — re-enable/resume semantics don't apply to a
   *  halted RUN (only to standing orders), but this flags provenance. */
  stoppedByKillSwitch?: boolean;
  /** Set by haltRun() (KICKOFF v1.1 item 3 — a killed dispatch halts its own
   *  chain run, same terminal semantics as STOP ALL but scoped to one run). */
  haltReason?: string;
  createdAt: number;
  updatedAt: number;
}

export type ChainDefResult = { ok: true; def: ChainDef } | { ok: false; reason: string };

function defaultDefsFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CHAIN_DEFS_FILE_NAME);
}
function defaultRunsFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CHAIN_RUNS_FILE_NAME);
}
function defaultAuditFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CHAIN_AUDIT_FILE_NAME);
}

/** Matches {{stepK.result}} / {{stepK.exitCode}}, K = 1-based step number. */
const TEMPLATE_PATTERN = /\{\{step(\d+)\.(result|exitCode)\}\}/g;

/** A step may only template-reference an EARLIER step (1-based K < this
 *  step's own 1-based position) — checked at save time so a bad chain
 *  fails fast at creation, never stalls mid-run on a forward reference. */
export function validateStepTemplates(
  steps: readonly ChainStepDef[],
): { ok: true } | { ok: false; reason: string } {
  for (let i = 0; i < steps.length; i++) {
    for (const m of steps[i].prompt.matchAll(TEMPLATE_PATTERN)) {
      const k = Number(m[1]);
      if (k < 1 || k > i) {
        return {
          ok: false,
          reason: `step ${i + 1} references {{step${k}...}}, which is not an earlier step`,
        };
      }
    }
  }
  return { ok: true };
}

/** Render a step's prompt template against prior steps' results — pure,
 *  called by chainOrchestrator immediately before enqueueing. Unresolved
 *  placeholders (shouldn't happen post-validateStepTemplates) are left
 *  verbatim rather than throwing — an honest no-op, never a crash. */
export function renderStepPrompt(prompt: string, priorSteps: readonly ChainStepRun[]): string {
  return prompt.replace(TEMPLATE_PATTERN, (full, kStr: string, field: string) => {
    const k = Number(kStr);
    const step = priorSteps[k - 1];
    if (!step) return full;
    if (field === 'exitCode') return step.exitCode !== undefined ? String(step.exitCode) : full;
    return step.resultTail ?? '';
  });
}

export class ChainStore {
  private defs: Map<string, ChainDef> | null = null;
  private runs: Map<string, ChainRun> | null = null;
  private listeners: Array<(run: ChainRun) => void> = [];

  private explicitDefsPath: string | undefined;
  private resolvedDefsPath: string | undefined;
  private usingDefaultDefsPath = false;
  private explicitRunsPath: string | undefined;
  private resolvedRunsPath: string | undefined;
  private usingDefaultRunsPath = false;
  private explicitAuditPath: string | undefined;
  private resolvedAuditPath: string | undefined;

  constructor(defsPath?: string, runsPath?: string, auditPath?: string) {
    this.explicitDefsPath = defsPath;
    this.explicitRunsPath = runsPath;
    this.explicitAuditPath = auditPath;
  }

  /** Subscribe to ChainRun lifecycle mutations. Returns an unsubscribe function. */
  onRunUpdate(listener: (run: ChainRun) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ── Defs ────────────────────────────────────────────────────────────

  createDef(
    input: { name: string; steps: ChainStepDef[] },
    now: number = Date.now(),
  ): ChainDefResult {
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      return { ok: false, reason: 'missing-name' };
    }
    if (!Array.isArray(input.steps) || input.steps.length === 0) {
      return { ok: false, reason: 'missing-steps' };
    }
    if (input.steps.length > CHAIN_MAX_STEPS) {
      return { ok: false, reason: 'too-many-steps' };
    }
    for (const step of input.steps) {
      if (typeof step.prompt !== 'string' || step.prompt.trim() === '') {
        return { ok: false, reason: 'missing-step-prompt' };
      }
    }
    const templateCheck = validateStepTemplates(input.steps);
    if (!templateCheck.ok) return templateCheck;

    const defs = this.ensureDefsLoaded();
    const def: ChainDef = {
      id: randomUUID(),
      name: input.name,
      steps: input.steps,
      createdAt: now,
      updatedAt: now,
    };
    defs.set(def.id, def);
    this.persistDefs();
    return { ok: true, def };
  }

  getDef(id: string): ChainDef | undefined {
    return this.ensureDefsLoaded().get(id);
  }

  getDefs(): ChainDef[] {
    return [...this.ensureDefsLoaded().values()];
  }

  deleteDef(id: string): { ok: true } {
    this.ensureDefsLoaded().delete(id);
    this.persistDefs();
    return { ok: true };
  }

  // ── Runs ────────────────────────────────────────────────────────────

  countRunningRuns(): number {
    return [...this.ensureRunsLoaded().values()].filter((r) => r.status === 'running').length;
  }

  createRun(def: ChainDef, now: number = Date.now()): ChainRun {
    const runs = this.ensureRunsLoaded();
    const run: ChainRun = {
      id: randomUUID(),
      chainId: def.id,
      status: 'running',
      currentStep: 0,
      steps: def.steps.map((s) => ({ stepId: s.id, status: 'pending' as const })),
      createdAt: now,
      updatedAt: now,
    };
    runs.set(run.id, run);
    this.persistRuns();
    this.audit('run-created', run);
    this.emit(run);
    return run;
  }

  getRun(id: string): ChainRun | undefined {
    return this.ensureRunsLoaded().get(id);
  }

  getRuns(): ChainRun[] {
    return [...this.ensureRunsLoaded().values()];
  }

  /** Non-terminal runs — replayed to a freshly connected WS client, same
   *  rationale as dispatchStore.getActive(). */
  getActiveRuns(): ChainRun[] {
    return this.getRuns().filter((r) => r.status === 'running');
  }

  /** A step was just enqueued as a real dispatch (chainOrchestrator is the
   *  only caller — the enqueue itself happened via dispatchStore). */
  markStepRunning(
    runId: string,
    stepIndex: number,
    dispatchId: string,
    renderedPrompt: string,
    now: number = Date.now(),
  ): ChainRun | undefined {
    const run = this.ensureRunsLoaded().get(runId);
    if (!run) return undefined;
    run.steps[stepIndex] = {
      ...run.steps[stepIndex],
      status: 'running',
      dispatchId,
      prompt: renderedPrompt,
      startedAt: now,
    };
    run.updatedAt = now;
    this.persistRuns();
    this.audit('step-running', run);
    this.emit(run);
    return run;
  }

  /** Record a step's terminal outcome (pure bookkeeping — chainOrchestrator
   *  decides what happens next: advanceRun/completeRun/failRun). */
  recordStepResult(
    runId: string,
    stepIndex: number,
    status: 'exited' | 'denied' | 'expired' | 'killed',
    opts: { exitCode?: number; resultTail?: string } = {},
    now: number = Date.now(),
  ): ChainRun | undefined {
    const run = this.ensureRunsLoaded().get(runId);
    if (!run) return undefined;
    run.steps[stepIndex] = {
      ...run.steps[stepIndex],
      status,
      exitCode: opts.exitCode,
      resultTail: opts.resultTail,
      finishedAt: now,
    };
    run.updatedAt = now;
    this.persistRuns();
    this.audit('step-result', run);
    this.emit(run);
    return run;
  }

  advanceRun(runId: string, now: number = Date.now()): ChainRun | undefined {
    const run = this.ensureRunsLoaded().get(runId);
    if (!run) return undefined;
    run.currentStep += 1;
    run.updatedAt = now;
    this.persistRuns();
    this.emit(run);
    return run;
  }

  completeRun(runId: string, now: number = Date.now()): ChainRun | undefined {
    const run = this.ensureRunsLoaded().get(runId);
    if (!run) return undefined;
    run.status = 'completed';
    run.updatedAt = now;
    this.persistRuns();
    this.audit('run-completed', run);
    this.emit(run);
    return run;
  }

  /** A denied/expired/failed-exit step is terminal — never retried, the run
   *  fails immediately (GAME-DESIGN §7.1). */
  failRun(runId: string, reason: string, now: number = Date.now()): ChainRun | undefined {
    const run = this.ensureRunsLoaded().get(runId);
    if (!run) return undefined;
    run.status = 'failed';
    run.failReason = reason;
    run.updatedAt = now;
    this.persistRuns();
    this.audit('run-failed', run);
    this.emit(run);
    return run;
  }

  /** STOP ALL (§7.5): halt every running run in one pass — an in-flight
   *  dispatch finishes on its own (already spent) but the run itself never
   *  enqueues a next step. Returns the runs actually halted. */
  haltAllRunning(now: number = Date.now()): ChainRun[] {
    const halted: ChainRun[] = [];
    for (const run of this.ensureRunsLoaded().values()) {
      if (run.status !== 'running') continue;
      run.status = 'halted';
      run.stoppedByKillSwitch = true;
      run.updatedAt = now;
      halted.push(run);
      this.audit('run-halted', run);
    }
    if (halted.length > 0) this.persistRuns();
    for (const run of halted) this.emit(run);
    return halted;
  }

  /** Targeted single-run halt (KICKOFF v1.1 item 3): a killed dispatch that
   *  belonged to a chain step halts THAT run, same terminal semantics as
   *  haltAllRunning (never resumed, in-flight work already spent) but
   *  scoped to one run instead of every running run. A no-op (not an error)
   *  if the run is unknown or already non-running. */
  haltRun(runId: string, reason: string, now: number = Date.now()): ChainRun | undefined {
    const run = this.ensureRunsLoaded().get(runId);
    if (!run || run.status !== 'running') return undefined;
    run.status = 'halted';
    run.haltReason = reason;
    run.updatedAt = now;
    this.persistRuns();
    this.audit('run-halted', run);
    this.emit(run);
    return run;
  }

  private emit(run: ChainRun): void {
    for (const listener of this.listeners) listener(run);
  }

  // ── Persistence (tolerant, throttle-free — same pattern as dispatchStore.ts) ──

  private defsPath(): string {
    if (!this.resolvedDefsPath) {
      this.usingDefaultDefsPath = this.explicitDefsPath === undefined;
      this.resolvedDefsPath = this.explicitDefsPath ?? defaultDefsFile();
    }
    return this.resolvedDefsPath;
  }

  private runsPath(): string {
    if (!this.resolvedRunsPath) {
      this.usingDefaultRunsPath = this.explicitRunsPath === undefined;
      this.resolvedRunsPath = this.explicitRunsPath ?? defaultRunsFile();
    }
    return this.resolvedRunsPath;
  }

  private auditPath(): string {
    if (!this.resolvedAuditPath) {
      this.resolvedAuditPath = this.explicitAuditPath ?? defaultAuditFile();
    }
    return this.resolvedAuditPath;
  }

  private ensureDefsLoaded(): Map<string, ChainDef> {
    if (!this.defs) this.defs = this.loadMap<ChainDef>(this.defsPath());
    return this.defs;
  }

  private ensureRunsLoaded(): Map<string, ChainRun> {
    if (!this.runs) this.runs = this.loadMap<ChainRun>(this.runsPath());
    return this.runs;
  }

  private loadMap<T extends { id: string }>(filePath: string): Map<string, T> {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      if (!Array.isArray(raw)) return new Map();
      const map = new Map<string, T>();
      for (const entry of raw as T[]) {
        if (entry && typeof entry.id === 'string') map.set(entry.id, entry);
      }
      return map;
    } catch {
      /* missing/corrupt → fresh store */
      return new Map();
    }
  }

  private persistDefs(): void {
    if (process.env.VITEST && this.usingDefaultDefsPath) return;
    this.writeMap(this.defsPath(), this.ensureDefsLoaded());
  }

  private persistRuns(): void {
    if (process.env.VITEST && this.usingDefaultRunsPath) return;
    this.writeMap(this.runsPath(), this.ensureRunsLoaded());
  }

  private writeMap<T>(filePath: string, map: Map<string, T>): void {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify([...map.values()]), 'utf8');
    } catch {
      /* chain state loss on write failure is acceptable — never crash the server */
    }
  }

  private audit(event: string, run: ChainRun): void {
    if (process.env.VITEST && this.explicitAuditPath === undefined) return;
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), event, ...run });
      const target = this.auditPath();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.appendFileSync(target, `${line}\n`, 'utf8');
    } catch {
      /* audit-log loss must never crash the server */
    }
  }
}

/** Process-wide instance (the server is single-process). */
export const chainStore = new ChainStore();
