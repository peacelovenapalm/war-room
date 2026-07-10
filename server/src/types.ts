import type * as vscode from 'vscode';

/** Agent session states surfaced by `claude agents --json` (research preview). */
export const POLL_STATE_VALUES = ['working', 'blocked', 'done', 'failed', 'stopped'] as const;
export type PollStateValue = (typeof POLL_STATE_VALUES)[number];

export interface AgentState {
  id: number;
  sessionId: string;
  /** Terminal reference — undefined for extension panel sessions */
  terminalRef?: vscode.Terminal;
  /** Whether this agent was detected from an external source (VS Code extension panel, etc.) */
  isExternal: boolean;
  projectDir: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
  activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
  backgroundAgentToolIds: Set<string>; // tool IDs for run_in_background Agent calls (stay alive until queue-operation)
  isWaiting: boolean;
  /** Idle-prompt discrimination of the LAST `agentStatus` broadcast: true =
   *  "Waiting for input" (idle_prompt), false/undefined = merely done/active.
   *  Mirrored beside every agentStatus broadcast so webviewReady can REPLAY
   *  the hook-plane NEEDS INPUT state to a reconnecting client — the same
   *  M4 pattern agentPollState uses (clientMessageHandler.ts step 8). */
  awaitingInput?: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
  /** Timestamp of last JSONL data received (ms since epoch) */
  lastDataAt: number;
  /** Total JSONL lines processed for this agent */
  linesProcessed: number;
  /** Set of record.type values we've already warned about (prevents log spam) */
  seenUnknownRecordTypes: Set<string>;
  /** Whether a hook event has been delivered for this agent (suppresses heuristic timers) */
  hookDelivered: boolean;
  /** True when agent has no transcript file (provider doesn't use JSONL). All state from hooks. */
  hooksOnly?: boolean;
  /** Machine identity label (e.g. "MACBOOK", "MINI"). Set for remote agents ingested
   *  via the authenticated hook path; absent = local machine (server fills its own label). */
  machine?: string;
  /** Provider that created this agent (defaults to 'claude') */
  providerId?: string;
  /** OS process id of the session, captured from the hook forwarder's X-Pid
   *  header (mechanic #6b FOCUS target). Absent until the first hook event
   *  carrying pid telemetry arrives for this session. */
  pid?: number;
  /** Latest state from the per-machine needs-input poller (`claude agents --json`).
   *  `at` = receipt time (ms epoch) for staleness sweeps. `since` = when the
   *  CURRENT state value was first reported (preserved across refresh ticks) —
   *  broadcast as `ageMs` so the webview can age crises (smoke → fire → alarm)
   *  without trusting client clocks. `lastBroadcastAt` throttles the periodic
   *  keep-fresh rebroadcast. Cleared when the poller stops reporting the
   *  session or goes silent past the TTL. */
  pollState?: {
    state: PollStateValue;
    waitingFor?: string;
    at: number;
    since: number;
    lastBroadcastAt: number;
  };
  /** Set when SessionEnd(reason=clear) fires; cleared when SessionStart(source=clear) reassigns */
  pendingClear?: boolean;
  /** Hook-generated tool ID for PreToolUse/PostToolUse correlation */
  currentHookToolId?: string;
  /** Tool name from the most recent PreToolUse, used to correlate a later SubagentStart
   *  event with the parent tool that launched it. */
  currentHookToolName?: string;
  /** True if the CURRENT PreToolUse tool call is a teammate spawn (per the provider's
   *  `team.isTeammateSpawnCall`). Authoritative source for teammate vs basic-subagent
   *  routing in SubagentStart. Set in PreToolUse, NOT cleared in PostToolUse (survives
   *  the PostToolUse-before-SubagentStart race); overwritten on the next PreToolUse. */
  currentHookIsTeammateSpawn?: boolean;

  // -- Token tracking --
  inputTokens: number;
  outputTokens: number;

  // -- Agent Teams --
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  /** True when lead spawns teammates via tmux (run_in_background Agent calls) */
  teamUsesTmux?: boolean;
}

export interface PersistedAgent {
  id: number;
  sessionId?: string;
  /** Terminal name — empty string for extension panel sessions */
  terminalName: string;
  /** Whether this agent was detected from an external source */
  isExternal?: boolean;
  jsonlFile: string;
  projectDir: string;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;

  // -- Agent Teams --
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}
