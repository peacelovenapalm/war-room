import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import * as crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import { autoExecutorStore } from './autoExecutor.js';
import { getBriefing } from './briefingProvider.js';
import type { ClaudeRateLimitSnapshot } from './budgetStore.js';
import { budgetStore } from './budgetStore.js';
import { globalBuffs } from './buildingBuffs.js';
import { chainOrchestrator } from './chainOrchestrator.js';
import { chainMaxSteps, type ChainStepDef, chainStore } from './chainStore.js';
import type { AssetCache, SetHooksEnabledSideEffect } from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import {
  AUTO_EXECUTOR_TICK_INTERVAL_MS,
  COWORKER_ADAPTER_HOOK_SOURCE,
  HOOK_API_PREFIX,
  HOOK_SOURCE_HEADER,
  MAX_AGENT_OUTPUT_BODY_BYTES,
  MAX_AGENT_OUTPUT_LINE_BYTES,
  MAX_AGENT_OUTPUT_LINES_PER_POST,
  MAX_AGENT_OUTPUT_TOTAL_LINE_BYTES,
  MAX_HOOK_BODY_SIZE,
  MORNING_PUSH_CHECK_INTERVAL_MS,
  SELF_HEAL_TICK_INTERVAL_MS,
} from './constants.js';
import { contractStore } from './contractStore.js';
import { renderDigest } from './digest.js';
import type { ManagedSessionAd } from './dispatchStore.js';
import { dispatchStore } from './dispatchStore.js';
import { dispatchTemplateStore } from './dispatchTemplateStore.js';
import { getDistricts } from './districtsProvider.js';
import { dossierDerivation } from './dossierDerivation.js';
import { dossierStore } from './dossierStore.js';
import type { PerkId } from './economyConstants.js';
import { PERK_IDS } from './economyConstants.js';
import { economyStore } from './economyStore.js';
import type { Employee, ScoreTrack } from './employeeStore.js';
import { employeeStore } from './employeeStore.js';
import { searchGraph } from './graphProvider.js';
import { getInboxListing, readInboxFile } from './inboxProvider.js';
import { matchDayDerivation } from './matchDayDerivation.js';
import { matchDayStore, toMatchDayEvent } from './matchDayStore.js';
import { type MemoryStore, memoryStore } from './memoryStore.js';
import { type MemoryTallyStore, memoryTallyStore } from './memoryTallyStore.js';
import { runMorningPushTick } from './morningPush.js';
import { type MorningStreakStore, morningStreakStore } from './morningStreakStore.js';
import { getMorningSurface } from './morningSurface.js';
import { narrativeFindingStore } from './narrativeFindingStore.js';
import {
  createBudgetPauseNotifier,
  createEmployeeQuitNotifier,
  notifyBigMoment,
} from './notifyBark.js';
import { addRoom, buyFurniture, expandOffice, getOfficeLayout, sell } from './officeLayoutStore.js';
import type { RoomType } from './officeLayoutTypes.js';
import { RoomType as RoomTypeValues } from './officeLayoutTypes.js';
import { getOpsReview, opsReviewSummary } from './opsAdvisor.js';
import { outputRingStore, outputStreamKey, parseOutputStreamKey } from './outputRingStore.js';
import { perfectOpsDay } from './perfectOpsDay.js';
import { applyPollStates, parsePollBody, startPollStateSweep } from './pollStateHandler.js';
import { progression } from './progressionStore.js';
import * as remoteTailDemand from './remoteTailDemand.js';
import {
  evictRemoteTranscriptPath,
  linkRemoteTranscriptPathToAgent,
  retainRemoteTranscriptPath,
} from './remoteTranscriptPaths.js';
import { reworkBinIngest } from './reworkBinIngest.js';
import { reworkBinStore } from './reworkBinStore.js';
import { redispatchCrate } from './reworkRedispatch.js';
import { RIVALRY_SWEEP_INTERVAL_MS, rivalryDerivation } from './rivalryDerivation.js';
import { rivalryStore } from './rivalryStore.js';
import { getSelfHealStatus, isSelfHealClass, runSelfHealTick, selfHealStore } from './selfHeal.js';
import { shiftStats } from './shiftStats.js';
import type { StandingOrderSchedule } from './standingOrderStore.js';
import { standingOrderStore } from './standingOrderStore.js';
import { stopAllLatch } from './stopAllLatch.js';
import { STUDIO_CONTRACT_SWEEP_INTERVAL_MS, studioContractIngest } from './studioContractIngest.js';
import { studioContractStore } from './studioContractStore.js';
import { renderTranscriptLine } from './transcriptOutputTap.js';
import { applyTokenUsage, isRecentEnoughForShiftSpend } from './transcriptParser.js';
import type { AgentState } from './types.js';
import { v3StoreEnabled } from './v3Flags.js';
import { getWiringSnapshot } from './wiringProvider.js';
import { worldEventStore } from './worldEventStore.js';

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  /** true = VS Code embedded mode (ephemeral port, no static, quiet logging) */
  embedded: boolean;
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Bearer auth token for hook and WebSocket endpoints */
  token: string;
  /** AgentStateStore for WebSocket broadcast piping */
  store: AgentStateStore;
  /** Shared agent lifecycle core (for toggle side effects + standalone restore). Optional in embedded mode. */
  runtime?: AgentRuntime;
  /** Path to the ROOT face dist (standalone only). Since the face-merge
   *  cutover (FACE-MERGE-PLAN Tier 3) this is the v3 "Living Studio" build. */
  staticDir?: string;
  /** Path to the LEGACY (v1) face dist, served at /v1/ for one grace
   *  release post-cutover (standalone only). Absent → /v1/ falls through. */
  staticDirLegacy?: string;
  /** Cached assets loaded at startup (standalone only) */
  assetCache?: AssetCache;
  /** TEXT label identifying the machine this server runs on (e.g. "MACBOOK").
   *  Local agents inherit it; remote hook events carry their own via X-Machine. */
  machineLabel?: string;
  /** Callback when a hook event is received */
  onHookEvent?: (providerId: string, event: Record<string, unknown>) => void;
  /** Invoked when setHooksEnabled is toggled via WebSocket. Standalone installs/uninstalls hooks here. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
}

const startTime = Date.now();

/**
 * Create a Fastify server with hook endpoint, health check, and WebSocket support.
 *
 * All Fastify-specific code lives in this file. The rest of the server layer is
 * framework-agnostic. If Fastify is ever replaced, only this file changes.
 */
