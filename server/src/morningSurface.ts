/**
 * Morning surface (V6-1 "board morning surface", V6-DESIGN §V6-1). The
 * board ABSORBS the morning page (RUN-MAP §3 Q3): GET /api/morning
 * composes ONE payload from three sources that today are three separate
 * places Greg has to open:
 *
 *   (a) morning.json — nexus-notifier's own generated page
 *       (`gen_morning_page.py`), read off a `:ro` mount the SAME pattern
 *       inboxProvider.ts already established (env-configured path,
 *       tolerant read, never a throw). Env: WAR_ROOM_MORNING_JSON (a
 *       single FILE path, not a directory — the notifier writes one file
 *       per deploy, not a dated series like the todo/digest sources).
 *       Staleness: `generated_at` older than MORNING_JSON_STALE_MS is
 *       honestly stale, not silently served fresh.
 *   (b) board state, derived LIVE from stores every other panel already
 *       reads (never re-derived): needs-input = agents whose
 *       pollState.state is 'blocked' (the exact set opsAdvisor's
 *       blocked-age finding is built from, unfiltered by its own aging
 *       threshold since "needs you" means right now, not "has been
 *       blocked a while"); held-budget = dispatchStore's queued-budget
 *       records off the SAME getRecent() ledger read opsAdvisor uses.
 *   (c) overnight receipts — autoExecutorStore's own receipts ledger
 *       (V6-4's self-heal actions), filtered to the 18:00->06:00 local
 *       window (constants.ts MORNING_OVERNIGHT_*).
 *
 * Every section carries `dataAgeSeconds` (V6-3 latency instrumentation).
 * `degraded` is true when morning.json is absent/stale/unreadable OR a
 * board-state read threw — the honest-⊘ posture, never a fabricated
 * value standing in for a real one. Analyze-on-demand with a short TTL
 * cache (MORNING_SURFACE_CACHE_TTL_MS), the same pattern
 * opsAdvisor.ts/briefingProvider.ts already use — no new polling loop.
 */

import * as fs from 'fs';

import type { AgentStateStore } from './agentStateStore.js';
import { autoExecutorStore } from './autoExecutor.js';
import {
  MORNING_BOARD_STALE_MS,
  MORNING_JSON_STALE_MS,
  MORNING_OVERNIGHT_END_HOUR,
  MORNING_OVERNIGHT_START_HOUR,
  MORNING_SURFACE_CACHE_TTL_MS,
  OPS_DISPATCH_HISTORY_LIMIT,
} from './constants.js';
import { dispatchStore } from './dispatchStore.js';
import { morningStreakStore } from './morningStreakStore.js';

export interface MorningTop3Item {
  n: number;
  action: string;
  why: string;
  source: string;
  tags: string[];
}

export interface MorningJsonSection {
  available: boolean;
  stale: boolean;
  dataAgeSeconds: number | null;
  date: string | null;
  top3: MorningTop3Item[];
  flags: string | null;
  prs: { count: number; list: Array<{ number: number; title: string; branch: string }> };
}

export interface BoardSection {
  dataAgeSeconds: number;
  needsInput: { count: number; names: string[] };
  heldBudget: { count: number; jobs: Array<{ machine: string; promptPreview: string }> };
}

export interface OvernightReceipt {
  ts: string;
  actionKind: string;
  ok: boolean;
  detail: string;
}

export interface OvernightSection {
  dataAgeSeconds: number;
  windowStart: string;
  windowEnd: string;
  receiptCount: number;
  receipts: OvernightReceipt[];
}

export interface MorningStreakSection {
  count: number;
  lastBreachReason: string | null;
  lastBreachAt: string | null;
}

export interface MorningSurface {
  generatedAt: string;
  morningJson: MorningJsonSection;
  board: BoardSection;
  overnight: OvernightSection;
  /** Lock-screen-legible count (V6-2) — currently == board.needsInput.count;
   *  a distinct field so the push/badge/view all read ONE number rather
   *  than each re-deriving it from needsInput.count independently. */
  needsYouCount: number;
  degraded: boolean;
  degradedReasons: string[];
  streak: MorningStreakSection;
}

function emptyMorningJsonSection(): MorningJsonSection {
  return {
    available: false,
    stale: false,
    dataAgeSeconds: null,
    date: null,
    top3: [],
    flags: null,
    prs: { count: 0, list: [] },
  };
}

