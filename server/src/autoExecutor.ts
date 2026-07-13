/**
 * Auto-Executor (T3 self-healing ladder, RUNG 3 — auto with guardrails).
 * HARD CONTRACT FROM THE KICKOFF: the whitelist SHIPS EMPTY — a fresh
 * deploy performs zero auto-actions. The whitelist file is NEVER written
 * by this server; it is deny-by-default (missing file, corrupt file, or an
 * absent/false `enabled` key all mean OFF) and only ever turns on by
 * Greg's own hand-edit (same convention as v4's Mini dispatch.json). Every
 * auto-action fires through the EXISTING redispatchCrate() implementation
 * (reworkRedispatch.ts) — zero new mutation capability, only a new,
 * guardrailed CALLER of one that already existed.
 *
 * The whitelist config (~/.pixel-agents/auto-executor-whitelist.json) is
 * read FRESH on every tick, not cached — a hand-edit takes effect on the
 * next tick without a server restart, matching the "hand-edit dispatch.json
 * live" precedent. The operational state (lineage/receipt bookkeeping the
 * server itself owns, ~/.pixel-agents/auto-executor-state.json) persists
 * normally via the shared v3 sidecar discipline (v3Persistence.ts).
 *
 * Guardrails, all centralized here (constants.ts):
 *  - AUTO_REQUEUE_DEFAULT_MAX_PER_ID: max auto-requeues per ORIGINAL (root)
 *    dispatch id, config-overridable via the whitelist entry's
 *    params.maxPerId.
 *  - AUTO_REQUEUE_DEFAULT_COOLDOWN_MS: minimum gap between two auto-fires
 *    of the same lineage, config-overridable via params.cooldownMs.
 *  - AUTO_REQUEUE_CONSECUTIVE_FAILURE_STOP: two auto-fired attempts in a
 *    row that themselves fail permanently stop that lineage (human's
 *    turn) — a hard safety ceiling, NOT config-overridable.
 * A dispatch id created BY an auto-requeue is tracked back to its root via
 * `originOf` so "per ORIGINAL dispatch id" holds across multiple rounds of
 * fail → auto-requeue → fail.
 */

import type { AgentStateStore } from './agentStateStore.js';
import {
  AUTO_EXECUTOR_RECEIPT_CAP,
  AUTO_REQUEUE_CONSECUTIVE_FAILURE_STOP,
  AUTO_REQUEUE_DEFAULT_COOLDOWN_MS,
  AUTO_REQUEUE_DEFAULT_MAX_PER_ID,
} from './constants.js';
import {
  getOpsReview,
  type OpsFinding,
  type OpsProposedAction,
  type OpsReceipt,
} from './opsAdvisor.js';
import { reworkBinStore } from './reworkBinStore.js';
import { redispatchCrate } from './reworkRedispatch.js';
import { V3JsonPersistence } from './v3Persistence.js';

const STATE_FILE_NAME = 'auto-executor-state.json';
const WHITELIST_FILE_NAME = 'auto-executor-whitelist.json';

export const REQUEUE_FAILED_DISPATCH_ACTION_KIND = 'requeue-failed-dispatch';
/** Registry of whitelistable action kinds — a future rung-3 addition (NOT
 *  "restart dead poller"; that needs runner-side support the fleet doesn't
 *  have and is deliberately not fabricated here) slots in as a new entry. */
export const AUTO_ACTION_KINDS = [REQUEUE_FAILED_DISPATCH_ACTION_KIND] as const;
export type AutoActionKind = (typeof AUTO_ACTION_KINDS)[number];

export interface AutoActionConfig {
  enabled: boolean;
  params?: Record<string, unknown>;
}

export interface AutoWhitelistConfig {
  actions: Partial<Record<string, AutoActionConfig>>;
  /** T5 fleet controls, DAILY FLEET SPEND CEILING — a sibling section in
   *  the SAME hand-edited file (same deny-by-default posture as `actions`:
   *  a missing file, corrupt file, or absent `dailyTokenCeiling` all mean
   *  no ceiling — current, unbounded behavior). */
  budget?: { dailyTokenCeiling?: number };
}

