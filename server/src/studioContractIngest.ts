/**
 * Studio contract ingest (v3 WS-C STAGE 2 — KICKOFF-v3.1 §1 "Aging
 * contracts"). The derivation loop that feeds studioContractStore.ts from
 * REAL sources only:
 *
 *  - MINT: the latest WAR_ROOM_TODO_DIR daily file (the SAME source the
 *    BRIEFING panel reads — briefingProvider.ts) is parsed for its
 *    "Start now" items; each unseen item becomes an `offered` contract
 *    carrying the VERBATIM item text + file + 1-based line number.
 *  - PROGRESS: only from real observed events — a dispatch run exiting 0
 *    (dispatchStore's terminal broadcast) or an OBSERVED crisis resolution
 *    (pollStateHandler's blocked→unblocked transition, never a stale
 *    sweep). Every progress event carries a sourceRef (one-tap-real).
 *  - DONE: todo disappearance. When the latest todo file no longer carries
 *    a contract's source line, the underlying todo left the compiled list
 *    — the real completion signal. A read failure or missing file NEVER
 *    completes anything (absence of data is not absence of the todo).
 *  - REWARD: bonus-only, paid through the EXISTING economy pipeline
 *    (economyStore.addCash) with a cause ref naming the contract id — the
 *    ledger's anti-dark-pattern grep-test surface, unchanged. Completion
 *    pays whether or not the player ever tapped ACCEPT: the real work was
 *    done either way, and engagement is never farmed.
 *  - EXPIRY: quiet. sweepQuietExpiry() flips the status; no penalty and
 *    no notification hook exists anywhere on this path.
 *
 * NO-DARK-PATTERN TARGET FORMULA (hard rule 3: targets sit BELOW natural
 * pace — the deadline always grants MORE time than the trailing actuals
 * say a todo naturally takes, never less):
 *
 *   naturalDaysPerTodo = TRAILING_WINDOW_DAYS / completionsInTrailingWindow
 *   windowDays = clamp(MIN_WINDOW_DAYS, MAX_WINDOW_DAYS,
 *                      ceil(naturalDaysPerTodo / (1 - TARGET_MARGIN)))
 *   quietExpiryAt = mintedAt + windowDays * DAY_MS
 *
 * With TARGET_MARGIN = 0.5 the granted window is ~2x the observed natural
 * time per todo. Zero history (no completions in the trailing window)
 * resolves to MAX_WINDOW_DAYS — the MOST generous read, never the least.
 * Completions are counted from the store's own completed contracts (real
 * observed events), no separate ledger.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { DispatchBroadcast } from './dispatchStore.js';
import { DispatchStore, dispatchStore } from './dispatchStore.js';
import { STUDIO_CONTRACT_REWARD_CASH } from './economyConstants.js';
import type { EconomyCause } from './economyStore.js';
import { economyStore } from './economyStore.js';
import { StudioContractStore, studioContractStore } from './studioContractStore.js';

export const STUDIO_CONTRACT_SWEEP_INTERVAL_MS = 60_000;

const DAY_MS = 86_400_000;
/** Trailing actuals window the natural pace is measured over. */
export const TRAILING_WINDOW_DAYS = 7;
/** Margin below natural pace (0.5 → the window is ~2x the natural time). */
export const TARGET_MARGIN = 0.5;
export const MIN_WINDOW_DAYS = 7;
export const MAX_WINDOW_DAYS = 30;

/** Bounded dedupe set for processed terminal dispatch ids. */
const PROCESSED_DISPATCH_CAP = 500;

/** One verbatim "Start now" item from the latest daily todo file. */
export interface StartNowTodo {
  file: string;
  /** 1-based line number of the item inside the file. */
  line: number;
  /** Verbatim item text (the content after the "N." list marker — the
   *  ordinal is presentation, not identity; renumbering must not re-mint). */
  text: string;
}

/**
 * Read the latest YYYY-MM-DD.md file in `dir` and return its "Start now"
 * items VERBATIM (no markdown stripping — one-tap-real wants the real
 * line). Returns null on any read failure — callers must treat null as
 * "no data", never as "no todos".
 */
export function readStartNowTodos(dir: string): { file: string; todos: StartNowTodo[] } | null {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort();
    const latest = files[files.length - 1];
    if (!latest) return null;
    const filePath = path.join(dir, latest);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');

    const todos: StartNowTodo[] = [];
    let inStartNow = false;
    for (let i = 0; i < lines.length; i++) {
      const heading = /^#{2,3}\s+(.*)$/.exec(lines[i]);
      if (heading) {
        inStartNow = /^start now\b/i.test(heading[1].trim());
        continue;
      }
      if (!inStartNow) continue;
      const item = /^\s*\d+\.\s+(.*\S)\s*$/.exec(lines[i]);
      if (item) todos.push({ file: filePath, line: i + 1, text: item[1] });
    }
    return { file: filePath, todos };
  } catch {
    return null;
  }
}

/** The store's own normalization, mirrored for presence checks (whitespace
 *  drift between days must not read as a different todo). */
function normalizedKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface SweepResult {
  minted: number;
  completed: number;
  expired: number;
}

export class StudioContractIngest {
  private readonly store: StudioContractStore;
  private readonly awardCash: (amount: number, cause: EconomyCause, now: number) => void;
  private subscribed = false;
  private processedDispatchIds = new Set<string>();

  constructor(
    store: StudioContractStore = studioContractStore,
    awardCash?: (amount: number, cause: EconomyCause, now: number) => void,
  ) {
    this.store = store;
    this.awardCash =
      awardCash ?? ((amount, cause, now) => economyStore.addCash(amount, cause, now));
  }

