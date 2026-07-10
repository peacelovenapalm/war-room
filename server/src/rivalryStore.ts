/**
 * Rivalries & Bonds store (v3 emergence anchor — KICKOFF-v3.1 §1, STAGE 1
 * SKELETON). Relationship strings derived from REAL worktree/repo overlap
 * facts between staff; `activeWarning` doubles as the GENUINE
 * worktree-collision early warning (incident 74d74e8's lesson made a
 * mechanic — real ops signal wearing a costume, never flavor).
 *
 * Hard rules enforced HERE:
 *  - Real-signal only: upsert() REQUIRES non-empty evidence — each entry
 *    a verbatim overlap fact (e.g. two live agent cwds resolving into the
 *    same repo). No evidence, no relationship.
 *  - Pair identity is the SORTED staffId tuple (employeeId.ts lineage
 *    keys) — the same pair never exists twice under swapped order.
 *  - Change-detected broadcast: re-deriving identical facts is silent
 *    (no listener spam from the stage-2 derivation loop re-running).
 *
 * Persisted via the shared v3 sidecar discipline (v3Persistence.ts) at
 * ~/.pixel-agents/rivalries.json.
 */

import type { RelationshipPair } from '../../core/src/messages.js';
import { V3JsonPersistence } from './v3Persistence.js';

const FILE_NAME = 'rivalries.json';

export type RivalryResult = { ok: true; pair: RelationshipPair } | { ok: false; reason: string };

interface RivalryData {
  pairs: Record<string, RelationshipPair>;
}

function emptyData(): RivalryData {
  return { pairs: {} };
}

/** Stable pair key — sorted ids, order-independent. */
export function pairKey(staffIds: readonly [string, string]): string {
  return [...staffIds].sort().join('|');
}

export class RivalryStore {
  private data: RivalryData | null = null;
  private readonly persistence: V3JsonPersistence<RivalryData>;
  private listeners: Array<(pair: RelationshipPair) => void> = [];

  constructor(persistPath?: string) {
    this.persistence = new V3JsonPersistence(FILE_NAME, persistPath);
  }

  /** Fired once per ACTUAL pair change (created, kind/evidence/warning changed). */
  onChange(listener: (pair: RelationshipPair) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ── Reads ──────────────────────────────────────────────────────────

  getAll(): RelationshipPair[] {
    return Object.values(this.ensureLoaded().pairs);
  }

  get(staffIds: readonly [string, string]): RelationshipPair | undefined {
    return this.ensureLoaded().pairs[pairKey(staffIds)];
  }

  /** Source-data flag input (v3Flags.ts). */
  hasRecords(): boolean {
    return Object.keys(this.ensureLoaded().pairs).length > 0;
  }

  // ── Mutations ──────────────────────────────────────────────────────

  /** Create or update a pair from freshly derived overlap facts. Rejects
   *  empty/duplicate ids and empty evidence. Broadcasts ONLY when the
   *  stored pair actually changed. */
  upsert(
    staffIds: readonly [string, string],
    kind: RelationshipPair['kind'],
    evidence: string[],
    activeWarning: boolean,
    now: number = Date.now(),
  ): RivalryResult {
    const [a, b] = staffIds;
    if (a.trim() === '' || b.trim() === '') return { ok: false, reason: 'empty-staff-id' };
    if (a === b) return { ok: false, reason: 'self-pair' };
    const realEvidence = evidence.filter((e) => e.trim() !== '');
    if (realEvidence.length === 0) return { ok: false, reason: 'no-evidence' };

    const data = this.ensureLoaded();
    const key = pairKey(staffIds);
    const next: RelationshipPair = {
      staffIds: [...staffIds].sort(),
      kind,
      evidence: realEvidence,
      activeWarning,
    };
    const existing = data.pairs[key];
    if (existing && JSON.stringify(existing) === JSON.stringify(next)) {
      return { ok: true, pair: existing };
    }
    data.pairs[key] = next;
    this.finish(next, now);
    return { ok: true, pair: next };
  }

  /** Flip only the collision warning (the live-overlap edge is cheaper to
   *  re-derive than the full evidence set). Silent when already in the
   *  requested state. */
  setWarning(
    staffIds: readonly [string, string],
    active: boolean,
    now: number = Date.now(),
  ): RivalryResult {
    const pair = this.ensureLoaded().pairs[pairKey(staffIds)];
    if (!pair) return { ok: false, reason: 'not-found' };
    if (pair.activeWarning === active) return { ok: true, pair };
    pair.activeWarning = active;
    this.finish(pair, now);
    return { ok: true, pair };
  }

  // ── Internal ──────────────────────────────────────────────────────

  private finish(pair: RelationshipPair, now: number): void {
    this.persistence.persist(this.ensureLoaded(), now, true);
    for (const listener of this.listeners) listener(pair);
  }

  private ensureLoaded(): RivalryData {
    if (!this.data) {
      this.data = this.persistence.load((raw) => typeof raw.pairs === 'object', emptyData);
    }
    return this.data;
  }
}

/** Process-wide instance (the server is single-process). */
export const rivalryStore = new RivalryStore();
