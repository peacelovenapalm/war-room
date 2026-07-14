/**
 * Pure logic for the DISTRICTS view (Phase 5 Lane C, T7/D-35 "districts =
 * projects") — kept separate from the rendering/component so the phase
 * glyph, floor-count, and progress-label mapping are independently
 * unit-testable. Types mirror server/src/districtsProvider.ts's shapes
 * (same duplication discipline as graphFacts.ts — never imported across
 * the client/server boundary).
 */

export interface DistrictProject {
  key: string;
  label: string;
  phase: string | null;
  progress: number | null;
  lastActivity: string | null;
  source: string;
}

export interface DistrictsSnapshot {
  projects: DistrictProject[];
}

export const DISTRICTS_POLL_MS = 45_000;

export const MIN_FLOORS = 1;
export const MAX_FLOORS = 4;

/** Progress -> floor count (colorblind hard rule: HEIGHT/shape is the real
 *  signal, never a color alone). null (unknown state) and 0 both render as
 *  the minimum single-floor foundation — the DOM plaque + unknown palette
 *  (constants.ts) is what tells them apart, not the height. */
export function progressToFloors(progress: number | null): number {
  if (progress === null) return MIN_FLOORS;
  const clamped = Math.min(1, Math.max(0, progress));
  return MIN_FLOORS + Math.round(clamped * (MAX_FLOORS - MIN_FLOORS));
}

/** Shape+text status glyph — never color alone (colorblind hard rule).
 *  '?' unknown (no data), '○' not started, '◷' in progress, '✓' complete. */
export function districtStatusGlyph(progress: number | null): string {
  if (progress === null) return '?';
  if (progress <= 0) return '○';
  if (progress >= 1) return '✓';
  return '◷';
}

/** Plain-text progress label for the DOM plaque — never a bare fabricated
 *  number when the source is honestly unknown. */
export function formatDistrictProgress(progress: number | null): string {
  if (progress === null) return 'UNKNOWN';
  return `${String(Math.round(Math.min(1, Math.max(0, progress)) * 100))}%`;
}

/** Info-card phase line — falls back to an honest placeholder rather than
 *  a blank line when the parser found no phase label. */
export function formatDistrictPhase(phase: string | null): string {
  return phase && phase.length > 0 ? phase : 'no phase data';
}

export function formatDistrictActivity(lastActivity: string | null): string {
  return lastActivity && lastActivity.length > 0 ? lastActivity : 'no recorded activity';
}

/** Minor finding: a 2-month-old "Last activity" timestamp rendered with no
 *  staleness signal — the raw ISO string reads as fresh unless you do the
 *  math yourself. Past this window, a district's last-activity fact is
 *  flagged STALE (shape+word, colorblind hard rule) rather than silently
 *  trusted. 14 days: long enough that a normal multi-day pause between
 *  milestones doesn't false-positive, short enough to actually catch a
 *  genuinely abandoned district (the reported case was ~2 months). */
export const DISTRICT_STALE_MS = 14 * 24 * 60 * 60 * 1000;

/** true when `lastActivity` parses and is older than DISTRICT_STALE_MS.
 *  An absent/unparseable timestamp is NOT "stale" — that's the separate
 *  "no recorded activity" honest-omission case above, never conflated with
 *  "old data". */
export function isDistrictStale(lastActivity: string | null, now: number): boolean {
  if (!lastActivity) return false;
  const ts = Date.parse(lastActivity);
  if (Number.isNaN(ts)) return false;
  return now - ts > DISTRICT_STALE_MS;
}

/** Human-readable age for the STALE badge — "2mo ago" / "16d ago" / "3h
 *  ago" — distinct from formatAge's mm:ss timer format (state/crisis.ts),
 *  which is built for minutes/hours, not the weeks-to-months range a
 *  district's last activity can honestly span. */
export function formatDistrictAge(lastActivity: string | null, now: number): string {
  if (!lastActivity) return '—';
  const ts = Date.parse(lastActivity);
  if (Number.isNaN(ts)) return '—';
  const ms = Math.max(0, now - ts);
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 60) return `${String(Math.floor(days / 30))}mo ago`;
  if (days >= 1) return `${String(days)}d ago`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${String(hours)}h ago`;
  return '<1h ago';
}

/** true when the provider had no configured/readable STATE.md for this
 *  project (server's source:'unknown' sentinel) — drives the
 *  desaturated-placeholder palette and an explicit "NO DATA" plaque line. */
export function isDistrictUnknown(project: DistrictProject): boolean {
  return project.source === 'unknown';
}

/** Fetch the districts snapshot. Never throws — a network/parse failure
 *  returns null so the caller can render an honest "can't reach the
 *  server" state instead of a stale or fabricated one. */
export async function fetchDistricts(): Promise<DistrictsSnapshot | null> {
  try {
    const res = await fetch('/api/districts');
    if (!res.ok) return null;
    return (await res.json()) as DistrictsSnapshot;
  } catch {
    return null;
  }
}
