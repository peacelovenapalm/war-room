import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button.js';
import {
  CHARACTER_SITTING_OFFSET_PX,
  FUEL_COLOR_CRITICAL,
  FUEL_COLOR_DANGER,
  FUEL_COLOR_OK,
  FUEL_COLOR_WARN,
  FUEL_GAUGE_BG,
  FUEL_GAUGE_HEIGHT_PX,
  FUEL_GAUGE_WIDTH_PX,
  MAX_CONTEXT_TOKENS,
  PIXEL_TEXT_SHADOW,
  TEAM_LEAD_COLOR,
  TEAM_ROLE_COLOR,
  TOKEN_CRITICAL_THRESHOLD,
  TOKEN_DANGER_THRESHOLD,
  TOKEN_WARN_THRESHOLD,
  TOOL_OVERLAY_VERTICAL_OFFSET,
} from '../../constants.js';
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js';
import { deriveVisualState, getFreshPollState, STATE_CHIPS } from '../agentState.js';
import type { OfficeState } from '../engine/officeState.js';
import type { ToolActivity } from '../types.js';
import { CharacterState, TILE_SIZE } from '../types.js';

// Both turn-end states show the ✓ DONE chip. Going idle waiting on the user
// (Notification(idle_prompt)) instead maps to the loud ⚠ NEEDS INPUT chip with
// this detail line. Driven by Character.waitingAwaitingInput.
const WAITING_INPUT_ACTIVITY_TEXT = 'Waiting for input';

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onCloseAgent: (id: number) => void;
  alwaysShowOverlay: boolean;
}

/** Derive a short human-readable activity string from tools/status */
function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
  bubbleType: 'permission' | 'waiting' | null,
  waitingAwaitingInput: boolean,
): string {
  if (bubbleType === 'permission') return 'Needs approval';
  // Only the idle case ("Waiting for input") gets a dedicated label; a finished
  // turn (Stop, waitingAwaitingInput=false) falls through (the ✓ DONE chip
  // already signals it).
  if (bubbleType === 'waiting' && waitingAwaitingInput) return WAITING_INPUT_ACTIVITY_TEXT;

  const tools = agentTools[agentId];
  if (tools && tools.length > 0) {
    // Find the latest non-done tool
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval';
      return activeTool.status;
    }
    // All tools done but agent still active (mid-turn) — keep showing last tool status
    if (isActive) {
      const lastTool = tools[tools.length - 1];
      if (lastTool) return lastTool.status;
    }
  }

  return 'Idle';
}

