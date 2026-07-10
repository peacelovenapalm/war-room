/**
 * Contract store (v2 mechanic G4 — GAME-DESIGN.md §6.2) — real vault todos
 * and tracker gates become Contracts with Cash/Rep rewards; game-generated
 * dailies/weeklies keep the loop warm between real events.
 *
 * Derives from briefingProvider.ts's existing 60s-cached todo/tracker read
 * (`reconcile()` is called from the existing /api/briefing and /api/contracts
 * routes — no new poll loop). Dailies/weeklies are minted (and immediately
 * self-completed, `daily-auto`) from shiftStats.ts's existing day-close path.
 *
 * Completion priority order (GAME-DESIGN §6.2):
 *   1. dispatch-result — an explicit `contractId` set by the webview's
 *      BRIEFING→DISPATCH prefill, never string-matched (completeByDispatch()).
 *   2. todo-disappeared / gate-flipped — ground truth, checked every
 *      reconcile() call.
 *   3. manual-claim — escape hatch, rate-limited to
 *      MAX_MANUAL_CLAIMS_PER_DAY, rejects (never silently no-ops) the 4th.
 *   4. daily-auto — self-certifying (mintDaily/mintWeekly).
 *
 * Re-minting dedupe (closes a double-pay risk): before minting a backlog
 * contract, checks both currently-OPEN and completed-in-the-last-7-days
 * contracts for the same normalized sourceKey — not just currently-open.
 * Gate contracts use the same rule with an unbounded lookback (gates never
 * expire, so "ever completed" is the bar).
 *
 * Persisted like economyStore.ts (lazy homedir, 5s throttled persist,
 * tolerant load, onChange listener list, VITEST guard) at
 * ~/.pixel-agents/contracts.json.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Briefing } from './briefingProvider.js';
import { LAYOUT_FILE_DIR } from './constants.js';
import type { EconomyCause } from './economyStore.js';
import { economyStore } from './economyStore.js';

const PERSIST_THROTTLE_MS = 5_000;
const CONTRACTS_FILE_NAME = 'contracts.json';

function defaultContractsFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CONTRACTS_FILE_NAME);
}

function localDate(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight (ms epoch) of a YYYY-MM-DD date string. */
function localDateToMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

function normalizeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Payout table (GAME-DESIGN §6.2, single numeric authority) ────────────
export const CONTRACT_PRIORITY_CASH = 40;
export const CONTRACT_PRIORITY_REP = 2;
export const CONTRACT_PRIORITY_DEADLINE_DAYS = 2;
export const CONTRACT_BACKLOG_CASH_PER_ITEM = 15;
export const CONTRACT_BACKLOG_CASH_CAP = 150;
export const CONTRACT_BACKLOG_REP_DIVISOR = 5;
export const CONTRACT_BACKLOG_REP_CAP = 5;
export const CONTRACT_BACKLOG_DEADLINE_DAYS = 7;
export const CONTRACT_BACKLOG_DEDUPE_LOOKBACK_DAYS = 7;
export const CONTRACT_GATE_CASH = 200;
export const CONTRACT_GATE_REP = 10;
export const CONTRACT_DAILY_CASH = 20;
export const CONTRACT_WEEKLY_CASH = 100;
export const CONTRACT_WEEKLY_REP = 5;
export const CONTRACT_PRIORITY_EXPIRY_REP_PENALTY = 1;
export const MAX_MANUAL_CLAIMS_PER_DAY = 3;

/** Purely flavor — payout is flat regardless of title (self-certifying).
 *  12/4 entries per GAME-DESIGN §6.2's template-table counts. */
export const DAILY_CONTRACT_TITLES = [
  'Keep the streak alive',
  'Clear the inbox',
  'Ship something small',
  'Answer the fires',
  'Close a loop',
  'Touch every project',
  'Leave the desk tidier',
  'One clean turn',
  'Beat yesterday',
  'Quiet the queue',
  'Push past the block',
  'Daily grind',
] as const;
export const WEEKLY_CONTRACT_TITLES = [
  'Weekly wrap-up',
  'Clear the backlog',
  'Full week, full effort',
  'Momentum check',
] as const;

