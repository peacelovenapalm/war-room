/**
 * Dispatch chains pure logic — port of webview-ui/src/chain.ts (frozen
 * fallback, read-only for WS-A). Mirrors core/src/messages.ts's
 * ChainRun/ChainStepRun/ChainRunStatusValue/ChainStepStatusValue.
 */

import { budgetPauseReasonWord } from './budget';

export const CHAIN_RUN_STATUSES = ['running', 'completed', 'failed', 'halted'] as const;
export type ChainRunStatusValue = (typeof CHAIN_RUN_STATUSES)[number];

export const CHAIN_STEP_STATUSES = [
  'pending',
  'running',
  'exited',
  'denied',
  'expired',
  'killed',
] as const;
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
  haltReason?: string;
  pausedReason?: string;
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

/** Mirrors server/src/chainStore.ts's CHAIN_MAX_STEPS. */
export const CHAIN_MAX_STEPS = 8;
/** Chain Gang perk (800 Cash) cap — mirrors server/src/chainStore.ts's
 *  CHAIN_MAX_STEPS_CHAIN_GANG. */
export const CHAIN_MAX_STEPS_CHAIN_GANG = 12;

/** Effective client-side step cap for the given perk ownership — 8 base, 12
 *  with Chain Gang. `hasChainGang` must default to false when perk state is
 *  unknown; never fail-open to the perked cap.
 *
 *  NOTE (v3 scope): core/src/messages.ts's generated EconomyUpdate does not
 *  currently carry `purchasedPerks` (webview-ui reads it off a looser,
 *  hand-cast message shape) — v3 always passes `hasChainGang=false` until
 *  that field lands in the generated core types, so this always renders the
 *  honest base cap rather than guessing. */
export function chainMaxSteps(hasChainGang: boolean): number {
  return hasChainGang ? CHAIN_MAX_STEPS_CHAIN_GANG : CHAIN_MAX_STEPS;
}

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

/** One line of tray chip text, e.g. "◎ RUNNING (step 2/3)", "⏸ PAUSED — 5h
 *  budget (step 2/3)", "⊘ FAILED — denied: ...", "■ HALTED". */
export function chainRunChipLabel(
  run: Pick<
    ChainRunClient,
    'status' | 'currentStep' | 'steps' | 'failReason' | 'haltReason' | 'pausedReason'
  >,
): string {
  const { glyph, word } = CHAIN_RUN_STATUS_CHIPS[run.status];
  if (run.status === 'failed' && run.failReason) return `${glyph} ${word} — ${run.failReason}`;
  if (run.status === 'halted' && run.haltReason) return `${glyph} ${word} — ${run.haltReason}`;
  if (run.status === 'running' && run.pausedReason) {
    return `⏸ PAUSED — ${budgetPauseReasonWord(run.pausedReason)} (step ${String(run.currentStep + 1)}/${String(run.steps.length)})`;
  }
  if (run.status === 'running') {
    return `${glyph} ${word} (step ${String(run.currentStep + 1)}/${String(run.steps.length)})`;
  }
  return `${glyph} ${word}`;
}

/** A run auto-clears from the tray once terminal and older than this —
 *  except FAILED, which is sticky (dismiss only). */
export const CHAIN_RUN_AUTOCLEAR_MS = 60_000;

export function shouldAutoClearChainRun(status: ChainRunStatusValue, ageMs: number): boolean {
  if (status === 'running' || status === 'failed') return false;
  return ageMs >= CHAIN_RUN_AUTOCLEAR_MS;
}

/** Validate that every step's prompt only references an EARLIER step
 *  (1-based {{stepK...}}, K < this step's own 1-based position) — the
 *  server re-validates for real (chainStore.ts's validateStepTemplates). */
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
          reason: `step ${String(i + 1)} references {{step${String(k)}...}}, which is not an earlier step`,
        };
      }
    }
  }
  return { ok: true };
}

/** Insert-or-update by id (a chainRunUpdate is a lifecycle transition of an
 *  existing run, or the first sighting of a new one). */
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

/** Explicit dismiss (the only way a sticky FAILED run's chip clears from the
 *  client-side tray view — the run record itself stays server-side). */
export function dismissChainRun(runs: ChainRunClient[], id: string): ChainRunClient[] {
  return runs.filter((r) => r.id !== id);
}
