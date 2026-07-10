/**
 * Dossier derivation (v3 WS-C STAGE 2 — KICKOFF-v3.1 §3 "dossier").
 * Accumulates REAL per-staff telemetry and computes traits as THRESHOLD
 * RULES over it, feeding dossierStore.ts (which enforces the one-tap-real
 * and traits-are-permanent invariants at its mutation surface).
 *
 * Identity: staffId = employeeId(machine, projectDir) — the BASE
 * (machine, project) lineage key. The dossier is the durable identity
 * file for that lineage: employee-record churn (fired → `#n` re-hires)
 * shares ONE dossier, which is exactly the "stable staff identity across
 * session churn" requirement.
 *
 * Real event sources (each record method is called from the point where
 * the event is OBSERVED, never inferred):
 *  - sessions run   → agentStateStore 'agentAdded' (deduped by sessionId)
 *  - turns + burn   → hookEventHandler's Stop path (the same call site
 *                     employeeStore.recordTurn uses; cumulative-token
 *                     baseline tracked here the same way)
 *  - crises         → pollStateHandler's observed blocked→unblocked
 *                     transition (with the measured duration); NEVER the
 *                     stale sweep or the vanished clear
 *  - kills/exits    → dispatchStore's terminal broadcast (machine + cwd
 *                     resolved via getRecord)
 *  - bounces        → GAME-DESIGN-V3 §2's bounce rule made staff-local: a
 *                     new blocked episode for the same staff within
 *                     BOUNCE_WINDOW_MS of a resolution is a bounce
 *
 * Every trait stores its triggering event refs (earnedFrom) — one-tap-real.
 * Telemetry persists via the shared v3 sidecar discipline at
 * ~/.pixel-agents/dossier-telemetry.json.
 */

import { employeeId } from '../../core/src/employeeId.js';
import type { DispatchBroadcast } from './dispatchStore.js';
import { DispatchStore, dispatchStore } from './dispatchStore.js';
import { DossierStore, dossierStore } from './dossierStore.js';
import { employeeStore } from './employeeStore.js';
import { V3JsonPersistence } from './v3Persistence.js';

const FILE_NAME = 'dossier-telemetry.json';

// ── Trait threshold rules (each documented beside its constant) ────────

/** NIGHT OWL — more than NIGHT_OWL_FRACTION of this staff's recorded turns
 *  land 22:00–05:59 local (the same night window employeeStore's nightOwl
 *  score uses), with at least NIGHT_OWL_MIN_TURNS turns on record so a
 *  two-turn midnight session can't mint the trait. */
export const NIGHT_OWL_MIN_TURNS = 20;
export const NIGHT_OWL_FRACTION = 0.6;

/** THE CLOSER — more than CLOSER_MIN_FAST_RESOLUTIONS observed crisis
 *  resolutions each under CLOSER_FAST_MS (measured from the real
 *  blocked→unblocked poll transition; sweeps and silent clears never
 *  count). ">5" per the design — i.e. the 6th fast resolution earns it. */
export const CLOSER_MIN_FAST_RESOLUTIONS = 5;
export const CLOSER_FAST_MS = 60_000;

/** BIG SPENDER — this staff's cumulative output-token burn sits in the top
 *  quartile across all staff with recorded burn; requires at least
 *  BIG_SPENDER_MIN_STAFF staff on record (a quartile of fewer is noise).
 *  A neutral fact, not a reward: the trait pays nothing anywhere (tokens
 *  are real money — the no-reward-for-volume guardrail holds). */
export const BIG_SPENDER_MIN_STAFF = 4;

/** STEADY HANDS — a 14-day zero-bounce streak with REAL work in the
 *  window: at least STEADY_HANDS_MIN_EXITS dispatch exits observed in the
 *  trailing STEADY_HANDS_WINDOW_MS, zero bounces AND zero kills in the
 *  same window. The activity floor is what keeps this an earned trait —
 *  absence of work never mints it (a vacation is not steadiness). */
export const STEADY_HANDS_WINDOW_MS = 14 * 86_400_000;
export const STEADY_HANDS_MIN_EXITS = 5;

/** Bounce window — GAME-DESIGN-V3 §2's bounce rule (re-block within 5
 *  minutes of an approval/resolution claws the credit back), applied here
 *  as the staff-local bounce definition. */
export const BOUNCE_WINDOW_MS = 5 * 60_000;