export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const app = Fastify({
    logger: !options.embedded,
    bodyLimit: MAX_HOOK_BODY_SIZE,
  });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Static SPA serving (standalone mode only).
  // Face-merge cutover (FACE-MERGE-PLAN Tier 3): the v3 "Living Studio"
  // build is the ROOT face; the old v1 face survives at /v1/ for one grace
  // release; every old /v3 URL 301s to the root equivalent WITH its query
  // string (phone bookmarks + push-notification deep links like
  // /v3/?agentId=5 keep working). The old face's root service worker heals
  // itself: its registration re-fetches /sw.js, gets v3's SW (autoUpdate +
  // skipWaiting/clientsClaim), and the next navigation serves v3.
  if (!options.embedded && options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    const staticDirLegacy = options.staticDirLegacy;
    if (staticDirLegacy) {
      await app.register(fastifyStatic, {
        root: staticDirLegacy,
        prefix: '/v1/',
        decorateReply: false,
      });
    }
    app.setNotFoundHandler((req, reply) => {
      if (req.url === '/v3' || req.url.startsWith('/v3?') || req.url.startsWith('/v3/')) {
        // '/v3' → '/', '/v3?q' → '/?q', '/v3/x?q' → '/x?q' — never strip
        // the query (deep links ride it). Path and query are rebuilt
        // separately with EXACTLY one leading slash: naive string splicing
        // turned '/v3//evil.example/x' into the protocol-relative
        // '//evil.example/x' — an open redirect off-tailnet (P6 codex
        // review finding #1).
        const qIndex = req.url.indexOf('?');
        const rawPath = qIndex === -1 ? req.url : req.url.slice(0, qIndex);
        const query = qIndex === -1 ? '' : req.url.slice(qIndex);
        const rest = rawPath.slice('/v3'.length).replace(/^\/+/, '');
        reply.redirect(`/${rest}${query}`, 301);
      } else if (staticDirLegacy && req.url.startsWith('/v1/')) {
        // HTML5 history fallback for the legacy face's own routes.
        reply.sendFile('index.html', staticDirLegacy);
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  registerHealthRoute(app);
  registerBriefingRoute(app, options);
  registerMemoryRoutes(app);
  registerInboxRoutes(app);
  registerWiringRoute(app);
  registerHookRoute(app, options);
  registerPollRoute(app, options);
  registerAgentOutputRoute(app, options);
  registerTailerPollRoute(app, options);
  registerDispatchRoutes(app, options);
  registerAgentKillRoutes(app, options);
  registerAgentAnswerRoutes(app, options);
  registerEmployeeRoutes(app);
  registerEconomyRoutes(app);
  registerBuildingRoutes(app, options);
  registerChainRoutes(app);
  registerStandingOrderRoutes(app);
  registerDispatchTemplateRoutes(app);
  registerBudgetRoutes(app, options);
  registerAutomationStopAllRoutes(app, options);
  registerContractRoutes(app);
  registerStudioContractRoutes(app);
  registerReworkRoutes(app);
  // Live-tick socket tracker (v2 mechanic G4, GAME-DESIGN §2's unified
  // cadence model: "Live tick ... ≥1 socket connected, every 5 min ...
  // stops the instant the last socket disconnects"). A plain mutable
  // counter, not a module-level singleton -- each createHttpServer() call
  // (each test's own app instance) gets its own.
  const liveSocketTracker = { count: 0 };
  registerWebSocketRoute(app, options, liveSocketTracker);

  // chainOrchestrator singleton subscription (v2 mechanic G3, bug-fix #1):
  // called EXACTLY ONCE here, at process startup — createHttpServer() runs
  // once per process in production. Never call chainOrchestrator.start()
  // inside registerWebSocketRoute's per-connection handler; see
  // chainOrchestrator.ts's file header for why (start() is idempotent as
  // defense-in-depth, but call-site discipline is the real fix).
  // Shared budget gate for chains + standing orders. The wrapper adds the
  // edge-triggered budget-paused Bark push (KICKOFF-v2.0 0.6): one push per
  // not-paused→paused transition across BOTH consumers, silent while the
  // pause persists, re-armed when the budget recovers.
  const budgetGate = createBudgetPauseNotifier(
    (_machine: string | undefined, provider: string | undefined) =>
      budgetStore.isAutomationPaused(provider, economyStore.getPerkFlags()),
  );

  chainOrchestrator.configure({
    resolveEmployeeDefaults: (id) => employeeStore.resolveEmployeeDefaults(id),
    isAutomationPaused: budgetGate,
  });
  chainOrchestrator.start();
  const chainSweepTimer = setInterval(() => chainOrchestrator.sweep(), CHAIN_SWEEP_INTERVAL_MS);
  chainSweepTimer.unref?.();
  app.addHook('onClose', () => clearInterval(chainSweepTimer));

  // ── v3 Living Studio derivation loops (WS-C stage 2 — KICKOFF-v3.1 §3) ──
  // Each module owns its own store subscription via an idempotent start()
  // (the chainOrchestrator.start() discipline: once per process, no
  // per-connection wiring). All of them DERIVE game-face state from real
  // observed events; none of them can gate, spawn, or stop anything real.
  studioContractIngest.start(); // dispatch exit-0 → contract progress
  dossierDerivation.start(); //     dispatch kills/exits → staff telemetry
  matchDayDerivation.start(); //    chain runs → fixtures + commentary
  reworkBinIngest.start(); //       failed/killed dispatches → crates
  rivalryDerivation.start(); //     completed chain runs → bonds

  // T5 fleet controls, DAILY FLEET SPEND CEILING (KICKOFF T5, D-21/D-27):
  // wired ONCE here, at process startup — dispatchStore itself never
  // imports autoExecutorStore/shiftStats (one-way layering, same
  // discipline worldEventStore's deps object keeps). Both sides are read
  // fresh on every enqueue() call; a hand-edit to the whitelist file's
  // sibling `budget.dailyTokenCeiling` takes effect on the very next
  // dispatch request, no restart needed.
  dispatchStore.setBudgetGate(() => {
    const ceiling = autoExecutorStore.getDailyTokenCeiling();
    if (ceiling === undefined) return null;
    const report = shiftStats.getReport();
    return { ceiling, spend: report.tokensIn + report.tokensOut };
  });
  // Codex fix round finding 1 — STOP ALL must reach HELD auto-releases too:
  // the automatic rollover sweep is frozen while the auto-executor's kill
  // switch is engaged (a human's explicit /release override is unaffected —
  // see dispatchStore.releaseHeld's own doc).
  dispatchStore.setHeldReleaseGate(() => autoExecutorStore.isKillSwitchActive());

  // Contract ingest tick (mint from the real todo file, complete on todo
  // disappearance, quiet expiry). One immediate sweep so a fresh boot
  // doesn't wait a full interval to surface the wall.
  studioContractIngest.sweep();
  const studioContractTimer = setInterval(
    () => studioContractIngest.sweep(),
    STUDIO_CONTRACT_SWEEP_INTERVAL_MS,
  );
  studioContractTimer.unref?.();
  app.addHook('onClose', () => clearInterval(studioContractTimer));

  // Rivalry live-overlap sweep — the genuine worktree-collision early
  // warning (incident 74d74e8's class) recomputed from live agent cwds.
  const rivalrySweepTimer = setInterval(
    () => rivalryDerivation.sweepLiveOverlap(options.store.values(), options.machineLabel),
    RIVALRY_SWEEP_INTERVAL_MS,
  );
  rivalrySweepTimer.unref?.();
  app.addHook('onClose', () => clearInterval(rivalrySweepTimer));

  // Dossier "sessions run" feed — a real agentAdded with a known project
  // dir is one observed session (deduped by sessionId inside the module).
  const onAgentAddedDossier = (_id: number, agent: AgentState) => {
    if (!agent.projectDir) return;
    dossierDerivation.recordSession(
      agent.machine ?? options.machineLabel,
      agent.projectDir,
      agent.folderName ?? agent.projectDir,
      agent.sessionId,
    );
  };
  options.store?.on('agentAdded', onAgentAddedDossier);
  app.addHook('onClose', () => options.store?.off('agentAdded', onAgentAddedDossier));

  // standingOrderTick (v2 mechanic G3, §7.2) — timerManager.ts has no
  // generic tick primitive (verified by grep, BUILD-PLAN §G3 task 6), so
  // this uses the repo's real interval idiom: a setInterval registered
  // where the dispatch TTL sweep already lives (httpServer.ts:238-241's
  // pattern), cleared via onClose.
  const standingOrderTimer = setInterval(() => {
    standingOrderStore.tick(
      Date.now(),
      budgetGate,
      (id) => employeeStore.resolveEmployeeDefaults(id),
      (input) => dispatchStore.enqueue(input),
    );
  }, STANDING_ORDER_TICK_INTERVAL_MS);
  standingOrderTimer.unref?.();
  app.addHook('onClose', () => clearInterval(standingOrderTimer));

  // Auto-Executor tick (T3 rung 3, KICKOFF-v4 D-16) — same interval idiom
  // as standingOrderTimer just above (no shared tick primitive exists,
  // verified previously). Computes opsAdvisor findings (its own cached
  // derivation, no new polling loop), filters to whitelisted +
  // guardrail-passing proposals, fires through the SAME redispatchCrate()
  // the human REQUEUE tap uses, and receipts the outcome. A shipped-empty
  // whitelist makes every tick a no-op (autoExecutorStore.runTick's own
  // deny-by-default check returns immediately).
  const autoExecutorTimer = setInterval(() => {
    autoExecutorStore.runTick(options.store, Date.now(), options.machineLabel ?? 'LOCAL');
  }, AUTO_EXECUTOR_TICK_INTERVAL_MS);
  autoExecutorTimer.unref?.();
  app.addHook('onClose', () => clearInterval(autoExecutorTimer));

  // Self-Heal tick (V6-4 autonomy rung 1) — same interval idiom as
  // autoExecutorTimer just above. Consults the SAME shared budgetGate
  // every other automation plane already respects (standing orders,
  // chains); the STOP-ALL latch and per-class flags are checked inside
  // selfHeal.ts itself on every candidate, not here.
  const selfHealTimer = setInterval(() => {
    runSelfHealTick({ now: Date.now(), isAutomationPaused: budgetGate });
  }, SELF_HEAL_TICK_INTERVAL_MS);
  selfHealTimer.unref?.();
  app.addHook('onClose', () => clearInterval(selfHealTimer));

  // Morning push tick (V6-1 "ONE pre-triaged push", morningPush.ts) — same
  // interval idiom, checked every MORNING_PUSH_CHECK_INTERVAL_MS; the tick
  // itself gates on local-hour + once-per-day so most invocations are a
  // cheap no-op.
  const morningPushTimer = setInterval(() => {
    runMorningPushTick(options.store);
  }, MORNING_PUSH_CHECK_INTERVAL_MS);
  morningPushTimer.unref?.();
  app.addHook('onClose', () => clearInterval(morningPushTimer));

  // World events (v2 mechanic G4, §6.3) — the coarse "live tick" GAME-DESIGN
  // §2 introduces: only rolls while ≥1 socket is connected (checked inside
  // the callback, not by gating the interval itself, so it naturally stops
  // doing anything the instant the last socket disconnects without needing
  // a separate start/stop lifecycle). One-way layering held: worldEventStore
  // never imports economyStore/employeeStore itself — every effect routes
  // through the deps object built here.
  const liveTickTimer = setInterval(() => {
    if (liveSocketTracker.count <= 0) return;
    const fired = worldEventStore.tick(Date.now(), {
      online: true,
      isVacationActive: () => economyStore.isVacationActive(),
      getGrime: () => economyStore.getSnapshot().grime,
      awardCash: (amount, cause) => economyStore.addCash(amount, cause),
      awardReputation: (amount, cause) => economyStore.addReputation(amount, cause),
      pickLowMoodEmployeeId: () => pickLowMoodEmployeeId(),
      pickRandomEmployeeId: () => pickRandomEmployeeId(),
      nudgeEmployeeMoodBoost: (id, delta) => employeeStore.nudgeMoodBoost(id, delta),
    });
    // Live visual layer (v2 mechanic G5) — the store's own event log already
    // feeds the digest/Bark planes; this is the one addition that lets a
    // connected screen render WorldEventBanner.tsx in real time. Cash/
    // Reputation effects (e.g. flavor_bonus) are NOT inferred from this
    // message — they arrive on their own economyUpdate broadcast, same as
    // every other real-money change.
    if (fired) {
      options.store.broadcast({
        type: 'worldEventFired',
        id: fired.id,
        glyph: fired.glyph,
        ts: fired.ts,
        summary: fired.summary,
      });
    }
  }, LIVE_TICK_INTERVAL_MS);
  liveTickTimer.unref?.();
  app.addHook('onClose', () => clearInterval(liveTickTimer));

  // Bark big-moment pushes (v2 mechanic G4, §6.5) — contract-completed and
  // chain-failed are wired here (subscribed once, at process startup, same
  // discipline as chainOrchestrator.start() above); STOP ALL is wired
  // directly at its route below; budget-paused rides the shared budgetGate
  // wrapper above; employee-quit subscribes below (all 5 classes now live —
  // KICKOFF-v2.0 0.6 closed the last two).
  const unsubscribeContractBark = contractStore.onCompleted((contract) => {
    notifyBigMoment(
      'contract-completed',
      `Contract complete: ${contract.title} (+$${contract.payoutCash}${contract.payoutRep > 0 ? `, +${contract.payoutRep}★` : ''})`,
    );
  });
  app.addHook('onClose', () => unsubscribeContractBark());

  const unsubscribeChainBark = chainStore.onRunUpdate((run) => {
    if (run.status === 'failed') {
      notifyBigMoment('chain-failed', `Chain run failed: ${run.failReason ?? 'unknown reason'}`);
    }
  });
  app.addHook('onClose', () => unsubscribeChainBark());

  // employee-quit (KICKOFF-v2.0 0.6) — edge-triggered per employee; the quit
  // path persists+broadcasts since 5e26214 (v1.1 item 6), so onChange is a
  // reliable signal for this now.
  const unsubscribeEmployeeBark = employeeStore.onChange(createEmployeeQuitNotifier());
  app.addHook('onClose', () => unsubscribeEmployeeBark());

  // Output ring eviction on dispatch terminal status (KICKOFF-v2.0 Phase 2
  // slice 2.2's "lifecycle sites call evict()"): buffered output telemetry
  // is ephemeral — once a dispatch reaches ANY terminal status its retained
  // chunks are dropped (the durable record stays resultTail / the run log).
  // Subscribed once at process startup, same discipline as the Bark
  // subscriptions above. Telemetry-only: this never touches the dispatch
  // record or the runner's containment.
  const unsubscribeOutputEvict = dispatchStore.onUpdate((broadcast) => {
    if (broadcast.status === 'ringing' || broadcast.status === 'answered') return;
    outputRingStore.evict('dispatch', broadcast.id);
  });
  app.addHook('onClose', () => unsubscribeOutputEvict());

  // Agent-plane twin of the dispatch eviction above (slice 2.4): the store's
  // 'agentRemoved' is the single choke point every removal path (stale
  // external cleanup, teammate dismissal, SessionEnd, orphaned terminal)
  // funnels through, so the transcript tail's ring entry can never outlive
  // its agent. Same ephemerality rationale — the durable record stays the
  // transcript file itself.
  const onAgentRemovedEvict = (id: number) => outputRingStore.evict('agent', String(id));
  options.store?.on('agentRemoved', onAgentRemovedEvict);
  app.addHook('onClose', () => options.store?.off('agentRemoved', onAgentRemovedEvict));

  // Remote transcript-path retention's twin eviction (T1 remote live-tail
  // plane, S1): same 'agentRemoved' choke point, same ephemerality
  // rationale — the retention entry can never outlive its agent.
  const onAgentRemovedEvictTranscriptPath = (id: number) => evictRemoteTranscriptPath(id);
  options.store?.on('agentRemoved', onAgentRemovedEvictTranscriptPath);
  app.addHook('onClose', () =>
    options.store?.off('agentRemoved', onAgentRemovedEvictTranscriptPath),
  );

  // Remote tail-instruction demand's own agentRemoved cleanup (T1 remote
  // live-tail plane, S2): a final tail-off if there was live demand, then
  // the record itself is dropped. Uses its own last-known transcriptPath
  // (see remoteTailDemand.ts), so it has no ordering dependency on the
  // transcript-path eviction hook above.
  const onAgentRemovedTailDemand = (id: number) => remoteTailDemand.onAgentRemoved(id);
  options.store?.on('agentRemoved', onAgentRemovedTailDemand);
  app.addHook('onClose', () => options.store?.off('agentRemoved', onAgentRemovedTailDemand));

  // ── Listen ──────────────────────────────────────────────────

  await app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return { app, port };
}

// ── Health ──────────────────────────────────────────────────────

function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
  }));
  // GET /api/version — deploy identity, unauthenticated like /api/health.
  // GIT_SHA/BUILT_AT are baked in by the deploy runbook as Docker build args
  // (the rsync'd build context has no .git); 'unknown' outside the container.
  app.get('/api/version', async () => ({
    sha: process.env.GIT_SHA || 'unknown',
    builtAt: process.env.BUILT_AT || 'unknown',
  }));
}

// ── Briefing (post-v0) ─────────────────────────────────────────

/** GET /api/briefing -- unauthenticated, like /api/health; the server is tailnet-only. */
function registerBriefingRoute(app: FastifyInstance, options: HttpServerOptions): void {
  // Knowledge-graph search (4C, T7 first slice) — same unauthenticated
  // tailnet-read tier as /api/briefing. Pure read of the :ro graph mount;
  // absent mount → { available: false }, never a 500.
  app.get<{ Querystring: { q?: string; depth?: string } }>('/api/graph/search', async (request) => {
    const q = typeof request.query.q === 'string' ? request.query.q : '';
    const depthRaw = Number.parseInt(request.query.depth ?? '1', 10);
    const depth = Number.isFinite(depthRaw) ? depthRaw : 1;
    return searchGraph(q, depth);
  });
  app.get('/api/briefing', async () => {
    const briefing = getBriefing();
    // Contracts (v2 mechanic G4, §6.2): piggybacks briefingProvider's own
    // 60s cache -- reconciling here (and again in registerContractRoutes)
    // is the "no new poll loop" mint/complete tick.
    contractStore.reconcile(briefing);
    return briefing;
  });
  // Shift report (v1 mechanic #2): today's scorecard — same trust level.
  // Also carries yesterday's closed ledger (deferred nit: previous-day card)
  // so a checked-out day isn't lost the moment midnight rolls over.
  // opsReview (T3 rung 1): the compact fold KICKOFF-v4 calls for ("folded
  // into SHIFT") — counts + the single most urgent finding. The full
  // receipt-laden list lives at GET /api/ops/review below.
  app.get('/api/shift', async () => ({
    today: shiftStats.getReport(),
    yesterday: shiftStats.getYesterdayReport(),
    opsReview: opsReviewSummary(
      getOpsReview(options.store, Date.now(), options.machineLabel ?? 'LOCAL'),
    ),
    // T3 rung 3: how many auto-actions actually fired today — the SHIFT
    // fold's honest count, zero on a shipped-empty whitelist.
    autoActionCount: autoExecutorStore.getTodayReceiptCount(),
  }));
  // Progression (v1 mechanic #3): XP/level/streak/unlock snapshot — same
  // trust level. Primarily consumed live over the WS plane
  // (progressionUpdate); this route mirrors /api/shift for parity/debugging.
  app.get('/api/progression', async () => progression.getSnapshot());
  // Ops Advisor (T3 self-healing ladder, rung 1 — read-only): the full
  // findings list with receipts. Same trust level as /api/briefing;
  // analyze-on-demand with a short TTL cache (opsAdvisor.ts), never a new
  // polling loop.
  app.get('/api/ops/review', async () =>
    getOpsReview(options.store, Date.now(), options.machineLabel ?? 'LOCAL'),
  );
  // Auto-Executor status (T3 rung 3): whitelist state (honest OFF unless
  // Greg has hand-edited the whitelist file) + the receipts ledger. Same
  // trust level, same "no new polling loop" posture — reads the executor's
  // own already-persisted state.
  app.get('/api/ops/auto', async () => autoExecutorStore.getStatus());
  // Self-Heal status (V6-4 autonomy rung 1): per-class flags (default ON)
  // + the receipts ledger — every fired/suppressed/failed decision from
  // the four pre-approved classes. Same trust tier + "no new polling
  // loop" posture as /api/ops/auto — reads selfHealStore's own already-
  // persisted state.
  app.get('/api/ops/self-heal', async () => getSelfHealStatus());
  // Per-class enable flag toggle — the "existing automation config
  // surface" this store's flags live behind, revocable per V6-4's
  // contract. Deny-by-default validation: an unknown class is rejected,
  // never silently widening SELF_HEAL_CLASSES.
  app.post<{ Params: { cls: string }; Body: Record<string, unknown> }>(
    '/api/ops/self-heal/flags/:cls',
    async (request, reply) => {
      const { cls } = request.params;
      if (!isSelfHealClass(cls)) {
        reply.code(400).send({ ok: false, reason: 'unknown-class' });
        return;
      }
      const enabled = request.body?.enabled === true;
      const result = selfHealStore.setClassEnabled(cls, enabled);
      reply.send(result);
    },
  );
  // Districts (Phase 5 Lane C T7/D-35; v5 C1 N-project build-out):
  // per-project milestone state, data-driven from WAR_ROOM_DISTRICTS_DIR
  // (one project per immediate subdirectory) plus the legacy 2-seed env
  // vars as additive overrides (districtsProvider.ts). Same trust tier +
  // tolerant-read/60s-cache posture as /api/briefing; a project with no
  // discoverable STATE.md renders honestly as source:'unknown', never a
  // fake number.
  app.get('/api/districts', async () => getDistricts());
  // Morning surface (V6-1 "one glance, one push"): composes morning.json +
  // live board state + overnight receipts into ONE payload. Same trust
  // tier + analyze-on-demand cache posture as everything else on this
  // route group (morningSurface.ts).
  app.get('/api/morning', async () => getMorningSurface(options.store, Date.now(), true));
  // V6-5 cross-model spot checks: the landing pad for an external `codex
  // exec` runner's discrepancy filing (morningSpotCheck.ts's documented
  // manual/runner path). Bearer-authed, same tier as the other
  // runner-ingest routes (POST /api/agents/poll, /api/answers/:id/status)
  // -- this is a WRITE from an untrusted-until-authed caller, unlike the
  // read-only routes around it.
  app.post<{ Body: Record<string, unknown> }>(
    '/api/ops/narrative-finding',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const body = request.body ?? {};
      const date = typeof body.date === 'string' ? body.date : undefined;
      const summary = typeof body.summary === 'string' ? body.summary : undefined;
      const detail = typeof body.detail === 'string' ? body.detail : '';
      if (!date || !summary) {
        reply.code(400).send({ error: 'expected body { date, summary, detail? }' });
        return;
      }
      const finding = narrativeFindingStore.file({ date, summary, detail });
      reply.send({ ok: true, id: finding.id });
    },
  );
}

