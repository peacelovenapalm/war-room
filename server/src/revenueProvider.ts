/**
 * Revenue-ready CASH seam (v3 stage 3 — KICKOFF-v3.1 §3 WS-C item 3).
 *
 * Greg's decision (KICKOFF §1, CASH row): "lightweight/cosmetic now,
 * REVENUE-READY by design — eventually pull real numbers from how much we
 * are actually making." This module defines the single ingest point that
 * real-money sources (Stripe etc.) will plug into LATER — see REVENUE.md
 * — and relocates the CURRENT synthetic CASH earning rules behind it,
 * byte-identically (the existing economyStore test suite passes unchanged
 * — that is the relocation's acceptance gate).
 *
 * Flow: real observed events → a RevenueProvider turns them into
 * RevenueEvent[] (amount + full EconomyCause receipt) → EconomyStore.
 * ingestRevenue() drains getRevenueEvents() and credits CASH with the
 * receipt attached. SyntheticRevenueProvider is the ONLY implementation
 * today; nothing else is built now (Greg's explicit boundary).
 *
 * HARD GUARDRAILS carried over verbatim:
 *  - every synthetic amount cites an OBSERVED real event (turn Stop,
 *    observed crisis resolution, real day-close grade, dispatch exit 0)
 *    — never token volume, never a bare timer;
 *  - the dispatch daily cap (anti-farming, Fable review delta #5) and the
 *    once/day streak touch keep their dedup state INSIDE economyStore's
 *    persisted sidecar (injected via SyntheticRevenueState) so restart
 *    behavior is unchanged;
 *  - revenue only CREDITS: EconomyStore.ingestRevenue refuses negative
 *    amounts (debits never masquerade as revenue). A zero amount is legal
 *    — the HEAVY shift grade has always written a "graded, paid 0" line.
 */

import type { EconomyCause } from '../../core/src/messages.js';
import {
  CASH_PER_CRISIS_RESOLVED,
  CASH_PER_DISPATCH_EXIT_0,
  CASH_PER_TURN,
  CASH_SHIFT_GRADE,
  CASH_STREAK_DAY_TOUCH,
  DISPATCH_CASH_DAILY_CAP,
} from './economyConstants.js';
import type { DayCloseSummary } from './progressionStore.js';

/** One real-money(-shaped) event: an amount of CASH plus the mandatory
 *  receipt naming the observed source events it derives from. A future
 *  real provider emits these with refs like `stripe:payment_intent:<id>`. */
export interface RevenueEvent {
  ts: number;
  /** Whole CASH units. Never negative (ingestRevenue refuses debits). */
  amount: number;
  cause: EconomyCause;
}

/** THE seam (REVENUE.md): a source of real money events with source refs.
 *  `getRevenueEvents()` has drain semantics — it returns the events
 *  accrued since the previous call and forgets them (the provider owns
 *  its own dedup; the consumer applies each event exactly once). */
export interface RevenueProvider {
  getRevenueEvents(): RevenueEvent[];
}

/** The dedup/cap state the synthetic rules need, injected by economyStore
 *  so it keeps living in the SAME persisted sidecar fields it always has
 *  (economy.json: streakDayTouchedDate / dispatchCashDate /
 *  dispatchCashToday) — relocation changes no persistence shape. */
export interface SyntheticRevenueState {
  getStreakDayTouchedDate(): string | null;
  setStreakDayTouchedDate(date: string): void;
  getDispatchCashWindow(): { date: string | null; paidToday: number };
  setDispatchCashWindow(date: string, paidToday: number): void;
}

function localDate(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Rounds the same way hookEventHandler.ts's xpOverride does — kept as a
 *  single helper so all Cash-award rules round identically (moved here
 *  verbatim from economyStore.ts with the rules it serves). */
function withCashBonus(amount: number, cashBonusPct: number): number {
  return Math.round(amount * (1 + cashBonusPct / 100));
}

/**
 * The current synthetic earning rules, relocated from economyStore's
 * record* methods — amounts, caps, dedup and event ordering are
 * byte-identical to the pre-seam behavior.
 */
export class SyntheticRevenueProvider implements RevenueProvider {
  private pending: RevenueEvent[] = [];

  constructor(private readonly state: SyntheticRevenueState) {}

  /** CASH_PER_TURN (Server Room bonus applies to the base award only)
   *  plus the once-per-local-day CASH_STREAK_DAY_TOUCH. */
  noteTurnCompleted(sourceRef: string, now: number, cashBonusPct = 0): void {
    this.pending.push({
      ts: now,
      amount: withCashBonus(CASH_PER_TURN, cashBonusPct),
      cause: { label: 'turn-completed', sourceEventRefs: [sourceRef] },
    });
    const today = localDate(now);
    if (this.state.getStreakDayTouchedDate() !== today) {
      this.state.setStreakDayTouchedDate(today);
      this.pending.push({
        ts: now,
        amount: CASH_STREAK_DAY_TOUCH,
        cause: { label: 'streak-day-touch', sourceEventRefs: [sourceRef] },
      });
    }
  }

  /** CASH_PER_CRISIS_RESOLVED (observed transitions only — the caller
   *  holds that contract, same as before the relocation). */
  noteCrisisResolved(sourceRef: string, now: number, cashBonusPct = 0): void {
    this.pending.push({
      ts: now,
      amount: withCashBonus(CASH_PER_CRISIS_RESOLVED, cashBonusPct),
      cause: { label: 'crisis-resolved', sourceEventRefs: [sourceRef] },
    });
  }

  /** CASH_SHIFT_GRADE — HEAVY legitimately queues a 0-amount event (the
   *  ledger has always carried the "graded, paid 0" line; never negative).
   *  Zero-turn / ungraded days queue nothing (same guard as before). */
  noteShiftDayClosed(closed: DayCloseSummary, now: number): void {
    if (closed.turnsCompleted <= 0 || closed.efficiency === null) return;
    this.pending.push({
      ts: now,
      amount: CASH_SHIFT_GRADE[closed.efficiency],
      cause: {
        label: `shift-grade-${closed.efficiency}`,
        sourceEventRefs: [`shift-day:${closed.date}`],
      },
    });
  }

  /** CASH_PER_DISPATCH_EXIT_0, hard-capped DISPATCH_CASH_DAILY_CAP per
   *  local day (anti-farming: dispatching burns real tokens — uncapped it
   *  would pay for volume). The bonus applies BEFORE the cap; nonzero
   *  exits queue nothing (never negative). */
  noteDispatchExit(exitCode: number, sourceRef: string, now: number, cashBonusPct = 0): void {
    if (exitCode !== 0) return;
    const today = localDate(now);
    const window = this.state.getDispatchCashWindow();
    const paidToday = window.date === today ? window.paidToday : 0;
    const remaining = Math.max(0, DISPATCH_CASH_DAILY_CAP - paidToday);
    const award = Math.min(withCashBonus(CASH_PER_DISPATCH_EXIT_0, cashBonusPct), remaining);
    if (award <= 0) {
      // Cap reached: still roll the window date so the sidecar matches the
      // pre-seam bookkeeping exactly.
      this.state.setDispatchCashWindow(today, paidToday);
      return;
    }
    this.state.setDispatchCashWindow(today, paidToday + award);
    this.pending.push({
      ts: now,
      amount: award,
      cause: { label: 'dispatch-exit-0', sourceEventRefs: [sourceRef] },
    });
  }

  /** Drain: everything accrued since the last call, exactly once. */
  getRevenueEvents(): RevenueEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }
}
