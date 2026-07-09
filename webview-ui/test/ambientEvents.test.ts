/**
 * Ambient wander bias tests (v2 mechanic G5, BUILD-PLAN §G5 task 1) — pure
 * logic behind officeState.ts's idle-wander target selection. Mirrors
 * crowdRule.test.ts's style for the v1 emergence pull.
 */

import { describe, expect, it } from 'vitest';

import type { PlacedRoom } from '../src/office/types.js';
import { RoomType } from '../src/office/types.js';
import {
  ambientWanderTarget,
  BREAK_ROOM_PULL_CHANCE,
  breakRoomTarget,
  COWORKER_CLUSTER_PULL_CHANCE,
  coworkerClusterTarget,
} from '../src/office/world/ambientEvents.js';

function breakRoom(overrides: Partial<PlacedRoom> = {}): PlacedRoom {
  return {
    uid: 'r1',
    type: RoomType.BREAK_ROOM,
    colStart: 4,
    rowStart: 4,
    colEnd: 7,
    rowEnd: 6,
    createdAt: 0,
    ...overrides,
  };
}

function openFloor(size = 10) {
  const walkable: Array<{ col: number; row: number }> = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) walkable.push({ col: c, row: r });
  return walkable;
}

describe('coworkerClusterTarget', () => {
  it('returns null when the character has no employeeId', () => {
    expect(coworkerClusterTarget({ id: 1, employeeId: undefined }, [])).toBeNull();
  });

  it('returns null when nobody else shares the project', () => {
    const chars = [
      { id: 1, employeeId: 'MACBOOK:proj-a', tileCol: 0, tileRow: 0 },
      { id: 2, employeeId: 'MINI:proj-b', tileCol: 5, tileRow: 5 },
    ];
    expect(coworkerClusterTarget(chars[0], chars)).toBeNull();
  });

  it('finds a coworker on the same project, machine-agnostic', () => {
    const chars = [
      { id: 1, employeeId: 'MACBOOK:proj-a', tileCol: 0, tileRow: 0 },
      { id: 2, employeeId: 'MINI:proj-a', tileCol: 5, tileRow: 5 },
    ];
    expect(coworkerClusterTarget(chars[0], chars)).toEqual({ col: 5, row: 5 });
  });

  it('never matches the character against itself', () => {
    const chars = [{ id: 1, employeeId: 'MACBOOK:proj-a', tileCol: 0, tileRow: 0 }];
    expect(coworkerClusterTarget(chars[0], chars)).toBeNull();
  });
});

describe('breakRoomTarget', () => {
  it('returns null when no Break Room is placed', () => {
    expect(breakRoomTarget(undefined, openFloor())).toBeNull();
    expect(breakRoomTarget([], openFloor())).toBeNull();
    expect(breakRoomTarget([breakRoom({ type: RoomType.DEV_PIT })], openFloor())).toBeNull();
  });

  it('picks a walkable tile inside the Break Room footprint', () => {
    const target = breakRoomTarget([breakRoom()], openFloor());
    expect(target).not.toBeNull();
    expect(target!.col).toBeGreaterThanOrEqual(4);
    expect(target!.col).toBeLessThan(7);
    expect(target!.row).toBeGreaterThanOrEqual(4);
    expect(target!.row).toBeLessThan(6);
  });

  it('falls back to the nearest walkable tile when the interior is fully blocked', () => {
    const walkable = openFloor().filter(
      (t) => !(t.col >= 4 && t.col < 7 && t.row >= 4 && t.row < 6),
    );
    const target = breakRoomTarget([breakRoom()], walkable);
    expect(target).not.toBeNull();
  });
});

describe('ambientWanderTarget', () => {
  it('prefers a coworker cluster over the Break Room when both are available and both rolls hit', () => {
    const chars = [
      { id: 1, employeeId: 'MACBOOK:proj-a', tileCol: 0, tileRow: 0 },
      { id: 2, employeeId: 'MINI:proj-a', tileCol: 8, tileRow: 8 },
    ];
    const target = ambientWanderTarget(
      chars[0],
      chars,
      [breakRoom()],
      openFloor(),
      () => 0, // always below both pull chances
    );
    expect(target).toEqual({ col: 8, row: 8 });
  });

  it('falls back to the Break Room when no coworker is available and the roll hits', () => {
    const chars = [{ id: 1, employeeId: 'MACBOOK:proj-a', tileCol: 0, tileRow: 0 }];
    const target = ambientWanderTarget(chars[0], chars, [breakRoom()], openFloor(), () => 0);
    expect(target).not.toBeNull();
  });

  it('returns null when the roll misses for both', () => {
    const chars = [
      { id: 1, employeeId: 'MACBOOK:proj-a', tileCol: 0, tileRow: 0 },
      { id: 2, employeeId: 'MINI:proj-a', tileCol: 8, tileRow: 8 },
    ];
    const target = ambientWanderTarget(chars[0], chars, [breakRoom()], openFloor(), () => 0.99);
    expect(target).toBeNull();
  });

  it('returns null with no employeeId and no Break Room placed', () => {
    const chars = [{ id: 1, employeeId: undefined, tileCol: 0, tileRow: 0 }];
    expect(ambientWanderTarget(chars[0], chars, undefined, openFloor(), () => 0)).toBeNull();
  });

  it('pull chances are sane probabilities', () => {
    expect(COWORKER_CLUSTER_PULL_CHANCE).toBeGreaterThan(0);
    expect(COWORKER_CLUSTER_PULL_CHANCE).toBeLessThan(1);
    expect(BREAK_ROOM_PULL_CHANCE).toBeGreaterThan(0);
    expect(BREAK_ROOM_PULL_CHANCE).toBeLessThan(1);
  });
});