export interface MemoryRouteDeps {
  store?: MemoryStore;
  tally?: MemoryTallyStore;
  streak?: Pick<MorningStreakStore, 'getSnapshot'>;
}

/**
 * V7 memory controls use the existing unauthenticated tailnet webview tier.
 * The direct-mode POST cannot bypass eligibility: enabled=true calls the
 * same receipted 7-day promotion path; enabled=false is the single instant
 * revocation flag. Exported so route guards can be tested via Fastify.inject
 * without opening a localhost socket in managed test sandboxes.
 */
export function registerMemoryRoutes(app: FastifyInstance, deps: MemoryRouteDeps = {}): void {
  const store = deps.store ?? memoryStore;
  const tally = deps.tally ?? memoryTallyStore;
  const streak = deps.streak ?? morningStreakStore;

  app.get('/api/memory/status', async () => store.getStatus());
  app.post<{ Body: Record<string, unknown> }>('/api/memory/direct', async (request, reply) => {
    if (request.body?.enabled === false) {
      reply.send(store.revokeDirect());
      return;
    }
    if (request.body?.enabled === true) {
      const result = store.promoteIfEligible();
      if (!result.ok) reply.code(409);
      reply.send(result);
      return;
    }
    reply.code(400).send({ ok: false, reason: 'expected-enabled-boolean' });
  });

  app.get('/api/memory/tally', async () => tally.getSnapshot(streak.getSnapshot()));
  app.post<{ Body: Record<string, unknown> }>('/api/memory/tally', async (request, reply) => {
    const attribution =
      typeof request.body?.attribution === 'string' ? request.body.attribution : '';
    const result = tally.recordAttribution(attribution);
    if (!result.ok) {
      reply.code(400).send(result);
      return;
    }
    reply.send({ ok: true, tally: tally.getSnapshot(streak.getSnapshot()) });
  });
}

// ── Routine inbox tray (v4 T7 slice 2) ──────────────────────────

/** GET /api/inbox + GET /api/inbox/content -- unauthenticated, same
 *  tailnet-read tier as /api/briefing and /api/graph/search. Reads the
 *  vault's `_inbox/routines/` mount (inboxProvider.ts). */
function registerInboxRoutes(app: FastifyInstance): void {
  app.get('/api/inbox', async () => getInboxListing());
  app.get<{ Querystring: { routine?: string; file?: string } }>(
    '/api/inbox/content',
    async (request, reply) => {
      const routine = typeof request.query.routine === 'string' ? request.query.routine : '';
      const file = typeof request.query.file === 'string' ? request.query.file : '';
      const result = readInboxFile(routine, file);
      if (result.ok) return { content: result.content };
      // Every non-ok reason renders as an honest 404/400 body, never a 500 --
      // same "tolerant read" posture as the rest of the briefing plane.
      reply.code(result.reason === 'invalid' ? 400 : 404);
      return { error: result.reason };
    },
  );
}

// ── WIRING auto-detect (v4 T7 slice 3) ──────────────────────────

/** GET /api/wiring -- unauthenticated, same tailnet-read tier as
 *  /api/briefing. Reads wiringProvider.ts's cached scan (WAR_ROOM_WIRING_
 *  ROOTS env-configured, zero per-project listing needed). See WIRING.md
 *  at the repo root for the full ingest-path documentation this endpoint
 *  is one half of. */
function registerWiringRoute(app: FastifyInstance): void {
  app.get('/api/wiring', async () => getWiringSnapshot());
}

// ── Hook Events ────────────────────────────────────────────────

// Remote transcript-path retention moved to its own module in S2
// (remoteTranscriptPaths.ts) so remoteTailDemand.ts can import the
// retention map without a circular dependency on this file. Re-exported
// here for the existing S1 route/test call sites.
export { getRemoteTranscriptPath } from './remoteTranscriptPaths.js';

/** Find the live agent matching a remote machine's (machine, sessionId)
 *  pair — the resolution rule shared by the hook route's transcript-path
 *  linking and POST /api/agents/output. O(n) over the live agent set (small
 *  and bounded by real concurrent sessions; no separate index is worth the
 *  upkeep at this scale). */
function resolveRemoteAgent(
  store: AgentStateStore | undefined,
  machine: string,
  sessionId: string,
): { id: number; agent: AgentState } | undefined {
  if (!store) return undefined;
  for (const [id, agent] of store.entries()) {
    if (agent.machine === machine && agent.sessionId === sessionId) return { id, agent };
  }
  return undefined;
}

function registerHookRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{
    Params: { providerId: string };
    Body: Record<string, unknown>;
  }>(
    `${HOOK_API_PREFIX}/:providerId`,
    {
      preHandler: bearerAuth(options.token),
      schema: {
        params: {
          type: 'object',
          properties: {
            providerId: { type: 'string', pattern: '^[a-z0-9-]+$' },
          },
          required: ['providerId'],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const event = request.body;

      // Source metadata is injected only from an authenticated header. Never
      // trust a caller-supplied __source body field for fallback dedupe.
      delete event.__source;
      delete event.__managedLaunch;
      if (request.headers[HOOK_SOURCE_HEADER] === COWORKER_ADAPTER_HOOK_SOURCE) {
        event.__source = COWORKER_ADAPTER_HOOK_SOURCE;
      }

      // Machine identity: remote machines tag their hook events with an
      // X-Machine header (installed by the hooks runbook). A label that
      // differs from this server's own label marks the event as REMOTE:
      //   - retain transcript_path in remoteTranscriptPaths (S2 will need it
      //     to build tail instructions), THEN strip it from the event (it
      //     points at a file on the remote machine; watching it here would
      //     fail) so adoption takes the hooks-only path
      //   - carry the label through on __machine for agent tagging
      const machine = sanitizeMachineLabel(request.headers['x-machine']);
      if (machine && machine !== options.machineLabel) {
        const sessionId = typeof event.session_id === 'string' ? event.session_id : undefined;
        const transcriptPath =
          typeof event.transcript_path === 'string' ? event.transcript_path : undefined;
        if (sessionId && transcriptPath) {
          retainRemoteTranscriptPath(machine, sessionId, transcriptPath);
        }
        delete event.transcript_path;
        event.__machine = machine;
      }

      // PID telemetry (mechanic #6b FOCUS): the command-hook forwarder sends
      // X-Pid (Claude Code runs the hook as a direct child, so $PPID there is
      // the session's own OS pid). Tagged regardless of machine — local
      // sessions carry it too, since it flows through this same route.
      const pid = sanitizeHookPid(request.headers['x-pid']);
      if (pid !== undefined) {
        event.__pid = pid;
        const launchMachine = machine ?? options.machineLabel;
        if (
          launchMachine &&
          dispatchStore.getManagedFor(launchMachine).some((session) => session.panePid === pid)
        ) {
          // Authenticated provenance for a War Room-managed launch. This is
          // derived server-side from the live runner advertisement, never
          // trusted from the request body.
          event.__managedLaunch = true;
        }
      }

      if (event.session_id && event.hook_event_name) {
        options.onHookEvent?.(providerId, event);
        // Link the retention entry to its agent's numeric id (once the
        // handler above has created/matched it) so the 'agentRemoved' choke
        // point can evict it — see evictRemoteTranscriptPath.
        if (machine && machine !== options.machineLabel) {
          const resolved = resolveRemoteAgent(options.store, machine, event.session_id as string);
          if (resolved) {
            linkRemoteTranscriptPathToAgent(resolved.id, machine, event.session_id as string);
          }
        }
      }

      reply.send('ok');
    },
  );
}

// ── Needs-input poll ingest (M4) ───────────────────────────────

/**
 * POST /api/agents/poll — authed ingest for the per-machine needs-input
 * poller (bin/needs-input-poller.mjs). Body: { agents: [normalized entries] }.
 * The X-Machine label scopes matching AND clearing to that machine's agents.
 */
function registerPollRoute(app: FastifyInstance, options: HttpServerOptions): void {
  // Staleness sweep lives with the route: a dead poller must not leave a
  // permanent NEEDS INPUT badge on screen.
  const sweepTimer = startPollStateSweep(options.store, undefined, undefined, shiftStats);
  app.addHook('onClose', () => clearInterval(sweepTimer));

  app.post<{ Body: Record<string, unknown> }>(
    '/api/agents/poll',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const machine =
        sanitizeMachineLabel(request.headers['x-machine']) ?? options.machineLabel ?? 'LOCAL';
      const entries = parsePollBody(request.body);
      if (entries === null) {
        reply.code(400).send({ error: 'expected body { agents: [...] }' });
        return;
      }
      const result = applyPollStates(
        options.store,
        machine,
        options.machineLabel,
        entries,
        Date.now(),
        shiftStats,
        progression,
        employeeStore,
        economyStore,
        // v3 Living Studio sinks (WS-C stage 2) — observed transitions
        // only; see V3CrisisSinks' contract in pollStateHandler.ts.
        {
          onCrisisStarted: (m, projectDir, agentId, now) => {
            dossierDerivation.recordCrisisStarted(m, projectDir, agentId, now);
            // Perfect-ops (v3 stage 3): same observed transition, keyed
            // like shiftStats' blocked episodes.
            perfectOpsDay.recordCrisisStarted(`agent:${agentId}`, now);
          },
          onCrisisResolved: (m, projectDir, agentId, durationMs, now) => {
            dossierDerivation.recordCrisisResolved(m, projectDir, agentId, durationMs, now);
            // studioContractIngest deliberately NOT fed here: a crisis
            // resolution has no per-contract linkage, and fanning it out
            // to every accepted contract fabricated progress evidence
            // (honest-nothing — see studioContractIngest.ts header).
            perfectOpsDay.recordCrisisResolved(`agent:${agentId}`, durationMs, now);
          },
          onCrisisAbandoned: (m, projectDir, agentId, waitingFor, now) => {
            reworkBinIngest.recordAbandonedCrisis(agentId, m, projectDir, waitingFor, now);
            perfectOpsDay.recordCrisisAbandoned(`agent:${agentId}`, now);
          },
        },
      );
      if (!options.embedded && (result.matched > 0 || result.cleared > 0)) {
        console.log(
          `[Pixel Agents] Poll: machine=${machine} entries=${entries.length} matched=${result.matched} cleared=${result.cleared}`,
        );
      }
      reply.send(result);
    },
  );
}

// ── Remote agent output ingest (T1 remote live-tail, S1) ────────

/** Validated POST /api/agents/output body. */
interface AgentOutputBody {
  sessionId: string;
  lines: string[];
}

/** Validate a POST /api/agents/output body. Returns null when the body
 *  shape is unusable (→ 400) — a defensively-capped batch (too many lines,
 *  a too-long line, or lines summing past MAX_AGENT_OUTPUT_TOTAL_LINE_BYTES)
 *  is unusable shape too, not a resolution question. */
