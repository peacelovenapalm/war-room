import * as path from 'path';

import { employeeId } from '../../core/src/employeeId.js';
import type { AgentEvent, HookProvider } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import { buffsForDesk, globalBuffs } from './buildingBuffs.js';
import { COWORKER_ADAPTER_HOOK_SOURCE, SESSION_END_GRACE_MS } from './constants.js';
import { dossierDerivation } from './dossierDerivation.js';
import { economyStore } from './economyStore.js';
import { employeeStore, XP_TURN } from './employeeStore.js';
import { getOfficeLayout } from './officeLayoutStore.js';
import { progression } from './progressionStore.js';
import type { PendingExternalSession, SessionRouter } from './sessionRouter.js';
import { shiftStats } from './shiftStats.js';
import { getInlineTeammates, hasInlineTeammates } from './teamUtils.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './timerManager.js';
import type { AgentState } from './types.js';

const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';

/** The V8 client-side distill fields carried on a sessionEnd AgentEvent,
 *  forwarded to RuntimeLifecycleCallbacks.onSessionEnd unchanged. */
export type SessionEndDistillFields = Pick<
  Extract<AgentEvent, { kind: 'sessionEnd' }>,
  'distilledNote' | 'distillSkipped' | 'distillFailed' | 'distillFailReason'
>;

/** Normalized hook event received from any provider's hook script via the HTTP server. */
export interface HookEvent {
  /** Hook event name (e.g., 'Stop', 'PermissionRequest', 'Notification') */
  hook_event_name: string;
  /** Claude Code session ID, maps to JSONL filename */
  session_id: string;
  /** Additional provider-specific fields (notification_type, tool_name, etc.) */
  [key: string]: unknown;
}

/**
 * Dispatches normalized AgentEvents to agents based on session_id.
 * Session routing (session→agent mapping, pending sessions, event buffering)
 * is delegated to an injected SessionRouter instance.
 *
 * When an event is successfully delivered, sets `agent.hookDelivered = true` which
 * suppresses heuristic timers (permission 7s, text-idle 5s) for that agent.
 */
/** Callback for session lifecycle events detected via hooks. */
interface SessionLifecycleCallbacks {
  /** Called when an external session is detected (unknown session_id in SessionStart).
   *  transcriptPath is undefined for providers without transcripts (OpenCode, Copilot)
   *  AND for remote machines (transcript lives on the remote host — hooks-only).
   *  machine is the remote machine's TEXT label, undefined for local sessions. */
  onExternalSessionDetected?: (
    sessionId: string,
    transcriptPath: string | undefined,
    cwd: string,
    machine?: string,
    providerId?: string,
    pid?: number,
    managedLaunch?: boolean,
  ) => boolean;
  /** Called when /clear is detected via hooks (SessionEnd reason=clear + SessionStart source=clear). */
  onSessionClear?: (
    agentId: number,
    newSessionId: string,
    newTranscriptPath: string | undefined,
  ) => void;
  /** Called when /clear or /resume keeps the agent alive but the ended
   *  session's captured distill payload still needs to be persisted. */
  onSessionDistill?: (
    agentId: number,
    endedSessionId: string,
    distill: SessionEndDistillFields,
  ) => void;
  /** Called when a session is resumed (--resume). Clears dismissals so the file can be re-adopted. */
  onSessionResume?: (transcriptPath: string) => void;
  /** Called when a session ends (exit/logout). `distill` carries the V8
   *  client-side distill payload from the SessionEnd hook event, if any
   *  (see AgentEvent's sessionEnd kind in core/src/provider.ts). */
  onSessionEnd?: (agentId: number, reason: string, distill?: SessionEndDistillFields) => void;
  /** Called when an Agent Teams teammate is detected via SubagentStart hook.
   *  Triggers scanning of the session's subagents/ directory for the teammate's JSONL. */
  onTeammateDetected?: (parentAgentId: number, sessionId: string, agentType: string) => void;
  /** Called when a teammate should be removed (e.g. no longer in team config members).
   *  Removes the teammate agent from the office. */
  onTeammateRemoved?: (teammateAgentId: number) => void;
}

export class HookEventHandler {
  private lifecycleCallbacks: SessionLifecycleCallbacks = {};
  private readonly pendingSessionDistills = new Map<
    number,
    { sessionId: string; distill: SessionEndDistillFields }
  >();

  /** Highest HookProvider.protocolVersion this handler understands. */
  private static readonly SUPPORTED_PROTOCOL_VERSION = 1;

  constructor(
    private agents: AgentStateStore,
    private waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
    private permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
    private defaultProvider: HookProvider,
    private sessionRouter: SessionRouter,
    private watchAllSessionsRef?: { current: boolean },
    private providerRegistry: ReadonlyMap<string, HookProvider> = new Map([
      [defaultProvider.id, defaultProvider],
    ]),
  ) {
    for (const provider of new Set([defaultProvider, ...providerRegistry.values()])) {
      if (provider.protocolVersion !== HookEventHandler.SUPPORTED_PROTOCOL_VERSION) {
        console.warn(
          `[Pixel Agents] HookProvider "${provider.id}" reports protocolVersion=${provider.protocolVersion}, ` +
            `but handler understands ${HookEventHandler.SUPPORTED_PROTOCOL_VERSION}. ` +
            `Events from this provider will be dropped.`,
        );
      }
    }
  }

  private providerFor(providerId: string): HookProvider {
    return this.providerRegistry.get(providerId) ?? this.defaultProvider;
  }

  /** Merged set of tool names that spawn subagents (teammates + within-turn subagents
   *  when a team provider is attached, or the base HookProvider set otherwise). */
  private getSubagentToolSet(provider: HookProvider): ReadonlySet<string> {
    if (provider.team) {
      return new Set<string>([
        ...provider.team.teammateSpawnTools,
        ...provider.team.withinTurnSubagentTools,
      ]);
    }
    return provider.subagentToolNames;
  }

