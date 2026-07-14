import { buildAgentDiagnostics } from './agentDiagnostics.js';
import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import type { LoadedAssets, LoadedCharacterSprites, LoadedPetSprites } from './assetLoader.js';
import { readConfig, writeConfig } from './configPersistence.js';
import { dispatchStore } from './dispatchStore.js';
import { readLayoutFromFile, writeLayoutToFile } from './layoutPersistence.js';
import type { OutputSource } from './outputRingStore.js';
import { outputRingStore, outputStreamKey } from './outputRingStore.js';
import { hookProviderCapabilities } from './providers/index.js';
import * as remoteTailDemand from './remoteTailDemand.js';

type WsSend = (message: Record<string, unknown>) => void;

/** Async hook toggle side effect (install/uninstall + script copy). Provided by cli.ts. */
export type SetHooksEnabledSideEffect = (enabled: boolean) => Promise<void> | void;

/** Cached legacy-face assets loaded at server startup. V3 loads its own
 * spritesheets over HTTP and never consumes these inline pixel arrays. */
export interface AssetCache {
  characters: LoadedCharacterSprites | null;
  pets: LoadedPetSprites | null;
  floorTiles: string[][][] | null;
  wallTiles: string[][][][] | null;
  furniture: LoadedAssets | null;
  defaultLayout: Record<string, unknown> | null;
}

export interface ClientMessageContext {
  store: AgentStateStore;
  runtime?: AgentRuntime;
  cache: AssetCache | null;
  /** Install/uninstall hooks side effect. Needs server url+token known only to cli.ts. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  /** TEXT label of the local machine; default machine identity for local agents. */
  machineLabel?: string;
  /** THIS connection's live tail subscriptions (KICKOFF-v2.0 Phase 2 —
   *  streaming plane), keyed by outputStreamKey(source, id). Owned by
   *  registerWebSocketRoute (one Set per socket, dropped with the socket);
   *  outputChunk fan-out delivers only to sockets whose Set holds the key. */
  tailSubscriptions?: Set<string>;
}

/** Narrow an incoming tailSubscribe/tailUnsubscribe payload. Invalid
 *  source/id are silently ignored (same posture as every other malformed
 *  client message in this file). */
function parseTailTarget(
  msg: Record<string, unknown>,
): { source: OutputSource; id: string } | undefined {
  const source = msg.source === 'agent' || msg.source === 'dispatch' ? msg.source : undefined;
  const id = typeof msg.id === 'string' && msg.id !== '' ? msg.id : undefined;
  if (!source || !id) return undefined;
  return { source, id };
}

// ── Setting key constants (mirror adapters/vscode/constants.ts) ──
const KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';
const KEY_LAST_SEEN_VERSION = 'pixel-agents.lastSeenVersion';
const KEY_ALWAYS_SHOW_LABELS = 'pixel-agents.alwaysShowLabels';
const KEY_WATCH_ALL_SESSIONS = 'pixel-agents.watchAllSessions';
const KEY_HOOKS_ENABLED = 'pixel-agents.hooksEnabled';
const KEY_HOOKS_INFO_SHOWN = 'pixel-agents.hooksInfoShown';

/**
 * Handle incoming ClientMessage from a WebSocket client.
 *
 * In standalone mode, the server is the authority for all state: assets,
 * layout, settings, agents. Assets are loaded once at startup and cached
 * in memory. Each connecting client receives the full state on webviewReady.
 */