export const CONTRACT_SOURCES = ['priority', 'backlog', 'gate', 'daily', 'weekly'] as const;
export type ContractSource = (typeof CONTRACT_SOURCES)[number];

export const COMPLETION_METHODS = [
  'todo-disappeared',
  'gate-flipped',
  'dispatch-result',
  'manual-claim',
  'daily-auto',
] as const;
export type CompletionMethod = (typeof COMPLETION_METHODS)[number];

export type ContractStatus = 'open' | 'completed' | 'expired';

export interface Contract {
  id: string;
  source: ContractSource;
  title: string;
  /** Normalized identity for dedupe/disappearance matching — never shown raw. */
  sourceKey: string;
  payoutCash: number;
  payoutRep: number;
  status: ContractStatus;
  completionMethod?: CompletionMethod;
  createdAt: number;
  /** undefined = no deadline (gate, and self-completing daily/weekly). */
  deadlineAt?: number;
  completedAt?: number;
  expiredAt?: number;
}

export type ContractResult = { ok: true; contract: Contract } | { ok: false; reason: string };

interface ContractData {
  contracts: Record<string, Contract>;
  manualClaimDate: string | null;
  manualClaimsToday: number;
  dailyMintDate: string | null;
  weeklyMintDate: string | null;
}

function emptyData(): ContractData {
  return {
    contracts: {},
    manualClaimDate: null,
    manualClaimsToday: 0,
    dailyMintDate: null,
    weeklyMintDate: null,
  };
}

export interface ContractStoreDeps {
  /** Injected — never imports economyStore.ts directly (one-way layering,
   *  same convention as standingOrderStore/chainOrchestrator). Awards carry
   *  a full EconomyCause receipt (v3 REP receipts): label + refs to the
   *  contract whose completion/expiry the movement derives from. */
  awardCash?: (amount: number, cause: EconomyCause) => void;
  awardReputation?: (amount: number, cause: EconomyCause) => void;
}

export class ContractStore {
  private data: ContractData | null = null;
  private lastPersistAt = 0;
  private explicitPath: string | undefined;
  private resolvedPath: string | undefined;
  private usingDefaultPath = false;
  private readonly awardCash: (amount: number, cause: EconomyCause) => void;
  private readonly awardReputation: (amount: number, cause: EconomyCause) => void;
  private completionListeners: Array<(contract: Contract) => void> = [];

  constructor(persistPath?: string, deps: ContractStoreDeps = {}) {
    this.explicitPath = persistPath;
    this.awardCash = deps.awardCash ?? (() => {});
    this.awardReputation = deps.awardReputation ?? (() => {});
  }

  /** Fired once per completion — the Bark "contract completed" big-moment
   *  hook (wired in notifyBark.ts, avoiding a circular import here). */
  onCompleted(listener: (contract: Contract) => void): () => void {
    this.completionListeners.push(listener);
    return () => {
      this.completionListeners = this.completionListeners.filter((l) => l !== listener);
    };
  }

  // ── Reads ──────────────────────────────────────────────────────────

  getAll(): Contract[] {
    return Object.values(this.ensureLoaded().contracts);
  }

  getById(id: string): Contract | undefined {
    return this.ensureLoaded().contracts[id];
  }

  // ── Reconcile against the briefing (priority + backlog + gate) ──────

  /** Piggybacks briefingProvider's own 60s cache — called from the
   *  /api/briefing and /api/contracts routes, never a new poll loop. */
  reconcile(briefing: Briefing, now: number = Date.now()): void {
    let mutated = false;
    if (briefing.todo) {
      mutated = this.reconcilePriority(briefing.todo.date, briefing.todo.startNow, now) || mutated;
      mutated = this.reconcileBacklog(briefing.todo.sections, now) || mutated;
    }
    if (briefing.tracker) {
      mutated = this.reconcileGates(briefing.tracker.gates, now) || mutated;
    }
    mutated = this.sweepExpired(now) > 0 || mutated;
    if (mutated) this.persist(now, true);
  }

