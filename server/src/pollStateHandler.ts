/**
 * Poll-state ingest (M4 needs-input poller).
 *
 * A per-machine poller runs `claude agents --json` every ~15s and POSTs the
 * normalized list to POST /api/agents/poll (bearer-authed, X-Machine label).
 * This module matches those entries to adopted agents and rides the EXISTING
 * WebSocket event plane: one `agentPollState` broadcast per change. The
 * webview renders `blocked` (+ waitingFor) as the loudest ⚠ NEEDS INPUT
 * badge — SHAPE + TEXT, color as reinforcement only (colorblind hard rule).
 *
 * Matching strategy (the poller surface has no pixel-agents ids):
 *   1. exact sessionId match (2.1.202 emits full session UUIDs),
 *   2. poll `id` as a sessionId prefix (the CLI's short id is the UUID head),
 *   3. cwd match — only when exactly ONE of the machine's agents lives in
 *      that cwd (ambiguous cwd = no match; never guess).
 *
 * Staleness: if the poller stops reporting a session (or dies), the state is
 * cleared — per-tick for omitted sessions, and by a sweep timer for silence.
 */

import * as path from 'path';

import { normalizeProjectPath } from '../../core/src/normalizeProjectPath.js';
import type { AgentStateStore } from './agentStateStore.js';
import type { ShiftStats } from './shiftStats.js';
import type { AgentState, PollStateValue } from './types.js';
import { POLL_STATE_VALUES } from './types.js';

/** The slice of ShiftStats the poll layer feeds (blocked episodes). Callers
 *  that don't track stats (unit tests) pass nothing. */
export type BlockedEpisodeSink = Pick<ShiftStats, 'startBlocked' | 'endBlocked'>;

/** Poll states older than this are swept (poller assumed dead). */
export const POLL_STATE_TTL_MS = 60_000;
/** Sweep cadence. */
export const POLL_STATE_SWEEP_INTERVAL_MS = 30_000;
/** Rebroadcast an UNCHANGED poll state this often so the webview's own TTL
 *  (60s) never expires a still-live state. Without this, a session blocked
 *  longer than the client TTL silently lost its NEEDS INPUT badge (change-only
 *  broadcasts meant no refresh ever reached the page). Also re-delivers
 *  `ageMs` so crisis aging stays anchored to the server clock. */
export const POLL_STATE_REBROADCAST_MS = 20_000;
/** Defensive caps on the ingest payload. */
const MAX_POLL_ENTRIES = 200;
const MAX_WAITING_FOR_CHARS = 200;

/** One normalized entry from the poller. */
export interface PollEntry {
  id: string;
  state: PollStateValue;
  sessionId?: string;
  waitingFor?: string;
  cwd?: string;
}

/**
 * Validate a poll ingest body ({ agents: [...] }). Returns the sanitized
 * entries, or null when the body shape is unusable (→ 400). Invalid entries
 * inside a valid body are dropped (tolerant — the poller already normalizes;
 * this is the trust boundary re-check).
 */
export function parsePollBody(body: unknown): PollEntry[] | null {
  if (body === null || typeof body !== 'object') return null;
  const agents = (body as Record<string, unknown>).agents;
  if (!Array.isArray(agents) || agents.length > MAX_POLL_ENTRIES) return null;

  const entries: PollEntry[] = [];
  for (const raw of agents) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const e = raw as Record<string, unknown>;
    const id = typeof e.id === 'string' && e.id !== '' ? e.id : undefined;
    const state =
      typeof e.state === 'string' && (POLL_STATE_VALUES as readonly string[]).includes(e.state)
        ? (e.state as PollStateValue)
        : undefined;
    if (!id || !state) continue;
    const entry: PollEntry = { id, state };
    if (typeof e.sessionId === 'string' && e.sessionId !== '') entry.sessionId = e.sessionId;
    if (typeof e.waitingFor === 'string' && e.waitingFor !== '') {
      entry.waitingFor = e.waitingFor.slice(0, MAX_WAITING_FOR_CHARS);
    }
    if (typeof e.cwd === 'string' && e.cwd !== '') entry.cwd = e.cwd;
    entries.push(entry);
  }
  return entries;
}

/** Does this agent live in the given cwd? Compares the raw project dir AND the
 *  ~/.claude/projects/<normalized> convention used for local JSONL agents. */
function agentMatchesCwd(agent: AgentState, cwd: string): boolean {
  if (agent.projectDir === cwd) return true;
  return path.basename(agent.projectDir) === normalizeProjectPath(cwd);
}

