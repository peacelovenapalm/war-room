/**
 * Dispatch chain orchestrator (v2 mechanic G3 — GAME-DESIGN.md §7.1). Owns
 * the chain-advance ALGORITHM; chainStore.ts owns only data + audit.
 *
 * Bug-fix #1 (subscription wiring): `start()` subscribes to
 * dispatchStore.onUpdate() and is idempotent — a second call is a safe
 * no-op. The real fix is call-site discipline (httpServer.ts calls
 * `chainOrchestrator.start()` exactly ONCE, at process startup, inside
 * `createHttpServer()` — never inside the per-WebSocket-connection
 * handler). The idempotency guard here is defense-in-depth: even if a
 * caller mistakenly invoked `start()` once per connection (the historical
 * bug shape — "two open browser tabs create two independent chain-advance
 * handlers"), only one subscription would ever be registered. A second,
 * independent guard lives in the advance algorithm itself: every handler
 * invocation re-checks `run.currentStep === stepIndex` before acting, so
 * even a genuinely duplicated event (not just a duplicated subscription)
 * can advance a given step at most once — the first invocation's synchronous
 * mutation of `currentStep` makes any second invocation for the same
 * transition a no-op.
 *
 * Bug-fix #2 (`expired` status): treated IDENTICALLY to `denied` in
 * onDispatchUpdate — terminal, fails the run immediately, never retried.
 *
 * Budget guardrail (cross-cutting rule 7): gates chain-step
 * AUTO-CONTINUATION only (steps 2+, advanced without a fresh human click) —
 * never the human-initiated kickoff of step 1 (GAME-DESIGN §7.4: "a human
 * clicking Send is a conscious spend... never paused", and starting a chain
 * run is that same kind of conscious act). A budget-paused continuation
 * leaves the next step `pending`; `sweep()` retries it on later ticks.
 */

import {
  CHAIN_STEP_TIMEOUT_MS,
  chainMaxConcurrentRuns,
  type ChainRun,
  ChainStore,
  chainStore,
  renderStepPrompt,
} from './chainStore.js';
import { type DispatchBroadcast, DispatchStore, dispatchStore } from './dispatchStore.js';
import type { AutomationPerkFlags } from './standingOrderStore.js';

/** Subset of employeeStore's Employee record resolveEmployeeDefaults() reads
 *  (GAME-DESIGN §7.3) — kept as a narrow local type so this file doesn't
 *  import employeeStore.ts directly (httpServer.ts wires the real resolver
 *  in via configure()). */
export interface EmployeeDispatchDefaults {
  machine?: string;
  projectDir?: string;
  defaultProvider?: string;
  defaultModel?: string;
}

export type ResolveEmployeeDefaults = (employeeId: string) => EmployeeDispatchDefaults | undefined;

/** Narrow local mirror of budgetStore.ts's AutomationPauseResult (KICKOFF
 *  v1.1 item 5) — kept as a structural duplicate rather than an import so
 *  this file still doesn't depend on budgetStore.ts directly (httpServer.ts
 *  wires the real gate in via configure(), same one-way-layering rationale
 *  as EmployeeDispatchDefaults above). */
export interface AutomationPauseCheck {
  paused: boolean;
  reason?: string;
}
export type IsAutomationPaused = (
  machine: string,
  provider: string | undefined,
) => AutomationPauseCheck;

export type ChainStartResult = { ok: true; run: ChainRun } | { ok: false; reason: string };

export class ChainOrchestrator {
  private subscribed = false;
  private unsubscribeDispatch: (() => void) | null = null;
  private resolveEmployeeDefaults: ResolveEmployeeDefaults;
  private isAutomationPaused: IsAutomationPaused;

  constructor(
    private readonly chains: ChainStore = chainStore,
    private readonly dispatch: DispatchStore = dispatchStore,
    resolveEmployeeDefaults: ResolveEmployeeDefaults = () => undefined,
    // Fail-safe default: until configure() wires the real budgetStore gate,
    // treat automation as PAUSED — an unwired gate must never silently mean
    // "never pauses" (same fail-safe posture as budgetStore's own
    // stale-snapshot default).
    isAutomationPaused: IsAutomationPaused = () => ({
      paused: true,
      reason: 'gate-not-configured',
    }),
  ) {
    this.resolveEmployeeDefaults = resolveEmployeeDefaults;
    this.isAutomationPaused = isAutomationPaused;
  }