export interface AutoActionReceipt {
  ts: number;
  actionKind: string;
  cause: { findingId: string; receipts: OpsReceipt[] };
  /** Present only between the durable intent write and completion of the
   *  existing redispatch plane. Terminal receipts retain their old shape. */
  pending?: true;
  outcome: { ok: boolean; detail: string };
  undo: string;
}

interface AutoRequeueLineage {
  rootId: string;
  autoRequeueCount: number;
  lastAutoRequeueAt: number;
  consecutiveAutoFailures: number;
  /** The dispatch id we last made a fire/block decision about — guards
   *  against re-deciding (and re-blocking-identically) the SAME still-piled
   *  crate on every future tick. */
  lastDecidedFailureId: string | null;
}

interface AutoExecutorData {
  lineages: Record<string, AutoRequeueLineage>;
  /** child (auto-created) dispatch id -> root dispatch id. */
  originOf: Record<string, string>;
  /** Newest last; capped at AUTO_EXECUTOR_RECEIPT_CAP, oldest pruned. */
  receipts: AutoActionReceipt[];
  /** Codex fix round finding 1 — STOP ALL's kill switch, mirroring
   *  standingOrderStore's stoppedByKillSwitch pattern: persisted so a
   *  restart mid-STOP-ALL doesn't silently resume auto-actions. Set/cleared
   *  ONLY by haltAll()/resumeAll(), called from the SAME stop-all/resume
   *  transaction httpServer.ts already runs for standing orders + chains. */
  killSwitchActive: boolean;
}

function emptyData(): AutoExecutorData {
  return { lineages: {}, originOf: {}, receipts: [], killSwitchActive: false };
}

function emptyWhitelist(): AutoWhitelistConfig {
  return { actions: {} };
}

export interface AutoActionStatus {
  enabled: boolean;
  params?: Record<string, unknown>;
}

export interface AutoStatus {
  /** One entry per AUTO_ACTION_KINDS member, always present even if the
   *  whitelist file never mentions it (reported OFF). */
  actions: Record<string, AutoActionStatus>;
  /** Newest first. */
  receipts: AutoActionReceipt[];
  /** Colorblind-safe shape+label line, e.g. "AUTO: OFF — whitelist empty",
   *  "AUTO: requeue-failed-dispatch ON (cap 2, cooldown 10m)", or (STOP ALL
   *  engaged with an otherwise-enabled action) "AUTO: requeue-failed-dispatch
   *  ON (cap 2, cooldown 10m) — SUSPENDED (STOP ALL engaged)". */
  whitelistLine: string;
  /** Codex fix round finding 1 — surfaced so the panel can show the
   *  suspension honestly rather than a silent no-op. */
  killSwitchActive: boolean;
}

function formatMinutes(ms: number): string {
  return `${String(Math.round(ms / 60_000))}m`;
}

/** Codex fix round finding 2 — deny-by-default extends to the guardrail
 *  PARAMS themselves: an invalid maxPerId (non-integer, <=0, or absurdly
 *  large) never DISABLES the cap — it falls back to the safe default and
 *  logs once, the same fail-safe posture a corrupt whitelist file already
 *  gets (never permissive, never a crash). */
const MAX_PER_ID_UPPER_BOUND = 20;
const COOLDOWN_MS_UPPER_BOUND = 24 * 60 * 60_000; // 1 day

function validatedMaxPerId(raw: unknown): number {
  if (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw > 0 &&
    raw <= MAX_PER_ID_UPPER_BOUND
  ) {
    return raw;
  }
  if (raw !== undefined) {
    console.warn(
      `[autoExecutor] invalid maxPerId (${JSON.stringify(raw)}) — falling back to default ${String(AUTO_REQUEUE_DEFAULT_MAX_PER_ID)}`,
    );
  }
  return AUTO_REQUEUE_DEFAULT_MAX_PER_ID;
}

