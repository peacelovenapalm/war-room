/**
 * Budget guardrail store (v2 mechanic G3 — GAME-DESIGN.md §7.4) — THE
 * REAL, non-fictional resource gate. Wraps the Claude rate-limit snapshot
 * (`~/.pixel-agents/rate-limit-snapshot.json`, written by
 * `bin/rate-limit-snapshot-hook.mjs`, forwarded by
 * `bin/needs-input-poller.mjs`) plus a manual, honestly-labeled Codex
 * weekly-message heuristic.
 *
 * FAIL-SAFE BY DEFAULT: `isAutomationPaused()` returns `paused: true,
 * reason: 'stale-snapshot'` whenever no fresh Claude snapshot exists (no
 * report ever received, OR the last report is older than
 * BUDGET_STALE_MS). Absence of the signal is a PAUSE, never a crash and
 * never an automation green-light — until the hook is wired (a Greg-owned,
 * gated action, see runbook), automation for the `claude` provider stays
 * dark by design. This is cross-cutting rule 7: every automation trigger
 * path from G3 onward (chainOrchestrator step-continuation,
 * standingOrderTick fire) MUST route through this function. Manual
 * CallModal dispatch is NEVER gated here — this store is only ever
 * consulted by the two automation call sites, never by a human-initiated
 * send.
 *
 * Hard ceilings (95/95) are NEVER raised by any perk — only the base pause
 * thresholds move (70/80 -> 80/88 with Night Shift Foreman).
 *
 * Persisted like progressionStore.ts (lazy homedir, 5s throttled persist,
 * tolerant load, VITEST guard) at ~/.pixel-agents/budget.json — NOT
 * ~/.war-room/budget.json (that dir is the hook forwarder's own home, not
 * a store home; don't fork the store convention, per BUILD-PLAN §G3 task 13).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR } from './constants.js';
import type { AutomationPerkFlags } from './standingOrderStore.js';

const BUDGET_FILE_NAME = 'budget.json';
const PERSIST_THROTTLE_MS = 5_000;

/** No fresh Claude report in this long => fail-safe pause. */
export const BUDGET_STALE_MS = 900_000; // 15 min

export const BUDGET_PAUSE_5H_PCT_BASE = 70;
export const BUDGET_PAUSE_7D_PCT_BASE = 80;
/** Night Shift Foreman perk raises the two BASE thresholds only. */
export const BUDGET_PAUSE_5H_PCT_FOREMAN = 80;
export const BUDGET_PAUSE_7D_PCT_FOREMAN = 88;
/** NEVER raised by any perk. */
export const BUDGET_PAUSE_HARD_CEILING_5H = 95;
export const BUDGET_PAUSE_HARD_CEILING_7D = 95;

/** Mirrors ~/.claude/statusline.js's own rate_limits shape (verified
 *  against statusline.js:353/357-366 — data.rate_limits.{five_hour,
 *  seven_day}, each {used_percentage, resets_at} with resets_at in Unix
 *  SECONDS per statusline.js:174's comment). REAL field names — an earlier
 *  draft invented `fiveHourUsedPct`, which does not exist anywhere. */
export interface RateLimitWindow {
  used_percentage: number;
  resets_at?: number;
}
export interface ClaudeRateLimitSnapshot {
  five_hour?: RateLimitWindow;
  seven_day?: RateLimitWindow;
}

interface BudgetData {
  /** Last Claude snapshot forwarded via POST /api/budget/report, plus when
   *  the server received it (staleness is measured from THIS clock, not
   *  any timestamp inside the payload — the payload carries none). */
  lastClaudeSnapshot: ClaudeRateLimitSnapshot | null;
  lastClaudeReceivedAt: number | null;
  /** Codex heuristic (§7.4): Greg enters this once (config, never
   *  auto-changed); codexWeeklyUsed is a COUNTER incremented on every
   *  codex `exited` dispatch, reset Monday 00:00 local. */
  codexWeeklyMessageCap: number | null;
  codexWeeklyUsed: number;
  codexWeekStartDate: string | null;
}

