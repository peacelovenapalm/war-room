/**
 * Ambient wander bias (v2 mechanic G5 — BUILD-PLAN.md §G5 task 1, "world sim
 * polish"). Idle employees (no active session, mood NOT low/BURNED_OUT)
 * occasionally drift toward the office's Break Room or cluster near a
 * coworker on the same real project, instead of wandering to a fully random
 * tile. Same "cheap rule" shape as the v1 emergence crowd-pull
 * (engine/characters.ts's `CROWD_PULL_CHANCE`): pure, deterministic given an
 * injected RNG, no new geometry, no new timer.
 *
 * Wiring (officeState.ts's existing update(dt) loop, itself driven by
 * pixiApp.ts's ticker — never a new setInterval/RAF): for each character
 * currently in CharacterState.IDLE with no live crisis crowd-target pulling
 * (crisis attention always wins over ambient flavor), officeState.ts computes
 * `ambientWanderTarget(...)` and passes it as that character's `crowdTarget`
 * argument to the UNMODIFIED `updateCharacter()` wander logic in
 * characters.ts — this file never touches characters.ts's tested FSM, it
 * only decides what target value that FSM receives.
 */

import type { Character, PlacedRoom } from '../types.js';
import { RoomType } from '../types.js';

/** Not specified numerically by GAME-DESIGN/BUILD-PLAN — documented judgment
 *  calls, deliberately lower than the v1 crisis CROWD_PULL_CHANCE (0.65):
 *  ambient flavor should read as occasional texture, never dominate wander
 *  behavior the way an active fire does. */
export const COWORKER_CLUSTER_PULL_CHANCE = 0.3;
export const BREAK_ROOM_PULL_CHANCE = 0.25;
/** How close to the Break Room's own footprint counts as "at" it, in tiles. */
const BREAK_ROOM_SEARCH_RADIUS_TILES = 6;

/** The project component of an employeeId (`machine:slug`, core/src/employeeId.ts)
 *  — the part two coworkers must share to be "same-project," machine-agnostic
 *  (a project dispatched from two different machines is still one project). */
function projectSlug(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const idx = id.indexOf(':');
  return idx === -1 ? id : id.slice(idx + 1);
}

/** The first other character sharing `ch`'s real project, or null if `ch` has
 *  no employeeId or nobody else currently shares one. Deterministic (no RNG)
 *  — "a" coworker is enough, picking among several isn't worth an extra roll. */
export function coworkerClusterTarget(
  ch: Pick<Character, 'id' | 'employeeId'>,
  allCharacters: ReadonlyArray<Pick<Character, 'id' | 'employeeId' | 'tileCol' | 'tileRow'>>,
): { col: number; row: number } | null {
  const slug = projectSlug(ch.employeeId);
  if (!slug) return null;
  const coworker = allCharacters.find(
    (other) => other.id !== ch.id && projectSlug(other.employeeId) === slug,
  );
  return coworker ? { col: coworker.tileCol, row: coworker.tileRow } : null;
}

/** A walkable tile inside the placed Break Room, or null if no Break Room is
 *  placed yet. Prefers the room's own footprint (center, or nearest walkable
 *  tile still inside the rectangle if the center is occupied by furniture);
 *  falls back to the nearest walkable tile within a small search radius of
 *  the center so a Break Room whose interior is fully furnished still draws
 *  wanderers to its doorway rather than never qualifying. */
export function breakRoomTarget(
  rooms: PlacedRoom[] | undefined,
  walkableTiles: ReadonlyArray<{ col: number; row: number }>,
): { col: number; row: number } | null {
  const room = rooms?.find((r) => r.type === RoomType.BREAK_ROOM);
  if (!room) return null;
  const centerCol = Math.floor((room.colStart + room.colEnd) / 2);
  const centerRow = Math.floor((room.rowStart + room.rowEnd) / 2);

  let best: { col: number; row: number } | null = null;
  let bestDist = Infinity;
  for (const t of walkableTiles) {
    const insideRoom =
      t.col >= room.colStart &&
      t.col < room.colEnd &&
      t.row >= room.rowStart &&
      t.row < room.rowEnd;
    const dist = Math.abs(t.col - centerCol) + Math.abs(t.row - centerRow);
    if (!insideRoom && dist > BREAK_ROOM_SEARCH_RADIUS_TILES) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}

/** Combined ambient wander decision for one idle character — coworker
 *  clustering is tried first (a specific person is a stronger pull than a
 *  room), then the Break Room, each gated by its own roll; null means "no
 *  ambient pull this decision," and the caller's existing random-tile
 *  wander behavior (characters.ts, unmodified) applies as before. */
export function ambientWanderTarget(
  ch: Pick<Character, 'id' | 'employeeId'>,
  allCharacters: ReadonlyArray<Pick<Character, 'id' | 'employeeId' | 'tileCol' | 'tileRow'>>,
  rooms: PlacedRoom[] | undefined,
  walkableTiles: ReadonlyArray<{ col: number; row: number }>,
  random: () => number = Math.random,
): { col: number; row: number } | null {
  const coworker = coworkerClusterTarget(ch, allCharacters);
  if (coworker && random() < COWORKER_CLUSTER_PULL_CHANCE) return coworker;
  const breakRoom = breakRoomTarget(rooms, walkableTiles);
  if (breakRoom && random() < BREAK_ROOM_PULL_CHANCE) return breakRoom;
  return null;
}