  /** Wire the real employeeStore/budgetStore dependencies — called once by
   *  httpServer.ts before start(), after those stores exist. */
  configure(deps: {
    resolveEmployeeDefaults?: ResolveEmployeeDefaults;
    isAutomationPaused?: IsAutomationPaused;
  }): void {
    if (deps.resolveEmployeeDefaults) this.resolveEmployeeDefaults = deps.resolveEmployeeDefaults;
    if (deps.isAutomationPaused) this.isAutomationPaused = deps.isAutomationPaused;
  }

  /** See file header — idempotent, call exactly once at process startup. */
  start(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.unsubscribeDispatch = this.dispatch.onUpdate((broadcast) =>
      this.onDispatchUpdate(broadcast),
    );
  }

  stop(): void {
    this.unsubscribeDispatch?.();
    this.unsubscribeDispatch = null;
    this.subscribed = false;
  }

  /** Human-initiated kickoff (CallModal-equivalent conscious act) — never
   *  budget-gated. Starts step 0 synchronously. `perkFlags` (Chain Gang)
   *  raises the concurrent-run cap 3 -> 5 — resolved by the caller
   *  (httpServer.ts via economyStore.getPerkFlags()) and passed in per-call,
   *  never imported here (same one-way-layering rule as
   *  resolveEmployeeDefaults/isAutomationPaused above). */
  startRun(
    chainId: string,
    perkFlags: AutomationPerkFlags = {},
    now: number = Date.now(),
  ): ChainStartResult {
    const def = this.chains.getDef(chainId);
    if (!def) return { ok: false, reason: 'unknown-chain' };
    if (this.chains.countRunningRuns() >= chainMaxConcurrentRuns(perkFlags)) {
      return { ok: false, reason: 'concurrent-cap-exceeded' };
    }
    const run = this.chains.createRun(def, now);
    this.enqueueStep(run.id, 0, { gateByBudget: false }, now);
    return { ok: true, run: this.chains.getRun(run.id) ?? run };
  }

  /** STOP ALL (§7.5) — halts every running run; in-flight dispatches finish
   *  on their own but never enqueue a next step (their terminal
   *  dispatchUpdate will find run.status !== 'running' in onDispatchUpdate
   *  and no-op). */
  haltAll(now: number = Date.now()): ChainRun[] {
    return this.chains.haltAllRunning(now);
  }

  /** Targeted single-run halt (KICKOFF v1.1 item 3) — called when a killed
   *  dispatch belonged to a chain step (see onDispatchUpdate's 'killed'
   *  branch below), never directly by an HTTP route. */
  haltRun(runId: string, reason: string, now: number = Date.now()): ChainRun | undefined {
    return this.chains.haltRun(runId, reason, now);
  }

  private enqueueStep(
    runId: string,
    stepIndex: number,
    opts: { gateByBudget: boolean },
    now: number,
  ): void {
    const run = this.chains.getRun(runId);
    if (!run || run.status !== 'running') return;
    const def = this.chains.getDef(run.chainId);
    if (!def) {
      this.chains.failRun(runId, 'chain-definition-missing', now);
      return;
    }
    const stepDef = def.steps[stepIndex];
    const defaults = stepDef.employeeId
      ? this.resolveEmployeeDefaults(stepDef.employeeId)
      : undefined;
    const machine = stepDef.machine ?? defaults?.machine;
    const provider = stepDef.provider ?? defaults?.defaultProvider;
    const cwd = stepDef.cwd ?? defaults?.projectDir;
    const model = stepDef.model ?? defaults?.defaultModel;

    if (!machine || !provider || !cwd) {
      this.chains.failRun(runId, 'missing-dispatch-target', now);
      return;
    }

    if (opts.gateByBudget) {
      const pauseCheck = this.isAutomationPaused(machine, provider);
      if (pauseCheck.paused) {
        // Step stays 'pending' — sweep() retries on a later tick. Never a
        // hard failure: a transient budget pause shouldn't kill the chain.
        // pausedReason is the ONLY thing that lets a client distinguish
        // this from "just between steps" (KICKOFF v1.1 item 5).
        this.chains.setPausedReason(runId, pauseCheck.reason, now);
        return;
      }
    }
    // Gate cleared (or wasn't applied) — this run is no longer paused.
    // setPausedReason() no-ops when the reason isn't actually changing, so
    // this doesn't churn persistence on every sweep tick of an unpaused run.
    this.chains.setPausedReason(runId, undefined, now);

    const prompt = renderStepPrompt(stepDef.prompt, run.steps);
    const result = this.dispatch.enqueue(
      {
        action: 'dispatch',
        machine,
        provider,
        cwd,
        prompt,
        model,
        effort: stepDef.effort,
        chainRunId: runId,
        chainStep: stepIndex,
        employeeId: stepDef.employeeId,
      },
      now,
    );
    if (!result.ok) {
      this.chains.failRun(runId, `enqueue-failed: ${result.reason}`, now);
      return;
    }
    this.chains.markStepRunning(runId, stepIndex, result.record.id, prompt, now);
  }