  private reconcilePriority(sourceDate: string, startNow: string[], now: number): boolean {
    const data = this.ensureLoaded();
    let mutated = false;
    const currentKeys = new Set(startNow.map(normalizeKey));

    // Ground truth: an open priority contract whose line vanished is DONE.
    for (const contract of Object.values(data.contracts)) {
      if (contract.source !== 'priority' || contract.status !== 'open') continue;
      if (!currentKeys.has(contract.sourceKey)) {
        this.completeContract(contract, 'todo-disappeared', now);
        mutated = true;
      }
    }

    // Mint new ones — only if nothing open already covers this line.
    for (const line of startNow) {
      const sourceKey = normalizeKey(line);
      const alreadyOpen = Object.values(data.contracts).some(
        (c) => c.source === 'priority' && c.sourceKey === sourceKey && c.status === 'open',
      );
      if (alreadyOpen) continue;
      const contract: Contract = {
        id: randomUUID(),
        source: 'priority',
        title: line,
        sourceKey,
        payoutCash: CONTRACT_PRIORITY_CASH,
        payoutRep: CONTRACT_PRIORITY_REP,
        status: 'open',
        createdAt: now,
        deadlineAt: localDateToMs(sourceDate) + CONTRACT_PRIORITY_DEADLINE_DAYS * 86_400_000,
      };
      data.contracts[contract.id] = contract;
      mutated = true;
    }
    return mutated;
  }

  private reconcileBacklog(
    sections: Array<{ title: string; count: number }>,
    now: number,
  ): boolean {
    const data = this.ensureLoaded();
    let mutated = false;
    const currentBySourceKey = new Map(sections.map((s) => [normalizeKey(s.title), s.count]));

    // Ground truth: an open backlog contract whose section cleared (count=0
    // or the section vanished entirely) is DONE.
    for (const contract of Object.values(data.contracts)) {
      if (contract.source !== 'backlog' || contract.status !== 'open') continue;
      const count = currentBySourceKey.get(contract.sourceKey);
      if (count === undefined || count === 0) {
        this.completeContract(contract, 'todo-disappeared', now);
        mutated = true;
      }
    }

    for (const section of sections) {
      if (section.count <= 0) continue;
      const sourceKey = normalizeKey(section.title);
      if (
        this.hasRecentOrOpenContract(
          'backlog',
          sourceKey,
          now,
          CONTRACT_BACKLOG_DEDUPE_LOOKBACK_DAYS,
        )
      ) {
        continue;
      }
      const contract: Contract = {
        id: randomUUID(),
        source: 'backlog',
        title: section.title,
        sourceKey,
        payoutCash: Math.min(
          CONTRACT_BACKLOG_CASH_CAP,
          CONTRACT_BACKLOG_CASH_PER_ITEM * section.count,
        ),
        payoutRep: Math.min(
          CONTRACT_BACKLOG_REP_CAP,
          Math.floor(section.count / CONTRACT_BACKLOG_REP_DIVISOR),
        ),
        status: 'open',
        createdAt: now,
        deadlineAt: now + CONTRACT_BACKLOG_DEADLINE_DAYS * 86_400_000,
      };
      data.contracts[contract.id] = contract;
      mutated = true;
    }
    return mutated;
  }

  private reconcileGates(
    gates: Array<{ id: string; label: string; status: string }>,
    now: number,
  ): boolean {
    const data = this.ensureLoaded();
    let mutated = false;

    for (const gate of gates) {
      const sourceKey = `gate:${gate.id}`;
      const existing = Object.values(data.contracts).find(
        (c) => c.source === 'gate' && c.sourceKey === sourceKey,
      );
      if (!existing) {
        const contract: Contract = {
          id: randomUUID(),
          source: 'gate',
          title: gate.label,
          sourceKey,
          payoutCash: CONTRACT_GATE_CASH,
          payoutRep: CONTRACT_GATE_REP,
          status: 'open',
          createdAt: now,
        };
        data.contracts[contract.id] = contract;
        mutated = true;
        if (gate.status === 'DONE') {
          this.completeContract(contract, 'gate-flipped', now);
        }
        continue;
      }
      if (existing.status === 'open' && gate.status === 'DONE') {
        this.completeContract(existing, 'gate-flipped', now);
        mutated = true;
      }
    }
    return mutated;
  }

