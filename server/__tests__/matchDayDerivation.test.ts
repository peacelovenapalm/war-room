/**
 * Match Day derivation tests (v3 WS-C stage 2): chain runs → fixtures,
 * commentary ONLY from real step transitions (with source refs), the
 * documented honest W/D/L mapping, REAL-vs-NO_DATA axis honesty (burn is
 * always NO_DATA — no token telemetry exists), the test-summary parser,
 * and restart adoption without re-announcing history.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChainRun, ChainStepRun, ChainStepStatus } from '../src/chainStore.js';
import {
  buildResult,
  MatchDayDerivation,
  parseTestSummary,
  renderCommentary,
} from '../src/matchDayDerivation.js';
import { MatchDayStore } from '../src/matchDayStore.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-day-derivation-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeStore(): MatchDayStore {
  return new MatchDayStore(path.join(tmpDir, 'match-days.json'));
}

function step(
  status: ChainStepStatus,
  opts: { dispatchId?: string; exitCode?: number; resultTail?: string } = {},
): ChainStepRun {
  return { stepId: `s-${Math.random()}`, status, ...opts };
}

function run(status: ChainRun['status'], steps: ChainStepRun[], id = 'run-1'): ChainRun {
  return {
    id,
    chainId: 'chain-1',
    status,
    currentStep: 0,
    steps,
    createdAt: 0,
    updatedAt: 0,
  };
}

const noopChains = { onRunUpdate: () => () => {} };

describe('parseTestSummary', () => {
  it('parses the LAST passed/failed counters and returns null with no summary', () => {
    expect(parseTestSummary('installing deps...')).toBeNull();
    expect(parseTestSummary('Tests: 12 passed')).toEqual({ passed: 12, failed: 0 });
    expect(parseTestSummary('5 passed\nrerun\n7 passed, 2 failed')).toEqual({
      passed: 7,
      failed: 2,
    });
    expect(parseTestSummary('3 passing, 1 failing')).toEqual({ passed: 3, failed: 1 });
  });
});

describe('renderCommentary', () => {
  it('is deterministic — the same real history renders the same line', () => {
    const a = renderCommentary('fx-1', 'stepStarted', 0, { step: 'step 1' });
    const b = renderCommentary('fx-1', 'stepStarted', 0, { step: 'step 1' });
    expect(a).toBe(b);
    expect(a).toContain('step 1');
  });
});

describe('MatchDayDerivation — fixture lifecycle from real run transitions', () => {
  it('opens a pre fixture for a fresh run, goes live on the first step start', () => {
    const store = makeStore();
    const derivation = new MatchDayDerivation(store, noopChains);

    derivation.handleRunUpdate(run('running', [step('pending'), step('pending')]), 100);
    let fixture = store.getAll()[0];
    expect(fixture.phase).toBe('pre');
    expect(fixture.events).toHaveLength(0);

    derivation.handleRunUpdate(
      run('running', [step('running', { dispatchId: 'd-1' }), step('pending')]),
      200,
    );
    fixture = store.getAll()[0];
    expect(fixture.phase).toBe('live');
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].kind).toBe('stepStarted');
    expect(fixture.events[0].sourceRef).toBe('dispatch:d-1');
    expect(fixture.events[0].commentary).toContain('step 1');
  });

  it('announces a clean exit AND a testsGreen event only for a real green summary', () => {
    const store = makeStore();
    const derivation = new MatchDayDerivation(store, noopChains);
    derivation.handleRunUpdate(run('running', [step('running', { dispatchId: 'd-1' })]), 100);
    derivation.handleRunUpdate(
      run('running', [
        step('exited', { dispatchId: 'd-1', exitCode: 0, resultTail: 'Tests: 42 passed' }),
      ]),
      200,
    );
    const kinds = store.getAll()[0].events.map((e) => e.kind);
    expect(kinds).toContain('stepCompleted');
    expect(kinds).toContain('testsGreen');
    const green = store.getAll()[0].events.find((e) => e.kind === 'testsGreen')!;
    expect(green.commentary).toContain('42');
    expect(green.sourceRef).toBe('dispatch:d-1');
  });

  it('HONESTY EDGE: a summary with failures never announces testsGreen', () => {
    const store = makeStore();
    const derivation = new MatchDayDerivation(store, noopChains);
    derivation.handleRunUpdate(run('running', [step('running', { dispatchId: 'd-1' })]), 100);
    derivation.handleRunUpdate(
      run('running', [
        step('exited', { dispatchId: 'd-1', exitCode: 0, resultTail: '9 passed, 1 failed' }),
      ]),
      200,
    );
    expect(store.getAll()[0].events.map((e) => e.kind)).not.toContain('testsGreen');
  });

  it('settles a completed clean run as W with honest axes (burn NO_DATA, never guessed)', () => {
    const store = makeStore();
    const derivation = new MatchDayDerivation(store, noopChains);
    derivation.handleRunUpdate(run('running', [step('running', { dispatchId: 'd-1' })]), 100);
    derivation.handleRunUpdate(
      run('completed', [
        step('exited', { dispatchId: 'd-1', exitCode: 0, resultTail: '12 passed' }),
      ]),
      200,
    );
    const fixture = store.getAll()[0];
    expect(fixture.phase).toBe('result');
    expect(fixture.result!.verdict).toBe('W');
    expect(fixture.result!.tests).toEqual({ status: 'REAL', value: 12, sourceRef: 'dispatch:d-1' });
    expect(fixture.result!.build.status).toBe('REAL');
    expect(fixture.result!.build.value).toBe(100);
    expect(fixture.result!.scope.value).toBe(100);
    expect(fixture.result!.burn).toEqual({ status: 'NO_DATA' });
  });

  it('adopts an in-flight fixture after a restart without re-announcing history', () => {
    const store = makeStore();
    const first = new MatchDayDerivation(store, noopChains);
    first.handleRunUpdate(run('running', [step('running', { dispatchId: 'd-1' })]), 100);
    expect(store.getAll()[0].events).toHaveLength(1);

    // Fresh derivation instance (restart): same run state arrives again.
    const second = new MatchDayDerivation(store, noopChains);
    second.handleRunUpdate(run('running', [step('running', { dispatchId: 'd-1' })]), 200);
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].events).toHaveLength(1); // nothing re-announced

    // But a NEW transition still lands exactly once.
    second.handleRunUpdate(
      run('completed', [step('exited', { dispatchId: 'd-1', exitCode: 0 })]),
      300,
    );
    const fixture = store.getAll()[0];
    expect(fixture.events.map((e) => e.kind)).toEqual(['stepStarted', 'stepCompleted']);
    expect(fixture.phase).toBe('result');
  });

  it('never stages a run first seen already-terminal with no open fixture (history, not a match)', () => {
    const store = makeStore();
    const derivation = new MatchDayDerivation(store, noopChains);
    derivation.handleRunUpdate(
      run('completed', [step('exited', { dispatchId: 'd-1', exitCode: 0 })]),
      100,
    );
    expect(store.getAll()).toHaveLength(0);
  });
});

describe('buildResult — the documented honest W/D/L mapping', () => {
  it('W: completed with every step exited 0', () => {
    const r = buildResult(
      run('completed', [step('exited', { exitCode: 0 }), step('exited', { exitCode: 0 })]),
    );
    expect(r.verdict).toBe('W');
  });

  it('L: the run failed (a real step failure)', () => {
    const r = buildResult(
      run('failed', [step('exited', { exitCode: 0 }), step('exited', { exitCode: 2 })]),
    );
    expect(r.verdict).toBe('L');
    expect(r.build.value).toBe(50); // 1 of 2 exited steps clean — real outcome
    expect(r.scope.value).toBe(50);
  });

  it('D: halted mid-run with no failed step (a kill is NOT a failure)', () => {
    const r = buildResult(run('halted', [step('exited', { exitCode: 0 }), step('killed')]));
    expect(r.verdict).toBe('D');
  });

  it('D: completed carrying a continueOnError-tolerated nonzero exit', () => {
    const r = buildResult(
      run('completed', [step('exited', { exitCode: 1 }), step('exited', { exitCode: 0 })]),
    );
    expect(r.verdict).toBe('D');
  });

  it('NO_DATA honesty: build has no value when no step ever exited; tests when no summary seen', () => {
    const r = buildResult(run('failed', [step('denied'), step('pending')]));
    expect(r.build).toEqual({ status: 'NO_DATA' });
    expect(r.tests).toEqual({ status: 'NO_DATA' });
    expect(r.burn).toEqual({ status: 'NO_DATA' });
    expect(r.scope.status).toBe('REAL'); // 0 of 2 planned — a real observation
    expect(r.scope.value).toBe(0);
  });
});
