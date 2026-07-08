/**
 * Pure, parameterizable XP/level curve — extracted from progressionStore.ts
 * so any store (account-wide progression, per-employee XP) can share the
 * same math with its own curve constants.
 */

export interface LevelCurve {
  base: number;
  step: number;
}

export interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
}

/** XP required to REACH a given level from 0 (level 1 = the starting level). */
export function xpForLevel(level: number, curve: LevelCurve): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += curve.base + curve.step * (l - 1);
  return total;
}

export function computeLevel(xp: number, curve: LevelCurve): LevelInfo {
  let level = 1;
  while (xp >= xpForLevel(level + 1, curve)) level++;
  const floor = xpForLevel(level, curve);
  const ceil = xpForLevel(level + 1, curve);
  return { level, xpIntoLevel: xp - floor, xpForNextLevel: ceil - floor };
}