function parseAgentOutputBody(body: unknown): AgentOutputBody | null {
  if (body === null || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const sessionId = typeof b.sessionId === 'string' && b.sessionId !== '' ? b.sessionId : undefined;
  if (!sessionId) return null;
  const rawLines = b.lines;
  if (
    !Array.isArray(rawLines) ||
    rawLines.length === 0 ||
    rawLines.length > MAX_AGENT_OUTPUT_LINES_PER_POST
  ) {
    return null;
  }
  const lines: string[] = [];
  let totalBytes = 0;
  for (const line of rawLines) {
    if (typeof line !== 'string') return null;
    const bytes = Buffer.byteLength(line, 'utf8');
    if (bytes > MAX_AGENT_OUTPUT_LINE_BYTES) return null;
    totalBytes += bytes;
    if (totalBytes > MAX_AGENT_OUTPUT_TOTAL_LINE_BYTES) return null;
    lines.push(line);
  }
  return { sessionId, lines };
}

/**
 * POST /api/agents/output — the S2 tailer's ingest route (S1 builds the
 * route now; S2 wires bin/transcript-tailer.mjs to it). Bearer + X-Machine
 * authed, same tier as /api/agents/poll. Body: { sessionId, lines: raw
 * assistant JSONL lines }. Per REMOTE-TAILER-DESIGN.md: resolution
 * (machine, sessionId) → live agent is a 2xx DECISION
 * ({ok:false, reason:'unknown-session'}) never a 4xx — the tailer treats a
 * deny as tail-off for that session. 400 is reserved for unusable body
 * shape (missing/invalid fields, cap violations); a missing/invalid
 * X-Machine header can't resolve anything either, so it is the same kind
 * of 2xx deny, not a 400.
 *
 * Each resolved line is rendered through renderTranscriptLine — the ONE
 * rendering implementation, shared with the local tap (transcriptOutputTap.ts)
 * — and appended into the SAME ring shape ({source:'agent', id, stream:
 * 'transcript'}) the local tap uses, so the existing tailSubscribe/WS
 * fan-out and replay path work unchanged for remote sessions too.
 *
 * Liveness gate: resolveRemoteAgent only returns a currently-live agent, and
 * this handler has no await between resolution and the append loop, so a
 * straggler POST for an agent removed mid-request can't resurrect a ring
 * entry — the same guarantee /api/dispatch/:id/output gives by re-checking
 * dispatchStore status right before appending.
 *
 * Token usage: each resolved assistant-type line's message.usage is applied
 * via the SAME applyTokenUsage the local tap uses (transcriptParser.ts), and
 * replay-guarded by isRecentEnoughForShiftSpend — S2's fromStart=true
 * (first-ever tail of a session) replays the whole transcript from offset 0,
 * so historical usage records arriving here get the identical treatment
 * /resume and adopt-from-start get locally.
 */
function registerAgentOutputRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{ Body: Record<string, unknown> }>(
    '/api/agents/output',
    // Route-level bodyLimit override (S3): a Write tool_use line can
    // legitimately approach MAX_AGENT_OUTPUT_LINE_BYTES, and the process-wide
    // default (MAX_HOOK_BODY_SIZE, 64KB) would 413 a real batch before this
    // route's own caps ever run. Every other route keeps the 64KB default.
    { preHandler: bearerAuth(options.token), bodyLimit: MAX_AGENT_OUTPUT_BODY_BYTES },
    async (request, reply) => {
      const machine = sanitizeMachineLabel(request.headers['x-machine']);
      if (!machine) {
        reply.send({ ok: false, reason: 'missing-machine' });
        return;
      }
      const parsed = parseAgentOutputBody(request.body);
      if (!parsed) {
        reply.code(400).send({ error: 'expected body { sessionId: string, lines: string[] }' });
        return;
      }
      const resolved = resolveRemoteAgent(options.store, machine, parsed.sessionId);
      if (!resolved) {
        reply.send({ ok: false, reason: 'unknown-session' });
        return;
      }
      const { id: agentId, agent } = resolved;
      for (const line of parsed.lines) {
        const rendered = renderTranscriptLine(line);
        if (rendered !== undefined) {
          outputRingStore.append('agent', String(agentId), 'transcript', `${rendered}\n`);
        }
        // Token usage: best-effort, never route-fatal — a malformed line
        // already fell out of renderTranscriptLine above; usage extraction
        // gets its own try so one bad line can't drop the rest of the batch.
        try {
          const record = JSON.parse(line) as Record<string, unknown>;
          // Match the local tap: only assistant records carry billable
          // usage. A non-assistant record with a usage-shaped field is not
          // real usage telemetry.
          if (record.type !== 'assistant') continue;
          const message = record.message as Record<string, unknown> | undefined;
          const usage = message?.usage as
            { input_tokens?: number; output_tokens?: number } | undefined;
          if (usage && typeof usage === 'object') {
            // Replay guard: S2's fromStart=true (first-ever tail of a
            // session) replays the WHOLE file from offset 0, so this route
            // sees the same historical-usage-record shape /resume and
            // adopt-from-start produce locally. Every transcript record
            // carries its own `timestamp` regardless of machine, so the
            // SAME cutoff check applies here — see
            // isRecentEnoughForShiftSpend's doc.
            applyTokenUsage(
              agentId,
              agent,
              usage,
              options.store,
              isRecentEnoughForShiftSpend(record),
            );
          }
        } catch {
          // Swallow: telemetry only, matches renderTranscriptLine/tapTranscriptLine's posture.
        }
      }
      reply.send({ ok: true });
    },
  );
}

// ── Remote tail-instruction plane (T1 remote live-tail, S2) ─────

/**
 * POST /api/tailer/poll — the tailer daemon's (S3, bin/transcript-tailer.mjs)
 * poll route. Bearer + X-Machine authed, same tier as /api/dispatch/poll
 * (a missing/invalid X-Machine can't resolve a per-machine queue, so it's a
 * 400 here, not a tolerant default — mirrors /api/dispatch/poll exactly,
 * not /api/agents/poll's ownMachineLabel fallback, since this route's
 * per-machine-queue shape matches dispatch's, not the poll-state-ingest
 * use case). Request body: { active?: string[] } — sessionIds the tailer
 * is CURRENTLY tailing this tick (tolerant of an absent/empty array, same
 * posture as the poll route's optional fields).
 *
 * Response: { tail: TailInstruction[] } — this machine's queue drained
 * AT-MOST-ONCE (dispatchStore.drainStopsFor's exact precedent), PLUS
 * reconcileAdvertisement's recovery instructions computed against what the
 * tailer just advertised. Per REMOTE-TAILER-DESIGN.md "Steering": a tailer
 * that restarts loses its in-memory active-tail state, and the next poll's
 * advertisement (now empty, or stale) drives reconciliation to re-issue
 * tail-on for every still-demanded session and tail-off for every session
 * the tailer thinks is active but nothing demands anymore — self-healing,
 * no separate recovery path needed.
 */
function registerTailerPollRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{ Body: Record<string, unknown> }>(
    '/api/tailer/poll',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const machine = sanitizeMachineLabel(request.headers['x-machine']);
      if (!machine) {
        reply.code(400).send({ error: 'missing/invalid X-Machine header' });
        return;
      }
      const body = request.body ?? {};
      const active = Array.isArray(body.active)
        ? body.active.filter((s): s is string => typeof s === 'string')
        : [];
      const drained = remoteTailDemand.drainTailQueueFor(machine);
      const recovered = remoteTailDemand.reconcileAdvertisement(machine, active, drained);
      reply.send({ tail: [...drained, ...recovered] });
    },
  );
}

// ── Dispatch queue (v1 mechanic #6b — "call a coworker") ───────

/** How often stale (unanswered past TTL) ringing requests are swept to `expired`. */
const DISPATCH_SWEEP_INTERVAL_MS = 30_000;

/** chainOrchestrator.sweep() cadence (v2 mechanic G3) — same interval as
 *  the dispatch TTL sweep; retries budget-paused pending continuations and
 *  applies the CHAIN_STEP_TIMEOUT_MS backstop. */
const CHAIN_SWEEP_INTERVAL_MS = 30_000;

/** standingOrderTick cadence (v2 mechanic G3, §7.2) — 60s, matching the
 *  BUILD-PLAN §G3 task 6 spec exactly (the daily dedupe guard must fire at
 *  most once per local date across repeated ticks at this cadence). */
const STANDING_ORDER_TICK_INTERVAL_MS = 60_000;

/** World-event live-tick cadence (v2 mechanic G4, GAME-DESIGN §2's unified
 *  cadence model) — 5 minutes, gated on ≥1 connected socket. */
const LIVE_TICK_INTERVAL_MS = 300_000;

/** effective mood = clamp(0,100, mood + moodBoost) — GAME-DESIGN §4.2. */
function effectiveMood(emp: { mood: number; moodBoost: number }): number {
  return Math.min(100, Math.max(0, emp.mood + emp.moodBoost));
}

/** rival_poach's targeting rule (§6.3): one random ACTIVE employee with
 *  effective mood < 40. Returns undefined when nobody qualifies (the event
 *  fizzles silently, per design). */