export function handleClientMessage(
  msg: Record<string, unknown>,
  send: WsSend,
  ctx: ClientMessageContext,
): void {
  const { store, runtime } = ctx;
  const adapter = store.getAdapter();

  switch (msg.type) {
    case 'webviewReady':
      handleWebviewReady(send, ctx, msg.client === 'webview-v3');
      break;

    case 'saveLayout':
      if (msg.layout) {
        writeLayoutToFile(msg.layout as Record<string, unknown>);
      }
      break;

    case 'saveAgentSeats':
      if (msg.seats) {
        adapter?.saveSeats(
          msg.seats as Record<string, { palette?: number; hueShift?: number; seatId?: string }>,
        );
      }
      break;

    case 'setSoundEnabled':
      adapter?.setSetting(KEY_SOUND_ENABLED, msg.enabled);
      break;

    case 'setLastSeenVersion':
      adapter?.setSetting(KEY_LAST_SEEN_VERSION, msg.version as string);
      break;

    case 'setAlwaysShowLabels':
      adapter?.setSetting(KEY_ALWAYS_SHOW_LABELS, msg.enabled);
      break;

    case 'setWatchAllSessions': {
      const enabled = msg.enabled as boolean;
      adapter?.setSetting(KEY_WATCH_ALL_SESSIONS, enabled);
      if (runtime) runtime.watchAllSessions.current = enabled;
      break;
    }

    case 'setHooksEnabled': {
      const enabled = msg.enabled as boolean;
      adapter?.setSetting(KEY_HOOKS_ENABLED, enabled);
      if (runtime) runtime.hooksEnabled.current = enabled;
      void ctx.onSetHooksEnabled?.(enabled);
      break;
    }

    case 'setHooksInfoShown':
      adapter?.setSetting(KEY_HOOKS_INFO_SHOWN, true);
      break;

    case 'requestDiagnostics':
      send({ type: 'agentDiagnostics', agents: buildAgentDiagnostics(store) });
      break;

    // Dispatch (v1 mechanic #6b — "call a coworker"): enqueue only. The
    // server never shells out; a per-machine runner polls the queue and
    // decides locally. enqueue() broadcasts a `dispatchUpdate` (ringing or,
    // on validation failure, nothing) over the same WS plane every client
    // (including this one) already listens on -- no separate ack needed.
    case 'dispatchRequest': {
      // 'session' (v4 T2/T4): a managed interactive session launch — same
      // queue, same runner decision plane, deny-by-default runner capability.
      const action =
        msg.action === 'dispatch' || msg.action === 'focus' || msg.action === 'session'
          ? msg.action
          : undefined;
      const machine = typeof msg.machine === 'string' ? msg.machine : undefined;
      if (!action || !machine) break;
      dispatchStore.enqueue({
        action,
        machine,
        provider: typeof msg.provider === 'string' ? msg.provider : undefined,
        cwd: typeof msg.cwd === 'string' ? msg.cwd : undefined,
        prompt: typeof msg.prompt === 'string' ? msg.prompt : undefined,
        sessionId: typeof msg.sessionId === 'string' ? msg.sessionId : undefined,
        pid: typeof msg.pid === 'number' ? msg.pid : undefined,
        model: typeof msg.model === 'string' ? msg.model : undefined,
        effort: typeof msg.effort === 'string' ? msg.effort : undefined,
        // 4B permission-mode toggle — enum-validated inside enqueue().
        permissionMode: typeof msg.permissionMode === 'string' ? msg.permissionMode : undefined,
        // T8 Mini compute — opaque scriptId + plain-token args for a `shell`
        // dispatch; validated (and dropped for non-shell) inside enqueue().
        scriptId: typeof msg.scriptId === 'string' ? msg.scriptId : undefined,
        args: Array.isArray(msg.args)
          ? msg.args.filter((a): a is string => typeof a === 'string')
          : undefined,
        // T5 fleet controls, PER-DISPATCH TIME CAP — validated properly
        // inside dispatchStore.enqueue(); a non-number here is simply
        // dropped, same tolerance as every other optional field on this path.
        timeoutSec: typeof msg.timeoutSec === 'number' ? msg.timeoutSec : undefined,
        // Contract correlation (v2 mechanic G4, §6.2) — explicit, never
        // string-matched. Employee correlation (G3, §7.3) mirrors it.
        contractId: typeof msg.contractId === 'string' ? msg.contractId : undefined,
        employeeId: typeof msg.employeeId === 'string' ? msg.employeeId : undefined,
        // Send correlation (asyncapi DispatchRequest.requestId): echoed on
        // every dispatchUpdate so the sending client can match its own
        // sends exactly (no fuzzy machine+action matching).
        requestId: typeof msg.requestId === 'string' ? msg.requestId : undefined,
        // C3 born-managed wrapper — which client sent this (session-only;
        // enqueue() drops it for dispatch/focus and validates the enum).
        launchedVia: typeof msg.launchedVia === 'string' ? msg.launchedVia : undefined,
      });
      break;
    }

    // Live output tail (KICKOFF-v2.0 Phase 2 — streaming plane). TELEMETRY
    // routing only: subscribing registers THIS socket for a (source, id)
    // stream and immediately replays the ring buffer's retained chunks to
    // this socket alone — it never starts, stops, or steers the underlying
    // run (runner-decides containment unchanged). New chunks are fanned out
    // by registerWebSocketRoute's per-socket onChunk subscription, gated on
    // the same Set mutated here.
    case 'tailSubscribe': {
      const target = parseTailTarget(msg);
      if (!target || !ctx.tailSubscriptions) break;
      const key = outputStreamKey(target.source, target.id);
      // Remote tail demand (T1 remote live-tail plane, S2): only a
      // genuinely NEW subscription for THIS socket counts — re-sending
      // tailSubscribe for an already-subscribed key must never double the
      // refcount. Agent-source only; dispatch output has no remote-tailer
      // plane. Local agents are a guaranteed no-op inside noteTailSubscribe
      // itself (see its doc) — checked there, not duplicated here.
      const isNewSubscription = !ctx.tailSubscriptions.has(key);
      ctx.tailSubscriptions.add(key);
      if (isNewSubscription && target.source === 'agent') {
        const agentId = Number(target.id);
        if (Number.isInteger(agentId)) {
          remoteTailDemand.noteTailSubscribe(ctx.store, agentId, ctx.machineLabel);
        }
      }
      for (const chunk of outputRingStore.replay(target.source, target.id)) {
        send(chunk as unknown as Record<string, unknown>);
      }
      break;
    }

    case 'tailUnsubscribe': {
      const target = parseTailTarget(msg);
      if (!target || !ctx.tailSubscriptions) break;
      const key = outputStreamKey(target.source, target.id);
      const wasSubscribed = ctx.tailSubscriptions.has(key);
      ctx.tailSubscriptions.delete(key);
      if (wasSubscribed && target.source === 'agent') {
        const agentId = Number(target.id);
        if (Number.isInteger(agentId)) {
          remoteTailDemand.noteTailUnsubscribe(agentId);
        }
      }
      break;
    }

    case 'addExternalAssetDirectory': {
      const newPath = msg.path as string | undefined;
      if (!newPath) break;
      const cfg = readConfig();
      if (!cfg.externalAssetDirectories.includes(newPath)) {
        cfg.externalAssetDirectories.push(newPath);
        writeConfig(cfg);
      }
      send({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
      break;
    }

    case 'removeExternalAssetDirectory': {
      const removePath = msg.path as string | undefined;
      if (!removePath) break;
      const cfg = readConfig();
      cfg.externalAssetDirectories = cfg.externalAssetDirectories.filter((d) => d !== removePath);
      writeConfig(cfg);
      send({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
      break;
    }

    default:
      // focusAgent, exportLayout, importLayout
      // require IDE-specific handling (not yet implemented for standalone)
      break;
  }
}

function handleWebviewReady(send: WsSend, ctx: ClientMessageContext, isV3: boolean): void {
  const { store, runtime, cache } = ctx;
  const adapter = store.getAdapter();

  // 1. Provider capabilities (must arrive before any agent messages)
  send({
    type: 'providerCapabilities',
    readingTools: hookProviderCapabilities.readingTools,
    subagentToolNames: hookProviderCapabilities.subagentToolNames,
  });

  // 2. Legacy-face assets (from server cache, loaded at startup via pngjs).
  // V3 owns a lazy HTTP spritesheet loader and ignores all six of these
  // frames, so do not put ~842 KiB of dead JSON on every V3 connection.
  if (!isV3 && cache) {
    if (cache.characters) {
      send({ type: 'characterSpritesLoaded', characters: cache.characters.characters });
    }
    if (cache.pets) {
      send({
        type: 'petSpritesLoaded',
        pets: cache.pets.pets,
        petNames: cache.pets.manifests.map((m) => m.name),
      });
    }
    if (cache.floorTiles) {
      send({ type: 'floorTilesLoaded', sprites: cache.floorTiles });
    }
    if (cache.wallTiles) {
      send({ type: 'wallTilesLoaded', sets: cache.wallTiles });
    }
    if (cache.furniture) {
      send({
        type: 'furnitureAssetsLoaded',
        catalog: cache.furniture.catalog,
        sprites: Object.fromEntries(cache.furniture.sprites),
      });
    }
  }

  // 3. The legacy editable office owns this layout format. V3's authored
  // world is independent and does not handle layoutLoaded.
  if (!isV3) {
    const savedLayout = readLayoutFromFile();
    send({ type: 'layoutLoaded', layout: savedLayout ?? cache?.defaultLayout ?? null });
  }

  // 4. Settings (from adapter, with sensible defaults when adapter is absent)
  const cfg = readConfig();
  const watchAllSessions = adapter?.getSetting(KEY_WATCH_ALL_SESSIONS, false) ?? false;
  const hooksEnabled = adapter?.getSetting(KEY_HOOKS_ENABLED, true) ?? true;
  send({
    type: 'settingsLoaded',
    soundEnabled: adapter?.getSetting(KEY_SOUND_ENABLED, true) ?? true,
    lastSeenVersion: adapter?.getSetting(KEY_LAST_SEEN_VERSION, '') ?? '',
    extensionVersion: process.env.PIXEL_AGENTS_VERSION ?? '',
    watchAllSessions,
    alwaysShowLabels: adapter?.getSetting(KEY_ALWAYS_SHOW_LABELS, false) ?? false,
    hooksEnabled,
    hooksInfoShown: adapter?.getSetting(KEY_HOOKS_INFO_SHOWN, false) ?? false,
    externalAssetDirectories: cfg.externalAssetDirectories,
  });

  // Sync runtime refs with the persisted settings so scanners behave correctly
  // from the first tick after a server restart.
  if (runtime) {
    runtime.watchAllSessions.current = watchAllSessions;
    runtime.hooksEnabled.current = hooksEnabled;
  }

  // 5. Restore persisted external agents (standalone only; VS Code handles its own restore)
  runtime?.restoreExternalAgents();

  // 6. Existing agents (either just restored, or from VS Code adapter if present)
  const agentIds: number[] = [];
  const folderNames: Record<number, string> = {};
  const externalAgents: Record<number, boolean> = {};
  const machines: Record<number, string> = {};
  const providers: Record<number, string> = {};
  const sessionIds: Record<number, string> = {};
  const cwds: Record<number, string> = {};
  const pids: Record<number, number> = {};
  const managed: Record<number, boolean> = {};
  for (const [id, agent] of store) {
    agentIds.push(id);
    if (agent.folderName) {
      folderNames[id] = agent.folderName;
    }
    if (agent.isExternal) {
      externalAgents[id] = true;
    }
    const machine = agent.machine ?? ctx.machineLabel;
    if (machine) {
      machines[id] = machine;
    }
    // Coworker providers only (claude is the house default — no label).
    if (agent.providerId && agent.providerId !== 'claude') {
      providers[id] = agent.providerId;
    }
    // Dispatch drawer identity (mechanic #6b) — see AgentCreated above.
    if (agent.sessionId) {
      sessionIds[id] = agent.sessionId;
    }
    if (agent.projectDir) {
      cwds[id] = agent.projectDir;
    }
    // FOCUS dispatch target (mechanic #6b) — see AgentCreated.pid above.
    if (agent.pid !== undefined) {
      pids[id] = agent.pid;
    }
    // T2 remote-answer plane: replay the managed flag so a page refresh
    // keeps the ANSWER verb without waiting for the next runner poll tick.
    if (agent.managed === true) {
      managed[id] = true;
    }
  }
  const seats = adapter?.loadSeats() ?? {};
  send({
    type: 'existingAgents',
    agents: agentIds,
    agentMeta: seats,
    folderNames,
    externalAgents,
    machines,
    providers,
    sessionIds,
    cwds,
    pids,
    managed,
  });

  // 7. Replay EVERY poll state, including explicit clears. A reconnect is a
  // new telemetry epoch, so omitted defaults would leave a client unable to
  // distinguish "still blocked" from "the clear happened while offline".
  // `ageMs` re-anchors crisis aging so a refresh doesn't reset fires to smoke.
  for (const [id, agent] of store) {
    send({
      type: 'agentPollState',
      id,
      state: agent.pollState?.state,
      waitingFor: agent.pollState?.waitingFor,
      ageMs: agent.pollState ? Date.now() - agent.pollState.since : undefined,
    });
  }

  // 8. Replay hook-plane state with explicit default/clear values, followed
  // by cumulative tokens and current tool activity. The existingAgents frame
  // resets ephemeral client state first, so this is an authoritative epoch
  // snapshot rather than an upsert-only replay.
  for (const [id, agent] of store) {
    send({
      type: 'agentStatus',
      id,
      status: agent.isWaiting ? 'waiting' : 'active',
      awaitingInput: agent.awaitingInput ?? false,
    });
    send({ type: agent.permissionSent ? 'agentToolPermission' : 'agentToolPermissionClear', id });
    send({
      type: 'agentTokenUsage',
      id,
      inputTokens: agent.inputTokens,
      outputTokens: agent.outputTokens,
    });
    for (const toolId of agent.activeToolIds) {
      send({
        type: 'agentToolStart',
        id,
        toolId,
        status: agent.activeToolStatuses.get(toolId) ?? agent.activeToolNames.get(toolId) ?? '',
        toolName: agent.activeToolNames.get(toolId),
        runInBackground: agent.backgroundAgentToolIds.has(toolId),
      });
      const subToolIds = agent.activeSubagentToolIds.get(toolId);
      const subToolNames = agent.activeSubagentToolNames.get(toolId);
      for (const subToolId of subToolIds ?? []) {
        const toolName = subToolNames?.get(subToolId) ?? '';
        send({
          type: 'subagentToolStart',
          id,
          parentToolId: toolId,
          toolId: subToolId,
          status: toolName ? `Subtask: ${toolName}` : 'Subtask',
        });
      }
    }
  }
}
