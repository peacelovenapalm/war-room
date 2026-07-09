/**
 * Day/night + seasons (v2 mechanic G4 — GAME-DESIGN.md §6.4) — pure
 * functions of `Date.now()`. Purely cosmetic flavor for G5's rendering
 * layer (lighting/tint, seasonal decor); never touches real Cash/Rep/
 * completion facts. One fictional holiday week (Dec 20-31), zero external
 * calendar reads, ever.
 */

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

/** Local wall-clock day phase. Boundaries: dawn 5-8, day 8-17, dusk 17-20,
 *  night 20-5 (24h local hour, inclusive start / exclusive end). */
export function getDayPhase(now: number = Date.now()): DayPhase {
  const hour = new Date(now).getHours();
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}

/** Meteorological quarters (not astronomical) — Dec/Jan/Feb = winter, etc. */
export function getSeason(now: number = Date.now()): Season {
  const month = new Date(now).getMonth(); // 0-11
  if (month === 11 || month === 0 || month === 1) return 'winter';
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  return 'autumn';
}

/** One fictional holiday week, Dec 20-31 local — the only calendar-flavor
 *  special case; zero external calendar reads. */
export function isHolidayWeek(now: number = Date.now()): boolean {
  const d = new Date(now);
  return d.getMonth() === 11 && d.getDate() >= 20 && d.getDate() <= 31;
}