function pickLowMoodEmployeeId(): string | undefined {
  const candidates = employeeStore
    .getAll()
    .filter((e) => e.status === 'active' && effectiveMood(e) < 40);
  if (candidates.length === 0) return undefined;
  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

/** birthday's targeting rule (§6.3): any random ACTIVE employee. */
function pickRandomEmployeeId(): string | undefined {
  const candidates = employeeStore.getAll().filter((e) => e.status === 'active');
  if (candidates.length === 0) return undefined;
  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

/**
 * T2 remote-answer plane: derive each of `machine`'s agents' managed flag
 * from the runner's just-recorded advertisement (pid correlation — the
 * session's tmux pane pid IS the CLI's pid, which is the same pid the
 * hook/poller planes report for the agent) and broadcast transitions.
 * The flag is server-derived, never client-asserted, and clears honestly
 * when the session dies or the runner goes silent (sweep below).
 */
function applyManagedFlags(
  options: HttpServerOptions,
  machine: string,
  managedSessions: ManagedSessionAd[],
): void {
  // The type says store is required, but PixelAgentsServer.start() can be
  // (and in tests is) called without one — flag propagation is telemetry,
  // never worth a 500 on the runner's poll.
  if (!options.store) return;
  const managedPids = new Set(
    managedSessions.map((s) => s.panePid).filter((p): p is number => p !== undefined),
  );
  const serverMachine = options.machineLabel;
  for (const [id, agent] of options.store) {
    const agentMachine = agent.machine ?? serverMachine;
    if (agentMachine !== machine) continue;
    const managed = agent.pid !== undefined && managedPids.has(agent.pid);
    if ((agent.managed === true) !== managed) {
      agent.managed = managed || undefined;
      options.store.broadcast({ type: 'agentManagedUpdate', id, managed });
    }
  }
}

/**
 * Dispatch queue routes. The server never shells out — these routes only
 * read/write dispatchStore.ts's in-memory (persisted) queue; the actual CLI
 * spawn happens on a per-machine runner (bin/dispatch-runner.mjs) that polls
 * `/api/dispatch/poll` over the same Bearer-authed channel as the needs-input
 * poller. Decision routes are always 2xx: deny and unknown-id are decision
 * payloads, never 403/404 (see dispatchStore.ts doc comment).
 */
function registerDispatchRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  const sweepTimer = setInterval(() => {
    dispatchStore.sweepExpired();
    // T5 fleet controls: piggybacks this SAME existing timer (no new one) —
    // a HELD dispatch auto-releases once the local date rolls over past the
    // day it was held on.
    dispatchStore.sweepHeldRollover();
    // T2 remote-answer plane: pending answers whose runner vanished sweep
    // to an honest terminal 'expired', and agents whose machine's managed
    // advertisement went stale drop their ANSWER verb (flag clears +
    // broadcast) rather than rendering a plane that no longer exists.
    dispatchStore.sweepExpiredAnswers();
    for (const staleMachine of dispatchStore.sweepStaleManaged()) {
      applyManagedFlags(options, staleMachine, []);
    }
  }, DISPATCH_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  app.addHook('onClose', () => clearInterval(sweepTimer));

  // GET /api/dispatch/machines -- unauthenticated, like /api/briefing (tailnet-only
  // server). Only machines with a live runner advertisement are listed — a machine
  // without a runner is honestly absent, never stale-listed.
  app.get('/api/dispatch/machines', async () => dispatchStore.getMachines());

  // GET /api/dispatch/recent -- unauthenticated, same trust level as
  // /api/dispatch/machines (tailnet-only server). Last ~20 entries (incl.
  // resultTail) so a page refresh doesn't lose in-flight/just-terminal
  // dispatch state the way the WS-only non-terminal replay (getActive) would.
  app.get('/api/dispatch/recent', async () => dispatchStore.getRecent());

  // GET /api/dispatch/launched-via?machine=&pid= -- C3 born-managed wrapper,
  // read-only drawer lookup: resolves (machine, pid) -> the managed
  // session's dispatchId via the machine's LIVE runner advertisement (same
  // resolution requestAnswer uses), then looks up which client issued that
  // session's launch request. Unauthenticated, same tailnet-only trust tier
  // as /api/dispatch/machines. `{ launchedVia: undefined }` for anything
  // unmanaged/unknown/pre-C3 — additive, never a fabricated default.
  app.get<{ Querystring: { machine?: string; pid?: string } }>(
    '/api/dispatch/launched-via',
    async (request, reply) => {
      const machine = sanitizeMachineLabel(request.query.machine);
      const pid = Number(request.query.pid);
      if (!machine || !Number.isInteger(pid)) {
        reply.send({ launchedVia: undefined });
        return;
      }
      const managed = dispatchStore.getManagedFor(machine).find((s) => s.panePid === pid);
      if (!managed) {
        reply.send({ launchedVia: undefined });
        return;
      }
      reply.send({ launchedVia: dispatchStore.getLaunchedVia(managed.dispatchId) });
    },
  );

  // POST /api/dispatch/poll -- runner poll (Bearer + X-Machine). The body advertises
  // this tick's allowlisted providers/roots/focus capability; the response carries
  // this machine's ringing requests WITH the full prompt -- the only place it
  // travels the wire, and only to a Bearer-authed runner.
  app.post<{ Body: Record<string, unknown> }>(
    '/api/dispatch/poll',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const machine = sanitizeMachineLabel(request.headers['x-machine']);
      if (!machine) {
        reply.code(400).send({ error: 'missing/invalid X-Machine header' });
        return;
      }
      const body = request.body ?? {};
      const providers = Array.isArray(body.providers)
        ? body.providers.filter((p): p is string => typeof p === 'string')
        : [];
      const roots = Array.isArray(body.roots)
        ? body.roots.filter((r): r is string => typeof r === 'string')
        : [];
      const focus = body.focus === true;
      // T2/T4 managed sessions: capability flag + the runner's live
      // manifest advertisement (sanitized — dispatchId/tmuxSession strings
      // required, panePid a positive integer when present; anything else
      // is dropped entry-by-entry, never trusted off the wire).
      const sessions = body.sessions === true;
      const managedSessions = (Array.isArray(body.managedSessions) ? body.managedSessions : [])
        .filter(
          (s): s is Record<string, unknown> =>
            s !== null &&
            typeof s === 'object' &&
            typeof (s as Record<string, unknown>).dispatchId === 'string' &&
            typeof (s as Record<string, unknown>).tmuxSession === 'string',
        )
        .map((s) => ({
          dispatchId: s.dispatchId as string,
          tmuxSession: s.tmuxSession as string,
          panePid:
            typeof s.panePid === 'number' && Number.isInteger(s.panePid) && s.panePid > 0
              ? s.panePid
              : undefined,
          cwd: typeof s.cwd === 'string' ? s.cwd : undefined,
          provider: typeof s.provider === 'string' ? s.provider : undefined,
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : undefined,
        }));
      // T8 Mini compute — the runner advertises its registered script NAMES
      // only (never interpreter/paths); the CALL tray renders a picker.
      const scriptIds = (Array.isArray(body.scriptIds) ? body.scriptIds : []).filter(
        (s): s is string => typeof s === 'string',
      );
      // 4B skill picker — same names-only discipline (~/.claude/skills dir
      // names); the CALL modal composes a visible `/name` prompt prefix.
      const skills = (Array.isArray(body.skills) ? body.skills : []).filter(
        (s): s is string => typeof s === 'string',
      );
      dispatchStore.recordAdvertisement(machine, {
        providers,
        roots,
        focus,
        sessions,
        scriptIds,
        skills,
      });
      dispatchStore.recordManagedSessions(machine, managedSessions);
      // Propagate the managed flag onto matching agents (pid correlation)
      // and broadcast transitions — the board's ONLY license to render
      // ANSWER (REMOTE-ANSWER-DESIGN.md UI contract).
      applyManagedFlags(options, machine, managedSessions);
      reply.send({
        pending: dispatchStore.pendingFor(machine),
        // KICKOFF v1.1 item 3 — the first server->runner IMPERATIVE channel
        // (everything above is runner-polls-and-decides). Drained here, at
        // most once: the runner is expected to act on each entry THIS same
        // tick and report the outcome back (see StopInstruction's doc for
        // the two distinct, never-conflated targeting kinds).
        stop: dispatchStore.drainStopsFor(machine),
        // T2 remote-answer plane — the same drained at-most-once channel.
        // An undelivered answer stays pending server-side and sweeps to an
        // honest 'expired' if no runner ever reports (never a fake state).
        answer: dispatchStore.drainAnswersFor(machine),
      });
    },
  );

  // POST /api/dispatch/:id/kill -- webview-initiated (unauthenticated, same
  // trust level as the other player-action routes below -- the server is
  // tailnet-only). Only QUEUES a stop instruction for that dispatch's
  // machine; the runner's own registry is the real containment boundary
  // (see dispatchStore.requestStop's doc) -- this route can't force
  // anything, it can only ask.
  app.post<{ Params: { id: string } }>('/api/dispatch/:id/kill', async (request, reply) => {
    reply.send(dispatchStore.requestStop(request.params.id));
  });

  // POST /api/dispatch/:id/release -- T5 fleet controls, DAILY FLEET SPEND
  // CEILING: the explicit human override that releases a HELD
  // ('queued-budget') dispatch to ring normally. Same trust level as
  // /api/dispatch/:id/kill (unauthenticated, tailnet-only, a conscious
  // player action). The automatic local-date-rollover release is a
  // separate path (sweepHeldRollover, piggybacked on the sweep timer above).
  app.post<{ Params: { id: string } }>('/api/dispatch/:id/release', async (request, reply) => {
    reply.send(dispatchStore.releaseHeld(request.params.id));
  });

  // POST /api/dispatch/:id/decision -- runner decision (Bearer). Deny AND an
  // unknown/already-decided id are BOTH 2xx -- a decision, never an HTTP error.
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/dispatch/:id/decision',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const body = request.body ?? {};
      const decision =
        body.decision === 'accept' || body.decision === 'deny' ? body.decision : undefined;
      if (!decision) {
        reply.code(400).send({ error: 'expected body { decision: "accept" | "deny" }' });
        return;
      }
      const reason = typeof body.reason === 'string' ? body.reason : undefined;
      const pid = typeof body.pid === 'number' ? body.pid : undefined;
      reply.send(dispatchStore.decide(request.params.id, decision, { reason, pid }));
    },
  );

  // POST /api/dispatch/:id/status -- runner-reported lifecycle event (Bearer):
  // spawn started (attaches pid), the process exited on its own (terminal,
  // carries exitCode), the runner explicitly killed it via the stop channel
  // (KICKOFF v1.1 item 3 -- a DISTINCT terminal status, never conflated with
  // a natural 'exited'), or the runner capped it via its own timeoutSec
  // timer (T5 fleet controls -- another DISTINCT terminal status).
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/dispatch/:id/status',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const body = request.body ?? {};
      const event =
        body.event === 'started' ||
        body.event === 'exited' ||
        body.event === 'killed' ||
        body.event === 'capped'
          ? body.event
          : undefined;
      if (!event) {
        reply
          .code(400)
          .send({ error: 'expected body { event: "started" | "exited" | "killed" | "capped" }' });
        return;
      }
      const pid = typeof body.pid === 'number' ? body.pid : undefined;
      const exitCode = typeof body.exitCode === 'number' ? body.exitCode : undefined;
      const resultTail = typeof body.resultTail === 'string' ? body.resultTail : undefined;
      const killOutcome = body.killOutcome === 'not-found' ? body.killOutcome : undefined;
      const result = dispatchStore.reportStatus(request.params.id, {
        event,
        pid,
        exitCode,
        resultTail,
        killOutcome,
      });
      // Dispatch-driven Cash/XP (v1 mechanic #6b Cash, v2 mechanic G3
      // employee XP — GAME-DESIGN §7.3's "employeeWorkCompleted" integration
      // point): every real exit counts as economy activity; exit 0 tagged
      // with an employeeId also awards that employee XP exactly once.
      // codex exits additionally feed the budget guardrail's weekly counter.
      if (event === 'exited' && exitCode !== undefined) {
        const record = dispatchStore.getRecord(request.params.id);
        // Server Room global Cash buff (G2, GAME-DESIGN §5.4) — same
        // point-in-time layout read as the poll route below and
        // hookEventHandler.ts's turn-completed award; economyStore.ts
        // cannot import officeLayoutStore.ts itself (reverse-cycle risk),
        // so the bonus is computed here and passed through.
        const dispatchLayout = getOfficeLayout();
        const dispatchCashBonusPct = dispatchLayout ? globalBuffs(dispatchLayout).cashBonusPct : 0;
        // Receipt ref (v3 REP receipts): the observed dispatch exit —
        // same `dispatch:<id>` convention as the stage-2 v3 planes.
        economyStore.recordDispatchExit(
          exitCode,
          `dispatch:${request.params.id}`,
          undefined,
          dispatchCashBonusPct,
        );
        // Perfect-ops (v3 stage 3): real 'exited' events only — the
        // 'killed' branch never reaches here (a deliberate player halt
        // is not a failure, v1.1 item-3 doctrine).
        perfectOpsDay.recordDispatchExit(request.params.id, exitCode);
        if (record?.employeeId) {
          employeeStore.recordDispatchExit(record.employeeId, exitCode);
        }
        if (record?.provider === 'codex') {
          budgetStore.recordCodexDispatchExit();
        }
        // Contracts (v2 mechanic G4, §6.2): the dispatch-result completion
        // path -- an explicit contractId set at enqueue time by the
        // webview's BRIEFING->DISPATCH prefill, never string-matched.
        // Exit 0 only; a nonzero exit leaves the contract open (the linked
        // work didn't actually finish).
        if (record?.contractId && exitCode === 0) {
          contractStore.completeByDispatch(record.contractId);
        }
      }
      reply.send(result);
    },
  );

  // POST /api/dispatch/:id/output -- runner-forwarded live output telemetry
  // (Bearer, same auth tier as /status: machine telemetry, not a player
  // action). KICKOFF-v2.0 Phase 2 slice 2.5. Appends the coalesced chunk
  // into the output ring, from which the subscription-gated WS fan-out
  // delivers it — output NEVER rides the poll response, and this route
  // never touches the dispatch record or containment. Liveness-gated:
  // appending is only allowed while the dispatch is non-terminal
  // (ringing/answered) so a straggler POST arriving after the terminal
  // eviction can't resurrect a ring entry nothing would ever evict again.
  // Refusal is a 2xx decision ({ok:false, reason}), never a 4xx — the
  // runner's forwarder is fire-and-forget either way.
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/dispatch/:id/output',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const body = request.body ?? {};
      const stream = body.stream === 'stdout' || body.stream === 'stderr' ? body.stream : undefined;
      const chunk = typeof body.chunk === 'string' && body.chunk !== '' ? body.chunk : undefined;
      const seqValid = body.seq === undefined || typeof body.seq === 'number';
      if (!stream || chunk === undefined || !seqValid) {
        reply
          .code(400)
          .send({ error: 'expected body { stream: "stdout" | "stderr", chunk, seq? }' });
        return;
      }
      const record = dispatchStore.getRecord(request.params.id);
      if (!record || (record.status !== 'ringing' && record.status !== 'answered')) {
        reply.send({ ok: false, reason: 'unknown-or-terminal' });
        return;
      }
      // The ring assigns the authoritative wire seq; the runner's own seq is
      // validated above but not trusted for ordering (the forwarder already
      // serializes its POSTs per dispatch).
      outputRingStore.append('dispatch', request.params.id, stream, chunk);
      reply.send({ ok: true });
    },
  );
}

// ── Observed-session pid-kill (KICKOFF v1.1 item 3) ─────────────

/**
 * Worker session kill's OBSERVED-SESSION path (reach: any worker with a
 * known pid, not just runner-spawned dispatches — the AgentDrawer kill
 * button always targets by (machine, pid), since that is the one thing the
 * drawer actually has for every agent, dispatched or not). Deliberately
 * separate from registerDispatchRoutes' dispatch-id kill route above —
 * different targeting semantics, never conflated (see StopInstruction's
 * doc in dispatchStore.ts). The runner is the ONLY thing that verifies the
 * target pid is actually a claude process before signaling it; this route
 * only queues the request.
 */
function registerAgentKillRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{ Body: Record<string, unknown> }>('/api/agents/kill', async (request, reply) => {
    const body = request.body ?? {};
    // Normalized the same way the runner's own X-Machine header is
    // (sanitizeMachineLabel) — the webview reads ch.machine straight from
    // hook telemetry, which is already this shape in practice, but
    // normalizing here too closes a silent-stranding gap (a body machine
    // string that doesn't exactly match the runner's own uppercased key
    // would otherwise queue against a key the runner's poll never drains).
    const machine = sanitizeMachineLabel(body.machine);
    const pid = typeof body.pid === 'number' ? body.pid : undefined;
    if (!machine || pid === undefined) {
      reply.send({ ok: false, reason: 'missing-machine-or-pid' });
      return;
    }
    reply.send(dispatchStore.requestPidKill(machine, pid));
  });

  // Webview-facing poll for the AgentDrawer's kill-outcome feedback (no WS
  // broadcast for this ephemeral, in-memory-only lifecycle — see
  // PidKillRecord's doc in dispatchStore.ts).
  app.get<{ Params: { id: string } }>('/api/agents/kill/:id', async (request, reply) => {
    const result = dispatchStore.getPidKillStatus(request.params.id);
    if (!result.found) {
      reply.code(404).send({ found: false });
      return;
    }
    reply.send(result);
  });

  // POST /api/pid-kills/:id/status -- runner-reported outcome (Bearer), same
  // auth tier as /api/dispatch/:id/status (machine telemetry, not a player
  // action).
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/pid-kills/:id/status',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const body = request.body ?? {};
      const event = body.event === 'killed' || body.event === 'denied' ? body.event : undefined;
      if (!event) {
        reply.code(400).send({ error: 'expected body { event: "killed" | "denied" }' });
        return;
      }
      const reason = typeof body.reason === 'string' ? body.reason : undefined;
      reply.send(dispatchStore.reportPidKillStatus(request.params.id, event, reason));
    },
  );
}