  /** Backlog/gate re-minting dedupe: currently-open OR completed within
   *  `lookbackDays` (Infinity = "ever completed", used by gates). */
  private hasRecentOrOpenContract(
    source: ContractSource,
    sourceKey: string,
    now: number,
    lookbackDays: number,
  ): boolean {
    const lookbackMs = lookbackDays * 86_400_000;
    return Object.values(this.ensureLoaded().contracts).some((c) => {
      if (c.source !== source || c.sourceKey !== sourceKey) return false;
      if (c.status === 'open') return true;
      if (c.status === 'completed' && c.completedAt !== undefined) {
        return now - c.completedAt < lookbackMs;
      }
      return false;
    });
  }

  // ── Dailies / weeklies (self-certifying, shiftStats day-close) ──────

  /** Called from shiftStats' onDayClose ONLY when the closed day had real
   *  activity (turnsCompleted > 0) — the anti-dark-pattern trace point.
   *  Self-certifying: mints and completes in the same call, once per local
   *  date (idempotent under duplicate calls). */
  mintDaily(now: number = Date.now()): Contract | undefined {
    const data = this.ensureLoaded();
    const today = localDate(now);
    if (data.dailyMintDate === today) return undefined;
    data.dailyMintDate = today;
    const title = DAILY_CONTRACT_TITLES[hashDate(today) % DAILY_CONTRACT_TITLES.length];
    const contract: Contract = {
      id: randomUUID(),
      source: 'daily',
      title,
      sourceKey: `daily:${today}`,
      payoutCash: CONTRACT_DAILY_CASH,
      payoutRep: 0,
      status: 'open',
      createdAt: now,
    };
    data.contracts[contract.id] = contract;
    this.completeContract(contract, 'daily-auto', now);
    return contract;
  }

  /** Same self-certifying shape as mintDaily — callers gate this to Mondays
   *  (BUILD-PLAN §G4 task 5), once per local date. */
  mintWeekly(now: number = Date.now()): Contract | undefined {
    const data = this.ensureLoaded();
    const today = localDate(now);
    if (data.weeklyMintDate === today) return undefined;
    data.weeklyMintDate = today;
    const title = WEEKLY_CONTRACT_TITLES[hashDate(today) % WEEKLY_CONTRACT_TITLES.length];
    const contract: Contract = {
      id: randomUUID(),
      source: 'weekly',
      title,
      sourceKey: `weekly:${today}`,
      payoutCash: CONTRACT_WEEKLY_CASH,
      payoutRep: CONTRACT_WEEKLY_REP,
      status: 'open',
      createdAt: now,
    };
    data.contracts[contract.id] = contract;
    this.completeContract(contract, 'daily-auto', now);
    return contract;
  }

  // ── Manual claim (escape hatch, rate-limited) ────────────────────────

  /** Rejects (never silently no-ops) the 4th claim of a local day. */
  claim(id: string, now: number = Date.now()): ContractResult {
    const data = this.ensureLoaded();
    const contract = data.contracts[id];
    if (!contract) return { ok: false, reason: 'not-found' };
    if (contract.status !== 'open') return { ok: false, reason: 'not-open' };

    const today = localDate(now);
    if (data.manualClaimDate !== today) {
      data.manualClaimDate = today;
      data.manualClaimsToday = 0;
    }
    if (data.manualClaimsToday >= MAX_MANUAL_CLAIMS_PER_DAY) {
      return { ok: false, reason: 'manual-claim-daily-cap' };
    }
    data.manualClaimsToday += 1;
    this.completeContract(contract, 'manual-claim', now);
    return { ok: true, contract };
  }