/** Find the agent a poll entry refers to, or undefined (never guess on ambiguity). */
function matchEntry(entry: PollEntry, machineAgents: Array<[number, AgentState]>) {
  const fullId = entry.sessionId ?? '';
  // 1. exact sessionId
  let found = machineAgents.find(([, a]) => a.sessionId === fullId || a.sessionId === entry.id);
  if (found) return found;
  // 2. short id as session UUID prefix (>= 8 chars to avoid false positives)
  if (entry.id.length >= 8) {
    found = machineAgents.find(([, a]) => a.sessionId.startsWith(entry.id));
    if (found) return found;
  }
  // 3. unique cwd match — Claude sessions only (`claude agents --json` never
  //    reports Codex/Gemini coworkers; matching one by shared cwd would set
  //    the wrong desk on fire).
  if (entry.cwd) {
    const cwd = entry.cwd;
    const byCwd = machineAgents.filter(
      ([, a]) => (!a.providerId || a.providerId === 'claude') && agentMatchesCwd(a, cwd),
    );
    if (byCwd.length === 1) return byCwd[0];
  }
  return undefined;
}

/**
 * Apply one poll tick for a machine: set/refresh poll state on matched agents,
 * clear it on that machine's agents the poller no longer reports. Broadcasts
 * `agentPollState` only on change (set/update/clear), not on refresh.
 */
export function applyPollStates(
  store: AgentStateStore,
  machine: string,
  localMachineLabel: string | undefined,
  entries: PollEntry[],
  now: number = Date.now(),
  stats?: BlockedEpisodeSink,
): { matched: number; cleared: number } {
  const machineAgents: Array<[number, AgentState]> = [];
  for (const [id, agent] of store) {
    if ((agent.machine ?? localMachineLabel) === machine) machineAgents.push([id, agent]);
  }

  const seenAgentIds = new Set<number>();
  let matched = 0;

  for (const entry of entries) {
    const found = matchEntry(entry, machineAgents);
    if (!found) continue;
    const [agentId, agent] = found;
    if (seenAgentIds.has(agentId)) continue; // first entry wins per agent
    seenAgentIds.add(agentId);
    matched++;

    const prev = agent.pollState;
    const changed = prev?.state !== entry.state || prev?.waitingFor !== entry.waitingFor;
    // Shift report: blocked episodes start/end on state transitions.
    if (entry.state === 'blocked' && prev?.state !== 'blocked') {
      stats?.startBlocked(`agent:${agentId}`, now, now);
    } else if (prev?.state === 'blocked' && entry.state !== 'blocked') {
      stats?.endBlocked(`agent:${agentId}`, now);
    }
    // `since` survives refresh ticks while the STATE VALUE is unchanged — it is
    // the transition time that anchors crisis aging (smoke → fire → alarm).
    // A waitingFor-only change keeps the original transition time.
    const since = prev && prev.state === entry.state ? prev.since : now;
    const due = !prev || now - prev.lastBroadcastAt >= POLL_STATE_REBROADCAST_MS;
    const lastBroadcastAt = changed || due ? now : prev.lastBroadcastAt;
    agent.pollState = {
      state: entry.state,
      waitingFor: entry.waitingFor,
      at: now,
      since,
      lastBroadcastAt,
    };
    if (changed || due) {
      store.broadcast({
        type: 'agentPollState',
        id: agentId,
        state: entry.state,
        waitingFor: entry.waitingFor,
        ageMs: now - since,
      });
    }
  }

  // Clear poll state for this machine's agents the poller no longer reports.
  let cleared = 0;
  for (const [agentId, agent] of machineAgents) {
    if (agent.pollState && !seenAgentIds.has(agentId)) {
      if (agent.pollState.state === 'blocked') stats?.endBlocked(`agent:${agentId}`, now);
      agent.pollState = undefined;
      cleared++;
      store.broadcast({ type: 'agentPollState', id: agentId });
    }
  }

  return { matched, cleared };
}

/**
 * Start the staleness sweep: clears poll states not refreshed within the TTL
 * (covers a dead poller — per-tick clearing can't fire if ticks stop coming).
 * Returns the timer; callers clear it on shutdown.
 */
export function startPollStateSweep(
  store: AgentStateStore,
  ttlMs: number = POLL_STATE_TTL_MS,
  intervalMs: number = POLL_STATE_SWEEP_INTERVAL_MS,
  stats?: BlockedEpisodeSink,
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [agentId, agent] of store) {
      if (agent.pollState && now - agent.pollState.at > ttlMs) {
        if (agent.pollState.state === 'blocked') stats?.endBlocked(`agent:${agentId}`, now);
        agent.pollState = undefined;
        // stale: the POLLER went silent — the session may well still be
        // blocked. The webview clears the badge but must NOT celebrate.
        store.broadcast({ type: 'agentPollState', id: agentId, stale: true });
      }
    }
  }, intervalMs);
  // Never keep the process alive just for the sweep.
  timer.unref?.();
  return timer;
}
