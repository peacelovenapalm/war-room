/**
 * Push-landing deep link — KICKOFF-v3.1 mobile decision "Push landing:
 * Board + auto-opened crisis sheet". The phone cold open is ALWAYS the
 * triage board (App.tsx's default view/layout, unconditional); this module
 * only parses which agent's drawer (the "crisis sheet") a push notification
 * wants auto-opened once that agent shows up in the live roster, OR (V6-1)
 * which DOCK PANEL a push wants opened immediately (no roster dependency —
 * a panel doesn't wait on any particular agent showing up).
 *
 * Pure — takes the query string, not `window.location`, so it's testable
 * without a DOM. Accepts two forms for the agent target, for robustness
 * across however the push payload builds the URL: `?agentId=<n>` directly,
 * or the more explicit `?open=agent&id=<n>`. The panel target is
 * `?open=<panelKind>` for any `open` value that ISN'T the literal string
 * "agent" — today only "morning" (morningPush.ts's own deep link), but the
 * parse itself doesn't hardcode that: an unrecognized panel kind is simply
 * `panel: null`, the same honest "no valid target" posture as an
 * unparseable agentId.
 */

import type { DockPanelKind } from './dockPanelKind';

/** Panel kinds a push deep-link is allowed to target — deliberately a
 *  small allowlist (not "any DockPanelKind") so a malformed/malicious
 *  query string can never auto-open a panel this feature never intended
 *  to reach from a cold push landing. */
const LAUNCHABLE_PANEL_KINDS: readonly DockPanelKind[] = ['morning'];

export interface LaunchTarget {
  /** null = no valid deep-link target; the board-only cold open applies. */
  agentId: number | null;
  /** null = no panel deep-link target. */
  panel: DockPanelKind | null;
}

export const NO_LAUNCH_TARGET: LaunchTarget = { agentId: null, panel: null };

function parseAgentId(raw: string | null): number | null {
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

function parsePanelKind(raw: string | null): DockPanelKind | null {
  if (raw === null) return null;
  return (LAUNCHABLE_PANEL_KINDS as readonly string[]).includes(raw)
    ? (raw as DockPanelKind)
    : null;
}

export function parseLaunchTarget(search: string): LaunchTarget {
  const params = new URLSearchParams(search);
  const direct = parseAgentId(params.get('agentId'));
  if (direct !== null) return { agentId: direct, panel: null };

  const open = params.get('open');
  if (open === 'agent') {
    const viaOpen = parseAgentId(params.get('id'));
    if (viaOpen !== null) return { agentId: viaOpen, panel: null };
  } else {
    const panel = parsePanelKind(open);
    if (panel !== null) return { agentId: null, panel };
  }
  return NO_LAUNCH_TARGET;
}