  /** Check if a session is tracked (in workspace project dir, or Watch All Sessions ON). */
  private isTrackedSession(transcriptPath?: string, cwd?: string): boolean {
    if (this.watchAllSessionsRef?.current) return true;
    const projectDir = transcriptPath ? path.dirname(transcriptPath) : cwd;
    if (!projectDir) return false;
    return [...this.agents.values()].some(
      (a) => path.resolve(a.projectDir).toLowerCase() === path.resolve(projectDir).toLowerCase(),
    );
  }

  /** Set callbacks for session lifecycle events (SessionStart/SessionEnd). */
  setLifecycleCallbacks(callbacks: SessionLifecycleCallbacks): void {
    this.lifecycleCallbacks = callbacks;
  }

  private promotePendingSession(pending: PendingExternalSession): boolean {
    const callback = this.lifecycleCallbacks.onExternalSessionDetected;
    const adopted = pending.managedLaunch
      ? callback?.(
          pending.sessionId,
          pending.transcriptPath,
          pending.cwd,
          pending.machine,
          pending.providerId,
          pending.pid,
          true,
        )
      : callback?.(
          pending.sessionId,
          pending.transcriptPath,
          pending.cwd,
          pending.machine,
          pending.providerId,
          pending.pid,
        );
    const adoptedId = this.sessionRouter.resolve(pending.sessionId);
    const adoptedAgent = adoptedId === undefined ? undefined : this.agents.get(adoptedId);
    if (adopted !== true && !adoptedAgent) return false;
    if (pending.hookDelivered === false) {
      if (adoptedAgent) adoptedAgent.hookDelivered = false;
    }
    return true;
  }

  /**
   * Record newly-arrived pid telemetry on an already-known agent and tell the
   * webview live (mechanic #6b FOCUS). Agents created directly from a pending
   * external session get their pid at creation time (onExternalSessionDetected);
   * this covers agents that existed BEFORE the forwarder's X-Pid header started
   * arriving (e.g. locally-discovered sessions, or forwarder installed mid-session).
   * No-op when pid is absent or unchanged -- avoids a broadcast storm on every event.
   */
  private updateAgentPid(agent: AgentState, agentId: number, pid: number | undefined): void {
    if (pid === undefined || agent.pid === pid) return;
    agent.pid = pid;
    this.agents.broadcast({ type: 'agentPidUpdate', id: agentId, pid });
  }

  /** Register an agent for hook event routing. Flushes any buffered events for this session. */
  registerAgent(sessionId: string, agentId: number): void {
    const flushed = this.sessionRouter.register(sessionId, agentId);
    if (debug && flushed.length > 0)
      console.log(
        `[Pixel Agents] Hook: flushing ${flushed.length} buffered event(s) for session ${sessionId.slice(0, 8)}...`,
      );
    for (const { providerId, event } of flushed) {
      this.handleEvent(providerId, event as HookEvent);
    }
  }

  /** Remove an agent's session mapping (called on agent removal/terminal close). */
  unregisterAgent(sessionId: string): void {
    this.sessionRouter.unregister(sessionId);
  }

