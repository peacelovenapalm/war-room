/**
 * Pure helpers + types for the SHIFT panel's MORNING fold (v4 T7 — "War
 * Room IS morning": SHIFT absorbs the daily-digest summary + todo top-3,
 * both sourced from the existing GET /api/briefing path
 * (briefingProvider.ts on the server).
 */

export interface MorningTodo {
  date: string;
  startNow: string[];
}

export interface MorningDigest {
  date: string;
  flagsSummary: string;
  topStandingFlags: string[];
}

/** The subset of GET /api/briefing's response the MORNING fold reads —
 *  a structural subtype of the full Briefing shape (BriefingPanel.tsx
 *  duplicates the same fields for its own panel; both read one endpoint). */
export interface MorningBriefing {
  todo: MorningTodo | null;
  digest: MorningDigest | null;
}

/** YYYY-MM-DD in local time, zero-padded — the same shape todo-compiler
 *  and daily-digest name their files with. */
export function todayDateString(now: number = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${String(y)}-${m}-${day}`;
}

/** Whole-day age between a YYYY-MM-DD source date and now's local date —
 *  null when the string doesn't parse (never throws on a malformed date). */
export function daysStale(dateStr: string, now: number = Date.now()): number | null {
  const source = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(source.getTime())) return null;
  const today = new Date(`${todayDateString(now)}T00:00:00`);
  const diffMs = today.getTime() - source.getTime();
  return Math.round(diffMs / 86_400_000);
}

/** Colorblind rule: shape (◷) + word (STALE) carry the signal, not color.
 *  A source dated today or in the future is never stale. */
export function isMorningSourceStale(dateStr: string, now: number = Date.now()): boolean {
  const days = daysStale(dateStr, now);
  return days !== null && days > 0;
}
