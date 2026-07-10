/**
 * Match Day derivation (v3 WS-C STAGE 2 — KICKOFF-v3.1 §1 "Match Day",
 * the tentpole). Chain runs become fixtures: this module subscribes to
 * chainStore's run updates, opens a fixture per real run, synthesizes
 * commentary lines ONLY from real observed step events via a template
 * bank, and settles the result card from real outcomes.
 *
 * HONEST W/D/L MAPPING (documented here, enforced in buildResult — the
 * verdict derives ONLY from the run's real terminal status + the per-step
 * exit codes chainStore recorded, never from output text or vibes):
 *   W — the run COMPLETED and every step exited 0: a clean sweep.
 *   D — the run reached a terminal state without being marked failed, but
 *       it was not a clean sweep: halted (STOP ALL or a killed step — a
 *       kill is NOT a failure, per the established v1.1 item-3 doctrine)
 *       or completed carrying nonzero exits tolerated by continueOnError.
 *   L — the run FAILED (a step exited nonzero without continueOnError,
 *       was denied, or timed out/expired).
 *
 * RESULT CARD AXES (NO_DATA is never guessed — hard rule):
 *   tests — REAL only when a recognizable test-summary line was actually
 *           observed in a step's resultTail (parseTestSummary); value =
 *           the passed count of the LAST summary observed, sourceRef =
 *           that step's dispatch. Otherwise NO_DATA.
 *   build — the per-step exit codes ARE the observed build/run outcome:
 *           value = % of exited steps that exited 0, over steps that
 *           actually ran to a natural exit. NO_DATA when no step ever
 *           exited (e.g. denied at step 1).
 *   scope — value = % of planned steps that exited 0 (plan length is real:
 *           the def the run was created from). Always REAL — 0 is a real
 *           observation, not a gap.
 *   burn  — ALWAYS NO_DATA in this iteration: no per-dispatch token
 *           telemetry exists anywhere in the pipeline yet, and an axis
 *           with no real signal renders NO DATA rather than a guess.
 *
 * Commentary is the COSTUME over the real event, never a replacement:
 * every feed event carries the sourceRef of the real dispatch/run record
 * (one-tap-real), and template picks are deterministic (hashString), not
 * random — the same real history always renders the same match.
 */

import { hashString } from '../../core/src/deterministicRandom.js';
import type { MatchDayAxis, MatchDayResult, MatchVerdictValue } from '../../core/src/messages.js';
import type { ChainRun, ChainStepStatus } from './chainStore.js';
import { ChainStore, chainStore } from './chainStore.js';
import { MatchDayStore, matchDayStore } from './matchDayStore.js';

/** Feed-event kinds (wire `MatchDayFeedEvent.kind` values). */
export type MatchFeedKind =
  | 'stepStarted'
  | 'stepCompleted'
  | 'testsGreen'
  | 'stepFailed'
  | 'stepKilled';

/** The template bank. Colorblind hard rule: every line leads with a SHAPE
 *  glyph + the words carry the meaning — color is never load-bearing. */
const TEMPLATES: Record<MatchFeedKind, string[]> = {
  stepStarted: [
    '▶ {step} takes the field — dispatch away.',
    '▶ {step} kicks off. The room leans in.',
    '▶ Fresh legs: {step} is on.',
  ],
  stepCompleted: [
    '✓ {step} slots it home — exit 0.',
    '✓ Clean finish from {step}. Exit 0.',
    '✓ {step} delivers, not a scratch on it.',
  ],
  testsGreen: [
    '◎ GOAL! {passed} tests green in {step}.',
    '◎ The board flashes: {passed} tests passing in {step}.',
  ],
  stepFailed: [
    '✗ {step} goes down — {detail}.',
    '✗ Trouble on the pitch: {step} fails ({detail}).',
  ],
  stepKilled: [
    '■ {step} pulled off the pitch — killed via the stop channel.',
    '■ The gaffer calls {step} in. Killed, not beaten.',
  ],
};

/** Deterministic template pick — same fixture, same event, same line. */
export function renderCommentary(
  fixtureId: string,
  kind: MatchFeedKind,
  seq: number,
  vars: Record<string, string>,
): string {
  const bank = TEMPLATES[kind];
  const template = bank[hashString(`${fixtureId}:${kind}:${seq}`) % bank.length];
  return template.replace(/\{(\w+)\}/g, (full, key: string) => vars[key] ?? full);
}

/**
 * Parse a test-runner summary out of REAL output text (a step's
 * resultTail). Recognizes the vitest/jest/pytest "N passed" / "N failed"
 * counter vocabulary. Returns null when no summary was observed — callers
 * must map null to NO_DATA, never to 0.
 */
export function parseTestSummary(text: string): { passed: number; failed: number } | null {
  const passedMatches = [...text.matchAll(/(\d+)\s+pass(?:ed|ing)\b/gi)];
  if (passedMatches.length === 0) return null;
  const passed = Number(passedMatches[passedMatches.length - 1][1]);
  const failedMatches = [...text.matchAll(/(\d+)\s+fail(?:ed|ing)\b/gi)];
  const failed = failedMatches.length > 0 ? Number(failedMatches[failedMatches.length - 1][1]) : 0;
  return { passed, failed };
}

interface TrackedRun {
  fixtureId: string;
  stepStatuses: ChainStepStatus[];
  /** Feed sequence counter (drives the deterministic template pick). */
  seq: number;
}

export class MatchDayDerivation {
  private readonly fixtures: MatchDayStore;
  private readonly chains: Pick<ChainStore, 'onRunUpdate'>;
  private readonly tracked = new Map<string, TrackedRun>();
  private subscribed = false;