  /**
   * Process an incoming hook event. Looks up the agent by session_id,
   * falls back to auto-discovery scan, or buffers if agent not yet registered.
   * @param providerId - Provider that sent the event ('claude', 'codex', etc.)
   * @param event - The hook event payload from the CLI tool
   */
  handleEvent(providerId: string, event: HookEvent): void {
    const provider = this.providerFor(providerId);
    if (provider.protocolVersion !== HookEventHandler.SUPPORTED_PROTOCOL_VERSION) {
      return; // version mismatch already logged in constructor
    }
    // ── Provider normalization boundary ───────────────────────────────────────
    // All raw Claude-specific fields (tool_name, tool_input, agent_type, notification_type,
    // reason, source) are extracted by provider.normalizeHookEvent. Downstream dispatch
    // uses the normalized AgentEvent.kind. Raw `event.*` reads are still allowed in a few
    // places for provider-specific metadata that AgentEvent doesn't capture (transcript_path,
    // cwd for external-session adoption; agent_type for teammate routing).
    const normalized = provider.normalizeHookEvent(event);
    if (!normalized) return; // unknown / uninteresting event -- silently drop
    const normEvent = normalized.event;
    const eventName = event.hook_event_name; // retained for logs only
    const fromCoworkerAdapter = event.__source === COWORKER_ADAPTER_HOOK_SOURCE;
    // Machine identity label injected at the HTTP boundary (httpServer.ts) for
    // authenticated remote hook events. Present => this event came from another
    // machine; its transcript_path was already stripped (hooks-only adoption).
    const machine = typeof event.__machine === 'string' ? event.__machine : undefined;
    // OS pid injected at the HTTP boundary (httpServer.ts) from the hook
    // forwarder's X-Pid header. Present for both local and remote sessions --
    // it flows through the same authenticated route regardless of machine.
    // Drives the agent-drawer FOCUS button (mechanic #6b).
    const pid = typeof event.__pid === 'number' ? event.__pid : undefined;
    const managedLaunch = event.__managedLaunch === true;
    // CI / e2e diagnostic: see agentStateStore.ts debugLogBroadcast comment.
    if (process.env['PIXEL_AGENTS_DEBUG_LOG']) {
      try {
        const fs = require('fs') as typeof import('fs');
        const sid = (event.session_id as string | undefined)?.slice(0, 8) ?? '?';
        const extras =
          normEvent.kind === 'toolStart'
            ? ` toolName=${(normEvent as { toolName?: string }).toolName}`
            : '';
        fs.appendFileSync(
          process.env['PIXEL_AGENTS_DEBUG_LOG']!,
          `${new Date().toISOString()} HOOK kind=${normEvent.kind} sid=${sid} src=${(normEvent as { source?: string }).source ?? ''}${extras}\n`,
        );
      } catch {
        /* never crash on diagnostic failure */
      }
    }

    // --- SessionStart: handle /clear for known agents, ignore unknown sessions ---
    // External session detection via SessionStart is deferred to Phase C.
    // For now, only use SessionStart for:
    //   1. Confirming known agents (set hookDelivered)
    //   2. /clear reassignment (source=clear + pendingClear agent)
    if (normEvent.kind === 'sessionStart') {
      const sid = event.session_id.slice(0, 8);
      const source = normEvent.source ?? 'unknown';
      const transcriptPath = normEvent.transcriptPath;
      const cwd = normEvent.cwd;
      const tracked = this.isTrackedSession(transcriptPath, cwd);
      if (debug && tracked)
        console.log(`[Pixel Agents] Hook: SessionStart(source=${source}, session=${sid}...)`);

      // Check registered mapping
      const existingAgentId = this.sessionRouter.resolve(event.session_id);
      if (existingAgentId !== undefined) {
        const agent = this.agents.get(existingAgentId);
        if (agent) {
          if (!fromCoworkerAdapter) agent.hookDelivered = true;
          if (providerId !== this.defaultProvider.id) agent.providerId = providerId;
          this.updateAgentPid(agent, existingAgentId, pid);
        }
        if (debug)
          console.log(
            `[Pixel Agents] Hook: Agent ${existingAgentId} - SessionStart(source=${source}) known`,
          );
        return;
      }
      // Check auto-discovery (agent exists but not yet registered for hooks)
      for (const [id, agent] of this.agents) {
        if (agent.sessionId === event.session_id) {
          this.registerAgent(agent.sessionId, id);
          if (!fromCoworkerAdapter) agent.hookDelivered = true;
          if (providerId !== this.defaultProvider.id) agent.providerId = providerId;
          this.updateAgentPid(agent, id, pid);
          if (debug)
            console.log(
              `[Pixel Agents] Hook: Agent ${id} - SessionStart(source=${source}) auto-discovered`,
            );
          return;
        }
      }
      // /clear or /resume: reassign existing agent to new session
      if (normEvent.source === 'clear' || normEvent.source === 'resume') {
        const projectDir = transcriptPath ? path.dirname(transcriptPath) : cwd;
        if (projectDir) {
          for (const [id, agent] of this.agents) {
            // Both /clear and /resume send SessionEnd first (sets pendingClear),
            // then SessionStart. Match the agent that has pendingClear in same project dir.
            // Normalize paths for cross-platform comparison (separators + case-insensitive
            // for Windows where drive letter casing differs: c:\ vs C:\).
            const isMatch =
              agent.pendingClear &&
              path.resolve(agent.projectDir).toLowerCase() ===
                path.resolve(projectDir).toLowerCase();
            if (isMatch) {
              const pendingDistill = this.pendingSessionDistills.get(id);
              if (pendingDistill?.sessionId === agent.sessionId) {
                this.pendingSessionDistills.delete(id);
                this.lifecycleCallbacks.onSessionDistill?.(
                  id,
                  pendingDistill.sessionId,
                  pendingDistill.distill,
                );
              }
              agent.pendingClear = false;
              console.log(
                `[Pixel Agents] Hook: Agent ${id} - /${normEvent.source} detected, reassigning to ${event.session_id}`,
              );
              this.sessionRouter.unregister(agent.sessionId);
              this.registerAgent(event.session_id, id);
              this.lifecycleCallbacks.onSessionClear?.(id, event.session_id, transcriptPath);
              return;
            }
          }
        }
      }
      // Unknown session -- store as pending, create only when a confirmation event
      // arrives (Stop, Notification, PermissionRequest). This filters transient sessions
      // from Claude Code Extension which fire SessionStart + SessionEnd without any activity.
      if (transcriptPath || cwd) {
        // For --resume, clear dismissals so the file can be re-adopted
        if (normEvent.source === 'resume' && transcriptPath) {
          this.lifecycleCallbacks.onSessionResume?.(transcriptPath);
        }
        if (debug && tracked)
          console.log(
            `[Pixel Agents] Hook: SessionStart(source=${source}) -> pending external session ${sid}..., awaiting confirmation`,
          );
        this.sessionRouter.storePending(event.session_id, {
          sessionId: event.session_id,
          transcriptPath,
          cwd: cwd ?? '',
          machine,
          providerId,
          pid,
          hookDelivered: !fromCoworkerAdapter,
          managedLaunch,
        });
        // Claude keeps its transient-session filter: SessionStart alone is not
        // enough to create an agent. Codex has no equivalent noisy extension
        // sessions, and native SessionStart is its only immediate board-entry
        // signal, so promote it without waiting for a second event.
        if (
          provider.id !== this.defaultProvider.id &&
          this.lifecycleCallbacks.onExternalSessionDetected
        ) {
          const pending = this.sessionRouter.confirmPending(event.session_id);
          if (pending) this.promotePendingSession(pending);
        }
      } else {
        if (debug && tracked)
          console.log(
            `[Pixel Agents] Hook: SessionStart -> unknown session ${sid}..., no transcript_path`,
          );
      }
      return;
    }

    // --- All other events: standard agent lookup ---
    // If SessionEnd arrives for a pending external session, discard it (transient session)
    if (normEvent.kind === 'sessionEnd' && this.sessionRouter.hasPending(event.session_id)) {
      this.sessionRouter.discardPending(event.session_id);
      if (debug)
        console.log(
          `[Pixel Agents] Hook: SessionEnd discarded pending external session ${event.session_id.slice(0, 8)}...`,
        );
      return;
    }

    // Remote sessions (authenticated hook path) that we have no record of --
    // e.g. the session was already running when this server started, so we never
    // saw its SessionStart. Instead of silently dropping, store a pending record
    // now; the confirmPending block below immediately promotes it to an agent.
    // Local unknown sessions keep the original behavior (drop/buffer) because the
    // JSONL scanner is the authority for local discovery.
    if (
      (machine || fromCoworkerAdapter || provider.id !== this.defaultProvider.id) &&
      normEvent.kind !== 'sessionEnd' && // don't resurrect a session just to end it
      this.sessionRouter.resolve(event.session_id) === undefined &&
      !this.sessionRouter.hasPending(event.session_id) &&
      ![...this.agents.values()].some((a) => a.sessionId === event.session_id)
    ) {
      this.sessionRouter.storePending(event.session_id, {
        sessionId: event.session_id,
        transcriptPath: undefined,
        cwd: typeof event.cwd === 'string' ? event.cwd : '',
        machine,
        providerId,
        pid,
        hookDelivered: !fromCoworkerAdapter,
        managedLaunch,
      });
    }

    // If a confirmation event arrives for a pending external session, create the agent first
    const pending = this.sessionRouter.confirmPending(event.session_id);
    if (pending) {
      const adopted = this.promotePendingSession(pending);
      if (debug) {
        console.log(
          `[Pixel Agents] Hook: ${eventName} confirmed external session ${event.session_id.slice(0, 8)}... ${adopted ? 'created agent' : 'adoption rejected'}`,
        );
      }
      // Re-process only after the callback actually registered an agent.
      if (adopted) this.handleEvent(providerId, event);
      return;
    }

    let agentId = this.sessionRouter.resolve(event.session_id);
    if (agentId === undefined) {
      for (const [id, agent] of this.agents) {
        if (agent.sessionId === event.session_id) {
          this.registerAgent(agent.sessionId, id);
          agentId = id;
          break;
        }
      }
    }
    if (agentId === undefined) {
      // Buffer if: pending external session, already buffering for this session,
      // OR agents exist that haven't been registered yet (internal agent race:
      // hook event arrives before registerAgent is called after launchNewTerminal).
      // Silently drop events for sessions we have no record of
      // (e.g. other projects with Watch All OFF).
      const isPending = this.sessionRouter.hasPending(event.session_id);
      const hasBuffered = this.sessionRouter.hasBuffered(event.session_id);
      const hasUnregisteredAgents = [...this.agents.values()].some(
        (a) => a.sessionId && !this.sessionRouter.hasSession(a.sessionId),
      );
      if (isPending || hasBuffered || hasUnregisteredAgents) {
        if (debug)
          console.log(
            `[Pixel Agents] Hook: ${eventName} - unknown session ${event.session_id.slice(0, 8)}..., buffering`,
          );
        this.sessionRouter.bufferEvent(providerId, event);
      }
      return;
    }

    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Dedupe rule: rollout fallback activity drives sessions only until a native
    // hook has arrived. The adapter never sets hookDelivered itself; once a
    // native event sets it, later adapter activity is dropped. Synthetic
    // SessionEnd remains accepted because Codex has no native end event.
    if (fromCoworkerAdapter && agent.hookDelivered && normEvent.kind !== 'sessionEnd') return;
    if (!fromCoworkerAdapter) agent.hookDelivered = true;
    if (providerId !== this.defaultProvider.id) agent.providerId = providerId;
    this.updateAgentPid(agent, agentId, pid);
    if (debug)
      console.log(
        `[Pixel Agents] Hook: Agent ${agentId} - ${eventName} (session=${event.session_id.slice(0, 8)}...)`,
      );

    // Dispatch on normalized AgentEvent.kind, not raw hook event names.
    // The TeammateIdle / TaskCompleted hooks normalize to `subagentTurnEnd` -- both
    // carry `agent_type` in the raw payload, which we pass to the team-routing handler.
    switch (normEvent.kind) {
      case 'sessionEnd':
        return this.handleSessionEnd(normEvent, agent, agentId, provider);
      case 'toolStart':
        return this.handlePreToolUse(normEvent, agent, agentId, provider);
      case 'toolEnd':
        // Both PostToolUse and PostToolUseFailure normalize to toolEnd. Distinguishing
        // them inside handlers would require extra info; the existing behavior was
        // identical for both (agentToolDone + clear currentHookToolId), so one branch suffices.
        return this.handlePostToolUse(normEvent, agent, agentId);
      case 'subagentStart':
        return this.handleSubagentStart(event, normEvent, agent, agentId, provider);
      case 'subagentEnd':
        return this.handleSubagentStop(normEvent, agent, agentId, provider);
      case 'permissionRequest':
        // Handles BOTH the PermissionRequest hook AND the Notification(permission_prompt)
        // hook -- normalizeHookEvent collapses them into one event kind.
        return this.handlePermissionRequest(agent, agentId);
      case 'turnEnd':
        // Handles Stop AND Notification(idle_prompt) -- both normalize to turnEnd.
        // awaitingInput discriminates them: idle_prompt sets it (-> "Waiting for
        // input"), Stop leaves it absent (-> "Done").
        return this.handleStop(agent, agentId, provider, normEvent.awaitingInput === true);
      case 'subagentTurnEnd':
        // Handles TeammateIdle AND TaskCompleted -- both normalize here. The normalized
        // `reason` field discriminates; the team-provider's extractTeammateNameFromEvent(raw)
        // still routes to the specific teammate. (TaskCreated normalizes to null in the provider.)
        if (!provider.team) return;
        if (normEvent.reason === 'completed') {
          return this.handleTaskCompleted(event, agentId, provider);
        }
        return this.handleTeammateIdle(event, agent, agentId, provider);
      case 'progress':
        // Not yet consumed by the office visualization. Silently drop.
        return;
    }
  }

