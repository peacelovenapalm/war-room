/**
 * Ambient walkers — KICKOFF-v3.1 WS-A item 4(c): "janitor rounds and coffee
 * drift driven by real state (idle agents drift, blocked agents pace) using
 * placeholder walker sprites via the manifest loader with procedural
 * fallback".
 *
 * Pure functions of TIME + already-classified agent state (state/ambient.ts
 * does the real-telemetry classification; this module never touches
 * AgentMap/net types, matching the existing engine/* layering — engine is
 * generic motion math, state/ is the app-specific wiring onto it). All
 * positions are in TILE space (fractional — iso.ts's tileToWorld is linear,
 * so non-integer tiles project correctly) so they drop straight into the
 * existing WorldProp / depthSort / renderer pipeline used for every other
 * prop.
 *
 * Bounded theater (hard rule 6) does NOT apply here in the "≤2s" sense —
 * these are CONTINUOUS ambient loops, not one-shot transit animations —
 * but they are still driven by real state (never decorative-only): the
 * janitor/cat only patrol while actually connected to a live office, and
 * drift/pace only exist for agents the caller classified from real
 * telemetry (state/ambient.ts).
 *
 * Each pose also carries a `rotation` (N/E/S/W) so the renderer can pick
 * the matching walk-cycle sprite variant — derived from actual direction of
 * travel (finite difference of the same pure position function, never an
 * authored/guessed default), so a walker always visually faces where it's
 * headed.
 */

import type { Rotation } from '../assets/manifest';
import { staticPropTile } from './world';

export type WalkerBehavior = 'idle' | 'blocked';

export interface WalkerAgentInput {
  agentId: number;
  behavior: WalkerBehavior;
  deskTileX: number;
  deskTileY: number;
}

export interface WalkerPose {
  id: string;
  kind: 'janitor' | 'drift' | 'pace' | 'cat-curl' | 'cat-walk';
  tileX: number;
  tileY: number;
  rotation: Rotation;
  /** Present for drift/pace (real agent behind the pose) — absent for
   *  janitor/cat, which aren't tied to any one agent. Lets the renderer
   *  dress a drifting/pacing agent in the same outfit as their desk
   *  sprite (engine/world.ts's outfitForAgent). */
  agentId?: number;
}

interface TilePoint {
  tileX: number;
  tileY: number;
}

const DOOR_TILE = staticPropTile('door');
const COFFEE_TILE = staticPropTile('coffee');

/** Closed patrol loop (first === last): door -> aisle -> coffee -> door. */
const JANITOR_ROUTE: readonly TilePoint[] = [
  DOOR_TILE,
  { tileX: 7, tileY: 5 },
  { tileX: 2, tileY: 5 },
  { tileX: 2, tileY: 1 },
  { tileX: 12, tileY: 1 },
  { tileX: 12, tileY: 5 },
  COFFEE_TILE,
  DOOR_TILE,
];

export const JANITOR_LOOP_MS = 26_000;
export const DRIFT_LOOP_MS = 20_000;
export const PACE_PERIOD_MS = 2_400;
const PACE_AMPLITUDE_TILES = 0.55;
/** How far "beside the desk" pacing sits, so it never overlaps the desk
 *  prop/occupant block itself. */
const PACE_OFFSET_TILES = 0.9;

/** Curl spot + short loop beside the coffee station — small offsets so the
 *  cat reads as "near coffee", never overlapping the coffee_station prop's
 *  own tile. */
const CAT_CURL_SPOT: TilePoint = {
  tileX: COFFEE_TILE.tileX - 0.9,
  tileY: COFFEE_TILE.tileY + 0.4,
};
const CAT_WALK_ROUTE: readonly TilePoint[] = [
  CAT_CURL_SPOT,
  { tileX: COFFEE_TILE.tileX - 1.7, tileY: COFFEE_TILE.tileY + 0.7 },
  { tileX: COFFEE_TILE.tileX - 0.9, tileY: COFFEE_TILE.tileY + 1.1 },
  CAT_CURL_SPOT,
];
/** Full curl<->walk cycle; most of it curled, a short walk at the end —
 *  "occasional walk" (KICKOFF-v3.1 flavor item), not a constant patrol. */
export const CAT_CYCLE_MS = 42_000;
export const CAT_WALK_MS = 9_000;

/** Finite-difference step (ms) used to derive a pose's direction of travel
 *  from its own pure position function — small enough to be a faithful
 *  instantaneous heading, large enough to stay well clear of float noise. */
const ROTATION_SAMPLE_MS = 40;

function lerpTile(a: TilePoint, b: TilePoint, t: number): TilePoint {
  return { tileX: a.tileX + (b.tileX - a.tileX) * t, tileY: a.tileY + (b.tileY - a.tileY) * t };
}

/** Position along a closed loop route at time `now`, one full lap every
 *  `loopMs`. Pure function of `now` — no internal/mutable animation state. */
function positionAlongRoute(route: readonly TilePoint[], loopMs: number, now: number): TilePoint {
  const segments = route.length - 1;
  if (segments <= 0) return route[0] ?? { tileX: 0, tileY: 0 };
  const wrapped = ((now % loopMs) + loopMs) % loopMs; // defensive: now is always >=0 in practice
  const progress = (wrapped / loopMs) * segments;
  const index = Math.min(segments - 1, Math.floor(progress));
  return lerpTile(route[index], route[index + 1], progress - index);
}

