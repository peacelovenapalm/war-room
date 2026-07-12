/**
 * BLOCKED AGE anchor (C9-3 — drawer since= anchor fix).
 *
 * Live finding: the AgentDrawer's "BLOCKED AGE" row showed a stale, ever-
 * growing duration (e.g. 16:34) for agents that were NOT actually blocked.
 * The cause was the anchor's fallback: `crisis.fires.get(id)?.since ?? poll?.since`.
 * A crisis FIRE only exists while the agent is NEEDS_INPUT (reduceCrisisState
 * spawns one for every blocked agent), and its `since` is the documented
 * needs-input ONSET anchor (server poll transition time, else client
 * first-seen). The `?? poll?.since` fallback anchored the "blocked age" to the
 * age of the CURRENT poll snapshot for a WORKING/DONE agent — a receipt time
 * that is not a blocked age at all, and that keeps growing until the poll
 * expires.
 *
 * Documented intent (crisisStore.ts header): BLOCKED AGE is the age since the
 * agent BECAME blocked. The only honest anchor is the fire's onset; a
 * non-blocked agent has no blocked age (renders "—"). This helper encodes that
 * — fire-only, no poll fallback.
 */

import type { FireRecord } from './crisisStore';

/** The blocked-age anchor for an agent: the needs-input fire's onset, or
 *  undefined when the agent is not currently blocked. */
export function blockedAgeAnchor(fire: FireRecord | undefined): number | undefined {
  return fire?.since;
}