  /**
   * Handle SessionEnd: /clear marks pendingClear (SessionStart follows),
   * exit/logout marks agent waiting or triggers cleanup.
   */
  private handleSessionEnd(
    normEvent: Extract<AgentEvent, { kind: 'sessionEnd' }>,
    agent: AgentState,
    agentId: number,
    provider: HookProvider,
  ): void {
    const reason = normEvent.reason;
    const distill: SessionEndDistillFields = {
      distilledNote: normEvent.distilledNote,
      distillSkipped: normEvent.distillSkipped,
      distillFailed: normEvent.distillFailed,
      distillFailReason: normEvent.distillFailReason,
    };
    if (debug)
      console.log(
        `[Pixel Agents] Hook: Agent ${agentId} - SessionEnd(reason=${reason ?? 'unknown'})`,
      );

    // /clear and /resume send SessionEnd then SessionStart. Wait briefly for the follow-up.
    // All other reasons (exit, logout, prompt_input_exit) are final -- despawn immediately.
    const expectsFollowUp = reason === 'clear' || reason === 'resume';

    if (expectsFollowUp) {
      agent.pendingClear = true;
      this.pendingSessionDistills.set(agentId, { sessionId: agent.sessionId, distill });
      this.markAgentWaiting(agent, agentId, provider);
      if (debug)
        console.log(
          `[Pixel Agents] Hook: Agent ${agentId} - SessionEnd(reason=${reason}), awaiting possible SessionStart`,
        );
      // Safety net: if SessionStart never arrives, clean up the zombie agent
      setTimeout(() => {
        const pendingDistill = this.pendingSessionDistills.get(agentId);
        if (agent.pendingClear && pendingDistill?.sessionId === agent.sessionId) {
          this.pendingSessionDistills.delete(agentId);
          agent.pendingClear = false;
          this.lifecycleCallbacks.onSessionEnd?.(agentId, reason, pendingDistill.distill);
        }
      }, SESSION_END_GRACE_MS);
    } else {
      this.pendingSessionDistills.delete(agentId);
      // Immediate cleanup for exit/logout. onSessionEnd → removeTeammates in the
      // ViewProvider cleans up all teammates of this lead at once.
      this.markAgentWaiting(agent, agentId, provider);
      this.lifecycleCallbacks.onSessionEnd?.(agentId, reason ?? 'unknown', distill);
    }
  }