function getFuelColor(ratio: number): string {
  if (ratio >= TOKEN_CRITICAL_THRESHOLD) return FUEL_COLOR_CRITICAL;
  if (ratio >= TOKEN_DANGER_THRESHOLD) return FUEL_COLOR_DANGER;
  if (ratio >= TOKEN_WARN_THRESHOLD) return FUEL_COLOR_WARN;
  return FUEL_COLOR_OK;
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  alwaysShowOverlay,
}: ToolOverlayProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  const selectedId = officeState.selectedAgentId;
  const hoveredId = officeState.hoveredAgentId;

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const isSelected = selectedId === id;
        const isHovered = hoveredId === id;
        const isSub = ch.isSubagent;
        const tools = agentTools[id];

        // Colorblind hard rule: state = SHAPE (glyph) + TEXT chip, never a tint.
        const vState = deriveVisualState(ch, tools);
        const chip = STATE_CHIPS[vState];

        // Per-agent identity as TEXT — always visible (never color-coded):
        // main agents: "#id [MACHINE] folder"; sub-agents: their task label.
        const sub = isSub ? subagentCharacters.find((s) => s.id === id) : undefined;
        const nameTag = isSub
          ? (sub?.label ?? 'Subtask')
          : [`#${id}`, ch.machine ? `[${ch.machine}]` : null, ch.folderName ?? null]
              .filter(Boolean)
              .join(' ');

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY =
          (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr;

        // Loud states (⚠ NEEDS INPUT, ✗ FAILED) always show the full stack —
        // needs-input must be the loudest thing on screen even with labels off.
        const showFull = alwaysShowOverlay || isSelected || isHovered || chip.loud;

        if (!showFull) {
          // Compact mode: glyph + name tag stay visible (identity + state are
          // never hidden), the detail panel appears on hover/select.
          return (
            <div
              key={id}
              className="absolute flex flex-col items-center -translate-x-1/2"
              style={{
                left: screenX,
                top: screenY - 4,
                pointerEvents: 'none',
                opacity: isSub ? 0.6 : 0.85,
                zIndex: 40,
              }}
              data-testid="agent-overlay"
              data-agent-id={id}
              data-state={vState}
            >
              <span className="name-tag">
                {/* SHAPE + STATE WORD + identity — readable without hover */}
                {chip.glyph} {chip.label} · {nameTag}
              </span>
            </div>
          );
        }

        // Get activity text
        const hasWaitingBubble = ch.bubbleType === 'waiting';
        const subHasPermission = isSub && ch.bubbleType === 'permission';
        let activityText: string;
        if (hasWaitingBubble && ch.waitingAwaitingInput) {
          activityText = WAITING_INPUT_ACTIVITY_TEXT;
        } else if (isSub) {
          if (subHasPermission) {
            activityText = 'Needs approval';
          } else {
            activityText = sub ? sub.label : 'Subtask';
          }
        } else {
          activityText = getActivityText(
            id,
            agentTools,
            ch.isActive,
            ch.bubbleType,
            ch.waitingAwaitingInput ?? false,
          );
        }

        // M4 poller detail: when the poll state drives the chip, surface WHY
        // as TEXT. `waitingFor` (what the blocked agent waits on) beats the
        // generic local fallbacks; failed/stopped have no local detail at all.
        const poll = getFreshPollState(ch);
        if (vState === 'needs-input' && poll?.state === 'blocked') {
          if (poll.waitingFor) {
            activityText = poll.waitingFor;
          } else if (activityText === 'Idle') {
            activityText = 'Blocked — needs input';
          }
        } else if (vState === 'failed' && poll?.state === 'failed') {
          activityText = 'Session failed';
        } else if (vState === 'stopped' && poll?.state === 'stopped') {
          activityText = 'Session stopped';
        } else if (vState === 'working' && poll?.state === 'working' && activityText === 'Idle') {
          // Poll lifted an otherwise-idle agent (hooks-only remote / background
          // session) — don't contradict the ▶ WORKING chip with an "Idle" line.
          activityText = 'Working';
        }

        // Team info
        const teamRoleLabel = ch.isTeamLead ? 'LEAD' : ch.agentName || null;
        const isTeamAgent = !!ch.teamName;
        const totalTokens = ch.inputTokens + ch.outputTokens;
        const tokenRatio = totalTokens / MAX_CONTEXT_TOKENS;
        const tokenPct = Math.round(tokenRatio * 100);
        const hasExtraLines = !!(teamRoleLabel || !isSub);

        return (
          <div
            key={id}
            className="absolute flex flex-col items-center -translate-x-1/2"
            style={{
              left: screenX,
              top: screenY - (hasExtraLines ? 52 : 46),
              pointerEvents: isSelected ? 'auto' : 'none',
              opacity:
                chip.loud || isSelected || isHovered
                  ? 1
                  : alwaysShowOverlay
                    ? isSub
                      ? 0.5
                      : 0.75
                    : 1,
              zIndex: chip.loud ? 43 : isSelected ? 42 : 41,
            }}
            data-testid="agent-overlay"
            data-agent-id={id}
            data-state={vState}
          >
            {/* State chip: SHAPE + TEXT (primary signal, colorblind-safe) */}
            <span className={`state-chip ${chip.chipClass}`} data-testid="agent-state-chip">
              <span className="state-chip__glyph">{chip.glyph}</span>
              {chip.label}
            </span>
            <div className="flex items-center border-border px-6 pt-2 pb-3 gap-5 pixel-panel whitespace-nowrap max-w-2xs mt-2">
              <div className="flex flex-col gap-1 overflow-hidden">
                {teamRoleLabel && (
                  <span
                    className="text-xs overflow-hidden text-ellipsis block leading-none"
                    style={{
                      color: ch.isTeamLead ? TEAM_LEAD_COLOR : TEAM_ROLE_COLOR,
                      fontWeight: ch.isTeamLead ? 'bold' : undefined,
                    }}
                  >
                    {/* Role is TEXT ("LEAD" / name); color is reinforcement only */}
                    {teamRoleLabel}
                  </span>
                )}
                <span
                  className={`overflow-hidden text-ellipsis block leading-none ${isSub ? 'text-sm italic' : 'text-sm'}`}
                >
                  {activityText}
                </span>
                {!isSub && (
                  <span
                    className="text-2xs leading-none overflow-hidden text-ellipsis block"
                    data-testid="agent-machine-label"
                  >
                    {/* Identity as TEXT (colorblind rule: never color-only). */}
                    {nameTag}
                  </span>
                )}
              </div>
              {isSelected && !isSub && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseAgent(id);
                  }}
                  title="Close agent"
                  className="ml-2 shrink-0 leading-none"
                >
                  ×
                </Button>
              )}
            </div>
            {isTeamAgent && totalTokens > 0 && (
              <div
                className="flex items-center gap-3"
                style={{ marginTop: 2 }}
                title={`${tokenPct}% context used (${(totalTokens / 1000).toFixed(0)}k tokens)`}
              >
                <div
                  style={{
                    width: FUEL_GAUGE_WIDTH_PX,
                    height: FUEL_GAUGE_HEIGHT_PX,
                    background: FUEL_GAUGE_BG,
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(tokenRatio * 100, 100)}%`,
                      height: '100%',
                      background: getFuelColor(tokenRatio),
                    }}
                  />
                </div>
                {/* Percent as TEXT so the gauge reads in grayscale (bar color
                    thresholds are reinforcement only) */}
                <span className="text-2xs leading-none" style={{ textShadow: PIXEL_TEXT_SHADOW }}>
                  {tokenPct}%
                </span>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