  constructor(
    fixtures: MatchDayStore = matchDayStore,
    chains: Pick<ChainStore, 'onRunUpdate'> = chainStore,
  ) {
    this.fixtures = fixtures;
    this.chains = chains;
  }

  /** Idempotent — call exactly once at process startup (chainOrchestrator
   *  discipline). */
  start(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.chains.onRunUpdate((run) => this.handleRunUpdate(run));
  }

  /** One run mutation from chainStore. Public for direct unit testing. */
  handleRunUpdate(run: ChainRun, now: number = Date.now()): void {
    let t = this.tracked.get(run.id);
    if (!t) {
      // A run first seen already-terminal with no open fixture is history
      // (e.g. a restart after the match ended) — never re-staged.
      const openFixture = this.fixtures.getActive().find((f) => f.chainRunId === run.id);
      if (!openFixture && run.status !== 'running') return;
      const opened = this.fixtures.openFixture(run.id, now);
      if (!opened.ok) return;
      t = {
        fixtureId: opened.fixture.fixtureId,
        // Adopting a fixture that already has feed events (restart mid-
        // match): seed the snapshot from the run's CURRENT statuses so
        // already-announced transitions are never re-announced.
        stepStatuses:
          opened.fixture.events.length > 0
            ? run.steps.map((s) => s.status)
            : run.steps.map(() => 'pending' as ChainStepStatus),
        seq: opened.fixture.events.length,
      };
      this.tracked.set(run.id, t);
    }

    // Diff step statuses against the last snapshot — each real transition
    // becomes at most one commentary event.
    for (let i = 0; i < run.steps.length; i++) {
      const step = run.steps[i];
      const prev = t.stepStatuses[i] ?? 'pending';
      if (prev === step.status) continue;
      t.stepStatuses[i] = step.status;
      const stepLabel = `step ${i + 1}`;
      const sourceRef = step.dispatchId
        ? `dispatch:${step.dispatchId}`
        : `chainRun:${run.id}#step${i + 1}`;

      if (step.status === 'running') {
        this.emit(t, 'stepStarted', sourceRef, { step: stepLabel }, now);
      } else if (step.status === 'exited') {
        if ((step.exitCode ?? 1) === 0) {
          this.emit(t, 'stepCompleted', sourceRef, { step: stepLabel }, now);
          const summary = step.resultTail ? parseTestSummary(step.resultTail) : null;
          if (summary && summary.passed > 0 && summary.failed === 0) {
            this.emit(
              t,
              'testsGreen',
              sourceRef,
              { step: stepLabel, passed: String(summary.passed) },
              now,
            );
          }
        } else {
          this.emit(
            t,
            'stepFailed',
            sourceRef,
            { step: stepLabel, detail: `exit ${step.exitCode}` },
            now,
          );
        }
      } else if (step.status === 'killed') {
        this.emit(t, 'stepKilled', sourceRef, { step: stepLabel }, now);
      } else if (step.status === 'denied' || step.status === 'expired') {
        this.emit(t, 'stepFailed', sourceRef, { step: stepLabel, detail: step.status }, now);
      }
    }

    if (run.status !== 'running') {
      this.fixtures.settle(t.fixtureId, buildResult(run), now);
      this.tracked.delete(run.id);
    }
  }

  private emit(
    t: TrackedRun,
    kind: MatchFeedKind,
    sourceRef: string,
    vars: Record<string, string>,
    now: number,
  ): void {
    const commentary = renderCommentary(t.fixtureId, kind, t.seq, vars);
    t.seq++;
    this.fixtures.recordEvent(t.fixtureId, { ts: now, kind, sourceRef, commentary });
  }
}

/** Build the result card from the run's REAL outcomes — see the file
 *  header for the documented verdict mapping and axis rules. Exported
 *  pure for direct unit testing. */
export function buildResult(run: ChainRun): MatchDayResult {
  const exited = run.steps.filter((s) => s.status === 'exited');
  const cleanExits = exited.filter((s) => s.exitCode === 0);
  const allClean =
    run.steps.length > 0 && run.steps.every((s) => s.status === 'exited' && s.exitCode === 0);

  let verdict: MatchVerdictValue;
  if (run.status === 'completed' && allClean) verdict = 'W';
  else if (run.status === 'failed') verdict = 'L';
  else verdict = 'D';

  // tests: last observed summary across step outputs, in step order.
  let tests: MatchDayAxis = { status: 'NO_DATA' };
  for (const step of run.steps) {
    if (!step.resultTail) continue;
    const summary = parseTestSummary(step.resultTail);
    if (summary && step.dispatchId) {
      tests = { status: 'REAL', value: summary.passed, sourceRef: `dispatch:${step.dispatchId}` };
    }
  }

  const build: MatchDayAxis =
    exited.length === 0
      ? { status: 'NO_DATA' }
      : {
          status: 'REAL',
          value: Math.round((100 * cleanExits.length) / exited.length),
          sourceRef: `chainRun:${run.id}`,
        };

  const scope: MatchDayAxis = {
    status: 'REAL',
    value: run.steps.length === 0 ? 0 : Math.round((100 * cleanExits.length) / run.steps.length),
    sourceRef: `chainRun:${run.id}`,
  };

  // burn: no per-dispatch token telemetry exists yet — NO_DATA, never a
  // guess (see file header).
  const burn: MatchDayAxis = { status: 'NO_DATA' };

  return { verdict, tests, build, scope, burn };
}

/** Process-wide instance (the server is single-process) — start() is wired
 *  once in httpServer.ts's createHttpServer(). */
export const matchDayDerivation = new MatchDayDerivation();
