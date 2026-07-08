/**
 * Unit tests for building buff resolution (G2, GAME-DESIGN §5.4/§5.5).
 *
 * Covers: room-membership buff applies only inside the rectangle,
 * adjacency same-type non-stacking, adjacency+room cross-type stacking
 * capped at exactly 40% (boundary, not just "under 40"), Server
 * Room/Kitchen global buffs apply without a deskUid.
 */

import { describe, expect, it } from 'vitest';

import { buffsForDesk, computeActiveBuffs, globalBuffs } from '../src/buildingBuffs.js';
import { ADJACENCY_AND_ROOM_BONUS_CAP_PCT, DEV_PIT_XP_BONUS_PCT } from '../src/economyConstants.js';
import type { OfficeLayout, PlacedFurniture, PlacedRoom } from '../src/officeLayoutTypes.js';
import { RoomType, TileType } from '../src/officeLayoutTypes.js';

function baseLayout(overrides: Partial<OfficeLayout> = {}): OfficeLayout {
  const cols = 20;
  const rows = 11;
  const tiles = new Array(cols * rows).fill(TileType.FLOOR_1);
  return { version: 1, cols, rows, tiles, furniture: [], rooms: [], ...overrides };
}

function desk(uid: string, col: number, row: number): PlacedFurniture {
  return { uid, type: 'DESK_FRONT', col, row };
}

function room(
  type: RoomType,
  colStart: number,
  rowStart: number,
  colEnd: number,
  rowEnd: number,
): PlacedRoom {
  return { uid: `room-${type}`, type, colStart, rowStart, colEnd, rowEnd, createdAt: 0 };
}

describe('buffsForDesk — room membership', () => {
  it('Dev Pit XP bonus applies only to a desk inside the rectangle', () => {
    const layout = baseLayout({
      furniture: [desk('inside', 2, 2), desk('outside', 10, 10)],
      rooms: [room(RoomType.DEV_PIT, 0, 0, 4, 3)],
    });
    expect(buffsForDesk(layout, 'inside').xpBonusPct).toBe(DEV_PIT_XP_BONUS_PCT);
    expect(buffsForDesk(layout, 'outside').xpBonusPct).toBe(0);
  });

  it('War Room grants crisisXpBonusPct only inside; Break Room grants moodRegenMult 1.5 only inside', () => {
    const layout = baseLayout({
      furniture: [desk('war', 1, 1), desk('break', 6, 1), desk('neither', 15, 8)],
      rooms: [room(RoomType.WAR_ROOM, 0, 0, 4, 4), room(RoomType.BREAK_ROOM, 5, 0, 8, 3)],
    });
    expect(buffsForDesk(layout, 'war').crisisXpBonusPct).toBeGreaterThan(0);
    expect(buffsForDesk(layout, 'break').moodRegenMult).toBe(1.5);
    expect(buffsForDesk(layout, 'neither').crisisXpBonusPct).toBe(0);
    expect(buffsForDesk(layout, 'neither').moodRegenMult).toBe(1);
  });

  it('an unknown deskUid returns neutral (all-zero) buffs, never throws', () => {
    const layout = baseLayout({ rooms: [room(RoomType.DEV_PIT, 0, 0, 4, 3)] });
    expect(() => buffsForDesk(layout, 'does-not-exist')).not.toThrow();
    expect(buffsForDesk(layout, 'does-not-exist')).toEqual({
      xpBonusPct: 0,
      cashBonusPct: 0,
      crisisXpBonusPct: 0,
      moodRegenMult: 1,
    });
  });
});

describe('buffsForDesk — furniture adjacency', () => {
  it('same-type furniture does not stack (strongest instance only)', () => {
    const layout = baseLayout({
      furniture: [
        desk('d', 5, 5),
        { uid: 'pc1', type: 'PC_FRONT_ON_1', col: 6, row: 5 },
        { uid: 'pc2', type: 'PC_FRONT_ON_1', col: 5, row: 6 },
      ],
    });
    // Two PC_FRONT_ON_1 in range — contributes its 10% xp bonus exactly once.
    expect(buffsForDesk(layout, 'd').xpBonusPct).toBe(10);
  });

  it('different-type furniture stacks additively', () => {
    const layout = baseLayout({
      furniture: [
        desk('d', 5, 5),
        { uid: 'pc', type: 'PC_FRONT_ON_1', col: 6, row: 5 },
        { uid: 'wb', type: 'WHITEBOARD', col: 5, row: 6 },
      ],
    });
    expect(buffsForDesk(layout, 'd').xpBonusPct).toBe(25); // 10 + 15
  });

  it('furniture outside its adjacencyRadius contributes nothing (Chebyshev distance)', () => {
    const layout = baseLayout({
      furniture: [desk('d', 0, 0), { uid: 'pc', type: 'PC_FRONT_ON_1', col: 5, row: 0 }],
    });
    expect(buffsForDesk(layout, 'd').xpBonusPct).toBe(0);
  });
});

