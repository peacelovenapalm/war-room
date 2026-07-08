import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import * as crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import { getBriefing } from './briefingProvider.js';
import type { AssetCache, SetHooksEnabledSideEffect } from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import { HOOK_API_PREFIX, MAX_HOOK_BODY_SIZE } from './constants.js';
import { dispatchStore } from './dispatchStore.js';
import { applyPollStates, parsePollBody, startPollStateSweep } from './pollStateHandler.js';
import { progression } from './progressionStore.js';
import { shiftStats } from './shiftStats.js';
import type { AgentState } from './types.js';

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
  /** Path to SPA dist directory for static serving (standalone only) */
  staticDir?: string;
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

  // Static SPA serving (standalone mode only)
  if (!options.embedded && options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    // HTML5 history fallback: serve index.html for unmatched routes
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  registerHealthRoute(app);
  registerBriefingRoute(app);
  registerHookRoute(app, options);
  registerPollRoute(app, options);
  registerDispatchRoutes(app, options);
  registerWebSocketRoute(app, options);

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
}

// ── Briefing (post-v0) ─────────────────────────────────────────

/** GET /api/briefing -- unauthenticated, like /api/health; the server is tailnet-only. */
function registerBriefingRoute(app: FastifyInstance): void {
  app.get('/api/briefing', async () => getBriefing());
  // Shift report (v1 mechanic #2): today's scorecard — same trust level.
  // Also carries yesterday's closed ledger (deferred nit: previous-day card)
  // so a checked-out day isn't lost the moment midnight rolls over.
  app.get('/api/shift', async () => ({
    today: shiftStats.getReport(),
    yesterday: shiftStats.getYesterdayReport(),
  }));
  // Progression (v1 mechanic #3): XP/level/streak/unlock snapshot — same
  // trust level. Primarily consumed live over the WS plane
  // (progressionUpdate); this route mirrors /api/shift for parity/debugging.
  app.get('/api/progression', async () => progression.getSnapshot());
}

// ── Hook Events ────────────────────────────────────────────────

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

      // Machine identity: remote machines tag their hook events with an
      // X-Machine header (installed by the hooks runbook). A label that
      // differs from this server's own label marks the event as REMOTE:
      //   - strip transcript_path (it points at a file on the remote machine;
      //     watching it here would fail) so adoption takes the hooks-only path
      //   - carry the label through on __machine for agent tagging
      const machine = sanitizeMachineLabel(request.headers['x-machine']);
      if (machine && machine !== options.machineLabel) {
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
      }

      if (event.session_id && event.hook_event_name) {
        options.onHookEvent?.(providerId, event);
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

// ── Dispatch queue (v1 mechanic #6b — "call a coworker") ───────

/** How often stale (unanswered past TTL) ringing requests are swept to `expired`. */
const DISPATCH_SWEEP_INTERVAL_MS = 30_000;

/**
 * Dispatch queue routes. The server never shells out — these routes only
 * read/write dispatchStore.ts's in-memory (persisted) queue; the actual CLI
 * spawn happens on a per-machine runner (bin/dispatch-runner.mjs) that polls
 * `/api/dispatch/poll` over the same Bearer-authed channel as the needs-input
 * poller. Decision routes are always 2xx: deny and unknown-id are decision
 * payloads, never 403/404 (see dispatchStore.ts doc comment).
 */
function registerDispatchRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  const sweepTimer = setInterval(() => dispatchStore.sweepExpired(), DISPATCH_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  app.addHook('onClose', () => clearInterval(sweepTimer));

  // GET /api/dispatch/machines -- unauthenticated, like /api/briefing (tailnet-only
  // server). Only machines with a live runner advertisement are listed — a machine
  // without a runner is honestly absent, never stale-listed.
  app.get('/api/dispatch/machines', async () => dispatchStore.getMachines());

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
      dispatchStore.recordAdvertisement(machine, { providers, roots, focus });
      reply.send({ pending: dispatchStore.pendingFor(machine) });
    },
  );

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
  // spawn started (attaches pid) or the process exited (terminal, carries exitCode).
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/dispatch/:id/status',
    { preHandler: bearerAuth(options.token) },
    async (request, reply) => {
      const body = request.body ?? {};
      const event = body.event === 'started' || body.event === 'exited' ? body.event : undefined;
      if (!event) {
        reply.code(400).send({ error: 'expected body { event: "started" | "exited" }' });
        return;
      }
      const pid = typeof body.pid === 'number' ? body.pid : undefined;
      const exitCode = typeof body.exitCode === 'number' ? body.exitCode : undefined;
      reply.send(dispatchStore.reportStatus(request.params.id, { event, pid, exitCode }));
    },
  );
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

function registerWebSocketRoute(app: FastifyInstance, options: HttpServerOptions): void {
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
        });
      } catch {
        // Malformed JSON, ignore
      }
    });

    socket.on('close', () => {
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
      unsubscribeProgression();
      unsubscribeDispatch();
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

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}
