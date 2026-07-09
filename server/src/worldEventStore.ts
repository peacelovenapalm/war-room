/**
 * World event store (v2 mechanic G4 — GAME-DESIGN.md §6.3) — ambient office
 * life between real events. 12-entry weighted table, evaluated on the
 * coarse "live tick" (httpServer.ts: 5-min interval, gated on ≥1 connected
 * WebSocket — see GAME-DESIGN §2's unified cadence model). Data layer only:
 * this store produces an event LOG that digest.ts reads for the "while you
 * were out" narrative; the visual/animation layer is G5's scope.
 *
 * ONE-WAY LAYERING (mirrors standingOrderStore.ts/chainOrchestrator.ts):
 * this file never imports economyStore.ts or employeeStore.ts directly —
 * every Cash/Reputation/mood effect goes through an injected dependency
 * function, wired for real in httpServer.ts's live-tick handler. The single
 * hard-coded amount in this file is `flavor_bonus`'s capped +1..+5 Cash
 * roll; every other effect (inspection's Reputation, rival_poach/birthday's
 * moodBoost nudge) is equally real-store-free at the call site, just routed
 * through a differently-named callback.
 *
 * Vacation-mode suppression: only `pureAmbient` events fire while vacation
 * mode is on (GAME-DESIGN §4.5) — inspection/rival_poach/birthday/
 * flavor_bonus are excluded. Online-only events (power_surge,
 * power_outage_scare — their entire value is a live visual moment) are
 * excluded from the eligible pool whenever `deps.online` is false.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { WORLD_EVENT_GLYPHS } from '../../core/src/worldEventGlyphs.js';
import { LAYOUT_FILE_DIR } from './constants.js';

const WORLD_EVENTS_FILE_NAME = 'world-events.json';
const PERSIST_THROTTLE_MS = 5_000;
const EVENT_LOG_CAP = 50;

function defaultWorldEventsFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, WORLD_EVENTS_FILE_NAME);
}

function localDate(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Hard cap — the ONE, explicit, documented exception to "no idle Cash"
 *  (GAME-DESIGN §6.3), tracked independently of economyStore's own caps
 *  (belt-and-suspenders). */
export const FLAVOR_BONUS_CASH_CAP_PER_DAY = 5;
/** rival_poach's mechanical nudge — fires only on this roll AND only when a
 *  qualifying (effective mood < 40) employee exists; fizzles silently otherwise. */
export const RIVAL_POACH_ROLL_CHANCE = 0.05;
export const RIVAL_POACH_MOOD_BOOST_DELTA = -3;
export const BIRTHDAY_MOOD_BOOST_DELTA = 1;
/** Reputation swing from an inspection, gated on office grime (GAME-DESIGN §6.3). */
export const INSPECTION_GRIME_THRESHOLD = 70;
export const INSPECTION_REP_CLEAN = 2;
export const INSPECTION_REP_DIRTY = -1;

export interface WorldEventDef {
  id: string;
  glyph: string;
  weight: number;
  minGapMs: number;
  durationMs: number;
  /** Only pure-ambient events fire while vacation mode is on. */
  pureAmbient: boolean;
  /** Entire value is a live visual moment — never replayed, excluded from
   *  the eligible pool when the tick runs "offline" (deps.online=false). */
  onlineOnly: boolean;
}

/** Canonical 12-entry table (GAME-DESIGN §6.3), glyphs reassigned off the
 *  fiction/real collision found in review (§6.1/§9.16) — coffee_run,
 *  client_call, mail_delivery moved off `○` (owned by the real dispatch
 *  EXPIRED chip). */