  /**
   * Handle PreToolUse: instantly mark agent as active (cancel waiting state).
   * JSONL still handles detailed tool tracking (toolId, status text, webview messages).
   * This just ensures the character starts animating without waiting for the 500ms JSONL poll.
   */
  private handlePreToolUse(
    normEvent: Extract<AgentEvent, { kind: 'toolStart' }>,
    agent: AgentState,
    agentId: number,
    provider: HookProvider,
  ): void {
    const toolName = normEvent.toolName;
    const toolInput = (normEvent.input as Record<string, unknown> | undefined) ?? {};
    const status = normEvent.status ?? provider.formatToolStatus(toolName, toolInput);
    const hookToolId = normEvent.toolId;

    // Track for PostToolUse/SubagentStart correlation (always, even if suppressed below).
    // currentHookIsTeammateSpawn is the authoritative teammate-vs-subagent discriminator.
    // It is NOT cleared in PostToolUse to survive the PostToolUse-before-SubagentStart race.
    agent.currentHookToolId = hookToolId;
    agent.currentHookToolName = toolName;
    agent.currentHookIsTeammateSpawn =
      provider.team?.isTeammateSpawnCall(toolName, toolInput) ?? false;

    // When a lead has inline teammates, hook tool events are ambiguous (could be
    // from the lead or any teammate -- they share session_id). Suppress hook-originated
    // tool display on the lead. Both lead and teammate tools display via JSONL polling.
    if (hasInlineTeammates(agentId, this.agents)) return;

    // Cancel waiting, mark active
    cancelWaitingTimer(agentId, this.waitingTimers);
    agent.isWaiting = false;
    agent.awaitingInput = false;
    // A tool actually running means any permission prompt was answered —
    // broadcast the clear, or the webview's toolPermission flag sticks
    // forever on hook-delivered agents (fileWatcher's clear is skipped for
    // them) and the sprite reads NEEDS INPUT while visibly working.
    if (agent.permissionSent) {
      this.agents.broadcast({ type: 'agentToolPermissionClear', id: agentId });
    }
    agent.permissionSent = false;
    agent.hadToolsInTurn = true;

    // Send tool start + active state to webview (instant, no 500ms JSONL delay).
    // Skip for Task/Agent tools — their sub-agent characters need the stable JSONL
    // tool ID (not the transient hook ID) so that SubagentStop/tool_result cleanup
    // can find and remove them. JSONL handles agentToolStart (with runInBackground)
    // for these tools.
    if (toolName !== 'Task' && toolName !== 'Agent') {
      this.agents.broadcast({
        type: 'agentToolStart',
        id: agentId,
        toolId: hookToolId,
        status,
        toolName,
      });
    }
    this.agents.broadcast({
      type: 'agentStatus',
      id: agentId,
      status: 'active',
    });
  }

  /**
   * Handle PostToolUse: no action needed. JSONL handles tool_result processing.
   * Stop hook handles the idle transition. This is here for completeness and
   * to serve as a confirmation event for pending external sessions.
   */
  private handlePostToolUse(
    normEvent: Extract<AgentEvent, { kind: 'toolEnd' }>,
    agent: AgentState,
    agentId: number,
  ): void {
    const toolId = normEvent.toolId === 'current' ? agent.currentHookToolId : normEvent.toolId;
    if (toolId) {
      // Suppress tool display when lead has inline teammates (see handlePreToolUse)
      if (!hasInlineTeammates(agentId, this.agents)) {
        this.agents.broadcast({
          type: 'agentToolDone',
          id: agentId,
          toolId,
        });
      }
      if (normEvent.toolId === 'current' || agent.currentHookToolId === toolId) {
        agent.currentHookToolId = undefined;
        agent.currentHookToolName = undefined;
      }
    }
  }

