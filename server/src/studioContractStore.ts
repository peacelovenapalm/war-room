/**
 * Studio contract store (v3 WS-C — KICKOFF-v3.1 §1 "Aging contracts",
 * STAGE 1 SKELETON). Real vault todo lines become wall contracts:
 * offered → accepted → progressing → completed, or QUIET expiry.
 *
 * Distinct from contractStore.ts (v2 mechanic G4) — that plane, its
 * payouts, and its routes stay untouched; this store speaks the new
 * `contractsUpdated` wire schema (core/asyncapi.yaml StudioContract).
 *
 * Hard rules enforced HERE, at the mutation surface:
 *  - Real-signal only: nothing in this file invents contracts — every
 *    mint call carries a verbatim `sourceTodo` {file, line, text} and the
 *    ingest loop (stage 2, WAR_ROOM_TODO_DIR) is the only intended caller.
 *  - One-tap-real: progress events REQUIRE a non-empty sourceRef; a bare
 *    progress bump with no traceable source is rejected, not stored.
 *  - No dark patterns: rewards are bonus-only (negative rewards rejected),
 *    expiry is QUIET — sweepQuietExpiry() flips status and broadcasts so
 *    the UI can drop the card, but there is NO penalty hook, NO
 *    notification hook, and nothing here to attach one to.
 *
 * Persisted via the shared v3 sidecar discipline (v3Persistence.ts) at
 * ~/.pixel-agents/studio-contracts.json.
 */

import { randomUUID } from 'crypto';

import type {
  StudioContract,
  StudioContractProgressEvent,
  StudioContractSourceTodo,
} from '../../core/src/messages.js';
import { V3JsonPersistence } from './v3Persistence.js';

const FILE_NAME = 'studio-contracts.json';

export type StudioContractResult =
  | { ok: true; contract: StudioContract }
  | { ok: false; reason: string };

interface StudioContractData {
  contracts: Record<string, StudioContract>;
}

function emptyData(): StudioContractData {
  return { contracts: {} };
}

/** Identity of the underlying todo line for re-mint dedupe — normalized
 *  text, never the raw line (whitespace drift must not double-mint). */
function sourceKey(sourceTodo: StudioContractSourceTodo): string {
  return sourceTodo.text.trim().toLowerCase().replace(/\s+/g, ' ');
}

const OPEN_STATUSES: ReadonlySet<StudioContract['status']> = new Set([
  'offered',
  'accepted',
  'progressing',
]);

const DAY_MS = 86_400_000;
/** Re-mint cooldown for a terminal (completed/expired) contract's source
 *  text — mirrors studioContractIngest.ts's MIN_WINDOW_DAYS (the shortest
 *  quiet-expiry window this plane ever grants). Without this, a todo whose
 *  normalized text recurs (e.g. it disappears from tomorrow's compiled
 *  list, auto-completes+pays, then reappears) can mint-and-pay repeatedly
 *  with zero cap — the OPEN-only dedup below only prevents a DOUBLE mint
 *  of the same still-open contract, not a farmable re-mint of one that
 *  already paid out. */
const REMINT_COOLDOWN_MS = 7 * DAY_MS;

function terminalAt(contract: StudioContract): number | undefined {
  return contract.completedAt ?? contract.expiredAt;
}

/** Guarded Record lookup — dunder ids (__proto__, constructor, …) must
 *  resolve to undefined, not Object.prototype members, so the not-found
 *  guards on player-suppliable :id params stay sound. */
function ownRecord<T>(rec: Record<string, T>, id: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(rec, id) ? rec[id] : undefined;
}

export class StudioContractStore {
  private data: StudioContractData | null = null;
  private readonly persistence: V3JsonPersistence<StudioContractData>;
  private listeners: Array<(contract: StudioContract) => void> = [];

  constructor(persistPath?: string) {
    this.persistence = new V3JsonPersistence(FILE_NAME, persistPath);
  }