/** Trait display names — the dedupe keys dossierStore refuses duplicates on. */
export const TRAIT_NIGHT_OWL = 'Night Owl';
export const TRAIT_THE_CLOSER = 'The Closer';
export const TRAIT_BIG_SPENDER = 'Big Spender';
export const TRAIT_STEADY_HANDS = 'Steady Hands';

/** Evidence-ref ring cap per category (one-tap needs a sample, not a log). */
const REF_CAP = 10;
/** Timestamped-event ring caps (window queries need history, bounded). */
const EVENT_CAP = 200;
const SESSION_ID_CAP = 50;

interface TsRef {
  ts: number;
  ref: string;
}

interface StaffTelemetry {
  staffId: string;
  machine: string;
  projectDir: string;
  displayName: string;
  firstSeenAt: number;
  sessions: number;
  /** Recent distinct session ids (dedupe ring — "sessions run" counts
   *  distinct sessions, and a second live server instance in one process
   *  must not double-count). */
  recentSessionIds: string[];
  sessionRefs: string[];
  turns: number;
  nightTurns: number;
  nightRefs: string[];
  /** Cumulative output-token burn (per-turn deltas summed). */
  outputTokens: number;
  lastOutputTokensSeen: number;
  burnRefs: string[];
  crisesResolved: number;
  unblockMsTotal: number;
  fastResolutions: number;
  fastRefs: string[];
  lastResolvedAt?: number;
  kills: TsRef[];
  bounces: TsRef[];
  dispatchExits: Array<TsRef & { ok: boolean }>;
}

interface TelemetryData {
  staff: Record<string, StaffTelemetry>;
}

function emptyData(): TelemetryData {
  return { staff: {} };
}

function isNightHour(hour: number): boolean {
  return hour >= 22 || hour < 6;
}

function pushRef(ring: string[], ref: string): void {
  ring.push(ref);
  if (ring.length > REF_CAP) ring.splice(0, ring.length - REF_CAP);
}

function pushEvent<T>(ring: T[], event: T): void {
  ring.push(event);
  if (ring.length > EVENT_CAP) ring.splice(0, ring.length - EVENT_CAP);
}

export class DossierDerivation {
  private data: TelemetryData | null = null;
  private readonly persistence: V3JsonPersistence<TelemetryData>;
  private readonly dossiers: DossierStore;
  private readonly resolveDisplayName: (staffId: string) => string | undefined;
  private subscribed = false;

  constructor(
    dossiers: DossierStore = dossierStore,
    persistPath?: string,
    resolveDisplayName?: (staffId: string) => string | undefined,
  ) {
    this.dossiers = dossiers;
    this.persistence = new V3JsonPersistence(FILE_NAME, persistPath);
    // Default: the roster's own character name for this lineage, so the
    // dossier plane and the employee plane never disagree on who this is.
    this.resolveDisplayName =
      resolveDisplayName ?? ((staffId) => employeeStore.getById(staffId)?.name);
  }

  /** Subscribe the dispatch kill/exit feed. Idempotent — call exactly once
   *  at process startup (same discipline as chainOrchestrator.start()). */
  start(dispatch: Pick<DispatchStore, 'onUpdate' | 'getRecord'> = dispatchStore): void {
    if (this.subscribed) return;
    this.subscribed = true;
    dispatch.onUpdate((broadcast) => this.onDispatchUpdate(broadcast, dispatch));
  }

  // ── Real-event entry points ─────────────────────────────────────────

  /** A real session appeared (agentAdded). Deduped by sessionId. */
  recordSession(
    machine: string | undefined,
    projectDir: string,
    projectLabel: string,
    sessionId: string,
    now: number = Date.now(),
  ): void {
    if (projectDir.trim() === '') return;
    const t = this.touch(machine, projectDir, projectLabel, now);
    if (sessionId !== '' && t.recentSessionIds.includes(sessionId)) return;
    if (sessionId !== '') {
      t.recentSessionIds.push(sessionId);
      if (t.recentSessionIds.length > SESSION_ID_CAP) {
        t.recentSessionIds.splice(0, t.recentSessionIds.length - SESSION_ID_CAP);
      }
    }
    t.sessions++;
    pushRef(t.sessionRefs, `session:${sessionId || `${t.staffId}@${now}`}`);
    this.finish(t, now);
  }

