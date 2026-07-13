/**
 * V7-4 Act-I memory instrumentation. Process-local by design: unlike
 * knowledge notes this telemetry must never create a vault write or a new
 * homedir sidecar. Restarting honestly returns the counters to zero.
 */

import { MORNING_PUSH_DEFAULT_TZ } from './constants.js';
import type { MorningStreakState } from './morningStreakStore.js';

export const MEMORY_ATTRIBUTIONS = ['graph-answered', 'rederived'] as const;
export type MemoryAttribution = (typeof MEMORY_ATTRIBUTIONS)[number];

export function isMemoryAttribution(value: string): value is MemoryAttribution {
  return (MEMORY_ATTRIBUTIONS as readonly string[]).includes(value);
}

export interface MemoryTallySnapshot {
  graphAnswered: number;
  rederived: number;
  surfacesOpenedPerMorning: number;
  morningDate: string | null;
  persistence: 'process';
}

export function memoryMorningDate(now: number, env: NodeJS.ProcessEnv = process.env): string {
  const requested = env.WAR_ROOM_MORNING_TZ ?? MORNING_PUSH_DEFAULT_TZ;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: requested,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: MORNING_PUSH_DEFAULT_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
  const fields = Object.fromEntries(
    formatter
      .formatToParts(new Date(now))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${fields.year ?? '0000'}-${fields.month ?? '00'}-${fields.day ?? '00'}`;
}

export class MemoryTallyStore {
  private graphAnswered = 0;
  private rederived = 0;
  private readonly openedMorningDates = new Set<string>();

  recordAttribution(value: string): { ok: true } | { ok: false; reason: 'unknown-attribution' } {
    if (!isMemoryAttribution(value)) return { ok: false, reason: 'unknown-attribution' };
    if (value === 'graph-answered') this.graphAnswered += 1;
    else this.rederived += 1;
    return { ok: true };
  }

  /** Idempotent per V6 streak date: refresh polling is not another surface. */
  recordMorningSurfaceOpened(date: string): void {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) this.openedMorningDates.add(date);
  }

  getSnapshot(streak: Pick<MorningStreakState, 'lastRecordedDate'>): MemoryTallySnapshot {
    const morningDate = streak.lastRecordedDate;
    return {
      graphAnswered: this.graphAnswered,
      rederived: this.rederived,
      surfacesOpenedPerMorning:
        morningDate !== null && this.openedMorningDates.has(morningDate) ? 1 : 0,
      morningDate,
      persistence: 'process',
    };
  }
}

export const memoryTallyStore = new MemoryTallyStore();