/** Deterministic per-agent phase offset (stable hash, not Math.random) so
 *  multiple agents doing the same ambient motion don't move in lockstep —
 *  and stays reproducible in tests. */
function phaseOffset(agentId: number, periodMs: number): number {
  return (Math.abs(agentId) * 2_654_435_761) % Math.max(1, periodMs);
}

/** Compass rotation whose authored front-facing direction (iso.ts/rig.py
 *  convention: N = -tileY, E = +tileX, S = +tileY, W = -tileX) best matches
 *  a (dx, dy) direction of travel. Dominant axis wins on a diagonal; a
 *  near-zero delta (stationary) keeps the default 'S' (the pipeline's own
 *  authored-facing default). */
function directionToRotation(dx: number, dy: number): Rotation {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return 'S';
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
}

/** Sample `positionFn` at `now` and a moment earlier to derive a heading,
 *  and package it with the position into a full WalkerPose. */
function poseWithRotation(
  id: string,
  kind: WalkerPose['kind'],
  positionFn: (t: number) => TilePoint,
  now: number,
  agentId?: number,
): WalkerPose {
  const pos = positionFn(now);
  const prior = positionFn(Math.max(0, now - ROTATION_SAMPLE_MS));
  const rotation = directionToRotation(pos.tileX - prior.tileX, pos.tileY - prior.tileY);
  return { id, kind, tileX: pos.tileX, tileY: pos.tileY, rotation, agentId };
}

function janitorPose(now: number): WalkerPose {
  return poseWithRotation(
    'janitor',
    'janitor',
    (t) => positionAlongRoute(JANITOR_ROUTE, JANITOR_LOOP_MS, t),
    now,
  );
}

/** Idle agents drift desk <-> coffee station and back (triangle wave). */
function driftPose(input: WalkerAgentInput, now: number): WalkerPose {
  const phase = phaseOffset(input.agentId, DRIFT_LOOP_MS);
  const desk = { tileX: input.deskTileX, tileY: input.deskTileY };
  const positionFn = (t: number): TilePoint => {
    const wrapped = ((t + phase) % DRIFT_LOOP_MS) / DRIFT_LOOP_MS;
    const legT = wrapped < 0.5 ? wrapped * 2 : (1 - wrapped) * 2; // 0 -> 1 -> 0 across the loop
    return lerpTile(desk, COFFEE_TILE, legT);
  };
  return poseWithRotation(
    `drift-${String(input.agentId)}`,
    'drift',
    positionFn,
    now,
    input.agentId,
  );
}

/** Blocked agents pace a short back-and-forth beside their own desk. */
function pacePose(input: WalkerAgentInput, now: number): WalkerPose {
  const phase = phaseOffset(input.agentId, PACE_PERIOD_MS);
  const positionFn = (t: number): TilePoint => {
    const swing = Math.sin(((t + phase) / PACE_PERIOD_MS) * Math.PI * 2);
    return {
      tileX: input.deskTileX + swing * PACE_AMPLITUDE_TILES,
      tileY: input.deskTileY + PACE_OFFSET_TILES,
    };
  };
  return poseWithRotation(`pace-${String(input.agentId)}`, 'pace', positionFn, now, input.agentId);
}

/** Curled most of the cycle, a short walk loop the rest — "occasional
 *  walk" beside the coffee station (KICKOFF-v3.1 flavor item). */
function catPose(now: number): WalkerPose {
  const curlMs = CAT_CYCLE_MS - CAT_WALK_MS;
  const positionFn = (t: number): TilePoint => {
    const wrapped = ((t % CAT_CYCLE_MS) + CAT_CYCLE_MS) % CAT_CYCLE_MS;
    if (wrapped < curlMs) return CAT_CURL_SPOT;
    return positionAlongRoute(CAT_WALK_ROUTE, CAT_WALK_MS, wrapped - curlMs);
  };
  const wrapped = ((now % CAT_CYCLE_MS) + CAT_CYCLE_MS) % CAT_CYCLE_MS;
  const walking = wrapped >= curlMs;
  return poseWithRotation('cat', walking ? 'cat-walk' : 'cat-curl', positionFn, now);
}

/**
 * All ambient walker poses for this frame. `connected` gates the janitor
 * and cat — no ambient "alive office" theater over a dead connection with
 * nobody home. Idle/blocked walkers exist ONLY for agents the caller
 * already classified from real telemetry (state/ambient.ts) — this
 * function never invents a walker for an agent it wasn't told about.
 */
export function computeWalkers(
  agentInputs: readonly WalkerAgentInput[],
  connected: boolean,
  now: number,
): WalkerPose[] {
  const poses: WalkerPose[] = [];
  const officeAlive = connected && agentInputs.length > 0;
  if (officeAlive) {
    poses.push(janitorPose(now));
    poses.push(catPose(now));
  }
  for (const input of agentInputs) {
    poses.push(input.behavior === 'idle' ? driftPose(input, now) : pacePose(input, now));
  }
  return poses;
}