function validatedCooldownMs(raw: unknown): number {
  // Strictly positive: cooldownMs 0 would disable the cooldown guardrail
  // outright — exactly what this validation exists to prevent. Zero,
  // negative, and fractional values all fall back to the default.
  if (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw > 0 &&
    raw <= COOLDOWN_MS_UPPER_BOUND
  ) {
    return raw;
  }
  if (raw !== undefined) {
    console.warn(
      `[autoExecutor] invalid cooldownMs (${JSON.stringify(raw)}) — falling back to default ${String(AUTO_REQUEUE_DEFAULT_COOLDOWN_MS)}`,
    );
  }
  return AUTO_REQUEUE_DEFAULT_COOLDOWN_MS;
}

function describeEnabledAction(kind: string, params: Record<string, unknown> | undefined): string {
  if (kind === REQUEUE_FAILED_DISPATCH_ACTION_KIND) {
    const maxPerId = validatedMaxPerId(params?.maxPerId);
    const cooldownMs = validatedCooldownMs(params?.cooldownMs);
    return `${kind} ON (cap ${String(maxPerId)}, cooldown ${formatMinutes(cooldownMs)})`;
  }
  return `${kind} ON`;
}

export class AutoExecutorStore {
  private data: AutoExecutorData | null = null;
  private readonly persistence: V3JsonPersistence<AutoExecutorData>;
  // A SEPARATE V3JsonPersistence instance for the whitelist — deliberately
  // never has .persist() called on it anywhere in this class. Read fresh
  // every call (no in-memory cache) so a hand-edit takes effect on the very
  // next tick without a server restart.
  private readonly whitelistPersistence: V3JsonPersistence<AutoWhitelistConfig>;

  constructor(statePath?: string, whitelistPath?: string) {
    this.persistence = new V3JsonPersistence(STATE_FILE_NAME, statePath);
    this.whitelistPersistence = new V3JsonPersistence(WHITELIST_FILE_NAME, whitelistPath);
  }

  private ensureLoaded(): AutoExecutorData {
    if (!this.data) {
      this.data = this.persistence.load(
        (raw) => typeof raw.lineages === 'object' && typeof raw.originOf === 'object',
        emptyData,
      );
    }
    return this.data;
  }

  private loadWhitelist(): AutoWhitelistConfig {
    return this.whitelistPersistence.load((raw) => typeof raw.actions === 'object', emptyWhitelist);
  }

  private isEnabled(kind: string): AutoActionConfig | null {
    const cfg = this.loadWhitelist().actions[kind];
    if (!cfg || cfg.enabled !== true) return null; // deny-by-default: missing file/key/false all mean OFF
    return cfg;
  }

  /** T5 fleet controls — read fresh every call (same posture as the
   *  whitelist itself), a missing file/section/field all mean `undefined`
   *  (no ceiling configured). Consumed by httpServer.ts via
   *  dispatchStore.setBudgetGate() — this module never imports
   *  dispatchStore itself (one-way layering). */
  getDailyTokenCeiling(): number | undefined {
    const value = this.loadWhitelist().budget?.dailyTokenCeiling;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
  }

  getStatus(): AutoStatus {
    const whitelist = this.loadWhitelist();
    const killSwitchActive = this.isKillSwitchActive();
    const actions: Record<string, AutoActionStatus> = {};
    const enabledLines: string[] = [];
    for (const kind of AUTO_ACTION_KINDS) {
      const cfg = whitelist.actions[kind];
      const enabled = cfg?.enabled === true;
      actions[kind] = { enabled, params: cfg?.params };
      if (enabled) enabledLines.push(describeEnabledAction(kind, cfg?.params));
    }
    const whitelistLine =
      enabledLines.length === 0
        ? 'AUTO: OFF — whitelist empty'
        : killSwitchActive
          ? `AUTO: ${enabledLines.join('; ')} — SUSPENDED (STOP ALL engaged)`
          : `AUTO: ${enabledLines.join('; ')}`;
    return {
      actions,
      receipts: this.ensureLoaded().receipts.slice().reverse(),
      whitelistLine,
      killSwitchActive,
    };
  }

