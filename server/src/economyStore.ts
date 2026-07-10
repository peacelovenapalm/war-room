/**
 * Economy store (v2 mechanic G2 — GAME-DESIGN.md §3) — dual currency
 * (Cash liquid/spendable, Reputation permanent/slow) plus office-wide
 * grime and the studio vacation-mode flag.
 *
 * Persisted like progressionStore.ts (lazy homedir, 5s throttled persist,
 * tolerant load, onChange listener list, VITEST guard) at
 * ~/.pixel-agents/economy.json.
 *
 * HARD GUARDRAIL (no dark patterns on real money): Cash/Reputation come
 * ONLY from real, observed events — a completed turn (hook Stop), an
 * OBSERVED crisis resolution, a shift-report day closing with a grade, or
 * a dispatch exit — wired into the EXACT same call sites
 * progression.recordTurnEnd/recordCrisisResolved/recordShiftDayClosed
 * already use. Nothing here ever reads token volume as a reward signal.
 * `addCash`/`addReputation` both require a full `EconomyCause` receipt
 * ({label, sourceEventRefs} — v3 REP receipts, KICKOFF-v3.1 §3 WS-C item
 * 2): the label IS the anti-dark-pattern grep-test surface, and the refs
 * are the one-tap-real decomposition — every movement names the observed
 * events it derives from. The type system enforces it: there is NO
 * mutation overload that accepts a bare string or omits the cause.
 * Pre-receipt ledger entries are migrated on load with the sentinel
 * UNKNOWN_LEGACY_LABEL and empty refs (honestly unknown, never guessed).
 *
 * Player-initiated debits/credits (bay/perk/room purchases, sells) carry
 * `player-action:*` refs — the observed source event for a purchase is the
 * player's own explicit API action; there is no deeper telemetry to cite.
 *
 * No `setInterval` tick loop — state is computed on-demand (real-event
 * award here; the WS-connect catch-up below covers Reputation decay over
 * elapsed offline time, capped at OFFLINE_CATCHUP_CAP_DAYS per call).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { EconomyCause, EconomyLedgerEntry } from '../../core/src/messages.js';
import { LAYOUT_FILE_DIR } from './constants.js';
import {
  CASH_PER_CRISIS_RESOLVED,
  CASH_PER_DISPATCH_EXIT_0,
  CASH_PER_TURN,
  CASH_SHIFT_GRADE,
  CASH_STREAK_DAY_TOUCH,
  DISPATCH_CASH_DAILY_CAP,
  OFFLINE_CATCHUP_CAP_DAYS,
  PERK_COST,
  type PerkId,
  REP_DECAY_DARK_DAY,
  REP_DECAY_GRACE_DAYS,
  REP_SHIFT_GRADE,
} from './economyConstants.js';
import type { DayCloseSummary } from './progressionStore.js';

const PERSIST_THROTTLE_MS = 5_000;
const ECONOMY_FILE_NAME = 'economy.json';
const LEDGER_CAP = 200;

function defaultEconomyFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, ECONOMY_FILE_NAME);
}

function localDate(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole-day gap between two YYYY-MM-DD local-calendar dates. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const msPerDay = 86_400_000;
  const da = new Date(ay, am - 1, ad).getTime();
  const db = new Date(by, bm - 1, bd).getTime();
  return Math.round((db - da) / msPerDay);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** Ledger entries are the generated wire shape (core/asyncapi.yaml) —
 *  re-exported so existing importers keep their path. `reason` always
 *  equals `cause.label` (kept as its own field for v2 clients). */
export type { EconomyCause, EconomyLedgerEntry } from '../../core/src/messages.js';

/** Sentinel cause label stamped onto ledger entries persisted before
 *  receipts existed (migration is honest: unknown stays unknown). */
export const UNKNOWN_LEGACY_LABEL = 'UNKNOWN-LEGACY';

export interface EconomySnapshot {
  cash: number;
  reputation: number;
  grime: number;
  vacationMode: boolean;
  bayCount: number;
  ledger: EconomyLedgerEntry[];
  purchasedPerks: PerkId[];
}

/** Read-only automation-perk flags (v2 mechanic G3, §7.4) — consumed by
 *  standingOrderStore/budgetStore/chainOrchestrator, all of which receive
 *  this as a plain value per-call rather than importing economyStore
 *  directly (one-way layering). */
