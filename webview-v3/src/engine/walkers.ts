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
 * janitor only patrols while actually connected to a live office, and
 * drift/pace only exist for agents the caller classified from real
 * telemetry (state/ambient.ts).
 */

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
  kind: 'janitor' | 'drift' | 'pace';
  tileX: number;
  tileY: number;
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

function janitorPose(now: number): WalkerPose {
  const pos = positionAlongRoute(JANITOR_ROUTE, JANITOR_LOOP_MS, now);
  return { id: 'janitor', kind: 'janitor', ...pos };
}

/** Idle agents drift desk <-> coffee station and back (triangle wave). */
function driftPose(input: WalkerAgentInput, now: number): WalkerPose {
  const phase = phaseOffset(input.agentId, DRIFT_LOOP_MS);
  const t = ((now + phase) % DRIFT_LOOP_MS) / DRIFT_LOOP_MS;
  const legT = t < 0.5 ? t * 2 : (1 - t) * 2; // 0 -> 1 -> 0 across the loop
  const desk = { tileX: input.deskTileX, tileY: input.deskTileY };
  const pos = lerpTile(desk, COFFEE_TILE, legT);
  return { id: `drift-${String(input.agentId)}`, kind: 'drift', ...pos };
}

/** Blocked agents pace a short back-and-forth beside their own desk. */
function pacePose(input: WalkerAgentInput, now: number): WalkerPose {
  const phase = phaseOffset(input.agentId, PACE_PERIOD_MS);
  const swing = Math.sin(((now + phase) / PACE_PERIOD_MS) * Math.PI * 2);
  return {
    id: `pace-${String(input.agentId)}`,
    kind: 'pace',
    tileX: input.deskTileX + swing * PACE_AMPLITUDE_TILES,
    tileY: input.deskTileY + PACE_OFFSET_TILES,
  };
}

/**
 * All ambient walker poses for this frame. `connected` gates the janitor —
 * no ambient "alive office" theater over a dead connection with nobody
 * home. Idle/blocked walkers exist ONLY for agents the caller already
 * classified from real telemetry (state/ambient.ts) — this function never
 * invents a walker for an agent it wasn't told about.
 */
export function computeWalkers(
  agentInputs: readonly WalkerAgentInput[],
  connected: boolean,
  now: number,
): WalkerPose[] {
  const poses: WalkerPose[] = [];
  if (connected && agentInputs.length > 0) poses.push(janitorPose(now));
  for (const input of agentInputs) {
    poses.push(input.behavior === 'idle' ? driftPose(input, now) : pacePose(input, now));
  }
  return poses;
}
