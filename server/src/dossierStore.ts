/**
 * Staff dossier store (v3 WS-C — KICKOFF-v3.1 §3 "dossier", STAGE 1
 * SKELETON). Persistent per-staff identity files: displayName, earned
 * traits, history summary, portrait reference.
 *
 * Identity: `staffId` is the stable (machine, projectDir)-lineage key —
 * the SAME `MACHINE:project-slug[#n]` algorithm core/src/employeeId.ts +
 * employeeStore.ts already use, so dossier and roster never drift. This
 * store does not compute ids itself; stage-2 wiring derives them from the
 * employee plane's real telemetry.
 *
 * Hard rules enforced HERE:
 *  - One-tap-real: a trait REQUIRES ≥1 `earnedFrom` real-event reference;
 *    addTrait rejects a trait with none — an unreferenced trait cannot
 *    exist.
 *  - Traits are permanent once earned (no removal API) — the same
 *    never-revert posture progressionStore's unlocks hold.
 *
 * Persisted via the shared v3 sidecar discipline (v3Persistence.ts) at
 * ~/.pixel-agents/dossiers.json.
 */

import type { DossierTrait, StaffDossier } from '../../core/src/messages.js';
import { V3JsonPersistence } from './v3Persistence.js';

const FILE_NAME = 'dossiers.json';

export type DossierResult = { ok: true; dossier: StaffDossier } | { ok: false; reason: string };

interface DossierData {
  dossiers: Record<string, StaffDossier>;
}

function emptyData(): DossierData {
  return { dossiers: {} };
}

export class DossierStore {
  private data: DossierData | null = null;
  private readonly persistence: V3JsonPersistence<DossierData>;
  private listeners: Array<(dossier: StaffDossier) => void> = [];

  constructor(persistPath?: string) {
    this.persistence = new V3JsonPersistence(FILE_NAME, persistPath);
  }

  /** Fired once per dossier mutation (created, trait earned, history/portrait set). */
  onChange(listener: (dossier: StaffDossier) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ── Reads ──────────────────────────────────────────────────────────

  getAll(): StaffDossier[] {
    return Object.values(this.ensureLoaded().dossiers);
  }

  get(staffId: string): StaffDossier | undefined {
    return this.ensureLoaded().dossiers[staffId];
  }

  /** Source-data flag input (v3Flags.ts). */
  hasRecords(): boolean {
    return Object.keys(this.ensureLoaded().dossiers).length > 0;
  }

  // ── Mutations ──────────────────────────────────────────────────────

  /** Create-if-missing (idempotent). An existing dossier is returned
   *  untouched — ensure() never resets earned traits or history. */
  ensure(staffId: string, displayName: string, now: number = Date.now()): DossierResult {
    if (staffId.trim() === '') return { ok: false, reason: 'empty-staff-id' };
    const data = this.ensureLoaded();
    const existing = data.dossiers[staffId];
    if (existing) return { ok: true, dossier: existing };
    const dossier: StaffDossier = { staffId, displayName, traits: [], history: '' };
    data.dossiers[staffId] = dossier;
    this.finish(dossier, now, true);
    return { ok: true, dossier };
  }

  /** Earn a trait. Rejects a trait with zero earnedFrom refs (one-tap-real)
   *  and dedupes by trait name — earning the same trait twice is a refusal,
   *  never a duplicate entry. */
  addTrait(staffId: string, trait: DossierTrait): DossierResult {
    if (trait.earnedFrom.length === 0 || trait.earnedFrom.every((ref) => ref.trim() === '')) {
      return { ok: false, reason: 'no-real-event-refs' };
    }
    const dossier = this.ensureLoaded().dossiers[staffId];
    if (!dossier) return { ok: false, reason: 'not-found' };
    if (dossier.traits.some((t) => t.name === trait.name)) {
      return { ok: false, reason: 'already-earned' };
    }
    dossier.traits.push(trait);
    this.finish(dossier, trait.earnedAt, true);
    return { ok: true, dossier };
  }

  /** Replace the computed history summary (stage 2 recomputes from real
   *  telemetry; the store just holds the latest read). THROTTLED persist:
   *  the history line changes on every recorded turn (hook Stop hot path)
   *  and re-derives from telemetry — same 5s-throttle discipline as
   *  economyStore/shiftStats on that call site. */
  setHistory(staffId: string, history: string, now: number = Date.now()): DossierResult {
    const dossier = this.ensureLoaded().dossiers[staffId];
    if (!dossier) return { ok: false, reason: 'not-found' };
    dossier.history = history;
    this.finish(dossier, now, false);
    return { ok: true, dossier };
  }

  /** Attach the generated-portrait asset reference (WS-B lane). */
  setPortraitRef(staffId: string, portraitRef: string, now: number = Date.now()): DossierResult {
    const dossier = this.ensureLoaded().dossiers[staffId];
    if (!dossier) return { ok: false, reason: 'not-found' };
    dossier.portraitRef = portraitRef;
    this.finish(dossier, now, true);
    return { ok: true, dossier };
  }

  // ── Internal ──────────────────────────────────────────────────────

  /** `force` = write through the 5s persist throttle. TRUE for the rare,
   *  permanence-critical mutations (create, trait earn, portrait — a
   *  trait is permanent and must survive an immediate crash); FALSE for
   *  the per-turn history refresh (re-derived from telemetry anyway). */
  private finish(dossier: StaffDossier, now: number, force: boolean): void {
    this.persistence.persist(this.ensureLoaded(), now, force);
    for (const listener of this.listeners) listener(dossier);
  }

  private ensureLoaded(): DossierData {
    if (!this.data) {
      this.data = this.persistence.load((raw) => typeof raw.dossiers === 'object', emptyData);
    }
    return this.data;
  }
}

/** Process-wide instance (the server is single-process). */
export const dossierStore = new DossierStore();