// ── Remote answer (v4 T2 — REMOTE-ANSWER-DESIGN.md) ─────────────

/**
 * Answer plane routes. The board addresses the target the same way the
 * observed-session kill path does — (machine, pid) — and the SERVER
 * resolves it to a managed-session ref against the machine's LIVE runner
 * advertisement (no live coverage = honest `not-managed` deny; the server
 * cannot conjure answerability the runner didn't advertise, and even a
 * queued instruction is re-checked runner-side against manifest + tmux
 * liveness + a one-shot nonce). Player-action routes are unauthenticated
 * (tailnet-only precedent, same tier as /api/agents/kill); the runner
 * outcome route is Bearer-authed like every other runner report.
 */
function registerAgentAnswerRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  // POST /api/agents/answer -- queue an answer { machine, pid, text }.
  app.post<{ Body: Record<string, unknown> }>('/api/agents/answer', async (request, reply) => {
    const body = request.body ?? {};
    const machine = sanitizeMachineLabel(body.machine);
    const pid = typeof body.pid === 'number' ? body.pid : undefined;
    const text = typeof body.text === 'string' ? body.text : undefined;
    // C8-6: optional start-identifier the board observed for the target — when
    // present, requestAnswer requires it to match the resolved session's start
    // time (pid-reuse guard). Absent = legacy pid-only match.
    const startTime = typeof body.startTime === 'number' ? body.startTime : undefined;
    if (!machine || pid === undefined || text === undefined) {
      reply.send({ ok: false, reason: 'missing-machine-pid-or-text' });
      return;
    }
    reply.send(dispatchStore.requestAnswer(machine, pid, text, Date.now(), startTime, 'answer'));
  });

  // POST /api/agents/prompt -- C3 free-form PROMPT verb. SAME route family,
  // SAME trust tier (unauthenticated, tailnet-only), SAME body shape, SAME
  // queue as /api/agents/answer — the only difference is the verb tag
  // (gate 4 CLOSED: shared type, no parallel promptQueue, no new trust
  // surface). Every guard requestAnswer applies (text cap, control-char
  // reject, one-shot nonce, at-most-once drain, duplicate-outcome drop)
  // covers PROMPT identically; the only semantic difference is that a
  // PROMPT is not gated on the target session currently being blocked.
  app.post<{ Body: Record<string, unknown> }>('/api/agents/prompt', async (request, reply) => {
    const body = request.body ?? {};
    const machine = sanitizeMachineLabel(body.machine);
    const pid = typeof body.pid === 'number' ? body.pid : undefined;
    const text = typeof body.text === 'string' ? body.text : undefined;
    const startTime = typeof body.startTime === 'number' ? body.startTime : undefined;
    if (!machine || pid === undefined || text === undefined) {
      reply.send({ ok: false, reason: 'missing-machine-pid-or-text' });
      return;
    }
    reply.send(dispatchStore.requestAnswer(machine, pid, text, Date.now(), startTime, 'prompt'));
  });

  // GET /api/agents/answer/:id -- the drawer's delivery-outcome poll
  // (pending = "DELIVERING…", denied renders ✗ with the runner's reason).
  app.get<{ Params: { id: string } }>('/api/agents/answer/:id', async (request, reply) => {
    const result = dispatchStore.getAnswerStatus(request.params.id);
    if (!result.found) {
      reply.code(404).send({ found: false });
      return;
    }
    reply.send(result);
  });

  // GET /api/agents/answers?machine=&ref= -- receipts for the drawer
  // (one-tap-real: the VERBATIM text is the receipt). Same unauthenticated
  // tailnet read plane as /api/dispatch/recent.
  app.get<{ Querystring: { machine?: string; ref?: string } }>(
    '/api/agents/answers',
    async (request, reply) => {
      const machine = sanitizeMachineLabel(request.query.machine);
      if (!machine) {
        reply.send({ answers: [] });
        return;
      }
      const ref = typeof request.query.ref === 'string' ? request.query.ref : undefined;
      reply.send({ answers: dispatchStore.getAnswerReceipts(machine, ref) });
    },
  );

  // POST /api/answers/:id/status -- runner-reported outcome (Bearer, same
  // tier as /api/pid-kills/:id/status). First report wins; duplicates drop.
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/answers/:id/status',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const body = request.body ?? {};
      const event = body.event === 'delivered' || body.event === 'denied' ? body.event : undefined;
      if (!event) {
        reply.code(400).send({ error: 'expected body { event: "delivered" | "denied" }' });
        return;
      }
      const reason = typeof body.reason === 'string' ? body.reason : undefined;
      reply.send(dispatchStore.reportAnswerStatus(request.params.id, event, reason));
    },
  );
}

// ── Employees (v2 mechanic G1 — GAME-DESIGN.md §4) ──────────────

const SCORE_TRACKS = ['speed', 'accuracy', 'nightOwl', 'tokenEfficiency'] as const;

/** Wire shape — drops internal-only bookkeeping fields (last-seen token
 *  counts, decay timestamps, the raw rolling-turns ring buffer) that never
 *  belong on the broadcast/response plane. */
function toEmployeeSnapshot(emp: Employee): Record<string, unknown> {
  return {
    type: 'employeeSnapshot',
    id: emp.id,
    machine: emp.machine,
    projectDir: emp.projectDir,
    projectLabel: emp.projectLabel,
    name: emp.name,
    spriteIndex: emp.spriteIndex,
    defaultProvider: emp.defaultProvider,
    defaultModel: emp.defaultModel,
    status: emp.status,
    rank: emp.rank,
    xp: emp.xp,
    mood: emp.mood,
    moodBoost: emp.moodBoost,
    scores: emp.scores,
    trainingBonus: emp.trainingBonus,
    sampleCount: emp.rolling.recentTurns.length,
    assignedRoomId: emp.assignedRoomId,
    createdAt: emp.createdAt,
    lastActiveAt: emp.lastActiveAt,
    lowMoodStreakDays: emp.lowMoodStreakDays,
    breakUntil: emp.breakUntil,
  };
}

/**
 * Employee roster routes. Same trust level as /api/briefing/dispatch's
 * machine-list routes (unauthenticated — this is a local-webview-initiated
 * player action plane, not remote-machine telemetry ingest; the server is
 * tailnet-only). Mutating verbs return `{ok:false, reason}` on a failed
 * gate at 200, never 4xx — "deny is a decision," same posture as
 * dispatchStore's decision plane.
 */
function registerEmployeeRoutes(app: FastifyInstance): void {
  app.get('/api/employees', async () => employeeStore.getAll().map(toEmployeeSnapshot));

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/employees/:id/history',
    async (request) => {
      const limit = Number(request.query.limit ?? 50);
      return employeeStore.history(request.params.id, Number.isFinite(limit) ? limit : 50);
    },
  );

  const verb = (
    path: string,
    fn: (
      id: string,
      body: Record<string, unknown>,
    ) => { ok: boolean; reason?: string; employee?: Employee },
  ) => {
    app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
      `/api/employees/:id/${path}`,
      async (request, reply) => {
        const result = fn(request.params.id, request.body ?? {});
        reply.send(
          result.ok
            ? {
                ok: true,
                employee: result.employee ? toEmployeeSnapshot(result.employee) : undefined,
              }
            : { ok: false, reason: result.reason },
        );
      },
    );
  };

  verb('train', (id, body) => {
    const track = body.track;
    if (typeof track !== 'string' || !(SCORE_TRACKS as readonly string[]).includes(track)) {
      return { ok: false, reason: 'invalid-track' };
    }
    return employeeStore.train(id, track as ScoreTrack);
  });
  verb('promote', (id) => employeeStore.promote(id));
  verb('break', (id) => employeeStore.break_(id));
  verb('fire', (id) => employeeStore.fire(id));
  verb('retire', (id) => employeeStore.retire(id));
  verb('rehire', (id) => employeeStore.rehire(id));
  verb('onboard', (id) => employeeStore.onboard(id));
  verb('assign', (id, body) => {
    const roomId = typeof body.roomId === 'string' ? body.roomId : undefined;
    return employeeStore.assign(id, roomId);
  });
}

// ── Economy (v2 mechanic G2 — GAME-DESIGN.md §3) ────────────────

/**
 * Economy routes. Same trust level as /api/employees (unauthenticated
 * local-webview player-action plane; the server is tailnet-only).
 * GET routes are read-only. The vacation toggle is `{ok:true}` always
 * (a boolean flip, nothing to deny).
 */
function registerEconomyRoutes(app: FastifyInstance): void {
  app.get('/api/economy', async () => economyStore.getSnapshot());

  // GET /api/economy/summary — check-in digest (GAME-DESIGN §2/§6.5). The
  // narrative sums the recent ledger tail's Cash/Rep deltas and pulls the
  // last 5 world events for the "while you were out" story.
  app.get('/api/economy/summary', async () => {
    const snapshot = economyStore.getSnapshot();
    const recentLedger = snapshot.ledger.slice(-20);
    const cashDelta = recentLedger
      .filter((e) => e.currency === 'cash')
      .reduce((sum, e) => sum + e.delta, 0);
    const reputationDelta = recentLedger
      .filter((e) => e.currency === 'reputation')
      .reduce((sum, e) => sum + e.delta, 0);
    const topEvents = worldEventStore
      .getEventLog(5)
      .map((e) => ({ glyph: e.glyph, summary: e.summary }));
    const warnings: string[] = [];
    if (snapshot.grime > 70) {
      warnings.push('Office grime is above 70 — consider a clean-up or a Kitchen.');
    }
    const narrative = renderDigest({ cashDelta, reputationDelta, topEvents, warnings });
    return { ...snapshot, recentLedger, narrative };
  });

  app.post<{ Body: Record<string, unknown> }>('/api/economy/vacation', async (request, reply) => {
    const active = request.body?.active === true;
    reply.send({ ok: true, economy: economyStore.setVacationMode(active) });
  });
}

// ── Building (v2 mechanic G2 — GAME-DESIGN.md §5) ───────────────

const ROOM_TYPE_VALUES: readonly string[] = Object.values(RoomTypeValues);

/**
 * Building routes. Same trust level as /api/employees/economy
 * (unauthenticated local-webview player-action plane). Every route is
 * check-debit(-or-refund)-persist-broadcast — the client never mutates
 * Cash (§5.7); it applies the layout change locally only on `{ok:true}`.
 * Decisions are `{ok:false, reason}` at 200, never 4xx.
 */
function registerBuildingRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  app.post('/api/building/expand', async (_request, reply) => {
    const result = expandOffice();
    if (result.ok) {
      options.store.broadcast({
        type: 'officeExpanded',
        layout: result.layout,
        bayCount: economyStore.getBayCount(),
      });
      reply.send({ ok: true, layout: result.layout });
    } else {
      reply.send({ ok: false, reason: result.reason });
    }
  });

  app.post<{ Body: Record<string, unknown> }>('/api/building/room', async (request, reply) => {
    const body = request.body ?? {};
    const type = body.type;
    if (typeof type !== 'string' || !ROOM_TYPE_VALUES.includes(type)) {
      reply.send({ ok: false, reason: 'invalid-room-type' });
      return;
    }
    const colStart = Number(body.colStart);
    const rowStart = Number(body.rowStart);
    const colEnd = Number(body.colEnd);
    const rowEnd = Number(body.rowEnd);
    if (![colStart, rowStart, colEnd, rowEnd].every(Number.isInteger)) {
      reply.send({ ok: false, reason: 'invalid-rect' });
      return;
    }
    const result = addRoom({ colStart, rowStart, colEnd, rowEnd }, type as RoomType);
    if (result.ok) {
      options.store.broadcast({ type: 'officeLayoutUpdated', layout: result.layout });
      reply.send({ ok: true, layout: result.layout });
    } else {
      reply.send({ ok: false, reason: result.reason });
    }
  });

  app.post<{ Body: Record<string, unknown> }>('/api/building/furniture', async (request, reply) => {
    const body = request.body ?? {};
    const type = body.type;
    const col = Number(body.col);
    const row = Number(body.row);
    if (typeof type !== 'string' || !Number.isInteger(col) || !Number.isInteger(row)) {
      reply.send({ ok: false, reason: 'invalid-request' });
      return;
    }
    const result = buyFurniture(type, col, row);
    if (result.ok) {
      options.store.broadcast({ type: 'officeLayoutUpdated', layout: result.layout });
      reply.send({ ok: true, layout: result.layout });
    } else {
      reply.send({ ok: false, reason: result.reason });
    }
  });

  app.post<{ Body: Record<string, unknown> }>('/api/building/sell', async (request, reply) => {
    const uid = request.body?.uid;
    if (typeof uid !== 'string' || uid === '') {
      reply.send({ ok: false, reason: 'invalid-uid' });
      return;
    }
    const result = sell(uid);
    if (result.ok) {
      options.store.broadcast({ type: 'officeLayoutUpdated', layout: result.layout });
      reply.send({ ok: true, layout: result.layout });
    } else {
      reply.send({ ok: false, reason: result.reason });
    }
  });
}

// ── Dispatch chains (v2 mechanic G3 — GAME-DESIGN.md §7.1) ─────