export interface PerkFlags {
  secondShift: boolean;
  chainGang: boolean;
  nightShiftForeman: boolean;
}

interface EconomyData {
  cash: number;
  reputation: number;
  grime: number;
  vacationMode: boolean;
  /** Office-expansion bays purchased so far (GAME-DESIGN §5.2) — tracked
   *  here since bay cost is Cash-store bookkeeping, not layout bookkeeping. */
  bayCount: number;
  ledger: EconomyLedgerEntry[];
  /** Last local date any real activity (turn/dispatch run) was observed. */
  lastActiveDate: string | null;
  /** Last local date the +10 streak-touch Cash was paid (dedup). */
  streakDayTouchedDate: string | null;
  /** Local date the dispatch-cash daily cap window is tracking. */
  dispatchCashDate: string | null;
  dispatchCashToday: number;
  /** Consecutive zero-activity days as of lastDecayCheckDate. */
  zeroActivityStreakDays: number;
  /** Last calendar date decay bookkeeping has been walked through (inclusive). */
  lastDecayCheckDate: string | null;
  /** Automation perks purchased (v2 mechanic G3, §7.4) — the Autopilot
   *  perk is CUT; these 3 never remove the standing-order first-fire
   *  confirm gate. */
  purchasedPerks: PerkId[];
}

function emptyData(): EconomyData {
  return {
    cash: 0,
    reputation: 0,
    grime: 0,
    vacationMode: false,
    bayCount: 0,
    ledger: [],
    lastActiveDate: null,
    streakDayTouchedDate: null,
    dispatchCashDate: null,
    dispatchCashToday: 0,
    zeroActivityStreakDays: 0,
    lastDecayCheckDate: null,
    purchasedPerks: [],
  };
}

export class EconomyStore {
  private data: EconomyData | null = null;
  private lastPersistAt = 0;
  private explicitPath: string | undefined;
  private resolvedPath: string | undefined;
  private usingDefaultPath = false;
  private listeners: Array<(snapshot: EconomySnapshot) => void> = [];

  constructor(persistPath?: string) {
    this.explicitPath = persistPath;
  }

