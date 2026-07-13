/**
 * Morning push scheduler (V6-1 "ONE pre-triaged push", V6-2 NEEDS-YOU
 * count, V6-3 "board announces its own sickness"). Same setInterval idiom
 * every other tick in httpServer.ts already uses (no shared tick
 * primitive exists in this repo — verified against standingOrderTimer/
 * autoExecutorTimer) — this module only exposes the pure tick function;
 * httpServer.ts wires the interval + onClose cleanup.
 *
 * The container the server runs in has NO reason to be in Greg's own
 * timezone, so "local hour" is never read off `new Date(now).getHours()`
 * (that's the CONTAINER's zone, i.e. usually UTC). Instead every hour/date
 * computation goes through `Intl.DateTimeFormat` with an explicit IANA
 * zone (WAR_ROOM_MORNING_TZ, default America/Denver — the notifier's own
 * existing cron gate) — modern Node ships full ICU by default, so this
 * works without extra deps. An invalid zone string falls back to UTC with
 * a logged warning rather than crashing the tick.
 *
 * Once-per-local-day dedupe mirrors notifyBark.ts's own posture: a
 * process-lifetime module variable, never persisted — worst case a rare
 * mid-morning restart produces one extra push, never a storm, never a
 * missed morning silently swallowed.
 */

import type { AgentStateStore } from './agentStateStore.js';
import { MORNING_PUSH_DEFAULT_HOUR, MORNING_PUSH_DEFAULT_TZ } from './constants.js';
import { shouldSpotCheck, writeMorningSpotCheckSpool } from './morningSpotCheck.js';
import { morningStreakStore } from './morningStreakStore.js';
import { getMorningSurface, type MorningSurface } from './morningSurface.js';
import { notifyBigMoment, notifyMorningDigest } from './notifyBark.js';

export function resolveMorningTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env['WAR_ROOM_MORNING_TZ']?.trim();
  const tz = raw && raw.length > 0 ? raw : MORNING_PUSH_DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    console.log(`[MorningPush] ⚠ invalid WAR_ROOM_MORNING_TZ (${tz}) -- falling back to UTC`);
    return 'UTC';
  }
}

export function resolveMorningPushHour(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['WAR_ROOM_MORNING_PUSH_HOUR'];
  const n = raw !== undefined ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isInteger(n) && n >= 0 && n <= 23) return n;
  if (raw !== undefined) {
    console.log(
      `[MorningPush] ⚠ invalid WAR_ROOM_MORNING_PUSH_HOUR (${raw}) -- falling back to default ${String(MORNING_PUSH_DEFAULT_HOUR)}`,
    );
  }
  return MORNING_PUSH_DEFAULT_HOUR;
}

export function resolveBoardUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env['WAR_ROOM_BOARD_URL']?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

/** Deep link to the MORNING view — the state/launch.ts `?open=morning`
 *  form this session added alongside the existing `?open=agent&id=`. */
export function morningDeepLink(boardUrl: string): string {
  return `${boardUrl}${boardUrl.includes('?') ? '&' : '?'}open=morning`;
}

export interface LocalHourAndDate {
  hour: number;
  /** YYYY-MM-DD in `timeZone`. */
  date: string;
}

export function localHourAndDate(now: number, timeZone: string): LocalHourAndDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(new Date(now));
  const byType: Partial<Record<string, string>> = {};
  for (const p of parts) byType[p.type] = p.value;
  // hour12:false can still yield "24" for midnight in some ICU builds.
  const rawHour = Number.parseInt(byType['hour'] ?? '0', 10);
  const hour = rawHour === 24 ? 0 : rawHour;
  const date = `${byType['year'] ?? '1970'}-${byType['month'] ?? '01'}-${byType['day'] ?? '01'}`;
  return { hour, date };
}

/** V6-2: the push's FIRST characters are the NEEDS-YOU count so it survives
 *  lock-screen truncation. */
export function buildMorningPushMessage(
  surface: MorningSurface,
  boardUrl: string | undefined,
): string {
  const lead = `NEEDS YOU: ${String(surface.needsYouCount)}`;
  const names = surface.board.needsInput.names;
  let namesPart = '';
  if (names.length > 0) {
    const shown = names.slice(0, 3).join(', ');
    const extra = names.length > 3 ? ` +${String(names.length - 3)} more` : '';
    namesPart = ` — ${shown}${extra}`;
  } else if (!surface.degraded) {
    namesPart = ' — all calm';
  }
  const degradedPart = surface.degraded
    ? ` ⊘ degraded: ${surface.degradedReasons[0] ?? 'unknown'}`
    : '';
  const link = boardUrl ? ` ${morningDeepLink(boardUrl)}` : '';
  return `${lead}${namesPart}${degradedPart}${link}`.trim();
}

let lastPushedDate: string | null = null;

export interface MorningPushTickDeps {
  env?: NodeJS.ProcessEnv;
  notifyDigest?: typeof notifyMorningDigest;
  notifyBigMomentFn?: typeof notifyBigMoment;
}

/** The scheduler's own gate: fires AT MOST once per local calendar day,
 *  exactly at the configured local hour (checked on a
 *  MORNING_PUSH_CHECK_INTERVAL_MS tick, so "at" means "the first tick
 *  whose local hour matches"). Composes the surface, pushes the
 *  pre-triaged digest, escalates via the morning-degraded big-moment when
 *  the compose was honest-sick, and records today's clean/breach streak
 *  outcome exactly once. */
export function runMorningPushTick(
  store: AgentStateStore,
  now: number = Date.now(),
  deps: MorningPushTickDeps = {},
): MorningSurface | null {
  const env = deps.env ?? process.env;
  const timeZone = resolveMorningTimeZone(env);
  const pushHour = resolveMorningPushHour(env);
  const { hour, date } = localHourAndDate(now, timeZone);

  if (hour !== pushHour) return null;
  if (lastPushedDate === date) return null;
  lastPushedDate = date;

  const surface = getMorningSurface(store, now);
  const boardUrl = resolveBoardUrl(env);
  const notifyDigest = deps.notifyDigest ?? notifyMorningDigest;
  const notifyBigMomentFn = deps.notifyBigMomentFn ?? notifyBigMoment;
  const message = buildMorningPushMessage(surface, boardUrl);

  notifyDigest(message, { now });
  if (surface.degraded) {
    notifyBigMomentFn(
      'morning-degraded',
      `Morning surface degraded: ${surface.degradedReasons.join('; ')}`,
      { now },
    );
  }

  // V6-5: yesterday's OWN recorded outcome (not just "was there ever a
  // breach") — read BEFORE today's recordOutcome overwrites it.
  const previousMorningDegraded = morningStreakStore.getSnapshot().lastOutcomeClean === false;

  morningStreakStore.recordOutcome(
    !surface.degraded,
    date,
    surface.degraded ? surface.degradedReasons.join('; ') : undefined,
    now,
  );

  if (shouldSpotCheck(date, previousMorningDegraded)) {
    writeMorningSpotCheckSpool(date, surface, message, env);
  }

  return surface;
}

/** Test-only: reset the once-per-day push gate between test cases. */
export function resetMorningPushStateForTests(): void {
  lastPushedDate = null;
}
