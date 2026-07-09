/**
 * Calendar mapping (v2 mechanic G5, BUILD-PLAN.md §G5 task 3) — season
 * (meteorological quarters) and the one fictional holiday week (Dec 20-31),
 * pure functions of a timestamp. Zero external calendar reads, ever.
 *
 * Server can't import webview-ui files (same constraint buildingBuffs.ts
 * documents for furnitureBuffs.ts), so this is a small, intentional mirror
 * of webview-ui/src/office/dayNight.ts's getSeason()/isHolidayWeek() logic
 * — kept in sync by hand. Both sides independently deriving the same pure
 * date math is low-drift-risk (no state, no config, just a calendar), unlike
 * a numeric constants table that would actually need single-sourcing.
 */

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

/** Meteorological quarters (not astronomical) — Dec/Jan/Feb = winter, etc.
 *  Mirrors webview-ui/src/office/dayNight.ts's getSeason(). */
export function getSeason(now: number = Date.now()): Season {
  const month = new Date(now).getMonth(); // 0-11
  if (month === 11 || month === 0 || month === 1) return 'winter';
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  return 'autumn';
}

/** One fictional holiday week, Dec 20-31 local — the only calendar-flavor
 *  special case (GAME-DESIGN §6.4). Mirrors dayNight.ts's isHolidayWeek(). */
export function isHolidayWeek(now: number = Date.now()): boolean {
  const d = new Date(now);
  return d.getMonth() === 11 && d.getDate() >= 20 && d.getDate() <= 31;
}
