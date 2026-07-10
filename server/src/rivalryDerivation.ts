/**
 * Rivalry & Bond derivation (v3 WS-C STAGE 2 — KICKOFF-v3.1 §1 "emergence
 * anchor"). Feeds rivalryStore.ts from REAL overlap facts only:
 *
 * RIVALRIES (the genuine worktree-collision early warning — incident
 * 74d74e8's class made a mechanic):
 *  - SAME-CHECKOUT WARNING (activeWarning=true): two live agents on the
 *    same machine whose cwds nest (one is a path-prefix of the other) are
 *    provably operating inside ONE checkout — the exact failure mode that
 *    produced 74d74e8. Evidence carries both verbatim cwds + session ids.
 *  - SAME-PROJECT RIVALRY (activeWarning=false): live agents on DIFFERENT
 *    machines in checkouts sharing a directory basename — the "same repo,
 *    two machines, coordinate your merges" fact. A name-match heuristic,
 *    honestly labeled as such in the evidence string (the verbatim cwds
 *    let the human judge).
 *  - Known limitation (documented, not silently dropped): two agents in
 *    the LITERAL same cwd share one (machine, project) staff identity —
 *    the pair schema cannot represent a self-pair, so that case surfaces
 *    through the agent drawer, not this plane. Nested-cwd overlap (root +
 *    subdir of one checkout) IS representable and covered above.
 *
 * BONDS: repeated successful same-repo sequential collaboration — a
 * COMPLETED chain run where consecutive steps were dispatched to two
 * different staff identities counts one collaboration for that pair
 * (evidence ref = the real run + step handoff). At
 * BOND_COLLABORATION_THRESHOLD the pair becomes a bond.
 *
 * PRIORITY (never weaken the safety net): an activeWarning rivalry is a
 * live ops signal and always outranks flavor — a bond or soft rivalry
 * NEVER overwrites a pair while its warning is active. Warnings clear via
 * setWarning(false) when the live overlap disappears (the pair itself is
 * retained as history).
 *
 * Collaboration counters persist via the shared v3 sidecar discipline at
 * ~/.pixel-agents/rivalry-collab.json.
 */

import * as path from 'path';

import { employeeId } from '../../core/src/employeeId.js';
import type { ChainRun } from './chainStore.js';
import { ChainStore, chainStore } from './chainStore.js';
import { DispatchStore, dispatchStore } from './dispatchStore.js';
import { pairKey, RivalryStore, rivalryStore } from './rivalryStore.js';
import { V3JsonPersistence } from './v3Persistence.js';

const FILE_NAME = 'rivalry-collab.json';

/** Completed-run collaborations before a pair becomes a bond. */
export const BOND_COLLABORATION_THRESHOLD = 3;
/** Live-overlap sweep cadence (httpServer.ts's timer). */
export const RIVALRY_SWEEP_INTERVAL_MS = 30_000;

/** Evidence/bookkeeping ring caps. */
const REF_CAP = 10;
const COUNTED_RUNS_CAP = 50;

/** The slice of AgentState this module reads (live-overlap sweep input). */
export interface LiveAgentView {
  machine?: string;
  projectDir?: string;
  sessionId: string;
}

interface CollabEntry {
  staffIds: [string, string];
  count: number;
  refs: string[];
  countedRuns: string[];
}

interface CollabData {
  pairs: Record<string, CollabEntry>;
}

function emptyData(): CollabData {
  return { pairs: {} };
}

/** b lives strictly INSIDE a's checkout (path-boundary-aware prefix). */
function containsPath(a: string, b: string): boolean {
  if (a === b) return false;
  const prefix = a.endsWith('/') ? a : `${a}/`;
  return b.startsWith(prefix);
}

export class RivalryDerivation {
  private data: CollabData | null = null;
  private readonly persistence: V3JsonPersistence<CollabData>;
  private readonly rivalries: RivalryStore;
  private readonly chains: Pick<ChainStore, 'onRunUpdate'>;
  private readonly dispatch: Pick<DispatchStore, 'getRecord'>;
  private subscribed = false;

  constructor(
    rivalries: RivalryStore = rivalryStore,
    chains: Pick<ChainStore, 'onRunUpdate'> = chainStore,
    dispatch: Pick<DispatchStore, 'getRecord'> = dispatchStore,
    persistPath?: string,
  ) {
    this.rivalries = rivalries;
    this.chains = chains;
    this.dispatch = dispatch;
    this.persistence = new V3JsonPersistence(FILE_NAME, persistPath);
  }

  /** Subscribe the completed-run collaboration feed. Idempotent — call
   *  exactly once at process startup (chainOrchestrator discipline). */
  start(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.chains.onRunUpdate((run) => {
      if (run.status === 'completed') this.recordCollaboration(run);
    });
  }

