/**
 * Unit tests for the chain orchestrator (v2 mechanic G3, GAME-DESIGN.md
 * §7.1). Covers the advance algorithm end-to-end against real ChainStore +
 * DispatchStore instances (pointed at temp files, no HTTP layer) — the two
 * named regression tests (bug #1 double-subscription, bug #2 expired
 * status), template substitution across a 3-step chain, the budget gate
 * (auto-continuation only, never step 1), and STOP ALL mid-chain.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChainOrchestrator } from '../src/chainOrchestrator.js';
import { type ChainStepDef, ChainStore } from '../src/chainStore.js';
import { DispatchStore } from '../src/dispatchStore.js';

let tmpDir: string;
let chains: ChainStore;
let dispatch: DispatchStore;
let orchestrator: ChainOrchestrator;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-orch-'));
  chains = new ChainStore(
    path.join(tmpDir, 'chain-defs.json'),
    path.join(tmpDir, 'chain-runs.json'),
    path.join(tmpDir, 'chain-audit.jsonl'),
  );
  dispatch = new DispatchStore(
    path.join(tmpDir, 'dispatch-queue.json'),
    path.join(tmpDir, 'dispatch-audit.jsonl'),
  );
  orchestrator = new ChainOrchestrator(
    chains,
    dispatch,
    () => undefined,
    () => ({ paused: false }),
  );
});

afterEach(() => {
  orchestrator.stop();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function step(id: string, prompt: string, extra: Partial<ChainStepDef> = {}): ChainStepDef {
  return { id, prompt, machine: 'MACBOOK', provider: 'claude', cwd: '/tmp/proj', ...extra };
}

/** Simulates a runner accepting the currently-ringing dispatch for
 *  `machine` and reporting it exited with `exitCode`. */
function acceptAndExit(machine: string, exitCode: number, resultTail?: string): void {
  const pending = dispatch.pendingFor(machine);
  expect(pending).toHaveLength(1);
  const id = pending[0].id;
  dispatch.decide(id, 'accept');
  dispatch.reportStatus(id, { event: 'exited', exitCode, resultTail });
}

/** Simulates a runner denying the currently-ringing dispatch. */
function deny(machine: string, reason: string): void {
  const pending = dispatch.pendingFor(machine);
  expect(pending).toHaveLength(1);
  dispatch.decide(pending[0].id, 'deny', { reason });
}