export const WORLD_EVENTS: readonly WorldEventDef[] = [
  {
    id: 'power_surge',
    glyph: WORLD_EVENT_GLYPHS.power_surge,
    weight: 10,
    minGapMs: 4 * 3_600_000,
    durationMs: 2 * 60_000,
    pureAmbient: true,
    onlineOnly: true,
  },
  {
    id: 'inspection',
    glyph: WORLD_EVENT_GLYPHS.inspection,
    weight: 8,
    minGapMs: 12 * 3_600_000,
    durationMs: 5 * 60_000,
    pureAmbient: false,
    onlineOnly: false,
  },
  {
    id: 'rival_poach',
    glyph: WORLD_EVENT_GLYPHS.rival_poach,
    weight: 6,
    minGapMs: 18 * 3_600_000,
    durationMs: 10 * 60_000,
    pureAmbient: false,
    onlineOnly: false,
  },
  {
    id: 'coffee_run',
    glyph: WORLD_EVENT_GLYPHS.coffee_run,
    weight: 20,
    minGapMs: 1 * 3_600_000,
    durationMs: 3 * 60_000,
    pureAmbient: true,
    onlineOnly: false,
  },
  {
    id: 'birthday',
    glyph: WORLD_EVENT_GLYPHS.birthday,
    weight: 3,
    minGapMs: 720 * 3_600_000,
    durationMs: 60 * 60_000,
    pureAmbient: false,
    onlineOnly: false,
  },
  {
    id: 'printer_jam',
    glyph: WORLD_EVENT_GLYPHS.printer_jam,
    weight: 12,
    minGapMs: 6 * 3_600_000,
    durationMs: 4 * 60_000,
    pureAmbient: true,
    onlineOnly: false,
  },
  {
    id: 'client_call',
    glyph: WORLD_EVENT_GLYPHS.client_call,
    weight: 10,
    minGapMs: 8 * 3_600_000,
    durationMs: 5 * 60_000,
    pureAmbient: true,
    onlineOnly: false,
  },
  {
    id: 'weather_rain',
    glyph: WORLD_EVENT_GLYPHS.weather_rain,
    weight: 15,
    minGapMs: 6 * 3_600_000,
    durationMs: 20 * 60_000,
    pureAmbient: true,
    onlineOnly: false,
  },
  {
    id: 'flavor_bonus',
    glyph: WORLD_EVENT_GLYPHS.flavor_bonus,
    weight: 5,
    minGapMs: 24 * 3_600_000,
    durationMs: 0,
    pureAmbient: false,
    onlineOnly: false,
  },
  {
    id: 'heatwave',
    glyph: WORLD_EVENT_GLYPHS.heatwave,
    weight: 8,
    minGapMs: 48 * 3_600_000,
    durationMs: 180 * 60_000,
    pureAmbient: true,
    onlineOnly: false,
  },
  {
    id: 'power_outage_scare',
    glyph: WORLD_EVENT_GLYPHS.power_outage_scare,
    weight: 4,
    minGapMs: 72 * 3_600_000,
    durationMs: 3 * 60_000,
    pureAmbient: true,
    onlineOnly: true,
  },
  {
    id: 'mail_delivery',
    glyph: WORLD_EVENT_GLYPHS.mail_delivery,
    weight: 15,
    minGapMs: 3 * 3_600_000,
    durationMs: 2 * 60_000,
    pureAmbient: true,
    onlineOnly: false,
  },
] as const;

/** SIM glyph pool — every glyph used across WORLD_EVENTS. Reserved separate
 *  from the real set (GAME-DESIGN §6.1); signalChip.test.ts asserts these
 *  two pools stay disjoint. */
export const SIM_GLYPHS: ReadonlySet<string> = new Set(WORLD_EVENTS.map((e) => e.glyph));

export interface WorldEventLogEntry {
  id: string;
  glyph: string;
  ts: number;
  /** Short flavor text — digest.ts's raw material for the "while you were
   *  out" narrative (GAME-DESIGN §6.5). */
  summary: string;
}

interface WorldEventData {
  lastFiredAt: Record<string, number>;
  flavorCashDate: string | null;
  flavorCashToday: number;
  eventLog: WorldEventLogEntry[];
}

function emptyData(): WorldEventData {
  return { lastFiredAt: {}, flavorCashDate: null, flavorCashToday: 0, eventLog: [] };
}

export interface WorldEventTickDeps {
  /** false = the tick is evaluated with no live socket (e.g. a future
   *  offline-catchup context) — onlineOnly events are excluded. httpServer.ts's
   *  live-tick always passes true, since the whole interval is itself gated
   *  on ≥1 connected socket. */
  online: boolean;
  isVacationActive: () => boolean;
  getGrime: () => number;
  awardCash: (amount: number, reason: string) => void;
  awardReputation: (amount: number, reason: string) => void;
  pickLowMoodEmployeeId: () => string | undefined;
  pickRandomEmployeeId: () => string | undefined;
  nudgeEmployeeMoodBoost: (id: string, delta: number) => void;
  /** Injectable for deterministic tests — defaults to Math.random. World
   *  events are ambient flavor, not a replay-critical roll (unlike
   *  employeeStore's quit mechanic), so Math.random() is fine in production. */
  random?: () => number;
}

export class WorldEventStore {
  private data: WorldEventData | null = null;
  private lastPersistAt = 0;
  private explicitPath: string | undefined;
  private resolvedPath: string | undefined;
  private usingDefaultPath = false;

  constructor(persistPath?: string) {
    this.explicitPath = persistPath;
  }

  getEventLog(limit = EVENT_LOG_CAP): WorldEventLogEntry[] {
    return this.ensureLoaded().eventLog.slice(-limit);
  }

