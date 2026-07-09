/**
 * Standing order store (v2 mechanic G3 — GAME-DESIGN.md §7.2) — a saved
 * dispatch that fires unattended on a schedule. Two schedule kinds only
 * (`daily`, `interval`) — no cron-expression parser.
 *
 * UNCONDITIONAL SAFETY GATE: a brand-new order's first-ever execution
 * requires one explicit human confirm click (`needsFirstFireConfirm`).
 * This gate is permanent — no perk, purchase, or setting removes it (the
 * Autopilot perk was CUT specifically over this: "no amount of fictional
 * currency buys away a real-money safety check", GAME-DESIGN §7.2/§7.4).
 * `confirmFirstFire()` is the ONLY code path that ever clears the flag, and
 * it is reachable only via an explicit human UI action
 * (StandingOrdersPanel's confirm button → a dedicated HTTP route) — never
 * from `tick()`, never from a perk purchase, never from STOP ALL/resume.
 *
 * Base cap 1 enabled order, raised by perks (Second Shift +1, Night Shift
 * Foreman +2 — GAME-DESIGN §7.4's perk table). Callers pass `perkFlags` in
 * per-call; this store never imports economyStore directly (one-way
 * layering, cross-cutting note in BUILD-PLAN §G3 task 14).
 *
 * Persisted like progressionStore.ts (lazy homedir, 5s throttled persist,
 * tolerant load, onChange listener list, VITEST guard) at
 * ~/.pixel-agents/standing-orders.json.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR } from './constants.js';

const ORDERS_FILE_NAME = 'standing-orders.json';
const PERSIST_THROTTLE_MS = 5_000;

export const STANDING_ORDER_BASE_CAP = 1;

/** Perk-derived enabled-order cap — additive per GAME-DESIGN §7.4's table
 *  (Second Shift +1, Night Shift Foreman +2). Standing orders never read
 *  economyStore directly; callers resolve perkFlags and pass the cap in. */
export interface AutomationPerkFlags {
  secondShift?: boolean;
  chainGang?: boolean;
  nightShiftForeman?: boolean;
}

export function standingOrderCap(perkFlags: AutomationPerkFlags): number {
  let cap = STANDING_ORDER_BASE_CAP;
  if (perkFlags.secondShift) cap += 1;
  if (perkFlags.nightShiftForeman) cap += 2;
  return cap;
}

export type StandingOrderSchedule =
  | { kind: 'daily'; atLocalHour: number }
  | { kind: 'interval'; everyMs: number };

export interface StandingOrder {
  id: string;
  name: string;
  schedule: StandingOrderSchedule;
  machine?: string;
  provider?: string;
  cwd?: string;
  prompt: string;
  model?: string;
  effort?: string;
  employeeId?: string;
  enabled: boolean;
  /** Unconditional safety gate — see file header. */
  needsFirstFireConfirm: boolean;
  lastFiredAt?: number;
  /** Local-calendar date (YYYY-MM-DD) of the last fire — daily dedupe. */
  lastFiredDate?: string;
  lastSkipReason?: string;
  /** Set by STOP ALL; re-enable (RESUME) restores exactly this prior set. */
  stoppedByKillSwitch?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StandingOrderInput {
  name: string;
  schedule: StandingOrderSchedule;
  machine?: string;
  provider?: string;
  cwd?: string;
  prompt: string;
  model?: string;
  effort?: string;
  employeeId?: string;
}

export type StandingOrderResult =
  | { ok: true; order: StandingOrder }
  | { ok: false; reason: string };

function defaultOrdersFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, ORDERS_FILE_NAME);
}

