/**
 * Real-telemetry classification for ambient walkers (KICKOFF-v3.1 WS-A item
 * 4(c)) — the state-layer half of engine/walkers.ts's split: this module
 * knows about AgentMap/visualState (net + state types), engine/walkers.ts
 * stays generic motion math. Only agents in a walker-relevant state produce
 * an input at all — a WORKING or DOWN agent gets no ambient walker (working
 * = already visually communicated by the occupied-desk glow; down = no one
 * is there to drift or pace).
 */

import type { WalkerAgentInput } from '../engine/walkers';
import type { DeskAnchor } from '../engine/world';
import type { AgentMap } from '../net/agentStore';
import { AgentVisualState, deriveVisualState } from './visualState';

export function classifyWalkerAgents(
  anchors: readonly DeskAnchor[],
  agents: AgentMap,
  now: number,
): WalkerAgentInput[] {
  const inputs: WalkerAgentInput[] = [];
  for (const anchor of anchors) {
    const record = agents.get(anchor.agentId);
    if (!record) continue;
    const state = deriveVisualState(record, now);
    if (state === AgentVisualState.WAITING || state === AgentVisualState.DONE) {
      inputs.push({
        agentId: anchor.agentId,
        behavior: 'idle',
        deskTileX: anchor.deskTileX,
        deskTileY: anchor.deskTileY,
      });
    } else if (state === AgentVisualState.NEEDS_INPUT) {
      inputs.push({
        agentId: anchor.agentId,
        behavior: 'blocked',
        deskTileX: anchor.deskTileX,
        deskTileY: anchor.deskTileY,
      });
    }
  }
  return inputs;
}