  // NOTE: PostToolUseFailure used to have its own handler. The behavior was identical
  // to PostToolUse (emit agentToolDone, clear currentHookToolId). Both now normalize to
  // the 'toolEnd' AgentEvent kind and share handlePostToolUse.

  /**
   * Handle SubagentStart: notify webview that a sub-agent is spawning.
   *
   * For Agent Teams teammates (Agent tool with run_in_background), triggers
   * teammate discovery via lifecycle callback -- teammates become independent
   * agents with their own JSONL file watching.
   *
   * For old-style Task/Agent subagents (inline, no run_in_background), creates
   * the child character immediately via hooks without waiting for JSONL polling.
   */
  private handleSubagentStart(
    event: HookEvent,
    normEvent: Extract<AgentEvent, { kind: 'subagentStart' }>,
    agent: AgentState,
    agentId: number,
    provider: HookProvider,
  ): void {
    if (!provider.team) {
      let subTools = agent.activeSubagentToolIds.get(normEvent.parentToolId);
      if (!subTools) {
        subTools = new Set();
        agent.activeSubagentToolIds.set(normEvent.parentToolId, subTools);
      }
      subTools.add(normEvent.toolId);
      let subNames = agent.activeSubagentToolNames.get(normEvent.parentToolId);
      if (!subNames) {
        subNames = new Map();
        agent.activeSubagentToolNames.set(normEvent.parentToolId, subNames);
      }
      subNames.set(normEvent.toolId, normEvent.toolName);
      this.agents.broadcast({
        type: 'subagentToolStart',
        id: agentId,
        parentToolId: normEvent.parentToolId,
        toolId: normEvent.toolId,
        status: normEvent.status ?? `Subtask: ${normEvent.toolName}`,
      });
      return;
    }

    const agentType = provider.team.extractTeammateNameFromEvent(event) ?? 'unknown';

    // Decide path: teammate spawn vs basic within-turn subagent.
    // Two conditions must BOTH hold for the teammate path:
    //   1. currentHookIsTeammateSpawn === true -- this specific tool call has the
    //      teammate-spawn flag (e.g. Agent with run_in_background=true)
    //   2. agent.teamName set -- JSONL has confirmed this agent is a team lead.
    //      Without this guard, external sessions firing run_in_background=true
    //      for parallel basic subagents would be mis-routed to teammate discovery.
    // Mirrors the same gate used by the periodic scanAllTeammateFiles fallback.
    if (agent.currentHookIsTeammateSpawn === true && agent.teamName) {
      if (debug)
        console.log(
          `[Pixel Agents] Hook: Agent ${agentId} - SubagentStart: teammate "${agentType}" detected, triggering discovery`,
        );
      this.lifecycleCallbacks.onTeammateDetected?.(agentId, event.session_id, agentType);
      return;
    }

    // Basic within-turn subagent path: find parent tool ID from activeToolNames.
    // Use only the real JSONL-populated id -- no synthetic fallback here, or we'd
    // double-track parents once JSONL catches up.
    const parentTools = this.getSubagentToolSet(provider);
    let parentToolId: string | undefined;
    for (const [toolId, toolName] of agent.activeToolNames) {
      if (parentTools.has(toolName)) {
        parentToolId = toolId;
        break;
      }
    }
    if (!parentToolId) return; // JSONL will handle it via agent_progress tool_use

    // Create child sub-agent character immediately (same as old behavior).
    const subToolId = `hook-sub-${agentType}-${Date.now()}`;
    const status = `Subtask: ${agentType}`;

    // Track sub-agent
    let subTools = agent.activeSubagentToolIds.get(parentToolId);
    if (!subTools) {
      subTools = new Set();
      agent.activeSubagentToolIds.set(parentToolId, subTools);
    }
    subTools.add(subToolId);

    let subNames = agent.activeSubagentToolNames.get(parentToolId);
    if (!subNames) {
      subNames = new Map();
      agent.activeSubagentToolNames.set(parentToolId, subNames);
    }
    subNames.set(subToolId, agentType);

    this.agents.broadcast({
      type: 'subagentToolStart',
      id: agentId,
      parentToolId,
      toolId: subToolId,
      status,
    });
  }

  /**
   * Handle SubagentStop: notify webview that a sub-agent finished.
   *
   * For Agent Teams teammates: marks all teammate agents as waiting (they're
   * independent agents, not sub-agent characters to destroy).
   *
   * For old-style Task subagents: removes the child character from the office.
   */
  private handleSubagentStop(
    normEvent: Extract<AgentEvent, { kind: 'subagentEnd' }>,
    agent: AgentState,
    agentId: number,
    provider: HookProvider,
  ): void {
    if (!provider.team) {
      agent.activeSubagentToolIds.delete(normEvent.parentToolId);
      agent.activeSubagentToolNames.delete(normEvent.parentToolId);
      this.agents.broadcast({
        type: 'subagentClear',
        id: agentId,
        parentToolId: normEvent.parentToolId,
      });
      return;
    }
    // Check if this agent has inline teammates (independent agents with leadAgentId).
    // Just mark them waiting -- SubagentStop fires per-task-iteration; teammates may
    // sit idle for minutes between lead requests before being re-invoked.
    // Actual removal is driven by:
    //   - Periodic team config polling (scanTeamConfigsForRemovals) -- teammate
    //     removed when no longer in team config members list
    //   - SessionEnd on lead (removeTeammates in ViewProvider)
    const inlineTeammates = getInlineTeammates(agentId, this.agents);
    if (inlineTeammates.length > 0) {
      if (debug)
        console.log(
          `[Pixel Agents] Hook: Agent ${agentId} - SubagentStop: marking inline teammates as waiting`,
        );
      for (const [id, a] of inlineTeammates) {
        this.markAgentWaiting(a, id, provider);
      }
      return;
    }

    // Old-style within-turn subagents: find a parent tool that actually has tracked
    // sub-agents. The `activeSubagentToolIds.has(toolId)` gate below prevents us
    // from picking a subagent-spawning parent that already had its sub-agents
    // cleared in the same turn.
    const subagentParentTools = this.getSubagentToolSet(provider);
    let parentToolId: string | undefined;
    for (const [toolId, toolName] of agent.activeToolNames) {
      if (subagentParentTools.has(toolName) && agent.activeSubagentToolIds.has(toolId)) {
        parentToolId = toolId;
        break;
      }
    }
    if (!parentToolId) return; // JSONL will handle it via agent_progress tool_result

    agent.activeSubagentToolIds.delete(parentToolId);
    agent.activeSubagentToolNames.delete(parentToolId);
    this.agents.broadcast({
      type: 'subagentClear',
      id: agentId,
      parentToolId,
    });
  }

