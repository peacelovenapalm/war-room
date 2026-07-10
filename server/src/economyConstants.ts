/**
 * Economy constants (v2 mechanic G2 — GAME-DESIGN.md §3) — the single
 * numeric authority for Cash/Reputation. Every other file imports from
 * here; nothing retypes a number.
 *
 * HARD GUARDRAIL (no dark patterns on real money): every award below is
 * cited against an OBSERVED real event (turn completed, crisis resolved,
 * shift grade at real day-close, dispatch exited 0) — never token volume,
 * never a bare timer. The one documented exception is the world-event
 * `flavor_bonus` (G4, capped +5/day) — not defined here since worldEventStore
 * doesn't exist yet.
 */

import type { ShiftReport } from './shiftStats.js';

// ── Cash sources ────────────────────────────────────────────────────────
export const CASH_PER_TURN = 2;
export const CASH_PER_CRISIS_RESOLVED = 10;
export const CASH_SHIFT_GRADE: Record<NonNullable<ShiftReport['efficiency']>, number> = {
  LEAN: 100,
  STEADY: 40,
  HEAVY: 0,
};
/** Same real-activity definition as progressionStore's streak, but tracked
 *  independently — touchStreak is private there (economyStore keeps its own
 *  last-active-date at the same recordTurnEnd call sites). */
export const CASH_STREAK_DAY_TOUCH = 10;
/** Dispatch Cash can't be farmed by burning real tokens — a one-click farm
 *  hole the anti-dark-pattern table itself missed (Fable review delta #5).
 *  Nonzero exits pay 0, never negative. */
export const CASH_PER_DISPATCH_EXIT_0 = 5;
export const DISPATCH_CASH_DAILY_CAP = 50;
/** v3 Living Studio wall contract (KICKOFF-v3.1 §1 "Aging contracts"):
 *  paid ONLY when the contract's real vault todo disappears from the
 *  compiled daily list (the observed done signal — studioContractIngest.ts).
 *  Bonus-only: no penalty exists anywhere on the contract path (quiet
 *  expiry pays and costs nothing). Sized between a crisis resolution (10)
 *  and a LEAN shift grade (100) — a closed real todo outranks a single
 *  unblock but never dwarfs a graded day. */
export const STUDIO_CONTRACT_REWARD_CASH = 25;

// ── Reputation sources ────────────────────────────────────────────────
export const REP_SHIFT_GRADE: Record<NonNullable<ShiftReport['efficiency']>, number> = {
  LEAN: 3,
  STEADY: 1,
  HEAVY: 0,
};
export const REP_STREAK_MILESTONE = { d3: 10, d7: 30, d30: 120 };
export const REP_FIRED_PENALTY = -10;
export const REP_RETIRED_BONUS = 10;

// ── Perfect-ops day (v3 stage 3 — KICKOFF-v3.1 WS-C item 2) ───────────
/** One-time Reputation bonus for a perfect-ops local day: real work
 *  happened (turnsCompleted > 0 — absence of work never mints, same
 *  doctrine as the Steady Hands trait) AND zero crises went unanswered
 *  past the N-minute window AND zero dispatches exited nonzero. Sized
 *  between a STEADY (1) and LEAN (3) shift grade: flawless ops
 *  complements the efficiency grade, never dwarfs it. Bonus-only — a
 *  non-perfect day pays 0 and costs nothing (no penalty path exists). */
export const PERFECT_OPS_REP_BONUS = 2;
/** Default N (minutes a crisis may sit unanswered before the day stops
 *  being perfect). 30 minutes ≈ the fire→alarm crisis-aging horizon —
 *  generous against Greg's observed response pattern (a target above
 *  natural pace would be a dark pattern). Ops override:
 *  WAR_ROOM_PERFECT_OPS_MAX_MINUTES=<minutes> (read per evaluation). */
export const PERFECT_OPS_DEFAULT_MAX_UNANSWERED_MINUTES = 30;

