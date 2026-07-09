/**
 * Dispatch chains (v2 mechanic G3 — GAME-DESIGN.md §7.1) pure logic, split
 * out of the components so it's unit-testable with no rendering harness
 * (same convention dispatch.ts uses for DispatchTray/CallModal). Mirrors
 * core/src/messages.ts's ChainRun/ChainStepRun/ChainRunStatusValue/
 * ChainStepStatusValue without importing the server-facing generated types
 * into the webview bundle directly (same convention ProgressionSnapshot/
 * EmployeeSnapshotClient use).
 */

export const CHAIN_RUN_STATUSES = ['running', 'completed', 'failed', 'halted'] as const;
export type ChainRunStatusValue = (typeof CHAIN_RUN_STATUSES)[number];

export const CHAIN_STEP_STATUSES = ['pending', 'running', 'exited', 'denied', 'expired'] as const;
export type ChainStepStatusValue = (typeof CHAIN_STEP_STATUSES)[number];

export interface ChainStepRunClient {
  stepId: string;
  dispatchId?: string;
  status: ChainStepStatusValue;
  exitCode?: number;
  resultTail?: string;
  prompt?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface ChainRunClient {
  id: string;
  chainId: string;
  status: ChainRunStatusValue;
  currentStep: number;
  steps: ChainStepRunClient[];
  failReason?: string;
  stoppedByKillSwitch?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChainStepDefInput {
  id: string;
  machine?: string;
  provider?: string;
  cwd?: string;
  prompt: string;
  model?: string;
  effort?: string;
  employeeId?: string;
  continueOnError?: boolean;
}

/** Mirrors server/src/chainStore.ts's CHAIN_MAX_STEPS — a client-side hint
 *  only, the server validates for real. */
export const CHAIN_MAX_STEPS = 8;

interface ChainRunStatusSpec {
  glyph: string;
  word: string;
}

/** Colorblind rule: every chip is GLYPH + WORD, color reinforcement only. */
export const CHAIN_RUN_STATUS_CHIPS: Record<ChainRunStatusValue, ChainRunStatusSpec> = {
  running: { glyph: '◎', word: 'RUNNING' },
  completed: { glyph: '✓', word: 'COMPLETED' },
  failed: { glyph: '⊘', word: 'FAILED' },
  halted: { glyph: '■', word: 'HALTED' },
};

/** One line of tray chip text, e.g. "◎ RUNNING (step 2/3)",
 *  "⊘ FAILED — denied: path-not-allowlisted", "■ HALTED". */
export function chainRunChipLabel(
  run: Pick<ChainRunClient, 'status' | 'currentStep' | 'steps' | 'failReason'>,
): string {
  const { glyph, word } = CHAIN_RUN_STATUS_CHIPS[run.status];
  if (run.status === 'failed' && run.failReason) {
    return `${glyph} ${word} — ${run.failReason}`;
  }
  if (run.status === 'running') {
    return `${glyph} ${word} (step ${run.currentStep + 1}/${run.steps.length})`;
  }
  return `${glyph} ${word}`;
}

/** A run auto-clears from the tray once terminal and older than this —
 *  same cadence as DISPATCH_AUTOCLEAR_MS (dispatch.ts), except FAILED,
 *  which is sticky (dismiss only) so a denied/expired chain isn't missed. */
export const CHAIN_RUN_AUTOCLEAR_MS = 60_000;

export function shouldAutoClearChainRun(status: ChainRunStatusValue, ageMs: number): boolean {
  if (status === 'running' || status === 'failed') return false;
  return ageMs >= CHAIN_RUN_AUTOCLEAR_MS;
}

/** Validate that every step's prompt only references an EARLIER step
 *  (1-based {{stepK...}}, K < this step's own 1-based position) — client-
 *  side early-honest-no before the round trip; the server re-validates for
 *  real (chainStore.ts's validateStepTemplates). */
const TEMPLATE_PATTERN = /\{\{step(\d+)\.(result|exitCode)\}\}/g;

export function validateStepTemplatesClient(
  steps: readonly ChainStepDefInput[],
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

/** Insert-or-update by id (a chainRunUpdate is a lifecycle transition of an
 *  existing run, or the first sighting of a new one) — mirrors
 *  upsertDispatchEntry's shape. */
export function upsertChainRun(runs: ChainRunClient[], update: ChainRunClient): ChainRunClient[] {
  const idx = runs.findIndex((r) => r.id === update.id);
  if (idx === -1) return [...runs, update];
  const copy = [...runs];
  copy[idx] = update;
  return copy;
}

/** Drop terminal runs past their auto-clear age (FAILED never included —
 *  sticky, dismiss only). */
export function pruneChainRuns(
  runs: ChainRunClient[],
  now: number,
  receivedAtById: Record<string, number>,
): ChainRunClient[] {
  return runs.filter((r) => {
    const receivedAt = receivedAtById[r.id] ?? now;
    return !shouldAutoClearChainRun(r.status, now - receivedAt);
  });
}