/**
 * Chain routes. Same trust level as /api/employees/economy/building
 * (unauthenticated local-webview player-action plane — the server is
 * tailnet-only). Decisions are `{ok:false, reason}` at 200, never 4xx.
 * The actual advance algorithm lives entirely in chainOrchestrator.ts —
 * these routes only call into it (createDef is the one exception, a pure
 * chainStore data operation with no dispatch side effect).
 */
function registerChainRoutes(app: FastifyInstance): void {
  app.get('/api/chains/defs', async () => chainStore.getDefs());
  app.get('/api/chains/runs', async () => chainStore.getRuns());

  app.post<{ Body: Record<string, unknown> }>('/api/chains/defs', async (request, reply) => {
    const body = request.body ?? {};
    const name = typeof body.name === 'string' ? body.name : '';
    const steps = Array.isArray(body.steps) ? (body.steps as ChainStepDef[]) : [];
    const perkFlags = economyStore.getPerkFlags();
    if (steps.length > chainMaxSteps(perkFlags)) {
      reply.send({ ok: false, reason: 'too-many-steps' });
      return;
    }
    const result = chainStore.createDef({ name, steps }, perkFlags);
    reply.send(result);
  });

  app.post<{ Params: { id: string } }>('/api/chains/defs/:id/run', async (request, reply) => {
    const result = chainOrchestrator.startRun(request.params.id, economyStore.getPerkFlags());
    reply.send(result);
  });
}

// ── Standing orders (v2 mechanic G3 — GAME-DESIGN.md §7.2) ─────

/**
 * Standing order routes. Same trust level as the chain routes above.
 * confirmFirstFire is the ONLY route that ever clears
 * needsFirstFireConfirm — see standingOrderStore.ts's file header; no
 * other route, perk purchase, or STOP ALL/RESUME action can reach it.
 */
function registerStandingOrderRoutes(app: FastifyInstance): void {
  app.get('/api/standing-orders', async () => standingOrderStore.getAll());

  app.post<{ Body: Record<string, unknown> }>('/api/standing-orders', async (request, reply) => {
    const body = request.body ?? {};
    const schedule = body.schedule as StandingOrderSchedule | undefined;
    if (
      !schedule ||
      (schedule.kind !== 'daily' && schedule.kind !== 'interval') ||
      typeof body.name !== 'string' ||
      typeof body.prompt !== 'string'
    ) {
      reply.send({ ok: false, reason: 'invalid-request' });
      return;
    }
    const result = standingOrderStore.create(
      {
        name: body.name,
        schedule,
        machine: typeof body.machine === 'string' ? body.machine : undefined,
        provider: typeof body.provider === 'string' ? body.provider : undefined,
        cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
        prompt: body.prompt,
        model: typeof body.model === 'string' ? body.model : undefined,
        effort: typeof body.effort === 'string' ? body.effort : undefined,
        employeeId: typeof body.employeeId === 'string' ? body.employeeId : undefined,
      },
      economyStore.getPerkFlags(),
    );
    reply.send(result);
  });

  app.post<{ Params: { id: string } }>(
    '/api/standing-orders/:id/confirm-first-fire',
    async (request, reply) => {
      const result = standingOrderStore.confirmFirstFire(
        request.params.id,
        (id) => employeeStore.resolveEmployeeDefaults(id),
        (input) => dispatchStore.enqueue(input),
      );
      reply.send(result);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/standing-orders/:id/enabled',
    async (request, reply) => {
      const enabled = request.body?.enabled === true;
      reply.send(standingOrderStore.setEnabled(request.params.id, enabled));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/standing-orders/:id/delete',
    async (request, reply) => {
      reply.send(standingOrderStore.delete(request.params.id));
    },
  );
}

// ── Dispatch templates (v2 mechanic G3 — GAME-DESIGN.md §7.3) ──

function registerDispatchTemplateRoutes(app: FastifyInstance): void {
  app.get('/api/dispatch-templates', async () => dispatchTemplateStore.getAll());

  app.post<{ Body: Record<string, unknown> }>('/api/dispatch-templates', async (request, reply) => {
    const body = request.body ?? {};
    if (typeof body.name !== 'string' || typeof body.prompt !== 'string') {
      reply.send({ ok: false, reason: 'invalid-request' });
      return;
    }
    reply.send(
      dispatchTemplateStore.create({
        name: body.name,
        prompt: body.prompt,
        machine: typeof body.machine === 'string' ? body.machine : undefined,
        provider: typeof body.provider === 'string' ? body.provider : undefined,
        cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
        effort: typeof body.effort === 'string' ? body.effort : undefined,
        employeeId: typeof body.employeeId === 'string' ? body.employeeId : undefined,
      }),
    );
  });

  app.post<{ Params: { id: string } }>(
    '/api/dispatch-templates/:id/delete',
    async (request, reply) => {
      reply.send(dispatchTemplateStore.delete(request.params.id));
    },
  );
}

// ── Budget guardrail (v2 mechanic G3 — GAME-DESIGN.md §7.4) ────

/**
 * Budget routes. GET is unauthenticated (same trust level as the other
 * player-facing snapshot routes). POST /api/budget/report is the ingest
 * point for bin/needs-input-poller.mjs's forwarded snapshot — same Bearer
 * auth as /api/agents/poll, since it's machine telemetry, not a player action.
 */
function registerBudgetRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/api/budget', async () => budgetStore.getSnapshot());

  app.post<{ Body: Record<string, unknown> }>(
    '/api/budget/report',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const body = request.body ?? {};
      const snapshot = (body.rate_limits ?? body) as ClaudeRateLimitSnapshot;
      budgetStore.reportClaudeSnapshot(snapshot);
      reply.send({ ok: true });
    },
  );

  app.post<{ Body: Record<string, unknown> }>('/api/budget/codex-cap', async (request, reply) => {
    const cap = Number(request.body?.cap);
    if (!Number.isFinite(cap) || cap < 0) {
      reply.send({ ok: false, reason: 'invalid-cap' });
      return;
    }
    budgetStore.setCodexWeeklyCap(cap);
    reply.send({ ok: true });
  });

  app.post<{ Body: Record<string, unknown> }>('/api/economy/perks/buy', async (request, reply) => {
    const id = request.body?.id;
    if (typeof id !== 'string' || !(PERK_IDS as readonly string[]).includes(id)) {
      reply.send({ ok: false, reason: 'invalid-perk' });
      return;
    }
    reply.send(economyStore.buyPerk(id as PerkId));
  });
}

// ── STOP ALL — the global kill switch (v2 mechanic G3 — GAME-DESIGN.md §7.5) ──

/**
 * `POST /api/automation/stop-all` — one transaction (§7.5): disables every
 * enabled standing order (stoppedByKillSwitch flag), halts every running
 * chain run (in-flight dispatch finishes on its own but never enqueues the
 * next step), and broadcasts `automationStopped`. `POST
 * /api/automation/resume` is a separate explicit action, never automatic.
 * Manual CallModal dispatch is unaffected either way — the kill switch
 * targets autonomy, not the human.
 */
function registerAutomationStopAllRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  app.post('/api/automation/stop-all', async (_request, reply) => {
    const haltedOrders = standingOrderStore.haltAll();
    const haltedRuns = chainOrchestrator.haltAll();
    // Codex fix round finding 1 — the SAME transaction now also suppresses
    // the T3 rung-3 auto-executor (ticks become a no-op) and freezes HELD
    // dispatches' automatic rollover release. A human's explicit REQUEUE
    // proposal tap or /release override still works — the kill switch
    // targets unattended automation, never a conscious human action.
    autoExecutorStore.haltAll();
    // C9-1: durable STOP-ALL latch — engaged in the SAME transaction so a
    // fresh webview (or a server restart) hydrates "stopped" even when this
    // STOP ALL halted ONLY chain runs and left zero durable order flags (the
    // limitation stopAll.ts's header called out). Idempotent.
    stopAllLatch.engage();
    options.store.broadcast({
      type: 'automationStopped',
      haltedOrderIds: haltedOrders.map((o) => o.id),
      haltedRunIds: haltedRuns.map((r) => r.id),
    });
    notifyBigMoment(
      'stop-all',
      `STOP ALL engaged: ${haltedOrders.length} standing order(s), ${haltedRuns.length} chain run(s) halted.`,
    );
    reply.send({ ok: true, haltedOrders: haltedOrders.length, haltedRuns: haltedRuns.length });
  });

  app.post('/api/automation/resume', async (_request, reply) => {
    const resumedOrders = standingOrderStore.resumeAll();
    // Codex fix round finding 1 — mirrors standingOrderStore's resumeAll
    // exactly: restores the auto-executor + HELD-rollover release.
    autoExecutorStore.resumeAll();
    // C9-1: clear the durable latch in the SAME resume transaction.
    stopAllLatch.release();
    reply.send({ ok: true, resumedOrders: resumedOrders.length });
  });

  // C9-1: GET /api/automation/stop-all-state — mount-time hydration source for
  // the webview STOP-ALL control. Same unauthenticated tailnet read plane as
  // the other player-facing GETs; reads the durable latch so a page reload
  // (or a fresh server after a restart) never silently shows "not stopped".
  app.get('/api/automation/stop-all-state', async (_request, reply) => {
    reply.send({ engaged: stopAllLatch.isEngaged() });
  });
}

// ── Contracts (v2 mechanic G4 — GAME-DESIGN.md §6.2) ────────────

/**
 * Contract routes. Same trust level as employees/economy/building
 * (unauthenticated local-webview player-action plane; the server is
 * tailnet-only). GET reconciles first (piggybacking briefingProvider's own
 * 60s cache, same as GET /api/briefing) so a client that only ever polls
 * /api/contracts still sees fresh mints/completions. The manual-claim route
 * rejects (never silently no-ops) a cap-exceeded or already-terminal claim.
 */
function registerContractRoutes(app: FastifyInstance): void {
  app.get('/api/contracts', async () => {
    contractStore.reconcile(getBriefing());
    return contractStore.getAll();
  });

  app.post<{ Params: { id: string } }>('/api/contracts/:id/claim', async (request, reply) => {
    reply.send(contractStore.claim(request.params.id));
  });
}

// ── Studio contracts (v3 WS-C stage 2 — KICKOFF-v3.1 §1 "Aging contracts") ──

/**
 * Studio contract routes. Same trust level as /api/contracts
 * (unauthenticated local-webview player-action plane; the server is
 * tailnet-only). GET is read-only; ACCEPT is the one player verb — every
 * other transition is derivation-owned (studioContractIngest.ts): mint
 * from the real todo file, progress from observed events, completion on
 * todo disappearance, QUIET expiry. There is deliberately no decline/
 * dismiss-with-penalty verb: ignoring an offered contract costs nothing.
 */
function registerStudioContractRoutes(app: FastifyInstance): void {
  app.get('/api/studio-contracts', async () => studioContractStore.getAll());

  app.post<{ Params: { id: string } }>(
    '/api/studio-contracts/:id/accept',
    async (request, reply) => {
      reply.send(studioContractStore.accept(request.params.id));
    },
  );
}

// ── Scrap & Rework Bin (v3 WS-C stage 2 — KICKOFF-v3.1 §1 "failure loop") ──

/**
 * Rework bin routes. Same trust level as the player-action planes above.
 * REWORK re-enqueues the crate's ORIGINAL dispatch parameters through the
 * NORMAL dispatch path — dispatchStore.enqueue applies the ringing cap,
 * the runner's own allowlist decides, the TTL sweep applies; nothing here
 * bypasses any gate (a rework click is a conscious human act, the same
 * class as a CallModal Send). DISMISS is the REQUIRED first-class verb —
 * counted on the SHIFT scorecard, never penalized, never re-nagged.
 */
function registerReworkRoutes(app: FastifyInstance): void {
  app.get('/api/rework', async () => reworkBinStore.getAll());

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/rework/:id/dismiss',
    async (request, reply) => {
      const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
      const result = reworkBinStore.dismiss(request.params.id, reason);
      if (result.ok) shiftStats.recordReworkDismissed();
      reply.send(result);
    },
  );

  app.post<{ Params: { id: string } }>('/api/rework/:id/redispatch', async (request, reply) => {
    // T3 rung 3: this is the SAME function the auto-executor's tick calls
    // for the requeue-failed-dispatch whitelist action — see
    // reworkRedispatch.ts's header comment.
    reply.send(redispatchCrate(request.params.id));
  });
}

/** Normalize an X-Machine header value to an uppercase label, or undefined if invalid. */
export function sanitizeMachineLabel(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const label = value.trim().toUpperCase();
  return /^[A-Z0-9_-]{1,32}$/.test(label) ? label : undefined;
}

