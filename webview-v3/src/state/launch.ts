/**
 * Push-landing deep link — KICKOFF-v3.1 mobile decision "Push landing:
 * Board + auto-opened crisis sheet". The phone cold open is ALWAYS the
 * triage board (App.tsx's default view/layout, unconditional); this module
 * only parses which agent's drawer (the "crisis sheet") a push notification
 * wants auto-opened once that agent shows up in the live roster.
 *
 * Pure — takes the query string, not `window.location`, so it's testable
 * without a DOM. Accepts two forms for robustness across however the push
 * payload builds the URL: `?agentId=<n>` directly, or the more explicit
 * `?open=agent&id=<n>`.
 */

export interface LaunchTarget {
  /** null = no valid deep-link target; the board-only cold open applies. */
  agentId: number | null;
}

export const NO_LAUNCH_TARGET: LaunchTarget = { agentId: null };

function parseAgentId(raw: string | null): number | null {
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function parseLaunchTarget(search: string): LaunchTarget {
  const params = new URLSearchParams(search);
  const direct = parseAgentId(params.get('agentId'));
  if (direct !== null) return { agentId: direct };
  if (params.get('open') === 'agent') {
    const viaOpen = parseAgentId(params.get('id'));
    if (viaOpen !== null) return { agentId: viaOpen };
  }
  return NO_LAUNCH_TARGET;
}