describe('buffsForDesk — shared 40% cap (§9.19, boundary-tested)', () => {
  it('stays uncapped below the ceiling: Dev Pit (15) + one furniture type (10) = 25', () => {
    const layout = baseLayout({
      furniture: [desk('d', 2, 2), { uid: 'pc1', type: 'PC_FRONT_ON_1', col: 2, row: 1 }],
      rooms: [room(RoomType.DEV_PIT, 0, 0, 4, 3)],
    });
    expect(buffsForDesk(layout, 'd').xpBonusPct).toBe(DEV_PIT_XP_BONUS_PCT + 10);
  });

  it('caps combined room+adjacency stacking at exactly 40%, not the uncapped 60', () => {
    // Dev Pit (15) + PC1/PC2/PC3 (10 each = 30) + WHITEBOARD (15) = 60 uncapped —
    // one shared pool, capped at ADJACENCY_AND_ROOM_BONUS_CAP_PCT=40, not 40+40=80
    // and not left at the raw 60.
    const layout = baseLayout({
      furniture: [
        desk('d', 2, 2),
        { uid: 'pc1', type: 'PC_FRONT_ON_1', col: 2, row: 1 },
        { uid: 'pc2', type: 'PC_FRONT_ON_2', col: 3, row: 2 },
        { uid: 'pc3', type: 'PC_FRONT_ON_3', col: 1, row: 2 },
        { uid: 'wb', type: 'WHITEBOARD', col: 2, row: 3 },
      ],
      rooms: [room(RoomType.DEV_PIT, 0, 0, 4, 3)],
    });
    expect(buffsForDesk(layout, 'd').xpBonusPct).toBe(ADJACENCY_AND_ROOM_BONUS_CAP_PCT);
  });

  it('overlapping rooms of the same type never double-count the room bonus', () => {
    const layout = baseLayout({
      furniture: [desk('d', 2, 2)],
      rooms: [room(RoomType.DEV_PIT, 0, 0, 4, 3), room(RoomType.DEV_PIT, 0, 0, 5, 5)],
    });
    expect(buffsForDesk(layout, 'd').xpBonusPct).toBe(DEV_PIT_XP_BONUS_PCT);
  });
});

describe('globalBuffs — Server Room + Kitchen (no deskUid required)', () => {
  it('Server Room grants +10% Cash only when qualifying furniture is inside', () => {
    const withPc = baseLayout({
      furniture: [{ uid: 'pc', type: 'PC_FRONT_ON_1', col: 1, row: 1 }],
      rooms: [room(RoomType.SERVER_ROOM, 0, 0, 3, 3)],
    });
    expect(globalBuffs(withPc).cashBonusPct).toBeGreaterThan(0);

    const withoutFurniture = baseLayout({ rooms: [room(RoomType.SERVER_ROOM, 0, 0, 3, 3)] });
    expect(globalBuffs(withoutFurniture).cashBonusPct).toBe(0);
  });

  it('Kitchen applies moodDecayMult 0.85 whenever the room exists anywhere', () => {
    const withKitchen = baseLayout({ rooms: [room(RoomType.KITCHEN, 10, 5, 13, 7)] });
    expect(globalBuffs(withKitchen).moodDecayMult).toBe(0.85);

    const withoutKitchen = baseLayout();
    expect(globalBuffs(withoutKitchen).moodDecayMult).toBe(1);
  });
});

describe('computeActiveBuffs', () => {
  it('merges both resolution paths', () => {
    const layout = baseLayout({
      furniture: [desk('d', 2, 2), { uid: 'pc', type: 'PC_FRONT_ON_1', col: 1, row: 1 }],
      rooms: [room(RoomType.DEV_PIT, 0, 0, 4, 3), room(RoomType.KITCHEN, 10, 5, 13, 7)],
    });
    const { desk: deskBuffs, global } = computeActiveBuffs(layout, 'd');
    expect(deskBuffs.xpBonusPct).toBeGreaterThan(0);
    expect(global.moodDecayMult).toBe(0.85);
  });
});