interface RawMorningPayload {
  date?: unknown;
  generated_at?: unknown;
  top3?: unknown;
  flags?: unknown;
  prs?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Tolerant field-by-field extraction — a payload with a missing/malformed
 *  field degrades that FIELD only (honest ⊘ per-field), never rejects the
 *  whole file the way a strict schema parse would. */
function parseMorningJson(
  raw: unknown,
): Omit<MorningJsonSection, 'available' | 'stale' | 'dataAgeSeconds'> {
  const r: RawMorningPayload = isRecord(raw) ? raw : {};
  const date = typeof r.date === 'string' ? r.date : null;

  const top3: MorningTop3Item[] = Array.isArray(r.top3)
    ? r.top3.filter(isRecord).map((item) => ({
        n: typeof item.n === 'number' ? item.n : 0,
        action: typeof item.action === 'string' ? item.action : '',
        why: typeof item.why === 'string' ? item.why : '',
        source: typeof item.source === 'string' ? item.source : '',
        tags: Array.isArray(item.tags)
          ? item.tags.filter((t): t is string => typeof t === 'string')
          : [],
      }))
    : [];

  const flags = typeof r.flags === 'string' ? r.flags : null;

  let prs: MorningJsonSection['prs'] = { count: 0, list: [] };
  if (isRecord(r.prs)) {
    const count = typeof r.prs.count === 'number' ? r.prs.count : 0;
    const list = Array.isArray(r.prs.list)
      ? r.prs.list.filter(isRecord).map((p) => ({
          number: typeof p.number === 'number' ? p.number : 0,
          title: typeof p.title === 'string' ? p.title : '',
          branch: typeof p.branch === 'string' ? p.branch : '',
        }))
      : [];
    prs = { count, list };
  }

  return { date, top3, flags, prs };
}

function loadMorningJsonSection(now: number): MorningJsonSection {
  const file = process.env['WAR_ROOM_MORNING_JSON'];
  if (!file) {
    console.log('[MorningSurface] ⚠ WAR_ROOM_MORNING_JSON not set -- morning page fold disabled');
    return emptyMorningJsonSection();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    const parsed = parseMorningJson(raw);
    const generatedAtRaw = isRecord(raw) ? (raw as RawMorningPayload).generated_at : undefined;
    const generatedAtMs =
      typeof generatedAtRaw === 'string' ? Date.parse(generatedAtRaw) : Number.NaN;
    const dataAgeSeconds = Number.isFinite(generatedAtMs)
      ? Math.max(0, Math.round((now - generatedAtMs) / 1000))
      : null;
    const stale = dataAgeSeconds === null || dataAgeSeconds * 1000 > MORNING_JSON_STALE_MS;
    return { available: true, stale, dataAgeSeconds, ...parsed };
  } catch (err) {
    console.log(
      `[MorningSurface] ⚠ failed to read WAR_ROOM_MORNING_JSON (${file}): ${(err as Error).message}`,
    );
    return emptyMorningJsonSection();
  }
}

/** Board state (b): reuses the exact live sources opsAdvisor.ts and the
 *  dispatch tray already read — never a second derivation of the same
 *  fact. */
function loadBoardSection(store: AgentStateStore): BoardSection {
  const needsInputNames: string[] = [];
  for (const [id, agent] of store.entries()) {
    if (agent.pollState?.state !== 'blocked') continue;
    const machine = agent.machine ?? 'LOCAL';
    needsInputNames.push(
      agent.agentName
        ? `${agent.agentName} (agent ${String(id)})`
        : `agent ${String(id)} on ${machine}`,
    );
  }

  const heldJobs = dispatchStore
    .getRecent(OPS_DISPATCH_HISTORY_LIMIT)
    .filter((r) => r.status === 'queued-budget')
    .map((r) => ({ machine: r.machine, promptPreview: r.promptPreview ?? '(no prompt)' }));

  return {
    dataAgeSeconds: 0, // derived live from in-process stores every call
    needsInput: { count: needsInputNames.length, names: needsInputNames },
    heldBudget: { count: heldJobs.length, jobs: heldJobs },
  };
}

/** Overnight window (c): the most recent 18:00 -> 06:00 local band that
 *  has ALREADY CLOSED by `now` (or is in progress — the window's own end
 *  is capped at `now`, so a compose during the window itself shows a
 *  partial, honestly-in-progress summary rather than an empty one). */
export function overnightWindow(now: number): { start: number; end: number } {
  const d = new Date(now);
  const hour = d.getHours();
  const startDay = new Date(d);
  startDay.setMinutes(0, 0, 0);
  if (hour >= MORNING_OVERNIGHT_END_HOUR && hour < MORNING_OVERNIGHT_START_HOUR) {
    // Daytime — the window in view is LAST night's (yesterday 18:00 ->
    // today 06:00), fully closed.
    startDay.setHours(MORNING_OVERNIGHT_START_HOUR);
    startDay.setDate(startDay.getDate() - 1);
    const end = new Date(startDay);
    end.setDate(end.getDate() + 1);
    end.setHours(MORNING_OVERNIGHT_END_HOUR);
    return { start: startDay.getTime(), end: end.getTime() };
  }
  // Inside or past the window itself — anchor start at the most recent
  // 18:00, end at the following 06:00 (may be in the future; overnight
  // summary's own receipt filter naturally excludes anything after `now`).
  if (hour >= MORNING_OVERNIGHT_START_HOUR) {
    startDay.setHours(MORNING_OVERNIGHT_START_HOUR);
  } else {
    startDay.setHours(MORNING_OVERNIGHT_START_HOUR);
    startDay.setDate(startDay.getDate() - 1);
  }
  const end = new Date(startDay);
  end.setDate(end.getDate() + 1);
  end.setHours(MORNING_OVERNIGHT_END_HOUR);
  return { start: startDay.getTime(), end: end.getTime() };
}

function loadOvernightSection(now: number): OvernightSection {
  const { start, end } = overnightWindow(now);
  const receipts = autoExecutorStore
    .getStatus()
    .receipts.filter((r) => r.ts >= start && r.ts <= Math.min(end, now))
    .map((r) => ({
      ts: new Date(r.ts).toISOString(),
      actionKind: r.actionKind,
      ok: r.outcome.ok,
      detail: r.outcome.detail,
    }));
  return {
    dataAgeSeconds: 0,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(end).toISOString(),
    receiptCount: receipts.length,
    receipts,
  };
}

let cache: { at: number; value: MorningSurface } | null = null;

export function getMorningSurface(
  store: AgentStateStore,
  now: number = Date.now(),
): MorningSurface {
  if (cache && now - cache.at < MORNING_SURFACE_CACHE_TTL_MS) return cache.value;

  const degradedReasons: string[] = [];

  let morningJson: MorningJsonSection;
  try {
    morningJson = loadMorningJsonSection(now);
  } catch (err) {
    morningJson = emptyMorningJsonSection();
    degradedReasons.push(`morning.json read threw: ${(err as Error).message}`);
  }
  if (!morningJson.available)
    degradedReasons.push('morning.json unavailable (mount absent or unreadable)');
  else if (morningJson.stale)
    degradedReasons.push('morning.json is stale (older than the current local morning)');

  let board: BoardSection;
  try {
    board = loadBoardSection(store);
  } catch (err) {
    board = {
      dataAgeSeconds: MORNING_BOARD_STALE_MS,
      needsInput: { count: 0, names: [] },
      heldBudget: { count: 0, jobs: [] },
    };
    degradedReasons.push(`board state derivation threw: ${(err as Error).message}`);
  }

  let overnight: OvernightSection;
  try {
    overnight = loadOvernightSection(now);
  } catch (err) {
    const { start, end } = overnightWindow(now);
    overnight = {
      dataAgeSeconds: MORNING_BOARD_STALE_MS,
      windowStart: new Date(start).toISOString(),
      windowEnd: new Date(end).toISOString(),
      receiptCount: 0,
      receipts: [],
    };
    degradedReasons.push(`overnight receipts derivation threw: ${(err as Error).message}`);
  }

  const streakSnapshot = morningStreakStore.getSnapshot();

  const value: MorningSurface = {
    generatedAt: new Date(now).toISOString(),
    morningJson,
    board,
    overnight,
    needsYouCount: board.needsInput.count,
    degraded: degradedReasons.length > 0,
    degradedReasons,
    streak: {
      count: streakSnapshot.count,
      lastBreachReason: streakSnapshot.lastBreachReason,
      lastBreachAt:
        streakSnapshot.lastBreachAt !== null
          ? new Date(streakSnapshot.lastBreachAt).toISOString()
          : null,
    },
  };
  cache = { at: now, value };
  return value;
}

/** Single source for the ALL-CALM claim on the SERVER side: nothing needs
 *  Greg (zero needs-you, zero held-budget jobs, zero open PRs) AND the
 *  surface composed honestly (not degraded). The push builder MUST use
 *  this — a lock-screen "all calm" that ignores held jobs or PRs claims
 *  more than the panel itself would render.
 *  webview-v3/src/net/morningFacts.ts#isAllCalm mirrors this condition
 *  (separate package, no shared import path) — keep the two in lockstep. */
export function isMorningAllCalm(surface: MorningSurface): boolean {
  return (
    !surface.degraded &&
    surface.needsYouCount === 0 &&
    surface.board.heldBudget.count === 0 &&
    surface.morningJson.prs.count === 0
  );
}

/** Test-only: force the next getMorningSurface() call to recompute. */
export function clearMorningSurfaceCache(): void {
  cache = null;
}