  /** Codex fix round finding 1 — STOP ALL's kill switch. Returns whether it
   *  actually changed anything (idempotent, mirrors standingOrderStore's
   *  haltAll semantics). Called from the SAME stop-all transaction as
   *  standingOrderStore.haltAll()/chainOrchestrator.haltAll(). */
  haltAll(now: number = Date.now()): boolean {
    const data = this.ensureLoaded();
    if (data.killSwitchActive) return false;
    data.killSwitchActive = true;
    this.persistence.persist(data, now, true);
    return true;
  }

  /** RESUME — explicit action, never automatic. Mirrors standingOrderStore's
   *  resumeAll: called from the SAME resume transaction. */
  resumeAll(now: number = Date.now()): boolean {
    const data = this.ensureLoaded();
    if (!data.killSwitchActive) return false;
    data.killSwitchActive = false;
    this.persistence.persist(data, now, true);
    return true;
  }

  isKillSwitchActive(): boolean {
    return this.ensureLoaded().killSwitchActive;
  }

  private appendReceipt(receipt: AutoActionReceipt, now: number): boolean {
    const data = this.ensureLoaded();
    data.receipts.push(receipt);
    while (data.receipts.length > AUTO_EXECUTOR_RECEIPT_CAP) data.receipts.shift();
    return this.persistence.persist(data, now, true);
  }

  /** Finalize the same durable intent entry in place, without appending a
   *  second receipt for one action. */
  private updateReceipt(
    receipt: AutoActionReceipt,
    outcome: AutoActionReceipt['outcome'],
    now: number,
  ): void {
    delete receipt.pending;
    receipt.outcome = outcome;
    this.persistence.persist(this.ensureLoaded(), now, true);
  }

  /** The requeue-failed-dispatch action kind's guardrail + fire logic for
   *  ONE candidate proposal. Returns the receipt if it fired (or was
   *  rejected by redispatchCrate itself), or null if a guardrail silently
   *  held it back (no receipt for a mere block — only real auto-actions
   *  leave a ledger entry) or the crate no longer resolves. */
  private maybeAutoRequeue(
    finding: OpsFinding,
    action: OpsProposedAction,
    params: Record<string, unknown> | undefined,
    now: number,
  ): AutoActionReceipt | null {
    const reworkId = String(action.params.reworkId);
    const crate = reworkBinStore.getById(reworkId);
    if (!crate) return null; // opsAdvisor only proposes existing crates; defensive only

    const failedDispatchId = crate.failureRef.id;
    const data = this.ensureLoaded();
    const root = data.originOf[failedDispatchId] ?? failedDispatchId;
    const lineage: AutoRequeueLineage = data.lineages[root] ?? {
      rootId: root,
      autoRequeueCount: 0,
      lastAutoRequeueAt: 0,
      consecutiveAutoFailures: 0,
      lastDecidedFailureId: null,
    };

    // Already decided this EXACT failure on a prior tick — don't
    // re-evaluate (and re-block identically) every AUTO_EXECUTOR_TICK
    // while the crate remains piled.
    if (lineage.lastDecidedFailureId === failedDispatchId) return null;

    const wasAutoCreated = data.originOf[failedDispatchId] !== undefined;
    const effectiveConsecutiveFailures = wasAutoCreated ? lineage.consecutiveAutoFailures + 1 : 0;

    const maxPerId = validatedMaxPerId(params?.maxPerId);
    const cooldownMs = validatedCooldownMs(params?.cooldownMs);

    const blockedByStreak = effectiveConsecutiveFailures >= AUTO_REQUEUE_CONSECUTIVE_FAILURE_STOP;
    const blockedByCap = lineage.autoRequeueCount >= maxPerId;
    const blockedByCooldown =
      lineage.autoRequeueCount > 0 && now - lineage.lastAutoRequeueAt < cooldownMs;

    if (blockedByStreak || blockedByCap) {
      // Terminal for this lineage until a human acts — record the decision
      // so it stays blocked without re-logging every tick.
      data.lineages[root] = {
        ...lineage,
        consecutiveAutoFailures: effectiveConsecutiveFailures,
        lastDecidedFailureId: failedDispatchId,
      };
      this.persistence.persist(data, now, true);
      return null;
    }
    if (blockedByCooldown) {
      // Not terminal — retry once the cooldown elapses, so the failure is
      // deliberately NOT marked decided.
      return null;
    }

    // D0: redispatchCrate is the existing human+automatic execution plane
    // and performs dispatchStore.enqueue internally. Persist intent before
    // entering it so an enqueue-then-crash can never create an unaudited
    // live dispatch.
    const receipt: AutoActionReceipt = {
      ts: now,
      actionKind: REQUEUE_FAILED_DISPATCH_ACTION_KIND,
      cause: { findingId: finding.id, receipts: finding.receipts },
      pending: true,
      outcome: {
        ok: false,
        detail: `intent recorded: redispatch piled crate ${crate.id} for failed dispatch ${failedDispatchId} via the existing redispatchCrate plane`,
      },
      undo: 'none — the new dispatch can be killed like any manual dispatch once it starts',
    };
    if (!this.appendReceipt(receipt, now)) {
      delete receipt.pending;
      receipt.outcome = {
        ok: false,
        detail: 'intent receipt persistence failed — action not requeued',
      };
      return receipt;
    }

    const result = redispatchCrate(crate.id);
    if (result.ok) {
      data.originOf[result.dispatchId] = root;
    }
    data.lineages[root] = {
      rootId: root,
      autoRequeueCount: lineage.autoRequeueCount + 1,
      lastAutoRequeueAt: now,
      // The streak tracks CONSECUTIVE RUN failures, not enqueue outcomes:
      // effectiveConsecutiveFailures already reflects "X's own failure,
      // chained onto however many of ITS auto-created predecessors also
      // failed" — carried forward as-is on a successful enqueue (the new
      // dispatch hasn't run yet, nothing to add), bumped once more if the
      // enqueue call itself was rejected outright (an immediate failure of
      // THIS attempt too, e.g. the ringing cap).
      consecutiveAutoFailures: result.ok
        ? effectiveConsecutiveFailures
        : effectiveConsecutiveFailures + 1,
      lastDecidedFailureId: failedDispatchId,
    };
    this.updateReceipt(
      receipt,
      result.ok
        ? { ok: true, detail: `requeued as dispatch ${result.dispatchId}` }
        : { ok: false, detail: result.reason },
      now,
    );
    return receipt;
  }

