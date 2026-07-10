/**
 * Pinned-tail dock state — EXACTLY 3 slots (GAME-DESIGN-V3 §3.1: the
 * 3-slot budget is a deliberate attention-scarcity decision, not a
 * rendering limit). Pinning a 4th REJECTS with a labeled reason instead of
 * silently evicting — the player chooses what to give up.
 */

export const MAX_PINS = 3;

export const DOCK_FULL_REASON = '⚠ DOCK FULL — unpin one first';

export interface PinResult {
  ok: boolean;
  pins: readonly number[];
  /** Set when ok=false — the labeled rejection. */
  reason?: string;
}

export function pinAgent(pins: readonly number[], agentId: number): PinResult {
  if (pins.includes(agentId)) return { ok: true, pins };
  if (pins.length >= MAX_PINS) return { ok: false, pins, reason: DOCK_FULL_REASON };
  return { ok: true, pins: [...pins, agentId] };
}

export function unpinAgent(pins: readonly number[], agentId: number): readonly number[] {
  if (!pins.includes(agentId)) return pins;
  return pins.filter((id) => id !== agentId);
}
