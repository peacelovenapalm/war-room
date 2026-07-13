/**
 * Self-Heal (V6-4, RUN-MAP-v5-v7-2026-07-12.md §3 — "autonomy rung 1,
 * pre-approved classes"). EXACTLY four pre-approved action classes, no
 * fifth, no generalization — the same containment discipline as
 * dispatch-rules.mjs's allowlist and notifyBark.ts's BIG_MOMENT_CLASSES: a
 * `readonly string[]` closed set checked at runtime with `.includes()`,
 * never trusted from the TS type alone, so a stray call site can never
 * widen the class set.
 *
 * HARD CONSTRAINT: this module grants the server ZERO new host-level
 * execution power. Every class executes through an EXISTING plane only:
 *
 *  - `restart-dead-runner` — PROPOSAL-ONLY. A dead runner's own poller IS
 *    the delivery mechanism for any dispatch; there is no channel to reach
 *    a machine that has stopped polling (autoExecutor.ts's own header
 *    already called this out: "NOT 'restart dead poller'; that needs
 *    runner-side support the fleet doesn't have and is deliberately not
 *    fabricated here"). Never executes, ever — always a receipted decline.
 *  - `refresh-stale-clone` — the T8 Mini-compute shell-dispatch plane
 *    (dispatchStore.enqueue with provider:'shell'), reused verbatim. Fires
 *    ONLY when the target machine's LIVE advertisement actually lists the
 *    matching scriptId (DispatchMachineAdvertisement.scriptIds) — the same
 *    honest-availability discipline opsAdvisor.ts's proposedActions use
 *    (machineAd.focus / machineAd.providers.includes(...)). Absent a
 *    machine-local `compute.scripts` registry entry (Greg's own hand-edit,
 *    same posture as autoExecutor's whitelist), this always suppresses.
 *  - `mechanical-vault-fix` — PROPOSAL-ONLY. No vault-health signal exists
 *    anywhere in this codebase yet (grepped: the only "vault-health"
 *    string is an example routine-dir name in a comment, never parsed for
 *    health data) — auto-detection is honestly ⊘, always.
 *  - `rerun-failed-routine` — wired to the SAME shell-dispatch plane as
 *    refresh-stale-clone for symmetry, but auto-detection is honestly ⊘:
 *    inboxProvider.ts's InboxEntry carries no failure/status field, so
 *    there is no existing failure signal in the routine inbox to detect
 *    from. (This is distinct from — and does not duplicate — the existing
 *    Rung-3 autoExecutor.ts, which already auto-requeues FAILED DISPATCHES
 *    via the rework bin. "rerun-failed-routine" here means a Brain2 vault
 *    routine, not a dispatch.)
 *
 * Every execution (or suppression) checks, in order: (1) the durable
 * STOP-ALL latch, (2) the shared budget-pause gate, (3) the per-class
 * enable flag (default ON), then executes or writes a suppressed receipt.
 * Every decision — fired, suppressed, or failed — is receipted verbatim
 * and persisted the same way autoExecutor.ts persists its own receipts
 * ledger (V3JsonPersistence, capped, newest-last on disk / newest-first on
 * read), exposed alongside it in the SAME OPS REVIEW surface rather than a
 * new panel.
 */

import {
  SELF_HEAL_ACTION_COOLDOWN_MS,
  SELF_HEAL_CLONE_STALE_MS,
  SELF_HEAL_RECEIPT_CAP,
  SELF_HEAL_RUNNER_DEAD_MS,
} from './constants.js';
import { dispatchStore } from './dispatchStore.js';
import { getInboxListing } from './inboxProvider.js';
import { stopAllLatch } from './stopAllLatch.js';
import { V3JsonPersistence } from './v3Persistence.js';

const FLAGS_FILE_NAME = 'self-heal-flags.json';
const STATE_FILE_NAME = 'self-heal-state.json';

export const SELF_HEAL_CLASSES = [
  'restart-dead-runner',
  'refresh-stale-clone',
  'mechanical-vault-fix',
  'rerun-failed-routine',
] as const;
export type SelfHealClass = (typeof SELF_HEAL_CLASSES)[number];

