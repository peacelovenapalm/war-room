/**
 * Offline PARK primitive (V6-3 "offline actions PARK", V6-DESIGN §V6-3 /
 * Q41). Any morning-surface action taken while the transport is
 * disconnected lands in a visible, clearable PARKED DRAFTS list instead of
 * silently failing OR (worse) auto-firing once the connection returns.
 * Re-arming a parked draft always requires an explicit re-confirm tap --
 * this module never fires anything itself, it only records/clears.
 *
 * Generic across kinds so MORNING's own actions (today: refresh; future:
 * whatever gains a real mutation) and any later panel can reuse it without
 * inventing a second parking list. Persisted to localStorage (same
 * KeyValueStorage injection pattern as soundscape.ts) so a parked draft
 * survives a reload -- it's explicitly Greg's to clear or retry, never the
 * app's to lose silently on a refresh.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PARKED_DRAFTS_STORAGE_KEY = 'war-room-parked-drafts';
/** Bounds unbounded growth if a client stays offline for a long time and
 *  keeps generating parked actions -- oldest pruned first. */
export const PARKED_DRAFTS_MAX = 20;

export interface ParkedDraft {
  id: string;
  kind: string;
  label: string;
  createdAt: number;
}

function readAll(storage: KeyValueStorage | undefined): ParkedDraft[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PARKED_DRAFTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is ParkedDraft =>
        typeof d === 'object' &&
        d !== null &&
        typeof (d as ParkedDraft).id === 'string' &&
        typeof (d as ParkedDraft).kind === 'string' &&
        typeof (d as ParkedDraft).label === 'string' &&
        typeof (d as ParkedDraft).createdAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeAll(storage: KeyValueStorage | undefined, drafts: ParkedDraft[]): void {
  storage?.setItem(PARKED_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

export function listParkedDrafts(storage: KeyValueStorage | undefined): ParkedDraft[] {
  return readAll(storage);
}

/** Park a new draft (newest last). Never auto-fires -- the caller's own
 *  UI is what requires an explicit re-confirm tap before ever retrying
 *  the underlying action. */
export function parkDraft(
  storage: KeyValueStorage | undefined,
  draft: Omit<ParkedDraft, 'id' | 'createdAt'>,
  now: number = Date.now(),
): ParkedDraft {
  const entry: ParkedDraft = {
    ...draft,
    id: `${String(now)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
  };
  const drafts = [...readAll(storage), entry].slice(-PARKED_DRAFTS_MAX);
  writeAll(storage, drafts);
  return entry;
}

export function clearParkedDraft(storage: KeyValueStorage | undefined, id: string): void {
  writeAll(
    storage,
    readAll(storage).filter((d) => d.id !== id),
  );
}

export function clearAllParkedDrafts(storage: KeyValueStorage | undefined): void {
  writeAll(storage, []);
}