  /** Subscribe to economy changes (fired after every Cash/Reputation/grime/
   *  vacation mutation). Returns an unsubscribe function. */
  onChange(listener: (snapshot: EconomySnapshot) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ── Injected-dependency surface (consumed by employeeStore.ts) ────────

  isVacationActive(): boolean {
    return this.ensureLoaded().vacationMode;
  }

  // ── Real-event entry points ─────────────────────────────────────────

  /** A completed real turn (hook Stop, Claude sessions only — same
   *  exclusion shiftStats/progression apply). Awards CASH_PER_TURN, plus a
   *  once-per-local-day CASH_STREAK_DAY_TOUCH (own last-active-date
   *  tracking — touchStreak is private on progressionStore).
   *  `sourceRef` names the observed Stop event (receipt ref, e.g.
   *  `hook-stop:<employeeId>`). `cashBonusPct` is the Server Room global
   *  Cash buff (G2, GAME-DESIGN §5.4) — computed by the caller
   *  (economyStore.ts cannot read the office layout itself:
   *  officeLayoutStore.ts already imports this module, so a reverse import
   *  would cycle) and applied only to the base turn award, never the
   *  once/day streak touch. */
  recordTurnCompleted(sourceRef: string, now: number = Date.now(), cashBonusPct = 0): void {
    const data = this.ensureLoaded();
    this.touchActivity(data, now);
    this.addCash(
      this.withCashBonus(CASH_PER_TURN, cashBonusPct),
      { label: 'turn-completed', sourceEventRefs: [sourceRef] },
      now,
    );
    const today = localDate(now);
    if (data.streakDayTouchedDate !== today) {
      data.streakDayTouchedDate = today;
      this.addCash(
        CASH_STREAK_DAY_TOUCH,
        { label: 'streak-day-touch', sourceEventRefs: [sourceRef] },
        now,
      );
    }
  }

  /** An OBSERVED crisis resolution (real state transition, never a stale
   *  sweep clear — mirrors progressionStore's CrisisXpSink contract).
   *  `sourceRef` names the resolved crisis episode (receipt ref, e.g.
   *  `crisis:agent:<id>@<since>`). `cashBonusPct` — see
   *  recordTurnCompleted's doc above. */
  recordCrisisResolved(sourceRef: string, now: number = Date.now(), cashBonusPct = 0): void {
    const data = this.ensureLoaded();
    this.touchActivity(data, now);
    this.addCash(
      this.withCashBonus(CASH_PER_CRISIS_RESOLVED, cashBonusPct),
      { label: 'crisis-resolved', sourceEventRefs: [sourceRef] },
      now,
    );
  }

  /** A shift-report day closed with a grade (wired via ShiftStats'
   *  onDayClose callback, alongside progression.recordShiftDayClosed).
   *  Skips days with zero completed turns (nothing to grade) — HEAVY
   *  always pays 0 Cash, never negative. Receipt ref: the closed real
   *  day itself (`shift-day:<date>`). */
  recordShiftDayClosed(closed: DayCloseSummary, now: number = Date.now()): void {
    if (closed.turnsCompleted <= 0 || closed.efficiency === null) return;
    const cause: EconomyCause = {
      label: `shift-grade-${closed.efficiency}`,
      sourceEventRefs: [`shift-day:${closed.date}`],
    };
    this.addCash(CASH_SHIFT_GRADE[closed.efficiency], cause, now);
    this.addReputation(REP_SHIFT_GRADE[closed.efficiency], cause, now);
  }

  /** A dispatch run exited (v1 mechanic #6b). Any exit counts as activity
   *  for decay purposes; only exit 0 pays Cash, hard-capped
   *  DISPATCH_CASH_DAILY_CAP/local day — the anti-farming fix (Fable
   *  review delta #5): dispatching burns real tokens, so uncapped it would
   *  pay for volume. `cashBonusPct` (Server Room, see recordTurnCompleted's
   *  doc) is applied BEFORE the daily cap — the cap stays the hard
   *  anti-farming ceiling regardless of the buff. Not yet wired to a live
   *  route (dispatch chains land in G3) — implemented and unit-tested now
   *  per BUILD-PLAN §G2 task 4. */
  recordDispatchExit(
    exitCode: number,
    sourceRef: string,
    now: number = Date.now(),
    cashBonusPct = 0,
  ): void {
    const data = this.ensureLoaded();
    this.touchActivity(data, now);
    if (exitCode !== 0) {
      this.persist(now);
      return;
    }
    const today = localDate(now);
    if (data.dispatchCashDate !== today) {
      data.dispatchCashDate = today;
      data.dispatchCashToday = 0;
    }
    const remaining = Math.max(0, DISPATCH_CASH_DAILY_CAP - data.dispatchCashToday);
    const award = Math.min(this.withCashBonus(CASH_PER_DISPATCH_EXIT_0, cashBonusPct), remaining);
    if (award > 0) {
      data.dispatchCashToday += award;
      this.addCash(award, { label: 'dispatch-exit-0', sourceEventRefs: [sourceRef] }, now);
    } else {
      this.persist(now);
    }
  }

  /** Rounds the same way hookEventHandler.ts's xpOverride does
   *  (Math.round(base * (1 + pct/100))) — kept as a single helper so all
   *  three Cash-award call sites round identically. */
  private withCashBonus(amount: number, cashBonusPct: number): number {
    return Math.round(amount * (1 + cashBonusPct / 100));
  }

  private touchActivity(data: EconomyData, now: number): void {
    const today = localDate(now);
    if (data.lastActiveDate !== today) {
      data.zeroActivityStreakDays = 0;
    }
    data.lastActiveDate = today;
  }

  // ── Offline-progress catch-up (§2 "Connect catch-up") ─────────────────

  /** Runs once per WS connect. Walks Reputation decay day-by-day from the
   *  last processed date through today, capped at OFFLINE_CATCHUP_CAP_DAYS
   *  day-boundaries per call (min(elapsed,72h) — never a back-charge dump
   *  after a long gap). No-op (but still marks today processed, so it
   *  never back-charges once turned off) while vacation mode is on. */
  catchUpOffline(now: number = Date.now()): void {
    const data = this.ensureLoaded();
    const today = localDate(now);
    if (data.lastDecayCheckDate === null) {
      if (data.lastActiveDate === null) {
        // Never any real activity yet — nothing to walk decay from.
        data.lastDecayCheckDate = today;
        this.persist(now);
        return;
      }
      // First-ever catch-up: baseline at the last real-activity date so
      // the gap since then is actually walked below, not skipped.
      data.lastDecayCheckDate = data.lastActiveDate;
    }
    if (data.lastDecayCheckDate === today) return;
    if (data.vacationMode) {
      data.lastDecayCheckDate = today;
      this.persist(now);
      return;
    }

    let cursor = addDays(data.lastDecayCheckDate, 1);
    let processed = 0;
    while (daysBetween(cursor, today) >= 0 && processed < OFFLINE_CATCHUP_CAP_DAYS) {
      if (cursor === data.lastActiveDate) {
        data.zeroActivityStreakDays = 0;
      } else {
        data.zeroActivityStreakDays += 1;
        if (data.zeroActivityStreakDays > REP_DECAY_GRACE_DAYS) {
          const before = data.reputation;
          data.reputation = Math.max(0, data.reputation - REP_DECAY_DARK_DAY);
          if (data.reputation !== before) {
            this.appendLedger(now, data.reputation - before, 'reputation', {
              label: 'zero-activity-decay',
              // The observed source event is the zero-activity calendar day
              // itself — the specific dark day this decay line walked.
              sourceEventRefs: [`dark-day:${cursor}`],
            });
          }
        }
      }
      cursor = addDays(cursor, 1);
      processed++;
    }
    // Jump straight to today even if the loop capped out early — never
    // back-charge beyond the 72h/3-day window on a longer gap.
    data.lastDecayCheckDate = today;
    this.persist(now, true);
  }

  // ── Building sinks (§5, wired by buildingBuffs.ts / httpServer.ts routes) ──

  getBayCount(): number {
    return this.ensureLoaded().bayCount;
  }

  /** Debit Cash and record a bay purchase iff sufficient funds. Returns the
   *  new bay count on success. Callers (the /api/building/expand route)
   *  still own the actual layout tile mutation. */
  spendOnBay(
    cost: number,
    now: number = Date.now(),
  ): { ok: true; bayCount: number } | { ok: false } {
    const data = this.ensureLoaded();
    if (data.cash < cost) return { ok: false };
    this.addCash(
      -cost,
      {
        label: 'bay-expansion',
        sourceEventRefs: [`player-action:expand-bay:${data.bayCount + 1}`],
      },
      now,
    );
    data.bayCount += 1;
    this.persist(now, true);
    return { ok: true, bayCount: data.bayCount };
  }

  /** Debit Cash for any other build spend (room shell, furniture, sell is
   *  a positive refund through the same method). Returns false without
   *  mutating state if funds are insufficient (0 or positive amounts never
   *  fail). */
  spend(amount: number, cause: EconomyCause, now: number = Date.now()): boolean {
    const data = this.ensureLoaded();
    if (amount > 0 && data.cash < amount) return false;
    this.addCash(-amount, cause, now);
    return true;
  }

  // ── Automation perks (v2 mechanic G3, §7.4) ─────────────────────────

  /** Debit Cash and mark a perk purchased iff sufficient funds and not
   *  already owned (idempotent — buying twice is a no-op refusal, never a
   *  double-charge). The Autopilot perk was CUT; nothing purchasable here
   *  ever weakens the standing-order first-fire confirm gate. */
  buyPerk(id: PerkId, now: number = Date.now()): { ok: true } | { ok: false; reason: string } {
    const data = this.ensureLoaded();
    if (data.purchasedPerks.includes(id)) return { ok: false, reason: 'already-owned' };
    const cost = PERK_COST[id];
    if (data.cash < cost) return { ok: false, reason: 'insufficient-cash' };
    this.addCash(
      -cost,
      { label: `perk-${id}`, sourceEventRefs: [`player-action:buy-perk:${id}`] },
      now,
    );
    data.purchasedPerks.push(id);
    this.persist(now, true);
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
    return { ok: true };
  }

  getPerkFlags(): PerkFlags {
    const owned = new Set(this.ensureLoaded().purchasedPerks);
    return {
      secondShift: owned.has('secondShift'),
      chainGang: owned.has('chainGang'),
      nightShiftForeman: owned.has('nightShiftForeman'),
    };
  }

  // ── Vacation toggle (§4.5) ─────────────────────────────────────────

  setVacationMode(active: boolean, now: number = Date.now()): EconomySnapshot {
    const data = this.ensureLoaded();
    data.vacationMode = active;
    this.persist(now, true);
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  // ── Reads ────────────────────────────────────────────────────────────

  getSnapshot(): EconomySnapshot {
    const data = this.ensureLoaded();
    return {
      cash: data.cash,
      reputation: data.reputation,
      grime: data.grime,
      vacationMode: data.vacationMode,
      bayCount: data.bayCount,
      ledger: [...data.ledger],
      purchasedPerks: [...data.purchasedPerks],
    };
  }

  // ── Ledger mutations (the anti-dark-pattern grep-test surface) ────────
  // MANDATORY receipts: `cause` is a required positional parameter with no
  // string overload and no default — the type system refuses any mutation
  // that can't name its observed source events (v3 REP receipts).

  addCash(amount: number, cause: EconomyCause, now: number = Date.now()): void {
    const data = this.ensureLoaded();
    data.cash = Math.max(0, data.cash + amount);
    this.appendLedger(now, amount, 'cash', cause);
    this.finish(now);
  }

  addReputation(amount: number, cause: EconomyCause, now: number = Date.now()): void {
    const data = this.ensureLoaded();
    data.reputation = Math.max(0, data.reputation + amount);
    this.appendLedger(now, amount, 'reputation', cause);
    this.finish(now);
  }

  private appendLedger(
    ts: number,
    delta: number,
    currency: 'cash' | 'reputation',
    cause: EconomyCause,
  ): void {
    const data = this.ensureLoaded();
    // `reason` always mirrors cause.label — kept as its own wire field so
    // v2 clients (webview-ui reads `reason`) stay working unchanged.
    data.ledger.push({ ts, delta, currency, reason: cause.label, cause });
    if (data.ledger.length > LEDGER_CAP) {
      data.ledger.splice(0, data.ledger.length - LEDGER_CAP);
    }
  }

  private finish(now: number): void {
    this.persist(now);
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  // ── Persistence (tolerant, throttled — same pattern as progressionStore.ts) ──

  private persistPath(): string {
    if (!this.resolvedPath) {
      this.usingDefaultPath = this.explicitPath === undefined;
      this.resolvedPath = this.explicitPath ?? defaultEconomyFile();
    }
    return this.resolvedPath;
  }

  private ensureLoaded(): EconomyData {
    if (!this.data) {
      this.data = this.load() ?? emptyData();
    }
    return this.data;
  }

  private load(): EconomyData | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath(), 'utf8')) as Partial<EconomyData>;
      if (raw && typeof raw.cash === 'number') {
        const base = emptyData();
        // Receipt migration (v3 REP receipts): entries persisted before the
        // mandatory cause existed get the honest sentinel — the label says
        // UNKNOWN-LEGACY rather than a guessed backfill, refs stay empty.
        const ledger = (raw.ledger ?? []).map((entry) =>
          entry.cause
            ? entry
            : { ...entry, cause: { label: UNKNOWN_LEGACY_LABEL, sourceEventRefs: [] } },
        );
        return { ...base, ...raw, ledger };
      }
    } catch {
      /* missing/corrupt → fresh state */
    }
    return null;
  }

  private persist(now: number, force = false): void {
    // Never let unit tests (which exercise the process-wide singleton
    // indirectly via handleStop / poll-state / day-rollover wiring) write
    // the REAL sidecar. Persistence tests construct their own instance with
    // an explicit temp path, which still writes (same rule as progressionStore.ts).
    if (process.env.VITEST && this.usingDefaultPath) return;
    if (!force && now - this.lastPersistAt < PERSIST_THROTTLE_MS) return;
    this.lastPersistAt = now;
    const target = this.persistPath();
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(this.ensureLoaded()), 'utf8');
    } catch {
      /* economy loss on write failure is acceptable — never crash the server */
    }
  }
}

/** Process-wide instance (the server is single-process). */
export const economyStore = new EconomyStore();