/** Runtime guard — never trust the TS type alone (mirrors
 *  notifyBark.ts's BIG_MOMENT_CLASSES `.includes()` check exactly). */
export function isSelfHealClass(value: string): value is SelfHealClass {
  return (SELF_HEAL_CLASSES as readonly string[]).includes(value);
}

export type SelfHealPlane = 'shell-dispatch' | 'proposal-only';

/** Which existing execution plane each class is wired to. See file header
 *  for the honest rationale behind each choice. */
export const SELF_HEAL_PLANE: Readonly<Record<SelfHealClass, SelfHealPlane>> = {
  'restart-dead-runner': 'proposal-only',
  'refresh-stale-clone': 'shell-dispatch',
  'mechanical-vault-fix': 'proposal-only',
  'rerun-failed-routine': 'shell-dispatch',
};

/** Opaque T8 compute scriptId per class — a shell-dispatch class only ever
 *  fires when the target machine's live advertisement actually lists this
 *  id; never fabricated, never assumed present. */
const SELF_HEAL_SCRIPT_ID: Readonly<Record<SelfHealClass, string>> = {
  'restart-dead-runner': 'restart-dead-runner',
  'refresh-stale-clone': 'refresh-stale-clone',
  'mechanical-vault-fix': 'mechanical-vault-fix',
  'rerun-failed-routine': 'rerun-failed-routine',
};