  /** Subscribe the dispatch-progress feed. Idempotent — call exactly once
   *  at process startup (same call-site discipline as chainOrchestrator). */
  start(dispatch: Pick<DispatchStore, 'onUpdate'> = dispatchStore): void {
    if (this.subscribed) return;
    this.subscribed = true;
    dispatch.onUpdate((broadcast) => this.onDispatchUpdate(broadcast));
  }

  /**
   * One ingest tick: mint new "Start now" contracts, complete contracts
   * whose source todo disappeared from the latest file, then run the quiet
   * expiry sweep. A missing env var / unreadable dir only runs the expiry
   * sweep — it never mints and NEVER completes (no data ≠ done).
   */
  sweep(now: number = Date.now()): SweepResult {
    const result: SweepResult = { minted: 0, completed: 0, expired: 0 };
    const dir = process.env['WAR_ROOM_TODO_DIR'];
    const parsed = dir ? readStartNowTodos(dir) : null;

    if (parsed) {
      const windowMs = this.quietExpiryWindowMs(now);
      for (const todo of parsed.todos) {
        const before = this.openContractForText(todo.text);
        const minted = this.store.mintFromTodo(
          todo,
          STUDIO_CONTRACT_REWARD_CASH,
          now + windowMs,
          now,
        );
        if (minted.ok && !before) result.minted++;
      }

      // Todo disappearance = done. Only decidable when the file was
      // actually readable (parsed !== null) — checked above.
      const present = new Set(parsed.todos.map((t) => normalizedKey(t.text)));
      for (const contract of this.store.getActive()) {
        if (present.has(normalizedKey(contract.sourceTodo.text))) continue;
        const completed = this.store.complete(contract.id, now);
        if (completed.ok) {
          result.completed++;
          // Bonus-only, through the existing pipeline. Receipt refs: the
          // contract id (whose sourceTodo is the verbatim line — one tap)
          // plus the todo file+line the done signal was observed against.
          this.awardCash(
            contract.reward,
            {
              label: `studio-contract-completed:${contract.id}`,
              sourceEventRefs: [
                `studio-contract:${contract.id}`,
                `todo:${contract.sourceTodo.file}#L${contract.sourceTodo.line}`,
              ],
            },
            now,
          );
        }
      }
    }

    // Quiet expiry: status flip + broadcast only. No penalty, no
    // notification — deliberately nothing here to attach one to.
    result.expired = this.store.sweepQuietExpiry(now);
    return result;
  }

  /** A dispatch reached a terminal state. Exit 0 is a REAL observed unit
   *  of studio work — recorded as a progress event (with its dispatch ref)
   *  on every contract the player has actually accepted. Non-zero exits
   *  and focus actions record nothing. */
  onDispatchUpdate(broadcast: DispatchBroadcast, now: number = Date.now()): void {
    if (broadcast.action !== 'dispatch') return;
    if (broadcast.status !== 'exited' || broadcast.exitCode !== 0) return;
    if (this.processedDispatchIds.has(broadcast.id)) return;
    this.rememberProcessed(broadcast.id);
    this.recordProgressOnAccepted(
      `dispatch:${broadcast.id}`,
      `dispatch exited 0 on ${broadcast.machine}`,
      now,
    );
  }

  /** An OBSERVED crisis resolution (pollStateHandler's blocked→unblocked
   *  transition — never the stale sweep, never the vanished clear). */
  recordCrisisResolved(
    machine: string | undefined,
    projectDir: string,
    agentId: number,
    now: number = Date.now(),
  ): void {
    this.recordProgressOnAccepted(
      `crisis:agent:${agentId}@${machine ?? 'LOCAL'}`,
      `crisis resolved in ${projectDir}`,
      now,
    );
  }

  /** See the file-header formula. Exported for direct unit testing. */
  quietExpiryWindowMs(now: number): number {
    const cutoff = now - TRAILING_WINDOW_DAYS * DAY_MS;
    const completions = this.store
      .getAll()
      .filter((c) => c.status === 'completed' && (c.completedAt ?? 0) >= cutoff).length;
    if (completions === 0) return MAX_WINDOW_DAYS * DAY_MS;
    const naturalDaysPerTodo = TRAILING_WINDOW_DAYS / completions;
    const windowDays = Math.min(
      MAX_WINDOW_DAYS,
      Math.max(MIN_WINDOW_DAYS, Math.ceil(naturalDaysPerTodo / (1 - TARGET_MARGIN))),
    );
    return windowDays * DAY_MS;
  }

  // ── Internal ──────────────────────────────────────────────────────

  private openContractForText(text: string): boolean {
    const key = normalizedKey(text);
    return this.store.getActive().some((c) => normalizedKey(c.sourceTodo.text) === key);
  }

  private recordProgressOnAccepted(sourceRef: string, summary: string, now: number): void {
    for (const contract of this.store.getActive()) {
      if (contract.status !== 'accepted' && contract.status !== 'progressing') continue;
      this.store.recordProgress(contract.id, { ts: now, sourceRef, summary });
    }
  }

  private rememberProcessed(id: string): void {
    this.processedDispatchIds.add(id);
    if (this.processedDispatchIds.size > PROCESSED_DISPATCH_CAP) {
      const oldest = this.processedDispatchIds.values().next().value;
      if (oldest !== undefined) this.processedDispatchIds.delete(oldest);
    }
  }
}

/** Process-wide instance (the server is single-process) — start() is wired
 *  once in httpServer.ts's createHttpServer(). */
export const studioContractIngest = new StudioContractIngest();
