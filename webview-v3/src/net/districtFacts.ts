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
