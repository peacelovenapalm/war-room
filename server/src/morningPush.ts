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
 * Once-per-local-day dedupe is PERSISTED (morning-push.json, same
 * V3JsonPersistence sidecar discipline morningStreakStore already uses) —
 * a mid-push-hour restart must not re-fire the push, and the "once daily"
 * promise becomes load-bearing at the V6-7 retirement flip when this is
 * the ONLY morning signal. The tick also detects the inverse failure: a
 * server down through the ENTIRE push hour records a streak breach
 * ("push-window-missed") instead of silently freezing the streak.
 */

import type { AgentStateStore } from './agentStateStore.js';
import { MORNING_PUSH_DEFAULT_HOUR, MORNING_PUSH_DEFAULT_TZ } from './constants.js';
import { shouldSpotCheck, writeMorningSpotCheckSpool } from './morningSpotCheck.js';
import { morningStreakStore } from './morningStreakStore.js';
import { getMorningSurface, isMorningAllCalm, type MorningSurface } from './morningSurface.js';
import { notifyBigMoment, notifyMorningDigest } from './notifyBark.js';
import { V3JsonPersistence } from './v3Persistence.js';

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

/** Operator constraint (not enforced in code): don't set the push hour to
 *  a value a spring-forward DST transition can skip in WAR_ROOM_MORNING_TZ
 *  (e.g. 2 in America/Denver) — that local hour simply never occurs on the
 *  transition day, so the tick would record that morning as
 *  push-window-missed. The shipped default (6) is safe. */
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
  } else if (isMorningAllCalm(surface)) {
    // Same definition the panel's ✓ ALL CALM uses — the push must never
    // claim calm on a morning with open PRs or held-budget jobs pending.
    namesPart = ' — all calm';
  } else if (!surface.degraded) {
    // Zero needs-you but NOT calm (open PRs / held jobs): say what's
    // actually pending instead of claiming calm or going silent.
    const pending: string[] = [];
    const prCount = surface.morningJson.prs.count;
    if (prCount > 0) pending.push(`${String(prCount)} PR${prCount === 1 ? '' : 's'}`);
    const heldCount = surface.board.heldBudget.count;
    if (heldCount > 0) pending.push(`${String(heldCount)} held job${heldCount === 1 ? '' : 's'}`);
    if (pending.length > 0) namesPart = ` — no blockers; open: ${pending.join(', ')}`;
  }
  const degradedPart = surface.degraded
    ? ` ⊘ degraded: ${surface.degradedReasons[0] ?? 'unknown'}`
    : '';
  const link = boardUrl ? ` ${morningDeepLink(boardUrl)}` : '';
  return `${lead}${namesPart}${degradedPart}${link}`.trim();
}

const PUSH_STATE_FILE_NAME = 'morning-push.json';

interface MorningPushState {
  /** Local date string (YYYY-MM-DD, push-tick zone) of the last fired
   *  push — the once-per-day idempotency key, persisted so a mid-morning
   *  restart cannot re-fire (same discipline as morningStreakStore). */
  lastPushedDate: string | null;
}

export class MorningPushStateStore {
  private data: MorningPushState | null = null;
  private readonly persistence: V3JsonPersistence<MorningPushState>;

  constructor(statePath?: string) {
    this.persistence = new V3JsonPersistence(PUSH_STATE_FILE_NAME, statePath);
  }

  private ensureLoaded(): MorningPushState {
    if (!this.data) {
      this.data = this.persistence.load(
        (raw) => raw.lastPushedDate === null || typeof raw.lastPushedDate === 'string',
        () => ({ lastPushedDate: null }),
      );
    }
    return this.data;
  }

  getLastPushedDate(): string | null {
    return this.ensureLoaded().lastPushedDate;
  }

  markPushed(localDate: string, now: number): void {
    const data = this.ensureLoaded();
    data.lastPushedDate = localDate;
    this.persistence.persist(data, now, true);
  }

  /** Test-only: force the next read to reload from disk. */
  clearCacheForTests(): void {
    this.data = null;
  }
}

export const morningPushStateStore = new MorningPushStateStore();

export interface MorningPushTickDeps {
  env?: NodeJS.ProcessEnv;
  notifyDigest?: typeof notifyMorningDigest;
  notifyBigMomentFn?: typeof notifyBigMoment;
  pushStateStore?: MorningPushStateStore;
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
  const pushStateStore = deps.pushStateStore ?? morningPushStateStore;
  const timeZone = resolveMorningTimeZone(env);
  const pushHour = resolveMorningPushHour(env);
  const { hour, date } = localHourAndDate(now, timeZone);

  if (hour !== pushHour) {
    // Inverse failure of "once daily": the server was down through the
    // ENTIRE push hour, so today's push never fired. Record the breach
    // (recordOutcome is idempotent per date) instead of letting the
    // streak silently freeze — a skipped morning must never look clean.
    if (hour > pushHour && pushStateStore.getLastPushedDate() !== date) {
      const snap = morningStreakStore.getSnapshot();
      // Fresh install / parallel-run not yet started: no history to
      // breach against — the streak begins with the first real push.
      if (snap.lastRecordedDate !== null && snap.lastRecordedDate !== date) {
        console.log(
          `[MorningPush] ⚠ push window missed for ${date} (server down through hour ${String(pushHour)} ${timeZone}) -- recording streak breach`,
        );
        morningStreakStore.recordOutcome(
          false,
          date,
          'push-window-missed (server down through the entire push hour)',
          now,
        );
      }
    }
    return null;
  }
  if (pushStateStore.getLastPushedDate() === date) return null;
  pushStateStore.markPushed(date, now);

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
  morningPushStateStore.clearCacheForTests();
}