  /** One tick: compute advisor findings (opsAdvisor's own short-TTL cache —
   *  no new polling loop), filter to whitelisted+guardrail-passing
   *  proposals, execute, receipt. Exported at instance level so tests can
   *  call it directly without waiting on a real timer. */
  runTick(store: AgentStateStore, now: number = Date.now()): AutoActionReceipt[] {
    // Codex fix round finding 1 — STOP ALL must reach the auto-executor: an
    // engaged kill switch makes every tick a genuine no-op (checked BEFORE
    // even reading the whitelist), surfaced honestly via getStatus()'s
    // whitelistLine rather than a silent skip nobody can see.
    if (this.isKillSwitchActive()) return [];
    const requeueCfg = this.isEnabled(REQUEUE_FAILED_DISPATCH_ACTION_KIND);
    if (!requeueCfg) return [];

    const review = getOpsReview(store, now);
    const fired: AutoActionReceipt[] = [];
    for (const finding of review.findings) {
      if (finding.id !== 'dispatch-waste-failed') continue;
      for (const action of finding.proposedActions ?? []) {
        if (action.verb !== 'requeue') continue;
        const receipt = this.maybeAutoRequeue(finding, action, requeueCfg.params, now);
        if (receipt) fired.push(receipt);
      }
    }
    return fired;
  }

  /** Count of receipts with ts falling on the same calendar day as `now`
   *  (local time) — the SHIFT fold's autoActionCount. */
  getTodayReceiptCount(now: number = Date.now()): number {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const start = dayStart.getTime();
    const end = start + 24 * 60 * 60_000;
    return this.ensureLoaded().receipts.filter((r) => r.ts >= start && r.ts < end).length;
  }
}

/** Process-wide instance (the server is single-process). */
export const autoExecutorStore = new AutoExecutorStore();