export interface BudgetSnapshot {
  claude: {
    fiveHourUsedPct: number | null;
    sevenDayUsedPct: number | null;
    stale: boolean;
    receivedAt: number | null;
    /** T5 fleet controls (RATE-LIMIT SCHEDULING HINTS, display-only) — Unix
     *  MS, converted from the snapshot's own resets_at (Unix SECONDS per
     *  RateLimitWindow's doc). null/absent means the snapshot itself
     *  carried none — never a computed guess at when a window resets. */
    fiveHourResetsAt: number | null;
    sevenDayResetsAt: number | null;
  };
  codex: {
    weeklyCap: number | null;
    weeklyUsed: number;
    /** Always 'est.' prefixed on the render side — never the bare % the
     *  Claude meter gets (the word IS the honesty signal, GAME-DESIGN §7.4). */
    estimatedPct: number | null;
  };
}

export type AutomationPauseResult =
  | { paused: false }
  | {
      paused: true;
      reason: 'stale-snapshot' | '5h-threshold' | '7d-threshold' | 'codex-cap-reached';
    };

function defaultBudgetFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, BUDGET_FILE_NAME);
}

/** Monday 00:00 local of the week containing `now`. */
function weekStartDate(now: number): string {
  const d = new Date(now);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

function emptyData(): BudgetData {
  return {
    lastClaudeSnapshot: null,
    lastClaudeReceivedAt: null,
    codexWeeklyMessageCap: null,
    codexWeeklyUsed: 0,
    codexWeekStartDate: null,
  };
}

export class BudgetStore {
  private data: BudgetData | null = null;
  private lastPersistAt = 0;
  private explicitPath: string | undefined;
  private resolvedPath: string | undefined;
  private usingDefaultPath = false;
  private listeners: Array<(snapshot: BudgetSnapshot) => void> = [];

  constructor(persistPath?: string) {
    this.explicitPath = persistPath;
  }

  onChange(listener: (snapshot: BudgetSnapshot) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** bin/needs-input-poller.mjs forwards the hook-written snapshot here. */
  reportClaudeSnapshot(snapshot: ClaudeRateLimitSnapshot, now: number = Date.now()): void {
    const data = this.ensureLoaded();
    data.lastClaudeSnapshot = snapshot;
    data.lastClaudeReceivedAt = now;
    this.finish(now);
  }

  setCodexWeeklyCap(cap: number, now: number = Date.now()): void {
    const data = this.ensureLoaded();
    data.codexWeeklyMessageCap = cap;
    this.finish(now);
  }

  /** Every codex `exited` dispatch increments the counter — reset at the
   *  Monday-00:00-local boundary. */
  recordCodexDispatchExit(now: number = Date.now()): void {
    const data = this.ensureLoaded();
    this.rollCodexWeekIfNeeded(data, now);
    data.codexWeeklyUsed += 1;
    this.finish(now);
  }

  private rollCodexWeekIfNeeded(data: BudgetData, now: number): void {
    const currentWeek = weekStartDate(now);
    if (data.codexWeekStartDate !== currentWeek) {
      data.codexWeekStartDate = currentWeek;
      data.codexWeeklyUsed = 0;
    }
  }

  getSnapshot(now: number = Date.now()): BudgetSnapshot {
    const data = this.ensureLoaded();
    const stale =
      data.lastClaudeReceivedAt === null || now - data.lastClaudeReceivedAt >= BUDGET_STALE_MS;
    const estimatedPct =
      data.codexWeeklyMessageCap && data.codexWeeklyMessageCap > 0
        ? Math.round((data.codexWeeklyUsed / data.codexWeeklyMessageCap) * 100)
        : null;
    const fiveHourResetsAtSec = data.lastClaudeSnapshot?.five_hour?.resets_at;
    const sevenDayResetsAtSec = data.lastClaudeSnapshot?.seven_day?.resets_at;
    return {
      claude: {
        fiveHourUsedPct: data.lastClaudeSnapshot?.five_hour?.used_percentage ?? null,
        sevenDayUsedPct: data.lastClaudeSnapshot?.seven_day?.used_percentage ?? null,
        stale,
        receivedAt: data.lastClaudeReceivedAt,
        fiveHourResetsAt:
          typeof fiveHourResetsAtSec === 'number' ? fiveHourResetsAtSec * 1000 : null,
        sevenDayResetsAt:
          typeof sevenDayResetsAtSec === 'number' ? sevenDayResetsAtSec * 1000 : null,
      },
      codex: {
        weeklyCap: data.codexWeeklyMessageCap,
        weeklyUsed: data.codexWeeklyUsed,
        estimatedPct,
      },
    };
  }

  /** THE gate — see file header. `provider` undefined (e.g. a focus-only
   *  action) is treated as claude for staleness purposes (the conservative
   *  default: fail-safe-pause when in doubt). */
  isAutomationPaused(
    provider: string | undefined,
    perkFlags: AutomationPerkFlags,
    now: number = Date.now(),
  ): AutomationPauseResult {
    const data = this.ensureLoaded();

    if (provider === 'codex') {
      this.rollCodexWeekIfNeeded(data, now);
      if (
        data.codexWeeklyMessageCap !== null &&
        data.codexWeeklyUsed >= data.codexWeeklyMessageCap
      ) {
        return { paused: true, reason: 'codex-cap-reached' };
      }
      return { paused: false };
    }

    // claude (default/undefined provider) — the real, live signal.
    const stale =
      data.lastClaudeReceivedAt === null || now - data.lastClaudeReceivedAt >= BUDGET_STALE_MS;
    if (stale) return { paused: true, reason: 'stale-snapshot' };

    const foreman = perkFlags.nightShiftForeman === true;
    // Hard ceilings always win even though no perk can currently push a
    // base threshold past them — clamping here is the literal "never
    // raised by any perk" guarantee, not just a documentation comment.
    const threshold5h = Math.min(
      foreman ? BUDGET_PAUSE_5H_PCT_FOREMAN : BUDGET_PAUSE_5H_PCT_BASE,
      BUDGET_PAUSE_HARD_CEILING_5H,
    );
    const threshold7d = Math.min(
      foreman ? BUDGET_PAUSE_7D_PCT_FOREMAN : BUDGET_PAUSE_7D_PCT_BASE,
      BUDGET_PAUSE_HARD_CEILING_7D,
    );
    const pct5h = data.lastClaudeSnapshot?.five_hour?.used_percentage ?? 0;
    const pct7d = data.lastClaudeSnapshot?.seven_day?.used_percentage ?? 0;
    if (pct5h >= threshold5h) return { paused: true, reason: '5h-threshold' };
    if (pct7d >= threshold7d) return { paused: true, reason: '7d-threshold' };
    return { paused: false };
  }

  private finish(now: number): void {
    this.persist(now);
    const snapshot = this.getSnapshot(now);
    for (const listener of this.listeners) listener(snapshot);
  }

  // ── Persistence (tolerant, throttled — same pattern as progressionStore.ts) ──

  private persistPath(): string {
    if (!this.resolvedPath) {
      this.usingDefaultPath = this.explicitPath === undefined;
      this.resolvedPath = this.explicitPath ?? defaultBudgetFile();
    }
    return this.resolvedPath;
  }

  private ensureLoaded(): BudgetData {
    if (!this.data) this.data = this.load() ?? emptyData();
    return this.data;
  }

  private load(): BudgetData | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath(), 'utf8')) as Partial<BudgetData>;
      if (raw) return { ...emptyData(), ...raw };
    } catch {
      /* missing/corrupt → fresh state (fail-safe: no snapshot => paused) */
    }
    return null;
  }

  private persist(now: number, force = false): void {
    if (process.env.VITEST && this.usingDefaultPath) return;
    if (!force && now - this.lastPersistAt < PERSIST_THROTTLE_MS) return;
    this.lastPersistAt = now;
    const target = this.persistPath();
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(this.ensureLoaded()), 'utf8');
    } catch {
      /* budget-state loss on write failure is acceptable — never crash the server */
    }
  }
}

/** Process-wide instance (the server is single-process). */
export const budgetStore = new BudgetStore();