function localDate(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Resolve machine/provider/cwd/model against optional employee defaults —
 *  explicit order fields always win (GAME-DESIGN §7.3). */
export interface ResolvedDispatchTarget {
  machine: string;
  provider: string;
  cwd: string;
  model?: string;
}

export type ResolveEmployeeDefaults = (
  employeeId: string,
) =>
  | { machine?: string; projectDir?: string; defaultProvider?: string; defaultModel?: string }
  | undefined;

function resolveTarget(
  order: Pick<StandingOrder, 'machine' | 'provider' | 'cwd' | 'model' | 'employeeId'>,
  resolveEmployeeDefaults: ResolveEmployeeDefaults,
): ResolvedDispatchTarget | undefined {
  const defaults = order.employeeId ? resolveEmployeeDefaults(order.employeeId) : undefined;
  const machine = order.machine ?? defaults?.machine;
  const provider = order.provider ?? defaults?.defaultProvider;
  const cwd = order.cwd ?? defaults?.projectDir;
  if (!machine || !provider || !cwd) return undefined;
  return { machine, provider, cwd, model: order.model ?? defaults?.defaultModel };
}

/** Enqueue callback signature — matches dispatchStore.enqueue()'s relevant
 *  slice. Injected so this store never imports dispatchStore directly
 *  (httpServer.ts wires the real one). */
export type EnqueueDispatch = (input: {
  action: 'dispatch';
  machine: string;
  provider: string;
  cwd: string;
  prompt: string;
  model?: string;
  effort?: string;
}) => { ok: boolean; reason?: string };

export class StandingOrderStore {
  private orders: Map<string, StandingOrder> | null = null;
  private lastPersistAt = 0;
  private explicitPath: string | undefined;
  private resolvedPath: string | undefined;
  private usingDefaultPath = false;
  private listeners: Array<(order: StandingOrder) => void> = [];

  constructor(persistPath?: string) {
    this.explicitPath = persistPath;
  }

  onChange(listener: (order: StandingOrder) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  create(
    input: StandingOrderInput,
    perkFlags: AutomationPerkFlags,
    now: number = Date.now(),
  ): StandingOrderResult {
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      return { ok: false, reason: 'missing-name' };
    }
    if (typeof input.prompt !== 'string' || input.prompt.trim() === '') {
      return { ok: false, reason: 'missing-prompt' };
    }
    const orders = this.ensureLoaded();
    const enabledCount = [...orders.values()].filter((o) => o.enabled).length;
    if (enabledCount >= standingOrderCap(perkFlags)) {
      return { ok: false, reason: 'standing-order-cap-exceeded' };
    }
    const order: StandingOrder = {
      id: randomUUID(),
      name: input.name,
      schedule: input.schedule,
      machine: input.machine,
      provider: input.provider,
      cwd: input.cwd,
      prompt: input.prompt,
      model: input.model,
      effort: input.effort,
      employeeId: input.employeeId,
      enabled: true,
      needsFirstFireConfirm: true,
      createdAt: now,
      updatedAt: now,
    };
    orders.set(order.id, order);
    this.finish(order, now, true);
    return { ok: true, order };
  }

  get(id: string): StandingOrder | undefined {
    return this.ensureLoaded().get(id);
  }

  getAll(): StandingOrder[] {
    return [...this.ensureLoaded().values()];
  }

  delete(id: string, now: number = Date.now()): { ok: true } {
    this.ensureLoaded().delete(id);
    this.persist(now, true);
    return { ok: true };
  }

  /** The ONLY code path that ever clears needsFirstFireConfirm — reachable
   *  only via an explicit human UI action. Fires the order's first-ever
   *  dispatch immediately (the confirm click IS the first execution), then
   *  unlocks unattended scheduling for every future tick. Never
   *  budget-gated — a human clicking confirm is the same conscious-spend
   *  act as a manual CallModal send. */
  confirmFirstFire(
    id: string,
    resolveEmployeeDefaults: ResolveEmployeeDefaults,
    enqueueDispatch: EnqueueDispatch,
    now: number = Date.now(),
  ): StandingOrderResult {
    const order = this.ensureLoaded().get(id);
    if (!order) return { ok: false, reason: 'not-found' };
    if (!order.needsFirstFireConfirm) return { ok: false, reason: 'already-confirmed' };
    const target = resolveTarget(order, resolveEmployeeDefaults);
    if (!target) return { ok: false, reason: 'missing-dispatch-target' };
    const result = enqueueDispatch({ action: 'dispatch', prompt: order.prompt, ...target });
    if (!result.ok) return { ok: false, reason: result.reason ?? 'enqueue-failed' };
    order.needsFirstFireConfirm = false;
    order.lastFiredAt = now;
    order.lastFiredDate = localDate(now);
    order.updatedAt = now;
    this.finish(order, now, true);
    return { ok: true, order };
  }

  setEnabled(id: string, enabled: boolean, now: number = Date.now()): StandingOrderResult {
    const order = this.ensureLoaded().get(id);
    if (!order) return { ok: false, reason: 'not-found' };
    order.enabled = enabled;
    order.updatedAt = now;
    this.finish(order, now, true);
    return { ok: true, order };
  }

  /** Periodic tick (60s cadence — httpServer.ts registers this, mirroring
   *  the dispatch TTL sweep's setInterval idiom, since timerManager.ts has
   *  no generic tick primitive it exports). Every due, confirmed, enabled
   *  order either fires or skips with a recorded reason — never silently
   *  drops a tick. Budget-paused skips leave lastFiredAt UNCHANGED (the
   *  next tick retries; a transient pause never counts as a fire). */
  tick(
    now: number,
    isAutomationPaused: (machine: string, provider: string | undefined) => boolean,
    resolveEmployeeDefaults: ResolveEmployeeDefaults,
    enqueueDispatch: EnqueueDispatch,
  ): void {
    for (const order of this.ensureLoaded().values()) {
      if (!order.enabled || order.needsFirstFireConfirm) continue;
      if (!this.isDue(order, now)) continue;

      const target = resolveTarget(order, resolveEmployeeDefaults);
      if (!target) {
        order.lastSkipReason = 'missing-dispatch-target';
        order.updatedAt = now;
        this.finish(order, now, false);
        continue;
      }
      if (isAutomationPaused(target.machine, target.provider)) {
        order.lastSkipReason = 'budget-paused';
        order.updatedAt = now;
        this.finish(order, now, false);
        continue;
      }
      const result = enqueueDispatch({ action: 'dispatch', prompt: order.prompt, ...target });
      if (!result.ok) {
        order.lastSkipReason = `enqueue-failed: ${result.reason ?? 'unknown'}`;
        order.updatedAt = now;
        this.finish(order, now, false);
        continue;
      }
      order.lastFiredAt = now;
      order.lastFiredDate = localDate(now);
      order.lastSkipReason = undefined;
      order.updatedAt = now;
      this.finish(order, now, true);
    }
  }

  private isDue(order: StandingOrder, now: number): boolean {
    if (order.schedule.kind === 'daily') {
      const today = localDate(now);
      if (order.lastFiredDate === today) return false; // dedupe: once/local-date
      return new Date(now).getHours() >= order.schedule.atLocalHour;
    }
    // interval
    const last = order.lastFiredAt ?? order.createdAt;
    return now - last >= order.schedule.everyMs;
  }

  /** STOP ALL (§7.5): disables every enabled order, flagging provenance so
   *  RESUME restores exactly the prior enabled set — never any other
   *  order that happened to already be disabled. */
  haltAll(now: number = Date.now()): StandingOrder[] {
    const halted: StandingOrder[] = [];
    for (const order of this.ensureLoaded().values()) {
      if (!order.enabled) continue;
      order.enabled = false;
      order.stoppedByKillSwitch = true;
      order.updatedAt = now;
      halted.push(order);
    }
    if (halted.length > 0) this.persist(now, true);
    for (const order of halted) this.emit(order);
    return halted;
  }

  /** RESUME (§7.5) — explicit action, never automatic/time-based. Restores
   *  exactly the set STOP ALL disabled, no more, no less. */
  resumeAll(now: number = Date.now()): StandingOrder[] {
    const resumed: StandingOrder[] = [];
    for (const order of this.ensureLoaded().values()) {
      if (!order.stoppedByKillSwitch) continue;
      order.enabled = true;
      order.stoppedByKillSwitch = false;
      order.updatedAt = now;
      resumed.push(order);
    }
    if (resumed.length > 0) this.persist(now, true);
    for (const order of resumed) this.emit(order);
    return resumed;
  }

  private finish(order: StandingOrder, now: number, force: boolean): void {
    this.persist(now, force);
    this.emit(order);
  }

  private emit(order: StandingOrder): void {
    for (const listener of this.listeners) listener(order);
  }

  // ── Persistence (tolerant, throttled — same pattern as progressionStore.ts) ──

  private persistPath(): string {
    if (!this.resolvedPath) {
      this.usingDefaultPath = this.explicitPath === undefined;
      this.resolvedPath = this.explicitPath ?? defaultOrdersFile();
    }
    return this.resolvedPath;
  }

  private ensureLoaded(): Map<string, StandingOrder> {
    if (!this.orders) this.orders = this.load();
    return this.orders;
  }

  private load(): Map<string, StandingOrder> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath(), 'utf8')) as unknown;
      if (!Array.isArray(raw)) return new Map();
      const map = new Map<string, StandingOrder>();
      for (const entry of raw as StandingOrder[]) {
        if (entry && typeof entry.id === 'string') map.set(entry.id, entry);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private persist(now: number, force = false): void {
    if (process.env.VITEST && this.usingDefaultPath) return;
    if (!force && now - this.lastPersistAt < PERSIST_THROTTLE_MS) return;
    this.lastPersistAt = now;
    const target = this.persistPath();
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify([...this.ensureLoaded().values()]), 'utf8');
    } catch {
      /* standing-order loss on write failure is acceptable — never crash the server */
    }
  }
}

/** Process-wide instance (the server is single-process). */
export const standingOrderStore = new StandingOrderStore();