  /**
   * A chain run COMPLETED — count one collaboration per distinct staff
   * pair that handed work off between consecutive steps (staff resolved
   * from each step's real dispatch record). Deduped per run per pair;
   * failed/halted runs never count ("successful" is load-bearing).
   */
  recordCollaboration(run: ChainRun, now: number = Date.now()): void {
    if (run.status !== 'completed') return;
    const staffOfStep: Array<string | undefined> = run.steps.map((step) => {
      if (!step.dispatchId) return undefined;
      const record = this.dispatch.getRecord(step.dispatchId);
      if (!record?.cwd) return undefined;
      return employeeId(record.machine, record.cwd);
    });

    const data = this.ensureLoaded();
    let changed = false;
    for (let k = 0; k + 1 < staffOfStep.length; k++) {
      const a = staffOfStep[k];
      const b = staffOfStep[k + 1];
      if (!a || !b || a === b) continue;
      const key = pairKey([a, b]);
      let entry = data.pairs[key];
      if (!entry) {
        entry = {
          staffIds: [a, b].sort() as [string, string],
          count: 0,
          refs: [],
          countedRuns: [],
        };
        data.pairs[key] = entry;
      }
      if (entry.countedRuns.includes(run.id)) continue;
      entry.countedRuns.push(run.id);
      if (entry.countedRuns.length > COUNTED_RUNS_CAP) {
        entry.countedRuns.splice(0, entry.countedRuns.length - COUNTED_RUNS_CAP);
      }
      entry.count++;
      entry.refs.push(`chainRun:${run.id}#step${k + 1}->step${k + 2}`);
      if (entry.refs.length > REF_CAP) entry.refs.splice(0, entry.refs.length - REF_CAP);
      changed = true;

      if (entry.count >= BOND_COLLABORATION_THRESHOLD) {
        // Priority rule (file header): never overwrite a live warning.
        const existing = this.rivalries.get(entry.staffIds);
        if (!existing?.activeWarning) {
          this.rivalries.upsert(entry.staffIds, 'bond', [...entry.refs], false, now);
        }
      }
    }
    if (changed) this.persistence.persist(data, now, true);
  }

  /**
   * One live-overlap sweep over the CURRENT agent population (httpServer's
   * 30s timer). Derives warnings/rivalries from real live cwds, and clears
   * (setWarning false) any stored warning whose overlap is gone.
   */
  sweepLiveOverlap(
    agents: Iterable<LiveAgentView>,
    localMachineLabel: string | undefined,
    now: number = Date.now(),
  ): void {
    // One entry per distinct staff identity (two sessions in the LITERAL
    // same cwd collapse to one entry — the documented self-pair limitation).
    const byStaff = new Map<
      string,
      { staffId: string; machine: string; cwd: string; sessionId: string }
    >();
    for (const agent of agents) {
      if (!agent.projectDir) continue;
      const machine = agent.machine ?? localMachineLabel ?? 'LOCAL';
      const staffId = employeeId(agent.machine ?? localMachineLabel, agent.projectDir);
      if (!byStaff.has(staffId)) {
        byStaff.set(staffId, {
          staffId,
          machine,
          cwd: agent.projectDir,
          sessionId: agent.sessionId,
        });
      }
    }

    const entries = [...byStaff.values()];
    const warnedKeys = new Set<string>();

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        if (a.machine === b.machine && (containsPath(a.cwd, b.cwd) || containsPath(b.cwd, a.cwd))) {
          // Provably one checkout: nested live cwds on one machine.
          const [outer, inner] = containsPath(a.cwd, b.cwd) ? [a, b] : [b, a];
          const key = pairKey([a.staffId, b.staffId]);
          warnedKeys.add(key);
          this.rivalries.upsert(
            [a.staffId, b.staffId],
            'rivalry',
            [
              `⚠ ${outer.machine}: two live agents in one checkout — ` +
                `${outer.cwd} (session ${outer.sessionId.slice(0, 8)}) contains ` +
                `${inner.cwd} (session ${inner.sessionId.slice(0, 8)})`,
            ],
            true,
            now,
          );
        } else if (
          a.machine !== b.machine &&
          path.basename(a.cwd) === path.basename(b.cwd) &&
          path.basename(a.cwd) !== ''
        ) {
          // Name-match heuristic, honestly labeled; never overwrites a
          // warned or bonded pair (priority rule in the file header).
          const existing = this.rivalries.get([a.staffId, b.staffId]);
          if (existing?.activeWarning || existing?.kind === 'bond') continue;
          this.rivalries.upsert(
            [a.staffId, b.staffId],
            'rivalry',
            [
              `same project name live on two machines (basename match) — ` +
                `${a.machine}:${a.cwd} (session ${a.sessionId.slice(0, 8)}) and ` +
                `${b.machine}:${b.cwd} (session ${b.sessionId.slice(0, 8)})`,
            ],
            false,
            now,
          );
        }
      }
    }

    // Clear warnings whose live overlap is gone — the pair is retained as
    // history, only the live signal drops (setWarning is silent when
    // already false).
    for (const pair of this.rivalries.getAll()) {
      if (!pair.activeWarning) continue;
      const key = pairKey([pair.staffIds[0], pair.staffIds[1]]);
      if (!warnedKeys.has(key)) {
        this.rivalries.setWarning([pair.staffIds[0], pair.staffIds[1]], false, now);
      }
    }
  }

  private ensureLoaded(): CollabData {
    if (!this.data) {
      this.data = this.persistence.load((raw) => typeof raw.pairs === 'object', emptyData);
    }
    return this.data;
  }
}

/** Process-wide instance (the server is single-process) — start() + the
 *  sweep timer are wired once in httpServer.ts's createHttpServer(). */
export const rivalryDerivation = new RivalryDerivation();