  /** Handle PermissionRequest: cancel heuristic timer, show permission bubble on agent + sub-agents. */
  private handlePermissionRequest(agent: AgentState, agentId: number): void {
    // When lead has inline teammates, route permission to the teammates instead.
    // The hook fires on the lead's session_id but the permission is for a teammate.
    const inlineTeammates = getInlineTeammates(agentId, this.agents);
    if (inlineTeammates.length > 0) {
      for (const [id, a] of inlineTeammates) {
        cancelPermissionTimer(id, this.permissionTimers);
        a.permissionSent = true;
        this.agents.broadcast({ type: 'agentToolPermission', id });
      }
      return;
    }

    cancelPermissionTimer(agentId, this.permissionTimers);
    agent.permissionSent = true;
    this.agents.broadcast({
      type: 'agentToolPermission',
      id: agentId,
    });
    // Also notify any sub-agents with active tools
    for (const parentToolId of agent.activeSubagentToolNames.keys()) {
      this.agents.broadcast({
        type: 'subagentToolPermission',
        id: agentId,
        parentToolId,
      });
    }
  }

  /** Handle Stop: Claude finished responding, mark agent as waiting. */
  private handleStop(
    agent: AgentState,
    agentId: number,
    provider: HookProvider,
    awaitingInput = false,
  ): void {
    // Shift report (v1 mechanic #2) + progression (v1 mechanic #3): a
    // finished turn (Stop) counts as a completion; going idle waiting on the
    // user does not. Coworker heartbeats (Codex/Gemini synthesize Stop but
    // contribute no JSONL tokens) are excluded so they can't deflate the
    // efficiency score or farm XP/streak from heartbeat noise.
    if (!awaitingInput && (!agent.providerId || agent.providerId === 'claude')) {
      shiftStats.recordTurnEnd();
      // Receipt ref (v3 REP receipts): the observed Stop event, named by
      // the durable staff lineage it belongs to — the one-tap-real
      // decomposition for the XP/Cash this turn mints.
      const turnSourceRef = `hook-stop:${employeeId(agent.machine, agent.projectDir)}`;
      progression.recordTurnEnd(turnSourceRef);
      // Employees (v2 mechanic G1, GAME-DESIGN §4): same real-event source
      // and exclusion as progression/shiftStats above — added alongside,
      // not instead of. outputTokens is the agent's cumulative session
      // total; employeeStore derives its own per-turn delta from it.
      //
      // Building (v2 mechanic G2, GAME-DESIGN §5.5): if this employee is
      // already on record and assigned to a desk, look up that desk's Dev
      // Pit room-membership XP bonus and pass it through as an explicit
      // xpOverride — buffs are computed server-side, point-in-time, at the
      // moment the real event resolves (never a client-side/cached read).
      // `assignedRoomId` holds the desk's PlacedFurniture uid (assign()'s
      // param name predates G2's buildings; it is used here as the desk-uid
      // reference the buff resolver needs).
      //
      // Server Room (§5.4) is a GLOBAL (non-desk) buff — read once off the
      // same point-in-time layout regardless of assignedRoomId, and pass
      // through to economyStore's Cash award below (economyStore.ts cannot
      // import officeLayoutStore.ts itself: officeLayoutStore already
      // imports economyStore, so a reverse import would cycle).
      let xpOverride: number | undefined;
      let cashBonusPct = 0;
      const existingEmp = employeeStore.getById(employeeId(agent.machine, agent.projectDir));
      const layout = getOfficeLayout();
      if (layout) {
        cashBonusPct = globalBuffs(layout).cashBonusPct;
        if (existingEmp?.assignedRoomId) {
          const buffs = buffsForDesk(layout, existingEmp.assignedRoomId);
          if (buffs.xpBonusPct > 0) {
            xpOverride = Math.round(XP_TURN * (1 + buffs.xpBonusPct / 100));
          }
        }
      }
      employeeStore.recordTurn(
        agent.machine,
        agent.projectDir,
        agent.folderName ?? path.basename(agent.projectDir),
        {
          outputTokensCumulative: agent.outputTokens,
          xpOverride,
        },
      );
      // Economy (v2 mechanic G2, GAME-DESIGN §3): same real-event source
      // and exclusion as above — Cash + the once/day streak-touch bonus,
      // plus the Server Room global Cash bonus computed above. Same
      // receipt ref as progression (identical source event).
      economyStore.recordTurnCompleted(turnSourceRef, undefined, cashBonusPct);
      // Dossiers (v3 WS-C stage 2): the same real Stop event feeds the
      // staff-lineage telemetry (turn count, night-hour fraction, output-
      // token burn) — added alongside, not instead of; dossierDerivation
      // derives its own per-turn token delta from the cumulative total,
      // keyed by THIS session (concurrent sessions in one checkout carry
      // independent cumulative counters — dossierDerivation.recordTurn).
      dossierDerivation.recordTurn(
        agent.machine,
        agent.projectDir,
        agent.folderName ?? path.basename(agent.projectDir),
        agent.outputTokens,
        Date.now(),
        agent.sessionId,
      );
    }
    this.markAgentWaiting(agent, agentId, provider, awaitingInput);
  }