  /** A completed real turn (hook Stop — the same call site employeeStore
   *  .recordTurn uses). `outputTokensCumulative` is the session's running
   *  total; the per-turn delta is derived against our own last-seen value
   *  (the established "track your own baseline" pattern). */
  recordTurn(
    machine: string | undefined,
    projectDir: string,
    projectLabel: string,
    outputTokensCumulative: number,
    now: number = Date.now(),
  ): void {
    const t = this.touch(machine, projectDir, projectLabel, now);
    const delta =
      outputTokensCumulative >= t.lastOutputTokensSeen
        ? outputTokensCumulative - t.lastOutputTokensSeen
        : 0;
    t.lastOutputTokensSeen = outputTokensCumulative;
    t.outputTokens += delta;
    t.turns++;
    const ref = `turn:${t.staffId}@${now}`;
    if (isNightHour(new Date(now).getHours())) {
      t.nightTurns++;
      pushRef(t.nightRefs, ref);
    }
    if (delta > 0) pushRef(t.burnRefs, `${ref}:+${delta}tok`);
    this.finish(t, now);
  }

  /** A blocked episode began (observed poll transition). Only consumed for
   *  bounce detection: a re-block within BOUNCE_WINDOW_MS of this staff's
   *  last observed resolution is a bounce. */
  recordCrisisStarted(
    machine: string | undefined,
    projectDir: string,
    agentId: number,
    now: number = Date.now(),
  ): void {
    const t = this.touch(machine, projectDir, projectDir, now);
    if (t.lastResolvedAt !== undefined && now - t.lastResolvedAt < BOUNCE_WINDOW_MS) {
      pushEvent(t.bounces, { ts: now, ref: `crisis:agent:${agentId}@${t.machine} re-blocked` });
    }
    this.finish(t, now);
  }

  /** An OBSERVED crisis resolution with its measured duration (poll
   *  blocked→unblocked transition — never a stale sweep or silent clear). */
  recordCrisisResolved(
    machine: string | undefined,
    projectDir: string,
    agentId: number,
    durationMs: number,
    now: number = Date.now(),
  ): void {
    const t = this.touch(machine, projectDir, projectDir, now);
    t.crisesResolved++;
    t.unblockMsTotal += Math.max(0, durationMs);
    if (durationMs < CLOSER_FAST_MS) {
      t.fastResolutions++;
      pushRef(t.fastRefs, `crisis:agent:${agentId}@${t.machine}@${now}:${durationMs}ms`);
    }
    t.lastResolvedAt = now;
    this.finish(t, now);
  }

  /** A dispatch reached a terminal state — resolve its (machine, cwd) via
   *  the queue record and log the outcome for the owning staff lineage. */
  onDispatchUpdate(
    broadcast: DispatchBroadcast,
    dispatch: Pick<DispatchStore, 'getRecord'> = dispatchStore,
    now: number = Date.now(),
  ): void {
    if (broadcast.action !== 'dispatch') return;
    if (broadcast.status !== 'exited' && broadcast.status !== 'killed') return;
    const record = dispatch.getRecord(broadcast.id);
    if (!record?.cwd) return;
    const t = this.touch(record.machine, record.cwd, record.cwd, now);
    if (broadcast.status === 'killed') {
      pushEvent(t.kills, { ts: now, ref: `dispatch:${broadcast.id}` });
    } else {
      pushEvent(t.dispatchExits, {
        ts: now,
        ok: broadcast.exitCode === 0,
        ref: `dispatch:${broadcast.id}`,
      });
    }
    this.finish(t, now);
  }

  // ── Reads (tests + debugging) ───────────────────────────────────────

  getTelemetry(staffId: string): StaffTelemetry | undefined {
    return this.ensureLoaded().staff[staffId];
  }

  // ── Internal ────────────────────────────────────────────────────────

  private touch(
    machine: string | undefined,
    projectDir: string,
    projectLabel: string,
    now: number,
  ): StaffTelemetry {
    const data = this.ensureLoaded();
    const staffId = employeeId(machine, projectDir);
    let t = data.staff[staffId];
    if (!t) {
      t = {
        staffId,
        machine: machine ?? 'LOCAL',
        projectDir,
        displayName: this.resolveDisplayName(staffId) ?? projectLabel,
        firstSeenAt: now,
        sessions: 0,
        recentSessionIds: [],
        sessionRefs: [],
        turns: 0,
        nightTurns: 0,
        nightRefs: [],
        outputTokens: 0,
        lastOutputTokensSeen: 0,
        burnRefs: [],
        crisesResolved: 0,
        unblockMsTotal: 0,
        fastResolutions: 0,
        fastRefs: [],
        kills: [],
        bounces: [],
        dispatchExits: [],
      };
      data.staff[staffId] = t;
    }
    return t;
  }