  // ── Dispatch-result completion (explicit contractId, never string-matched) ──

  /** No-op on an unknown/non-open id — the linked contract may have expired
   *  or been claimed manually before the dispatch finished (honest no-op,
   *  same posture as employeeStore.recordDispatchExit). */
  completeByDispatch(contractId: string, now: number = Date.now()): void {
    const contract = this.ensureLoaded().contracts[contractId];
    if (!contract || contract.status !== 'open') return;
    this.completeContract(contract, 'dispatch-result', now);
  }

  // ── Expiration ────────────────────────────────────────────────────

  /** Priority expiry costs -1 Rep (Cash never touched); backlog expiry is
   *  silent (re-mints next reconcile since dedupe only checks open +
   *  completed-in-lookback, never expired). Gate contracts have no deadline
   *  and never expire. Returns the count swept. */
  sweepExpired(now: number = Date.now()): number {
    const data = this.ensureLoaded();
    let count = 0;
    for (const contract of Object.values(data.contracts)) {
      if (contract.status !== 'open' || contract.deadlineAt === undefined) continue;
      if (now < contract.deadlineAt) continue;
      contract.status = 'expired';
      contract.expiredAt = now;
      if (contract.source === 'priority') {
        this.awardReputation(-CONTRACT_PRIORITY_EXPIRY_REP_PENALTY, {
          label: 'contract-priority-expired',
          sourceEventRefs: [`contract:${contract.id}`],
        });
      }
      count++;
    }
    return count;
  }

  // ── Internal ──────────────────────────────────────────────────────

  private completeContract(contract: Contract, method: CompletionMethod, now: number): void {
    contract.status = 'completed';
    contract.completionMethod = method;
    contract.completedAt = now;
    const cause: EconomyCause = {
      label: `contract-${contract.source}-${method}`,
      sourceEventRefs: [`contract:${contract.id}`],
    };
    if (contract.payoutCash > 0) {
      this.awardCash(contract.payoutCash, cause);
    }
    if (contract.payoutRep > 0) {
      this.awardReputation(contract.payoutRep, cause);
    }
    for (const listener of this.completionListeners) listener(contract);
  }

  // ── Persistence (tolerant, throttled — same pattern as economyStore.ts) ──

  private persistPath(): string {
    if (!this.resolvedPath) {
      this.usingDefaultPath = this.explicitPath === undefined;
      this.resolvedPath = this.explicitPath ?? defaultContractsFile();
    }
    return this.resolvedPath;
  }

  private ensureLoaded(): ContractData {
    if (!this.data) this.data = this.load() ?? emptyData();
    return this.data;
  }

  private load(): ContractData | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath(), 'utf8')) as Partial<ContractData>;
      if (raw && typeof raw.contracts === 'object') {
        return { ...emptyData(), ...raw };
      }
    } catch {
      /* missing/corrupt → fresh state */
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
      /* contract loss on write failure is acceptable — never crash the server */
    }
  }
}

/** Simple deterministic day→index hash (titles are flavor-only, so this
 *  doesn't need core/src/deterministicRandom.ts's mulberry32 — a stable
 *  same-day pick is all that's needed). */
function hashDate(date: string): number {
  let h = 0;
  for (let i = 0; i < date.length; i++) h = (h * 31 + date.charCodeAt(i)) >>> 0;
  return h;
}

/** Process-wide instance (the server is single-process), wired to the real
 *  economyStore singleton (same pattern as employeeStore.ts's export).
 *  `onCompleted` (the Bark "contract completed" big-moment hook) is wired
 *  below, after notifyBark.ts's declaration, to avoid a circular import. */
export const contractStore = new ContractStore(undefined, {
  awardCash: (amount, cause) => economyStore.addCash(amount, cause),
  awardReputation: (amount, cause) => economyStore.addReputation(amount, cause),
});