/** Normalize an X-Pid header value to a positive integer OS pid, or undefined if invalid/absent. */
export function sanitizeHookPid(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

// ── WebSocket ──────────────────────────────────────────────────

function registerWebSocketRoute(
  app: FastifyInstance,
  options: HttpServerOptions,
  liveSocketTracker: { count: number },
): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    // In standalone mode (not embedded), skip auth for WebSocket connections.
    // The server binds to 127.0.0.1, so only local clients can connect.
    // In embedded mode (VS Code), require Bearer token for security.
    if (options.embedded) {
      const auth = request.headers.authorization ?? '';
      const expected = `Bearer ${options.token}`;
      const authBuf = Buffer.from(auth);
      const expectedBuf = Buffer.from(expected);
      if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
        socket.close(4001, 'unauthorized');
        return;
      }
    }

    // World-event live-tick gate (v2 mechanic G4, GAME-DESIGN §2): a plain
    // connect/close counter, decremented unconditionally on close so the
    // live tick stops doing anything the instant the last socket disconnects.
    liveSocketTracker.count += 1;

    const { store } = options;

    // Pipe store events to WebSocket client
    const onAgentAdded = (id: number, agent: AgentState) => {
      safeSend(socket, {
        type: 'agentCreated',
        id,
        folderName: agent.folderName,
        isExternal: agent.isExternal || undefined,
        isTeammate: agent.leadAgentId !== undefined || undefined,
        teammateName: agent.agentName,
        parentAgentId: agent.leadAgentId,
        teamName: agent.teamName,
        hooksOnly: agent.hooksOnly || undefined,
        machine: agent.machine ?? options.machineLabel,
        // Coworker providers only (claude is the house default — no label).
        provider: agent.providerId && agent.providerId !== 'claude' ? agent.providerId : undefined,
        // Dispatch drawer identity (mechanic #6b): real session id + project
        // dir, carried through so FOCUS/COPY ID have something real to act on.
        sessionId: agent.sessionId,
        cwd: agent.projectDir,
        // FOCUS dispatch target (mechanic #6b): OS pid from the hook
        // forwarder's X-Pid header. Absent until the first hook event with
        // pid telemetry arrives — drawer shows "NO PID" until then.
        pid: agent.pid,
      });
    };

    const onAgentRemoved = (id: number) => {
      safeSend(socket, { type: 'agentClosed', id });
    };

    const onBroadcast = (message: Record<string, unknown>) => {
      safeSend(socket, message);
    };

    store.on('agentAdded', onAgentAdded);
    store.on('agentRemoved', onAgentRemoved);
    store.on('broadcast', onBroadcast);

    // Progression (v1 mechanic #3): rides its own change-notification plane
    // (not the AgentStateStore) since it isn't tied to any single agent —
    // broadcast on every XP/streak/unlock mutation, plus an initial snapshot
    // so a freshly connected client doesn't wait for the next real event.
    const unsubscribeProgression = progression.onChange((snapshot) => {
      safeSend(socket, { type: 'progressionUpdate', ...snapshot });
    });
    safeSend(socket, { type: 'progressionUpdate', ...progression.getSnapshot() });

    // Dispatch (v1 mechanic #6b): own broadcast plane (not tied to any single
    // agent) -- one dispatchUpdate per lifecycle transition, plus a replay of
    // non-terminal (ringing/answered) entries on connect so a page refresh
    // doesn't lose in-flight "call a coworker" state.
    const unsubscribeDispatch = dispatchStore.onUpdate((broadcast) => {
      safeSend(socket, broadcast as unknown as Record<string, unknown>);
    });
    for (const broadcast of dispatchStore.getActive()) {
      safeSend(socket, broadcast as unknown as Record<string, unknown>);
    }

    // Employees (v2 mechanic G1): one employeeSnapshot broadcast per
    // mutation (turn recorded, crisis resolved, verb applied), plus the
    // full current roster replayed on connect so a page refresh doesn't
    // wait for the next real event to populate the roster.
    const unsubscribeEmployees = employeeStore.onChange((emp) => {
      safeSend(socket, toEmployeeSnapshot(emp));
    });
    for (const emp of employeeStore.getAll()) {
      safeSend(socket, toEmployeeSnapshot(emp));
    }

    // Economy (v2 mechanic G2, GAME-DESIGN §2 "Connect catch-up"): run the
    // offline-progress Reputation-decay catch-up once per connect, THEN
    // subscribe + send the current snapshot — own broadcast plane (not
    // tied to any single agent), same rationale as progression above.
    economyStore.catchUpOffline();
    const unsubscribeEconomy = economyStore.onChange((snapshot) => {
      safeSend(socket, { type: 'economyUpdate', ...snapshot });
    });
    safeSend(socket, { type: 'economyUpdate', ...economyStore.getSnapshot() });

    // Chain runs (v2 mechanic G3): PURE broadcast fan-out to this connected
    // client -- distinct from chainOrchestrator's own singleton subscription
    // to dispatchStore.onUpdate() (wired once at process startup, above in
    // createHttpServer()), which is the one that ACTS on updates. This
    // per-connection subscription only forwards state, never enqueues
    // anything, so N open tabs are safe here the same way they're safe for
    // dispatchStore's own broadcast fan-out below.
    const unsubscribeChainRuns = chainStore.onRunUpdate((run) => {
      safeSend(socket, { type: 'chainRunUpdate', run });
    });
    const chainRunSnapshot = chainStore.getReconnectSnapshot();
    safeSend(socket, { type: 'chainRunSnapshot', ...chainRunSnapshot });
    // Compatibility replay for clients predating chainRunSnapshot. V3
    // treats these as same-revision no-op replacements after the snapshot.
    for (const run of chainStore.getActiveRuns()) {
      safeSend(socket, { type: 'chainRunUpdate', run });
    }

    // Standing orders (v2 mechanic G3): same pure-forwarding rationale.
    const unsubscribeStandingOrders = standingOrderStore.onChange((order) => {
      safeSend(socket, { type: 'standingOrderUpdate', order });
    });
    for (const order of standingOrderStore.getAll()) {
      safeSend(socket, { type: 'standingOrderUpdate', order });
    }

    // Budget guardrail (v2 mechanic G3): same pure-forwarding rationale.
    const unsubscribeBudget = budgetStore.onChange((snapshot) => {
      safeSend(socket, { type: 'budgetUpdate', ...snapshot });
    });
    safeSend(socket, { type: 'budgetUpdate', ...budgetStore.getSnapshot() });

    // ── v3 Living Studio planes (WS-C stage 1 — KICKOFF-v3.1 §3) ──────
    // Same pure-forwarding rationale as the planes above, with one twist:
    // each plane is gated by its source-data feature flag (v3Flags.ts) —
    // default ON only when REAL source data exists (a plane with nothing
    // observed stays silent rather than broadcasting fiction), env-
    // overridable per store. The flag is evaluated per send, not captured
    // at connect, so a plane lights up mid-session the moment its first
    // real record lands. These flags gate ONLY the game-face broadcast
    // planes — no real functionality (dispatch, chains, STOP ALL) is ever
    // behind them (hard rule 2).
    const v3ContractsEnabled = () =>
      v3StoreEnabled(
        'CONTRACTS',
        () => !!process.env['WAR_ROOM_TODO_DIR'] || studioContractStore.hasRecords(),
      );
    const unsubscribeStudioContracts = studioContractStore.onChange((contract) => {
      if (v3ContractsEnabled()) safeSend(socket, { type: 'contractsUpdated', contract });
    });
    if (v3ContractsEnabled()) {
      for (const contract of studioContractStore.getActive()) {
        safeSend(socket, { type: 'contractsUpdated', contract });
      }
    }

    const v3DossiersEnabled = () =>
      v3StoreEnabled(
        'DOSSIERS',
        () => employeeStore.getAll().length > 0 || dossierStore.hasRecords(),
      );
    const unsubscribeDossiers = dossierStore.onChange((dossier) => {
      if (v3DossiersEnabled()) safeSend(socket, { type: 'dossierUpdated', dossier });
    });
    if (v3DossiersEnabled()) {
      for (const dossier of dossierStore.getAll()) {
        safeSend(socket, { type: 'dossierUpdated', dossier });
      }
    }

    const v3MatchDayEnabled = () =>
      v3StoreEnabled(
        'MATCH_DAY',
        () => chainStore.getRuns().length > 0 || matchDayStore.hasRecords(),
      );
    const unsubscribeMatchDay = matchDayStore.onChange((fixture) => {
      if (v3MatchDayEnabled()) {
        safeSend(socket, toMatchDayEvent(fixture) as unknown as Record<string, unknown>);
      }
    });
    if (v3MatchDayEnabled()) {
      for (const fixture of matchDayStore.getActive()) {
        safeSend(socket, toMatchDayEvent(fixture) as unknown as Record<string, unknown>);
      }
    }

    // Rework bin's source IS observed failures — before the first one
    // exists there is nothing real to show, so the store's own records
    // are the availability signal.
    const v3ReworkBinEnabled = () =>
      v3StoreEnabled('REWORK_BIN', () => reworkBinStore.hasRecords());
    const unsubscribeReworkBin = reworkBinStore.onChange((item) => {
      if (v3ReworkBinEnabled()) safeSend(socket, { type: 'reworkBinUpdated', item });
    });
    if (v3ReworkBinEnabled()) {
      for (const item of reworkBinStore.getPiled()) {
        safeSend(socket, { type: 'reworkBinUpdated', item });
      }
    }

    // Rivalries derive from live worktree/repo overlap — possible only
    // with ≥2 live agents with known project dirs (or already-derived
    // pairs persisted from an earlier session).
    const v3RivalriesEnabled = () =>
      v3StoreEnabled(
        'RIVALRIES',
        () => rivalryStore.hasRecords() || countLiveAgentDirs(store) >= 2,
      );
    const unsubscribeRivalries = rivalryStore.onChange((pair) => {
      if (v3RivalriesEnabled()) safeSend(socket, { type: 'rivalryUpdated', pair });
    });
    if (v3RivalriesEnabled()) {
      for (const pair of rivalryStore.getAll()) {
        safeSend(socket, { type: 'rivalryUpdated', pair });
      }
    }

    // Live output tail (KICKOFF-v2.0 Phase 2 — streaming plane).
    // SUBSCRIPTION-GATED, deliberately unlike every broadcast plane above:
    // outputChunk messages go ONLY to sockets that sent a matching
    // tailSubscribe (handleClientMessage mutates this Set and replays the
    // ring buffer to this socket alone). Delivery is fire-and-forget — the
    // try/catch here (plus the store's own per-listener guard) means a
    // slow/dead subscriber can never block or throw into the producing
    // append path (the backpressure hard requirement).
    const tailSubscriptions = new Set<string>();
    const unsubscribeOutputChunks = outputRingStore.onChunk((chunk) => {
      if (!tailSubscriptions.has(outputStreamKey(chunk.source, chunk.id))) return;
      // Slow-subscriber shed: streaming pushes materially more volume than
      // the status broadcast planes, and ws's send() never blocks — a
      // subscriber that stops draining would otherwise grow this socket's
      // ws-library send buffer without bound for as long as the tail runs.
      // Past the cap this chunk is simply not sent to THIS socket (ephemeral
      // telemetry — the ring still retains it for replay; other subscribers
      // and the producer are unaffected).
      if (isTailSocketBackpressured(socket as { bufferedAmount?: number })) return;
      try {
        safeSend(socket, chunk as unknown as Record<string, unknown>);
      } catch {
        // Fire-and-forget: a broken socket must never break the producer.
      }
    });

    // Handle incoming client messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (!options.embedded && msg.type) {
          console.log('[Pixel Agents] WS client message:', msg.type);
        }
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          store,
          runtime: options.runtime,
          cache: options.assetCache ?? null,
          onSetHooksEnabled: options.onSetHooksEnabled,
          machineLabel: options.machineLabel,
          tailSubscriptions,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });

    socket.on('close', () => {
      liveSocketTracker.count -= 1;
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
      unsubscribeProgression();
      unsubscribeDispatch();
      unsubscribeEmployees();
      unsubscribeEconomy();
      unsubscribeChainRuns();
      unsubscribeStandingOrders();
      unsubscribeBudget();
      unsubscribeStudioContracts();
      unsubscribeDossiers();
      unsubscribeMatchDay();
      unsubscribeReworkBin();
      unsubscribeRivalries();
      // Socket close implicitly unsubscribes every tail (protocol contract
      // on TailUnsubscribe). Remote tail demand (T1 remote live-tail plane,
      // S2): decrement refcount for each surviving agent-source key BEFORE
      // clearing the registry, the same as an explicit tailUnsubscribe
      // would — otherwise a closed socket's remote subscriptions would
      // never release their tail-on demand.
      for (const key of tailSubscriptions) {
        const parsed = parseOutputStreamKey(key);
        if (parsed?.source === 'agent') {
          const agentId = Number(parsed.id);
          if (Number.isInteger(agentId)) remoteTailDemand.noteTailUnsubscribe(agentId);
        }
      }
      tailSubscriptions.clear();
      unsubscribeOutputChunks();
    });
  });
}

// ── Auth Helper ────────────────────────────────────────────────

function bearerAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization ?? '';
    const expected = `Bearer ${expectedToken}`;
    const authBuf = Buffer.from(auth);
    const expectedBuf = Buffer.from(expected);
    if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
      reply.code(401).send('unauthorized');
    }
  };
}

// ── Utilities ──────────────────────────────────────────────────

/** Max bytes a tail subscriber may leave undrained in the ws-library send
 *  buffer before outputChunk delivery to that socket is shed (skipped, not
 *  queued). Applies ONLY to the streaming fan-out — the low-volume status
 *  broadcast planes keep their existing fire-and-forget posture. */
export const OUTPUT_TAIL_MAX_BUFFERED_BYTES = 1024 * 1024;

/** True when a socket's undrained send buffer exceeds the tail cap. A
 *  socket without a bufferedAmount (unit-test fakes) is never shed. */
export function isTailSocketBackpressured(socket: { bufferedAmount?: number }): boolean {
  return (socket.bufferedAmount ?? 0) > OUTPUT_TAIL_MAX_BUFFERED_BYTES;
}

/** Live agents with a known real project dir — the rivalry plane's
 *  source-data signal (overlapping checkouts require ≥2 of these). */
function countLiveAgentDirs(store: AgentStateStore): number {
  let n = 0;
  for (const agent of store.values()) {
    if (agent.projectDir) n++;
  }
  return n;
}

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}