// ── Reputation decay (soft-fail, §3.2) ────────────────────────────────
export const REP_DECAY_DARK_DAY = 1;
/** First consecutive zero-activity day is always free; decay starts on the
 *  second (interrogation delta — rest days are designed-for). */
export const REP_DECAY_GRACE_DAYS = 1;
/** Offline-progress catch-up cap (GAME-DESIGN §2): a long gap since the last
 *  WS connect still only ever processes up to 72h/3 days of decay bookkeeping
 *  per catch-up call — never a back-charge dump after a long vacation. */
export const OFFLINE_CATCHUP_CAP_DAYS = 3;

// ── Building sinks (§3.1/§5) ───────────────────────────────────────────
export const BAY_BASE_COST = 500;
export const BAY_COST_GROWTH = 1.55;
/** (MAX_COLS(64) - DEFAULT_COLS(20)) / BAY_COLS(4) */
export const BAY_MAX_COUNT = 11;
export const BAY_COLS = 4;

export const ROOM_COST: Record<string, number> = {
  dev_pit: 300,
  server_room: 800,
  break_room: 400,
  war_room: 1200,
  kitchen: 250,
};

/** Cash cost of buffed furniture pieces (§3.1 "Furniture piece 20-200").
 *  Server-authoritative — /api/building/furniture looks up cost here,
 *  never trusts a client-supplied price. Mirrors the buff-carrying subset
 *  of webview-ui's furnitureBuffs.ts / this file's buildingBuffs.ts
 *  FURNITURE_BUFFS table; plain decor furniture (everything else) stays
 *  free, unchanged v1 behavior. */
export const FURNITURE_COST: Record<string, number> = {
  PC_FRONT_ON_1: 150,
  PC_FRONT_ON_2: 150,
  PC_FRONT_ON_3: 150,
  WHITEBOARD: 60,
  COFFEE_TABLE: 30,
  COFFEE: 20,
};

/** Furniture-adjacency + room-membership buff pool per desk — ONE shared
 *  cap, not two independent 40% caps (§9.19). */
export const ADJACENCY_AND_ROOM_BONUS_CAP_PCT = 40;

/** Room buffs (§5.3). */
export const DEV_PIT_XP_BONUS_PCT = 15;
export const SERVER_ROOM_CASH_BONUS_PCT = 10;
export const BREAK_ROOM_MOOD_REGEN_MULT = 1.5;
export const WAR_ROOM_CRISIS_XP_BONUS_PCT = 25;
export const KITCHEN_MOOD_DECAY_MULT = 0.85;

/** Sell refund (§5.7). */
export const SELL_REFUND_PCT = 50;

/** Automation perks (v2 mechanic G3, §7.4) — Cash-purchased, read-only
 *  `perkFlags` consumed by standingOrderStore/budgetStore/chainOrchestrator.
 *  The Autopilot perk is CUT (interrogation delta #6): first-fire confirm
 *  is unconditional forever regardless of any perk owned here. Total 2800
 *  across the 3-perk ladder. */
export const PERK_IDS = ['secondShift', 'chainGang', 'nightShiftForeman'] as const;
export type PerkId = (typeof PERK_IDS)[number];

export const PERK_COST: Record<PerkId, number> = {
  secondShift: 500,
  chainGang: 800,
  nightShiftForeman: 1500,
};

export const PERK_DESCRIPTION: Record<PerkId, string> = {
  secondShift: 'Standing-order cap 1 → 2.',
  chainGang: 'Chain max steps 8 → 12, concurrent runs 3 → 5.',
  nightShiftForeman:
    'Standing-order cap 2 → 4; budget pause thresholds 70/80% → 80/88% (hard ceilings 95/95 never move).',
};

export function bayCost(n: number): number {
  return Math.round(BAY_BASE_COST * Math.pow(BAY_COST_GROWTH, n));
}
