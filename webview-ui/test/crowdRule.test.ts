/**
 * Emergence rule test (v1 mechanic #4): a long-blocked desk draws a crowd —
 * an idle wanderer with a crowdTarget picks a tile near the fire when the
 * pull-roll hits, and wanders anywhere when it misses.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCharacter, updateCharacter } from '../src/office/engine/characters.js';
import { CharacterState } from '../src/office/types.js';

/** 10×10 open floor (tile type 1) with no blockers. */
function openFloor() {
  const tileMap = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 1)) as never;
  const walkable: Array<{ col: number; row: number }> = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) walkable.push({ col: c, row: r });
  return { tileMap, walkable };
}

function idleWanderer() {
  const ch = createCharacter(1, 0, null, null, 0);
  ch.state = CharacterState.IDLE;
  ch.tileCol = 0;
  ch.tileRow = 0;
  ch.x = 8;
  ch.y = 8;
  ch.wanderTimer = 0.01; // due this tick
  ch.wanderCount = 0;
  ch.wanderLimit = 99; // never rest during the test
  ch.isActive = false;
  return ch;
}

afterEach(() => vi.restoreAllMocks());

describe('crowd rule (emergence)', () => {
  it('pulls the wander target near the burning desk when the roll hits', () => {
    const { tileMap, walkable } = openFloor();
    const ch = idleWanderer();
    // roll < CROWD_PULL_CHANCE → pull; second call picks index 0 of the near set
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.0).mockReturnValue(0.0);
    updateCharacter(ch, 0.02, walkable, new Map(), tileMap, new Set(), { col: 8, row: 8 });
    expect(ch.state).toBe(CharacterState.WALK);
    const dest = ch.path[ch.path.length - 1];
    expect(Math.abs(dest.col - 8)).toBeLessThanOrEqual(2);
    expect(Math.abs(dest.row - 8)).toBeLessThanOrEqual(2);
  });

  it('wanders anywhere when the roll misses or there is no fire', () => {
    const { tileMap, walkable } = openFloor();
    const ch = idleWanderer();
    // roll ≥ CROWD_PULL_CHANCE → no pull; then pick index 0 (tile 0,0 area)
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.99).mockReturnValue(0.0);
    updateCharacter(ch, 0.02, walkable, new Map(), tileMap, new Set(), { col: 8, row: 8 });
    // destination is the first walkable tile (0,0) — far from the fire corner
    if (ch.path.length > 0) {
      const dest = ch.path[ch.path.length - 1];
      expect(Math.abs(dest.col - 8) > 2 || Math.abs(dest.row - 8) > 2).toBe(true);
    }
    // and with no crowdTarget at all the call simply works
    const ch2 = idleWanderer();
    updateCharacter(ch2, 0.02, walkable, new Map(), tileMap, new Set(), null);
  });
});