describe('ChainOrchestrator.startRun', () => {
  it('enqueues step 1 immediately, never budget-gated', () => {
    const isPaused = vi.fn(() => ({ paused: true, reason: 'stale-snapshot' })); // would fail every step if checked
    orchestrator = new ChainOrchestrator(chains, dispatch, () => undefined, isPaused);
    orchestrator.start();
    const defResult = chains.createDef({ name: 'x', steps: [step('s1', 'do it')] });
    if (!defResult.ok) throw new Error('unreachable');
    const result = orchestrator.startRun(defResult.def.id);
    expect(result.ok).toBe(true);
    expect(dispatch.pendingFor('MACBOOK')).toHaveLength(1);
    // isPaused is never even consulted for step 1 (gateByBudget: false).
    expect(isPaused).not.toHaveBeenCalled();
  });

  it('rejects an unknown chain id', () => {
    orchestrator.start();
    const result = orchestrator.startRun('nonexistent');
    expect(result.ok).toBe(false);
  });

  it('fails the run immediately if the step has no resolvable machine/provider/cwd', () => {
    orchestrator.start();
    const defResult = chains.createDef({
      name: 'x',
      steps: [{ id: 's1', prompt: 'do it' }], // no machine/provider/cwd, no employeeId
    });
    if (!defResult.ok) throw new Error('unreachable');
    const result = orchestrator.startRun(defResult.def.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(chains.getRun(result.run.id)?.status).toBe('failed');
  });
});

describe('ChainOrchestrator end-to-end advance', () => {
  it('a 3-step chain substitutes {{stepK.result}}/{{stepK.exitCode}} and completes', () => {
    orchestrator.start();
    const defResult = chains.createDef({
      name: 'pipeline',
      steps: [
        step('s1', 'produce a value'),
        step('s2', 'consume {{step1.result}} (was code {{step1.exitCode}})'),
        step('s3', 'consume {{step1.result}} and {{step2.result}}'),
      ],
    });
    if (!defResult.ok) throw new Error('unreachable');
    const started = orchestrator.startRun(defResult.def.id);
    if (!started.ok) throw new Error('unreachable');

    acceptAndExit('MACBOOK', 0, 'RESULT_ONE');
    let run = chains.getRun(started.run.id)!;
    expect(run.currentStep).toBe(1);
    expect(run.steps[1].prompt).toBe('consume RESULT_ONE (was code 0)');

    acceptAndExit('MACBOOK', 0, 'RESULT_TWO');
    run = chains.getRun(started.run.id)!;
    expect(run.currentStep).toBe(2);
    expect(run.steps[2].prompt).toBe('consume RESULT_ONE and RESULT_TWO');

    acceptAndExit('MACBOOK', 0, 'RESULT_THREE');
    run = chains.getRun(started.run.id)!;
    expect(run.status).toBe('completed');
  });

  it('a denied step fails the run immediately with the runner deny reason, next step never enqueues', () => {
    orchestrator.start();
    const defResult = chains.createDef({
      name: 'pipeline',
      steps: [step('s1', 'first'), step('s2', 'second {{step1.result}}')],
    });
    if (!defResult.ok) throw new Error('unreachable');
    const started = orchestrator.startRun(defResult.def.id);
    if (!started.ok) throw new Error('unreachable');

    deny('MACBOOK', 'path-not-allowlisted');
    const run = chains.getRun(started.run.id)!;
    expect(run.status).toBe('failed');
    expect(run.failReason).toContain('path-not-allowlisted');
    expect(dispatch.pendingFor('MACBOOK')).toHaveLength(0); // step 2 never enqueued
  });

  it('a nonzero exit without continueOnError fails the run; WITH continueOnError it advances', () => {
    orchestrator.start();
    const defResult = chains.createDef({
      name: 'pipeline',
      steps: [step('s1', 'first', { continueOnError: true }), step('s2', 'second')],
    });
    if (!defResult.ok) throw new Error('unreachable');
    const started = orchestrator.startRun(defResult.def.id);
    if (!started.ok) throw new Error('unreachable');

    acceptAndExit('MACBOOK', 1);
    const run = chains.getRun(started.run.id)!;
    expect(run.currentStep).toBe(1); // advanced despite nonzero exit
    expect(dispatch.pendingFor('MACBOOK')).toHaveLength(1); // step 2 enqueued
  });
});

describe('Regression test — bug #2 (expired treated identically to denied)', () => {
  it('a step reaching expired fails the chain immediately, same as denied — no stall', () => {
    orchestrator.start();
    const defResult = chains.createDef({
      name: 'pipeline',
      steps: [step('s1', 'first'), step('s2', 'second')],
    });
    if (!defResult.ok) throw new Error('unreachable');
    const started = orchestrator.startRun(defResult.def.id);
    if (!started.ok) throw new Error('unreachable');

    const pending = dispatch.pendingFor('MACBOOK');
    expect(pending).toHaveLength(1);
    // Sweep the dispatch past its own TTL to force 'expired' (0ms ttl).
    const swept = dispatch.sweepExpired(Date.now() + 1, 0);
    expect(swept).toBe(1);

    const run = chains.getRun(started.run.id)!;
    expect(run.status).toBe('failed');
    expect(run.failReason).toBe('step-expired');
    expect(dispatch.pendingFor('MACBOOK')).toHaveLength(0); // never retried, never advanced
  });
});

describe('Regression test — bug #1 (double-subscription does not double-enqueue)', () => {
  it('calling start() twice (simulating 2 WS connections) still enqueues exactly once per real step transition', () => {
    const enqueueSpy = vi.spyOn(dispatch, 'enqueue');
    orchestrator.start();
    orchestrator.start(); // second "connection" naively re-wiring — must be a no-op

    const defResult = chains.createDef({
      name: 'pipeline',
      steps: [step('s1', 'first'), step('s2', 'second {{step1.result}}')],
    });
    if (!defResult.ok) throw new Error('unreachable');
    const started = orchestrator.startRun(defResult.def.id);
    if (!started.ok) throw new Error('unreachable');
    expect(enqueueSpy).toHaveBeenCalledTimes(1); // step 1

    // ONE real step transition (step 1 exits, should enqueue step 2 exactly once).
    acceptAndExit('MACBOOK', 0, 'ok');
    expect(enqueueSpy).toHaveBeenCalledTimes(2); // step 1 + step 2, never 3

    const run = chains.getRun(started.run.id)!;
    expect(run.currentStep).toBe(1);
    expect(dispatch.pendingFor('MACBOOK')).toHaveLength(1); // exactly one step-2 dispatch
  });
});

describe('Budget gate — auto-continuation only, never step 1', () => {
  it('pauses continuation to step 2 while budget-paused, leaving step 2 pending', () => {
    let paused = true;
    orchestrator = new ChainOrchestrator(
      chains,
      dispatch,
      () => undefined,
      () => (paused ? { paused: true, reason: '5h-threshold' } : { paused: false }),
    );
    orchestrator.start();
    const defResult = chains.createDef({
      name: 'pipeline',
      steps: [step('s1', 'first'), step('s2', 'second')],
    });
    if (!defResult.ok) throw new Error('unreachable');
    const started = orchestrator.startRun(defResult.def.id);
    if (!started.ok) throw new Error('unreachable');
    expect(dispatch.pendingFor('MACBOOK')).toHaveLength(1); // step 1 unaffected by pause

    acceptAndExit('MACBOOK', 0, 'ok');
    let run = chains.getRun(started.run.id)!;
    expect(run.status).toBe('running');
    expect(run.steps[1].status).toBe('pending'); // held, not enqueued
    expect(dispatch.pendingFor('MACBOOK')).toHaveLength(0);
    // KICKOFF v1.1 item 5: the specific reason threads onto the run itself —
    // this is what lets a client tell "paused: 5h-threshold" apart from
    // "just between steps" (both would otherwise be an identical pending step).
    expect(run.pausedReason).toBe('5h-threshold');

    paused = false;
    orchestrator.sweep();
    run = chains.getRun(started.run.id)!;
    expect(run.steps[1].status).toBe('running');
    expect(dispatch.pendingFor('MACBOOK')).toHaveLength(1);
    expect(run.pausedReason).toBeUndefined(); // cleared once the gate unblocks
  });
});

describe('sweep() step-timeout backstop', () => {
  it('fails a run whose current step has run past CHAIN_STEP_TIMEOUT_MS with no terminal update', () => {
    orchestrator.start();
    const defResult = chains.createDef({ name: 'x', steps: [step('s1', 'a')] });
    if (!defResult.ok) throw new Error('unreachable');
    const started = orchestrator.startRun(defResult.def.id);
    if (!started.ok) throw new Error('unreachable');

    orchestrator.sweep(Date.now() + 600_000); // past CHAIN_STEP_TIMEOUT_MS (500_000)
    const run = chains.getRun(started.run.id)!;
    expect(run.status).toBe('failed');
    expect(run.failReason).toBe('step-timeout');
  });
});

describe('STOP ALL mid-chain', () => {
  it('halts a running chain; a subsequent terminal dispatchUpdate never enqueues the next step', () => {
    orchestrator.start();
    const defResult = chains.createDef({
      name: 'pipeline',
      steps: [step('s1', 'first'), step('s2', 'second')],
    });
    if (!defResult.ok) throw new Error('unreachable');
    const started = orchestrator.startRun(defResult.def.id);
    if (!started.ok) throw new Error('unreachable');

    orchestrator.haltAll();
    expect(chains.getRun(started.run.id)?.status).toBe('halted');

    // The in-flight step-1 dispatch finishes on its own (already spent).
    acceptAndExit('MACBOOK', 0, 'ok');
    const run = chains.getRun(started.run.id)!;
    expect(run.status).toBe('halted'); // unchanged — never resurrected to 'running'
    expect(dispatch.pendingFor('MACBOOK')).toHaveLength(0); // step 2 never enqueued
  });
});

describe('Worker session kill (KICKOFF v1.1 item 3)', () => {
  it('a killed dispatch step halts ITS run (not failed) with a distinct step status, and never enqueues a next step', () => {
    orchestrator.start();
    const defResult = chains.createDef({
      name: 'pipeline',
      steps: [step('s1', 'first'), step('s2', 'second')],
    });
    if (!defResult.ok) throw new Error('unreachable');
    const started = orchestrator.startRun(defResult.def.id);
    if (!started.ok) throw new Error('unreachable');

    const pending = dispatch.pendingFor('MACBOOK');
    expect(pending).toHaveLength(1);
    const id = pending[0].id;
    dispatch.decide(id, 'accept');
    dispatch.reportStatus(id, { event: 'killed', exitCode: -1 });

    const run = chains.getRun(started.run.id)!;
    expect(run.status).toBe('halted'); // terminal, STOP ALL's own semantics — never 'failed'
    expect(run.haltReason).toBe('step-killed');
    expect(run.steps[0].status).toBe('killed'); // distinct step status, never 'exited'
    expect(dispatch.pendingFor('MACBOOK')).toHaveLength(0); // step 2 never enqueued
  });

  it('killing one run never touches a SEPARATE concurrent run, and STOP ALL still halts everything afterward', () => {
    orchestrator.start();
    const defA = chains.createDef({ name: 'x', steps: [step('s1', 'a', { machine: 'MACBOOK' })] });
    const defB = chains.createDef({ name: 'y', steps: [step('s1', 'b', { machine: 'MINI' })] });
    if (!defA.ok || !defB.ok) throw new Error('unreachable');

    const runA = orchestrator.startRun(defA.def.id);
    const runB = orchestrator.startRun(defB.def.id);
    if (!runA.ok || !runB.ok) throw new Error('unreachable');

    const pendingA = dispatch.pendingFor('MACBOOK');
    expect(pendingA).toHaveLength(1);
    dispatch.decide(pendingA[0].id, 'accept');
    dispatch.reportStatus(pendingA[0].id, { event: 'killed', exitCode: -1 });

    expect(chains.getRun(runA.run.id)?.status).toBe('halted');
    expect(chains.getRun(runB.run.id)?.status).toBe('running'); // untouched by A's kill

    // Adversarial-review check (c): STOP ALL still halts everything
    // end-to-end even after an individual kill has already happened.
    orchestrator.haltAll();
    expect(chains.getRun(runB.run.id)?.status).toBe('halted');
    expect(chains.getRun(runA.run.id)?.status).toBe('halted'); // already-halted A is untouched, still halted
  });
});