  /** Fired once per contract mutation (mint/accept/progress/complete/expire). */
  onChange(listener: (contract: StudioContract) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ── Reads ──────────────────────────────────────────────────────────

  getAll(): StudioContract[] {
    return Object.values(this.ensureLoaded().contracts);
  }

  getById(id: string): StudioContract | undefined {
    return ownRecord(this.ensureLoaded().contracts, id);
  }

  /** Non-terminal contracts — the WS connect replay set. */
  getActive(): StudioContract[] {
    return this.getAll().filter((c) => OPEN_STATUSES.has(c.status));
  }

  /** Source-data flag input (v3Flags.ts): any record ever derived. */
  hasRecords(): boolean {
    return Object.keys(this.ensureLoaded().contracts).length > 0;
  }

  // ── Mutations ──────────────────────────────────────────────────────

  /** Mint an `offered` contract from a REAL todo line. Idempotent under
   *  re-ingest: an open contract for the same normalized source text is
   *  returned as-is, never double-minted. Rejects negative rewards
   *  (bonus-only rule) and blank source text (nothing real to derive from). */
  mintFromTodo(
    sourceTodo: StudioContractSourceTodo,
    reward: number,
    quietExpiryAt: number,
    now: number = Date.now(),
  ): StudioContractResult {
    if (sourceTodo.text.trim() === '') return { ok: false, reason: 'empty-source-text' };
    if (reward < 0) return { ok: false, reason: 'negative-reward' };
    const data = this.ensureLoaded();
    const key = sourceKey(sourceTodo);
    const existing = Object.values(data.contracts).find(
      (c) => OPEN_STATUSES.has(c.status) && sourceKey(c.sourceTodo) === key,
    );
    if (existing) return { ok: true, contract: existing };

    // Terminal-cooldown dedup: a contract for this exact normalized text
    // that already completed/expired recently is returned as-is (no new
    // mint, no re-broadcast, no re-payout) rather than farmable forever.
    const recentTerminal = Object.values(data.contracts).find((c) => {
      if (OPEN_STATUSES.has(c.status) || sourceKey(c.sourceTodo) !== key) return false;
      const at = terminalAt(c);
      return at !== undefined && now - at < REMINT_COOLDOWN_MS;
    });
    if (recentTerminal) return { ok: true, contract: recentTerminal };

    const contract: StudioContract = {
      id: randomUUID(),
      sourceTodo,
      status: 'offered',
      progress: [],
      reward,
      quietExpiryAt,
    };
    data.contracts[contract.id] = contract;
    this.finish(contract, now);
    return { ok: true, contract };
  }

  /** Player accepts an offered contract. */
  accept(id: string, now: number = Date.now()): StudioContractResult {
    const contract = ownRecord(this.ensureLoaded().contracts, id);
    if (!contract) return { ok: false, reason: 'not-found' };
    if (contract.status !== 'offered') return { ok: false, reason: 'not-offered' };
    contract.status = 'accepted';
    contract.acceptedAt = now;
    this.finish(contract, now);
    return { ok: true, contract };
  }

  /** Append one REAL observed progress event. Rejects events with an empty
   *  sourceRef or summary — the one-tap-real enforcement point. */
  recordProgress(id: string, event: StudioContractProgressEvent): StudioContractResult {
    if (event.sourceRef.trim() === '') return { ok: false, reason: 'missing-source-ref' };
    if (event.summary.trim() === '') return { ok: false, reason: 'missing-summary' };
    const contract = ownRecord(this.ensureLoaded().contracts, id);
    if (!contract) return { ok: false, reason: 'not-found' };
    if (contract.status !== 'accepted' && contract.status !== 'progressing') {
      return { ok: false, reason: 'not-accepted' };
    }
    contract.progress.push(event);
    contract.status = 'progressing';
    this.finish(contract, event.ts);
    return { ok: true, contract };
  }

  complete(id: string, now: number = Date.now()): StudioContractResult {
    const contract = ownRecord(this.ensureLoaded().contracts, id);
    if (!contract) return { ok: false, reason: 'not-found' };
    if (!OPEN_STATUSES.has(contract.status)) return { ok: false, reason: 'not-open' };
    contract.status = 'completed';
    contract.completedAt = now;
    this.finish(contract, now);
    return { ok: true, contract };
  }

  /** QUIET expiry sweep: open contracts past quietExpiryAt flip to
   *  `expired` and broadcast (so the UI drops the card) — deliberately NO
   *  penalty and NO notification hook exists here (no-dark-pattern rule:
   *  no loss-aversion, no streak shame). Returns the count swept. */
  sweepQuietExpiry(now: number = Date.now()): number {
    const data = this.ensureLoaded();
    let count = 0;
    for (const contract of Object.values(data.contracts)) {
      if (!OPEN_STATUSES.has(contract.status)) continue;
      if (now < contract.quietExpiryAt) continue;
      contract.status = 'expired';
      contract.expiredAt = now;
      this.finish(contract, now);
      count++;
    }
    return count;
  }

  // ── Internal ──────────────────────────────────────────────────────

  private finish(contract: StudioContract, now: number): void {
    this.persistence.persist(this.ensureLoaded(), now, true);
    for (const listener of this.listeners) listener(contract);
  }

  private ensureLoaded(): StudioContractData {
    if (!this.data) {
      this.data = this.persistence.load((raw) => typeof raw.contracts === 'object', emptyData);
    }
    return this.data;
  }
}

/** Process-wide instance (the server is single-process). */
export const studioContractStore = new StudioContractStore();
