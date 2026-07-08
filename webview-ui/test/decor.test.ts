/**
 * Decor unlock catalog test (v1 mechanic #5 — expression pass): each
 * progression unlock flag maps to exactly one cosmetic furniture placement,
 * items only render when unlocked, and placements never collide with each
 * other on the tile grid.
 */

import { describe, expect, it } from 'vitest';

import { DECOR_CATALOG, decorUid, getUnlockedDecorFurniture } from '../src/office/decor.js';

describe('decor unlock catalog', () => {
  it('has a unique unlock key and tile position per entry', () => {
    const keys = new Set(DECOR_CATALOG.map((e) => e.unlockKey));
    expect(keys.size).toBe(DECOR_CATALOG.length);

    const positions = new Set(DECOR_CATALOG.map((e) => `${e.col},${e.row}`));
    expect(positions.size).toBe(DECOR_CATALOG.length);
  });

  it('every entry has a plain-text requirement and label', () => {
    for (const entry of DECOR_CATALOG) {
      expect(entry.label.trim()).toBeTruthy();
      expect(entry.requirement.trim().length).toBeGreaterThan(0);
    }
  });

  it('renders nothing when no unlocks are true', () => {
    const unlocks: Record<string, boolean> = {};
    for (const entry of DECOR_CATALOG) unlocks[entry.unlockKey] = false;
    expect(getUnlockedDecorFurniture(unlocks)).toEqual([]);
  });

  it('renders exactly the unlocked items, at their catalog positions', () => {
    const unlocks: Record<string, boolean> = {};
    for (const entry of DECOR_CATALOG) unlocks[entry.unlockKey] = false;
    unlocks.streakBronze = true;
    unlocks.level10 = true;

    const placed = getUnlockedDecorFurniture(unlocks);
    expect(placed).toHaveLength(2);

    const bronze = DECOR_CATALOG.find((e) => e.unlockKey === 'streakBronze')!;
    const level10 = DECOR_CATALOG.find((e) => e.unlockKey === 'level10')!;
    expect(placed).toContainEqual({
      uid: decorUid(bronze),
      type: bronze.type,
      col: bronze.col,
      row: bronze.row,
    });
    expect(placed).toContainEqual({
      uid: decorUid(level10),
      type: level10.type,
      col: level10.col,
      row: level10.row,
    });
  });

  it('ignores unknown unlock keys', () => {
    const placed = getUnlockedDecorFurniture({ notARealUnlock: true });
    expect(placed).toEqual([]);
  });

  it('produces a uid distinct from editor-issued furniture uids', () => {
    for (const entry of DECOR_CATALOG) {
      expect(decorUid(entry)).toMatch(/^decor:/);
    }
  });
});
