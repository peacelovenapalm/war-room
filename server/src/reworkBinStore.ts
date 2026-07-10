/**
 * Scrap & Rework Bin store (v3 failure loop — KICKOFF-v3.1 §1, STAGE 1
 * SKELETON). Real failures (failed/killed dispatches, terminal crises)
 * pile as visible crates until reworked or dismissed.
 *
 * Hard rules enforced HERE:
 *  - Real-signal only: pile() REQUIRES a failureRef with the source
 *    record's id AND a verbatim excerpt of the failure output — the bin
 *    never invents work, and every crate decomposes to real telemetry
 *    (one-tap-real). Excerpts are capped server-side
 *    (REWORK_EXCERPT_MAX_CHARS), same posture as DispatchUpdate.resultTail.
 *  - Dismiss is a FIRST-CLASS verb (without it the bin is nagware —
 *    Greg's explicit requirement). The optional reason is data, never a
 *    guilt prompt.
 *  - Never weakens the safety net: rework re-dispatch goes through the
 *    NORMAL dispatch confirm flow at the route layer (stage 2); this
 *    store only records outcomes and can not spawn anything.
 *
 * Persisted via the shared v3 sidecar discipline (v3Persistence.ts) at
 * ~/.pixel-agents/rework-bin.json. Resolved crates are retained up to
 * REWORK_RESOLVED_RETENTION (oldest pruned); the durable failure record
 * stays the dispatch queue/audit log.
 */

import { randomUUID } from 'crypto';

import type { ReworkBinItem, ReworkFailureRef } from '../../core/src/messages.js';
import { V3JsonPersistence } from './v3Persistence.js';

const FILE_NAME = 'rework-bin.json';

/** Verbatim failure excerpt cap — same order as the dispatch resultTail cap. */
export const REWORK_EXCERPT_MAX_CHARS = 2048;
/** Resolved (reworked/dismissed) crates retained before pruning. */
export const REWORK_RESOLVED_RETENTION = 200;

export type ReworkBinResult = { ok: true; item: ReworkBinItem } | { ok: false; reason: string };

interface ReworkBinData {
  items: Record<string, ReworkBinItem>;
}

function emptyData(): ReworkBinData {
  return { items: {} };
}

export class ReworkBinStore {
  private data: ReworkBinData | null = null;
  private readonly persistence: V3JsonPersistence<ReworkBinData>;
  private listeners: Array<(item: ReworkBinItem) => void> = [];

  constructor(persistPath?: string) {
    this.persistence = new V3JsonPersistence(FILE_NAME, persistPath);
  }

  /** Fired once per crate mutation (piled, reworked, dismissed). */
  onChange(listener: (item: ReworkBinItem) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ── Reads ──────────────────────────────────────────────────────────

  getAll(): ReworkBinItem[] {
    return Object.values(this.ensureLoaded().items);
  }

  getById(id: string): ReworkBinItem | undefined {
    return this.ensureLoaded().items[id];
  }

  /** Crates still in the bin — the WS connect replay set. */
  getPiled(): ReworkBinItem[] {
    return this.getAll().filter((i) => i.status === 'piled');
  }

  /** Source-data flag input (v3Flags.ts): a failure was actually observed. */
  hasRecords(): boolean {
    return Object.keys(this.ensureLoaded().items).length > 0;
  }

  // ── Mutations ──────────────────────────────────────────────────────

  /** Pile a crate for a REAL observed failure. Rejects refs missing the
   *  source id or the verbatim excerpt; idempotent per (source, ref id)
   *  while piled — the same failure never stacks two crates. */
  pile(
    source: ReworkBinItem['source'],
    failureRef: ReworkFailureRef,
    now: number = Date.now(),
  ): ReworkBinResult {
    if (failureRef.id.trim() === '') return { ok: false, reason: 'missing-failure-id' };
    if (failureRef.excerpt.trim() === '') return { ok: false, reason: 'missing-failure-excerpt' };
    const data = this.ensureLoaded();
    const existing = Object.values(data.items).find(
      (i) => i.status === 'piled' && i.source === source && i.failureRef.id === failureRef.id,
    );
    if (existing) return { ok: true, item: existing };
    const item: ReworkBinItem = {
      id: randomUUID(),
      source,
      failureRef: {
        id: failureRef.id,
        excerpt: failureRef.excerpt.slice(-REWORK_EXCERPT_MAX_CHARS),
      },
      status: 'piled',
      createdAt: now,
    };
    data.items[item.id] = item;
    this.finish(item, now);
    return { ok: true, item };
  }

  /** Record that the crate was re-dispatched through the normal confirm
   *  flow (the route layer owns the actual dispatch; a failed re-dispatch
   *  simply piles a new crate from its own real failure). */
  markReworked(id: string, now: number = Date.now()): ReworkBinResult {
    return this.resolve(id, 'reworked', undefined, now);
  }

  /** The REQUIRED dismiss verb — a crate leaves the bin for good with no
   *  penalty and no follow-up. `reason` is optional operator data. */
  dismiss(id: string, reason?: string, now: number = Date.now()): ReworkBinResult {
    return this.resolve(id, 'dismissed', reason, now);
  }

  // ── Internal ──────────────────────────────────────────────────────

  private resolve(
    id: string,
    status: 'reworked' | 'dismissed',
    reason: string | undefined,
    now: number,
  ): ReworkBinResult {
    const item = this.ensureLoaded().items[id];
    if (!item) return { ok: false, reason: 'not-found' };
    if (item.status !== 'piled') return { ok: false, reason: 'not-piled' };
    item.status = status;
    item.resolvedAt = now;
    if (status === 'dismissed' && reason !== undefined && reason.trim() !== '') {
      item.dismissedReason = reason;
    }
    this.pruneResolved();
    this.finish(item, now);
    return { ok: true, item };
  }

  private pruneResolved(): void {
    const data = this.ensureLoaded();
    const resolved = Object.values(data.items)
      .filter((i) => i.status !== 'piled')
      .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));
    while (resolved.length > REWORK_RESOLVED_RETENTION) {
      const oldest = resolved.shift();
      if (oldest) delete data.items[oldest.id];
    }
  }

  private finish(item: ReworkBinItem, now: number): void {
    this.persistence.persist(this.ensureLoaded(), now, true);
    for (const listener of this.listeners) listener(item);
  }

  private ensureLoaded(): ReworkBinData {
    if (!this.data) {
      this.data = this.persistence.load((raw) => typeof raw.items === 'object', emptyData);
    }
    return this.data;
  }
}

/** Process-wide instance (the server is single-process). */
export const reworkBinStore = new ReworkBinStore();