  /**
   * Handle TeammateIdle: teammate signaled it's idle and available for work.
   * Routes to the specific teammate if identifiable by agent_type, otherwise
   * marks all inline teammates of this lead as waiting.
   * Fallback: if the agent has no inline teammates, mark the agent itself.
   */
  private handleTeammateIdle(
    event: HookEvent,
    agent: AgentState,
    agentId: number,
    provider: HookProvider,
  ): void {
    const agentType = provider.team?.extractTeammateNameFromEvent(event);
    const inlineTeammates = getInlineTeammates(agentId, this.agents);

    if (inlineTeammates.length === 0) {
      // No inline teammates — treat as a regular idle signal for this agent.
      // TeammateIdle is idle-semantics, so it surfaces "Waiting for input".
      this.markAgentWaiting(agent, agentId, provider, true);
      return;
    }

    // Match by agentName if provider extracted a name from the event
    if (agentType) {
      const match = inlineTeammates.find(([, a]) => a.agentName === agentType);
      if (match) {
        const [id, a] = match;
        if (debug)
          console.log(`[Pixel Agents] Hook: TeammateIdle "${agentType}" -> teammate Agent ${id}`);
        this.markAgentWaiting(a, id, provider, true);
        return;
      }
    }

    // Fallback: mark all inline teammates as waiting
    if (debug)
      console.log(
        `[Pixel Agents] Hook: TeammateIdle (no agent_type match) -> marking ${inlineTeammates.length} teammate(s) waiting`,
      );
    for (const [id, a] of inlineTeammates) {
      this.markAgentWaiting(a, id, provider, true);
    }
  }

  /**
   * Handle TaskCompleted: a teammate marked its task done.
   * Routes to the specific teammate when identifiable, marking it waiting instantly.
   */
  private handleTaskCompleted(event: HookEvent, agentId: number, provider: HookProvider): void {
    const subject = (event.subject as string) ?? '';
    const agentType = provider.team?.extractTeammateNameFromEvent(event);
    if (debug)
      console.log(
        `[Pixel Agents] Hook: Agent ${agentId} - TaskCompleted: ${subject}${agentType ? ` (agent_type=${agentType})` : ''}`,
      );

    const inlineTeammates = getInlineTeammates(agentId, this.agents);
    if (inlineTeammates.length === 0) return;

    // Match by agentName if available, otherwise mark all inline teammates waiting
    if (agentType) {
      const match = inlineTeammates.find(([, a]) => a.agentName === agentType);
      if (match) {
        const [id, a] = match;
        this.markAgentWaiting(a, id, provider);
        return;
      }
    }
    for (const [id, a] of inlineTeammates) {
      this.markAgentWaiting(a, id, provider);
    }
  }

  /**
   * Transition agent to waiting state. Clears foreground tools (preserves background
   * agents), cancels timers, and notifies the webview. Same logic as the turn_duration
   * handler in transcriptParser.ts.
   */
  private markAgentWaiting(
    agent: AgentState,
    agentId: number,
    provider: HookProvider,
    awaitingInput = false,
  ): void {
    cancelWaitingTimer(agentId, this.waitingTimers);
    cancelPermissionTimer(agentId, this.permissionTimers);

    // Clear foreground tools, preserve background agents (same logic as turn_duration handler).
    // ALWAYS send agentToolsClear at turn end -- even when activeToolIds is empty by now
    // (because tool_results already processed and removed them). Without this, stale
    // sub-agent characters and permission bubbles from the turn would never clear.
    const parentTools = this.getSubagentToolSet(provider);
    for (const toolId of [...agent.activeToolIds]) {
      if (agent.backgroundAgentToolIds.has(toolId)) continue;
      agent.activeToolIds.delete(toolId);
      agent.activeToolStatuses.delete(toolId);
      const toolName = agent.activeToolNames.get(toolId);
      agent.activeToolNames.delete(toolId);
      if (toolName && parentTools.has(toolName)) {
        agent.activeSubagentToolIds.delete(toolId);
        agent.activeSubagentToolNames.delete(toolId);
      }
    }
    this.agents.broadcast({ type: 'agentToolsClear', id: agentId });
    // Re-send background agent tools to restore them after the clear
    for (const toolId of agent.backgroundAgentToolIds) {
      const status = agent.activeToolStatuses.get(toolId);
      if (status) {
        this.agents.broadcast({
          type: 'agentToolStart',
          id: agentId,
          toolId,
          status,
        });
      }
    }

    agent.isWaiting = true;
    agent.awaitingInput = awaitingInput;
    // Turn ended — a permission prompt from this turn is over either way;
    // clear the webview flag (it survives forever otherwise, see
    // handlePreToolUse's matching clear).
    if (agent.permissionSent) {
      this.agents.broadcast({ type: 'agentToolPermissionClear', id: agentId });
    }
    agent.permissionSent = false;
    agent.hadToolsInTurn = false;
    agent.currentHookToolId = undefined;
    this.agents.broadcast({
      type: 'agentStatus',
      id: agentId,
      status: 'waiting',
      awaitingInput,
    });
  }

  /** Clean up timers and maps. Called when the extension disposes. */
  dispose(): void {
    this.sessionRouter.dispose();
  }
}