  /** Persist telemetry, refresh the dossier record (ensure + history),
   *  and run every threshold rule. Runs after each recorded event. */
  private finish(t: StaffTelemetry, now: number): void {
    this.persistence.persist(this.ensureLoaded(), now, true);
    this.dossiers.ensure(t.staffId, t.displayName, now);
    this.evaluateTraits(t, now);
    const history = this.historySummary(t);
    const existing = this.dossiers.get(t.staffId);
    if (existing && existing.history !== history) {
      this.dossiers.setHistory(t.staffId, history, now);
    }
  }

  /** The computed history line — every number in it decomposes into the
   *  telemetry counters above, which in turn hold their event refs. */
  private historySummary(t: StaffTelemetry): string {
    const meanUnblock =
      t.crisesResolved > 0
        ? ` (mean unblock ${Math.round(t.unblockMsTotal / t.crisesResolved / 1000)}s)`
        : '';
    return (
      `${t.sessions} sessions · ${t.turns} turns · ` +
      `${t.crisesResolved} crises resolved${meanUnblock} · ` +
      `${t.kills.length} kills · ${t.bounces.length} bounces · ` +
      `${(t.outputTokens / 1000).toFixed(1)}k output tokens`
    );
  }

  private evaluateTraits(t: StaffTelemetry, now: number): void {
    // NIGHT OWL (see constant doc): >60% of ≥20 recorded turns at night.
    if (t.turns >= NIGHT_OWL_MIN_TURNS && t.nightTurns / t.turns > NIGHT_OWL_FRACTION) {
      this.earn(t.staffId, TRAIT_NIGHT_OWL, t.nightRefs, now);
    }
    // THE CLOSER (see constant doc): >5 sub-60s observed resolutions.
    if (t.fastResolutions > CLOSER_MIN_FAST_RESOLUTIONS) {
      this.earn(t.staffId, TRAIT_THE_CLOSER, t.fastRefs, now);
    }
    // BIG SPENDER (see constant doc): top-quartile cumulative burn among
    // ≥4 staff with recorded burn. Threshold = the burn of the staff at
    // the top-25% rank boundary (descending).
    const burns = Object.values(this.ensureLoaded().staff)
      .map((s) => s.outputTokens)
      .filter((b) => b > 0)
      .sort((a, b) => b - a);
    if (burns.length >= BIG_SPENDER_MIN_STAFF && t.outputTokens > 0) {
      const quartileIdx = Math.max(0, Math.ceil(burns.length * 0.25) - 1);
      if (t.outputTokens >= burns[quartileIdx]) {
        this.earn(t.staffId, TRAIT_BIG_SPENDER, t.burnRefs, now);
      }
    }
    // STEADY HANDS (see constant doc): ≥5 exits, 0 bounces, 0 kills in the
    // trailing 14 days.
    const windowStart = now - STEADY_HANDS_WINDOW_MS;
    const exitsInWindow = t.dispatchExits.filter((e) => e.ts >= windowStart);
    const bouncesInWindow = t.bounces.filter((e) => e.ts >= windowStart);
    const killsInWindow = t.kills.filter((e) => e.ts >= windowStart);
    if (
      exitsInWindow.length >= STEADY_HANDS_MIN_EXITS &&
      bouncesInWindow.length === 0 &&
      killsInWindow.length === 0
    ) {
      this.earn(
        t.staffId,
        TRAIT_STEADY_HANDS,
        exitsInWindow.slice(0, REF_CAP).map((e) => e.ref),
        now,
      );
    }
  }

  /** addTrait refuses duplicates ('already-earned') and evidence-less
   *  traits ('no-real-event-refs') — both are safe no-ops here. */
  private earn(staffId: string, name: string, earnedFrom: string[], now: number): void {
    if (earnedFrom.length === 0) return;
    this.dossiers.addTrait(staffId, { name, earnedFrom: [...earnedFrom], earnedAt: now });
  }

  private ensureLoaded(): TelemetryData {
    if (!this.data) {
      this.data = this.persistence.load((raw) => typeof raw.staff === 'object', emptyData);
    }
    return this.data;
  }
}

/** Process-wide instance (the server is single-process) — start() and the
 *  session/turn/crisis feeds are wired in httpServer.ts / hookEventHandler.ts. */
export const dossierDerivation = new DossierDerivation();