  private onDispatchUpdate(broadcast: DispatchBroadcast): void {
    if (broadcast.chainRunId === undefined || broadcast.chainStep === undefined) return;
    const runId = broadcast.chainRunId;
    const stepIndex = broadcast.chainStep;
    const run = this.chains.getRun(runId);
    // Re-entrancy / duplicate-subscription guard: a stale or duplicated
    // event for a step this run has already moved past is a no-op.
    if (!run || run.status !== 'running' || run.currentStep !== stepIndex) return;

    const now = Date.now();
    const def = this.chains.getDef(run.chainId);
    const stepDef = def?.steps[stepIndex];

    if (broadcast.status === 'denied') {
      this.chains.recordStepResult(runId, stepIndex, 'denied', {}, now);
      this.chains.failRun(runId, broadcast.reason ? `denied: ${broadcast.reason}` : 'denied', now);
      return;
    }
    if (broadcast.status === 'expired') {
      // Bug-fix #2: expired === denied for chain purposes — terminal, no retry.
      this.chains.recordStepResult(runId, stepIndex, 'expired', {}, now);
      this.chains.failRun(runId, 'step-expired', now);
      return;
    }
    if (broadcast.status === 'killed') {
      // KICKOFF v1.1 item 3: a killed dispatch is NOT a failure (it wasn't
      // given the chance to finish or misbehave) — it halts its run with
      // the same terminal, never-resumed semantics STOP ALL uses, scoped to
      // this one run. Never retried, same as denied/expired/failed exits.
      this.chains.recordStepResult(
        runId,
        stepIndex,
        'killed',
        { exitCode: broadcast.exitCode, resultTail: broadcast.resultTail },
        now,
      );
      this.chains.haltRun(runId, 'step-killed', now);
      return;
    }
    if (broadcast.status === 'exited') {
      this.chains.recordStepResult(
        runId,
        stepIndex,
        'exited',
        { exitCode: broadcast.exitCode, resultTail: broadcast.resultTail },
        now,
      );
      const failed = broadcast.exitCode !== 0 && !stepDef?.continueOnError;
      if (failed) {
        this.chains.failRun(runId, `step exited ${broadcast.exitCode}`, now);
        return;
      }
      const nextIndex = stepIndex + 1;
      this.chains.advanceRun(runId, now);
      if (!def || nextIndex >= def.steps.length) {
        this.chains.completeRun(runId, now);
        return;
      }
      this.enqueueStep(runId, nextIndex, { gateByBudget: true }, now);
      return;
    }
    // 'ringing' / 'answered': non-terminal, nothing to do yet.
  }

  /** Periodic tick (httpServer.ts registers this at the same cadence as the
   *  dispatch TTL sweep): retries budget-paused pending continuations, and
   *  fails any run whose current step has run past CHAIN_STEP_TIMEOUT_MS
   *  without a terminal dispatchUpdate ever arriving — the chain's own
   *  timeout backstop, which trips BEFORE dispatchStore's own
   *  DISPATCH_TTL_MS sweep would (500_000 < 600_000). */
  sweep(now: number = Date.now()): void {
    for (const run of this.chains.getActiveRuns()) {
      const step = run.steps[run.currentStep];
      if (!step) continue;
      if (step.status === 'pending') {
        this.enqueueStep(run.id, run.currentStep, { gateByBudget: true }, now);
      } else if (step.status === 'running' && step.startedAt !== undefined) {
        if (now - step.startedAt > CHAIN_STEP_TIMEOUT_MS) {
          this.chains.recordStepResult(run.id, run.currentStep, 'expired', {}, now);
          this.chains.failRun(run.id, 'step-timeout', now);
        }
      }
    }
  }
}

/** Process-wide instance (the server is single-process) — configure() +
 *  start() are wired once in httpServer.ts's createHttpServer(). */
export const chainOrchestrator = new ChainOrchestrator();