  /** One weighted-random roll among events whose min-gap has elapsed and
   *  that pass the online/vacation filters. Returns the fired event's log
   *  entry, or null when nothing was eligible/rolled (most ticks, by
   *  construction — rare, ambient, not spammy). */
  tick(now: number, deps: WorldEventTickDeps): WorldEventLogEntry | null {
    const data = this.ensureLoaded();
    const random = deps.random ?? Math.random;
    const vacationActive = deps.isVacationActive();

    const eligible = WORLD_EVENTS.filter((e) => {
      if (!deps.online && e.onlineOnly) return false;
      if (vacationActive && !e.pureAmbient) return false;
      const last = data.lastFiredAt[e.id] ?? 0;
      return now - last >= e.minGapMs;
    });
    if (eligible.length === 0) return null;

    const totalWeight = eligible.reduce((sum, e) => sum + e.weight, 0);
    let roll = random() * totalWeight;
    let chosen: WorldEventDef = eligible[eligible.length - 1];
    for (const e of eligible) {
      if (roll < e.weight) {
        chosen = e;
        break;
      }
      roll -= e.weight;
    }

    data.lastFiredAt[chosen.id] = now;
    const summary = this.applyEffect(chosen, now, deps, random);
    const entry: WorldEventLogEntry = { id: chosen.id, glyph: chosen.glyph, ts: now, summary };
    data.eventLog.push(entry);
    if (data.eventLog.length > EVENT_LOG_CAP) {
      data.eventLog.splice(0, data.eventLog.length - EVENT_LOG_CAP);
    }
    this.persist(now, true);
    return entry;
  }

  private applyEffect(
    def: WorldEventDef,
    now: number,
    deps: WorldEventTickDeps,
    random: () => number,
  ): string {
    switch (def.id) {
      case 'inspection': {
        const grime = deps.getGrime();
        if (grime <= INSPECTION_GRIME_THRESHOLD) {
          deps.awardReputation(INSPECTION_REP_CLEAN, 'world-event-inspection');
          return 'Surprise inspection — the office passed with flying colors.';
        }
        deps.awardReputation(INSPECTION_REP_DIRTY, 'world-event-inspection');
        return 'Surprise inspection — the office needs a clean-up.';
      }
      case 'rival_poach': {
        if (random() < RIVAL_POACH_ROLL_CHANCE) {
          const targetId = deps.pickLowMoodEmployeeId();
          if (targetId) {
            deps.nudgeEmployeeMoodBoost(targetId, RIVAL_POACH_MOOD_BOOST_DELTA);
            return 'A rival studio is making offers — someone is considering it.';
          }
        }
        return 'A rival studio came sniffing around, but nobody bit.';
      }
      case 'birthday': {
        const targetId = deps.pickRandomEmployeeId();
        if (targetId) deps.nudgeEmployeeMoodBoost(targetId, BIRTHDAY_MOOD_BOOST_DELTA);
        return 'Someone had a birthday in the office today.';
      }
      case 'flavor_bonus': {
        const data = this.ensureLoaded();
        const today = localDate(now);
        if (data.flavorCashDate !== today) {
          data.flavorCashDate = today;
          data.flavorCashToday = 0;
        }
        const remaining = Math.max(0, FLAVOR_BONUS_CASH_CAP_PER_DAY - data.flavorCashToday);
        const roll = Math.floor(random() * 5) + 1; // 1..5
        const award = Math.min(roll, remaining);
        if (award > 0) {
          data.flavorCashToday += award;
          deps.awardCash(award, 'world-event-flavor-bonus');
          return `Found a coffee gift card (+$${award}).`;
        }
        return 'Found a coffee gift card, but the daily luck ran out.';
      }
      default:
        return AMBIENT_SUMMARIES[def.id] ?? def.id;
    }
  }

  // ── Persistence (tolerant, throttled — same pattern as economyStore.ts) ──

  private persistPath(): string {
    if (!this.resolvedPath) {
      this.usingDefaultPath = this.explicitPath === undefined;
      this.resolvedPath = this.explicitPath ?? defaultWorldEventsFile();
    }
    return this.resolvedPath;
  }

  private ensureLoaded(): WorldEventData {
    if (!this.data) this.data = this.load() ?? emptyData();
    return this.data;
  }

  private load(): WorldEventData | null {
    try {
      const raw = JSON.parse(
        fs.readFileSync(this.persistPath(), 'utf8'),
      ) as Partial<WorldEventData>;
      if (raw && typeof raw.lastFiredAt === 'object') {
        return { ...emptyData(), ...raw };
      }
    } catch {
      /* missing/corrupt → fresh state */
    }
    return null;
  }

  private persist(now: number, force = false): void {
    if (process.env.VITEST && this.usingDefaultPath) return;
    if (!force && now - this.lastPersistAt < PERSIST_THROTTLE_MS) return;
    this.lastPersistAt = now;
    const target = this.persistPath();
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(this.ensureLoaded()), 'utf8');
    } catch {
      /* world-event state loss on write failure is acceptable — never crash the server */
    }
  }
}

const AMBIENT_SUMMARIES: Partial<Record<string, string>> = {
  power_surge: 'The lights flickered for a second.',
  coffee_run: 'A couple of people made a coffee run.',
  printer_jam: 'The printer jammed again.',
  client_call: 'Someone took a client call.',
  weather_rain: 'It started raining outside.',
  heatwave: 'The AC is straining through a heatwave.',
  power_outage_scare: 'The power flickered — false alarm.',
  mail_delivery: 'The mail arrived.',
};

/** Process-wide instance (the server is single-process). Real store wiring
 *  (economyStore/employeeStore/grime) happens in httpServer.ts's live-tick
 *  handler, not here — this file never imports either store. */
export const worldEventStore = new WorldEventStore();