const UNDO_NOTES: Readonly<Record<SelfHealClass, string>> = {
  'restart-dead-runner':
    'no automated undo — a manual restart is the corrective action itself; nothing this module does is reversible because nothing here ever executes it',
  'refresh-stale-clone':
    'undo by reverting the clone/mirror to its prior commit or snapshot on the target machine, the same way any manual git operation there would be undone',
  'mechanical-vault-fix':
    "undo per the vault's own git history once a real vault-health source exists — no automated action fires yet, so nothing to undo today",
  'rerun-failed-routine':
    'the new dispatch can be killed like any manual run; the original failed run is untouched by the re-run',
};

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${String(totalMinutes)}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${String(hours)}h` : `${String(hours)}h${String(minutes)}m`;
}

/** Single shared target machine for shell-dispatch classes — the smallest
 *  reversible default given no per-class machine config was specified: one
 *  env var, absent by default (⊘ no target configured, never fabricated).
 *  `undefined` when unset/blank. */
export function selfHealTargetMachine(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.WAR_ROOM_SELF_HEAL_TARGET_MACHINE;
  return raw && raw.trim() !== '' ? raw.trim() : undefined;
}

export interface SelfHealReceipt {
  ts: number;
  class: SelfHealClass;
  target: string;
  plane: SelfHealPlane;
  outcome: 'executed' | 'suppressed' | 'failed';
  suppressedReason?: string;
  detail: string;
  dispatchId?: string;
  undoNote: string;
}

export interface SelfHealCandidate {
  class: SelfHealClass;
  target: string;
  detail: string;
}

interface SelfHealFlagsData {
  /** Per-class opt-out — absent/false means ON (default-ON posture, the
   *  opposite of autoExecutor.ts's deny-by-default whitelist, per the
   *  V6-4 contract: "per-class enable flags default ON for the four
   *  classes"). */
  disabled: Partial<Record<SelfHealClass, boolean>>;
}

interface SelfHealStateData {
  /** Newest last (persisted order); getReceipts() reverses for read. */
  receipts: SelfHealReceipt[];
  /** `${class}:${target}` -> ts of the last receipted decision, bounding
   *  ledger spam from a persistently-eligible candidate re-deciding every
   *  tick. */
  lastActionAt: Record<string, number>;
}

function emptyFlags(): SelfHealFlagsData {
  return { disabled: {} };
}

function emptyState(): SelfHealStateData {
  return { receipts: [], lastActionAt: {} };
}

/** Shape-checked against the SAME `isAutomationPaused`-shaped signature
 *  standingOrderStore.tick()/chainOrchestrator use — httpServer.ts wires
 *  the real shared budgetGate in, so self-heal respects the identical
 *  budget-pause gate every other automation plane already does. */
export type SelfHealIsAutomationPaused = (
  machine: string,
  provider: string | undefined,
) => { paused: boolean; reason?: string };

export interface SelfHealDeps {
  now: number;
  isAutomationPaused: SelfHealIsAutomationPaused;
}

export type SelfHealActionResult =
  { ok: false; reason: 'unknown-class' } | { ok: true; receipt: SelfHealReceipt | null };

export class SelfHealStore {
  private readonly flagsPersistence: V3JsonPersistence<SelfHealFlagsData>;
  private readonly statePersistence: V3JsonPersistence<SelfHealStateData>;
  private state: SelfHealStateData | null = null;

  constructor(flagsPath?: string, statePath?: string) {
    this.flagsPersistence = new V3JsonPersistence(FLAGS_FILE_NAME, flagsPath);
    this.statePersistence = new V3JsonPersistence(STATE_FILE_NAME, statePath);
  }

  private ensureState(): SelfHealStateData {
    if (!this.state) {
      this.state = this.statePersistence.load((raw) => Array.isArray(raw.receipts), emptyState);
    }
    return this.state;
  }

  /** Read fresh every call (same posture as autoExecutor's whitelist) — a
   *  hand-edit or a POST /api/ops/self-heal/flags toggle takes effect on
   *  the very next check, no restart/cache invalidation needed. */
  getFlags(): Record<SelfHealClass, boolean> {
    const raw = this.flagsPersistence.load(
      (r) => typeof r.disabled === 'object' && r.disabled !== null,
      emptyFlags,
    );
    const out = {} as Record<SelfHealClass, boolean>;
    for (const cls of SELF_HEAL_CLASSES) out[cls] = raw.disabled[cls] !== true;
    return out;
  }

  setClassEnabled(
    cls: string,
    enabled: boolean,
    now: number = Date.now(),
  ): { ok: true } | { ok: false; reason: 'unknown-class' } {
    if (!isSelfHealClass(cls)) return { ok: false, reason: 'unknown-class' };
    const raw = this.flagsPersistence.load(
      (r) => typeof r.disabled === 'object' && r.disabled !== null,
      emptyFlags,
    );
    raw.disabled[cls] = !enabled;
    this.flagsPersistence.persist(raw, now, true);
    return { ok: true };
  }

  /** Newest first. */
  getReceipts(): SelfHealReceipt[] {
    return this.ensureState().receipts.slice().reverse();
  }

  private appendReceipt(receipt: SelfHealReceipt, now: number): void {
    const state = this.ensureState();
    state.receipts.push(receipt);
    while (state.receipts.length > SELF_HEAL_RECEIPT_CAP) state.receipts.shift();
    state.lastActionAt[`${receipt.class}:${receipt.target}`] = now;
    this.statePersistence.persist(state, now, true);
  }

  private withinCooldown(cls: SelfHealClass, target: string, now: number): boolean {
    const last = this.ensureState().lastActionAt[`${cls}:${target}`];
    return last !== undefined && now - last < SELF_HEAL_ACTION_COOLDOWN_MS;
  }

  /** The ONLY entry point that ever executes (or suppresses) a self-heal
   *  action — every candidate, auto-detected or future-manual, passes
   *  through here so the guard chain is identical regardless of caller.
   *  Guard order: unknown-class -> per-target cooldown (silent no-op, no
   *  receipt) -> STOP-ALL latch -> budget pause -> per-class flag ->
   *  execute (or decline if proposal-only / no honest execution path). */
  runAction(candidate: SelfHealCandidate, deps: SelfHealDeps): SelfHealActionResult {
    if (!isSelfHealClass(candidate.class)) return { ok: false, reason: 'unknown-class' };
    const cls = candidate.class;
    const now = deps.now;
    const plane = SELF_HEAL_PLANE[cls];
    const undoNote = UNDO_NOTES[cls];

    // Cooldown is a pure no-op (no receipt at all) — re-deciding an
    // already-decided-recently candidate is not itself a new decision.
    if (this.withinCooldown(cls, candidate.target, now)) {
      return { ok: true, receipt: null };
    }

    const suppress = (reason: string, detail: string): SelfHealActionResult => {
      const receipt: SelfHealReceipt = {
        ts: now,
        class: cls,
        target: candidate.target,
        plane,
        outcome: 'suppressed',
        suppressedReason: reason,
        detail,
        undoNote,
      };
      this.appendReceipt(receipt, now);
      return { ok: true, receipt };
    };

    if (stopAllLatch.isEngaged()) {
      return suppress('stop-all-latch', 'STOP-ALL latch engaged — action not executed');
    }

    const machine = selfHealTargetMachine();
    const pauseCheck = deps.isAutomationPaused(machine ?? candidate.target, undefined);
    if (pauseCheck.paused) {
      return suppress(
        'budget-paused',
        `automation budget paused: ${pauseCheck.reason ?? 'unknown'}`,
      );
    }

    if (!this.getFlags()[cls]) {
      return suppress('class-disabled', `${cls} is disabled via self-heal flags`);
    }

    if (plane === 'proposal-only') {
      return suppress('proposal-only', candidate.detail);
    }

    if (!machine) {
      return suppress('no-target-machine', 'WAR_ROOM_SELF_HEAL_TARGET_MACHINE not configured');
    }

    const liveAd = dispatchStore.getMachines(now).find((m) => m.machine === machine);
    if (!liveAd) {
      return suppress('machine-not-live', `${machine} has no live dispatch advertisement`);
    }

    const scriptId = SELF_HEAL_SCRIPT_ID[cls];
    if (!liveAd.scriptIds.includes(scriptId)) {
      return suppress(
        'script-not-advertised',
        `${machine} does not advertise compute script "${scriptId}" — Greg has not opted this machine in yet`,
      );
    }

    const enqueued = dispatchStore.enqueue({
      action: 'dispatch',
      machine,
      provider: 'shell',
      scriptId,
    });

    const receipt: SelfHealReceipt = {
      ts: now,
      class: cls,
      target: candidate.target,
      plane,
      outcome: enqueued.ok ? 'executed' : 'failed',
      detail: enqueued.ok
        ? `dispatched compute script "${scriptId}" on ${machine}`
        : `enqueue failed: ${enqueued.reason}`,
      dispatchId: enqueued.ok ? enqueued.record.id : undefined,
      undoNote,
    };
    this.appendReceipt(receipt, now);
    return { ok: true, receipt };
  }

  /** Standing-order escalation (V6-4: "Board may spawn scheduled + reactive
   *  standing orders — every spawn receipted"). Honest containment note:
   *  standingOrderStore's EnqueueDispatch shape is LLM-dispatch-only
   *  (machine/provider/cwd/prompt) — it has no scriptId/args field, so it
   *  cannot carry a T8 shell-compute request today. Extending that store's
   *  core dispatch contract is out of THIS module's boundary (no new
   *  mutation capability, no touching an existing store's contract to make
   *  room for a new caller). Every spawn ATTEMPT is still receipted —
   *  honest decline, never a silent unsupported no-op. */
  spawnStandingOrder(cls: string, now: number = Date.now()): SelfHealActionResult {
    if (!isSelfHealClass(cls)) return { ok: false, reason: 'unknown-class' };
    const receipt: SelfHealReceipt = {
      ts: now,
      class: cls,
      target: 'standing-order',
      plane: SELF_HEAL_PLANE[cls],
      outcome: 'suppressed',
      suppressedReason: 'standing-orders-lack-shell-dispatch-support',
      detail:
        "standingOrderStore's EnqueueDispatch carries no scriptId/args field — a shell-compute " +
        "self-heal action cannot be scheduled as a standing order without extending that store's " +
        "core dispatch contract, which is out of this module's containment boundary.",
      undoNote: UNDO_NOTES[cls],
    };
    this.appendReceipt(receipt, now);
    return { ok: true, receipt };
  }
}

/** Process-wide instance (the server is single-process). */
export const selfHealStore = new SelfHealStore();

// ── Detection (honest signals only — ⊘ where none exist) ───────────────

/** restart-dead-runner: dispatchStore's own machine advertisements,
 *  regardless of TTL staleness (getAllMachineAdvertisements is the
 *  inverse of getMachines()'s live filter — the same source
 *  opsAdvisor.ts's DEAD-TELEMETRY finding reads), aged past
 *  SELF_HEAL_RUNNER_DEAD_MS. */
function detectDeadRunners(now: number): SelfHealCandidate[] {
  const out: SelfHealCandidate[] = [];
  for (const ad of dispatchStore.getAllMachineAdvertisements()) {
    const ageMs = now - ad.lastSeenAt;
    if (ageMs <= SELF_HEAL_RUNNER_DEAD_MS) continue;
    out.push({
      class: 'restart-dead-runner',
      target: ad.machine,
      detail: `dispatch runner on ${ad.machine} silent ${formatDuration(ageMs)} (threshold ${formatDuration(SELF_HEAL_RUNNER_DEAD_MS)}) — no channel exists to remotely restart a poller that has stopped polling; a human must restart it out-of-band`,
    });
  }
  return out;
}

/** refresh-stale-clone: the routine inbox's newest entry mtime (the SAME
 *  WAR_ROOM_ROUTINES_DIR mount that lives on the vault clone/mirror —
 *  inboxProvider.ts's own file header). No entries / unavailable inbox is
 *  honestly ⊘ (skipped, never fabricated as "stale"). */
function detectStaleClone(now: number): SelfHealCandidate[] {
  const inbox = getInboxListing(now);
  if (!inbox.available || inbox.entries.length === 0) return [];
  const newest = inbox.entries[0];
  const ageMs = now - newest.mtimeMs;
  if (ageMs <= SELF_HEAL_CLONE_STALE_MS) return [];
  return [
    {
      class: 'refresh-stale-clone',
      target: 'routines-clone',
      detail: `newest routine inbox entry (${newest.routine}/${newest.filename}) is ${formatDuration(ageMs)} old (threshold ${formatDuration(SELF_HEAL_CLONE_STALE_MS)}) — the clone/mirror feeding it may not have refreshed recently`,
    },
  ];
}

/** mechanical-vault-fix: no vault-health source exists in this codebase
 *  today (confirmed by search — "vault-health" appears only as an example
 *  routine-dir name in inboxProvider.ts's comment, never parsed for
 *  health/status data). Honestly always ⊘ — never fabricated. */
function detectVaultFix(_now: number): SelfHealCandidate[] {
  return [];
}

/** rerun-failed-routine: the routine inbox (inboxProvider.ts's
 *  InboxEntry) carries only { routine, filename, mtimeMs, ageMs } — no
 *  failure/status/exit-code field exists to detect a FAILED routine from.
 *  Honestly always ⊘ — never fabricated. Distinct from autoExecutor.ts's
 *  existing Rung-3 dispatch-requeue, which already covers failed
 *  DISPATCHES (a different signal this module deliberately does not
 *  duplicate). */
function detectFailedRoutine(_now: number): SelfHealCandidate[] {
  return [];
}

/** All honest self-heal candidates this tick, across all four classes. */
export function detectSelfHealCandidates(now: number = Date.now()): SelfHealCandidate[] {
  return [
    ...detectDeadRunners(now),
    ...detectStaleClone(now),
    ...detectVaultFix(now),
    ...detectFailedRoutine(now),
  ];
}

/** One tick: detect candidates, run each through the guard chain, return
 *  whatever actually produced a receipt (cooldown no-ops are omitted).
 *  Exported at module level (not a class method) so httpServer.ts's
 *  setInterval idiom and tests can call it directly, mirroring
 *  autoExecutorStore.runTick's own shape. */
export function runSelfHealTick(
  deps: SelfHealDeps,
  store: SelfHealStore = selfHealStore,
): SelfHealReceipt[] {
  const fired: SelfHealReceipt[] = [];
  for (const candidate of detectSelfHealCandidates(deps.now)) {
    const result = store.runAction(candidate, deps);
    if (result.ok && result.receipt) fired.push(result.receipt);
  }
  return fired;
}

export interface SelfHealStatus {
  /** One entry per SELF_HEAL_CLASSES member, always present. */
  flags: Record<SelfHealClass, boolean>;
  /** Newest first. */
  receipts: SelfHealReceipt[];
}

export function getSelfHealStatus(store: SelfHealStore = selfHealStore): SelfHealStatus {
  return { flags: store.getFlags(), receipts: store.getReceipts() };
}
