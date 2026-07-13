/**
 * Pure logic for the MORNING view (V6-1 "one glance, one push",
 * V6-DESIGN §V6-1). Types mirror server/src/morningSurface.ts's shapes
 * exactly (same duplication discipline as inboxFacts.ts/districtFacts.ts
 * -- never imported across the client/server boundary).
 */

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
  pending?: true;
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
  lastRecordedDate: string | null;
  lastBreachReason: string | null;
  lastBreachAt: string | null;
}

export interface MorningMemorySection {
  graphAnswered: number;
  rederived: number;
  surfacesOpenedPerMorning: number;
  morningDate: string | null;
  persistence: 'process';
  writePathEnabled: boolean;
  writeMode: 'staged' | 'direct';
  cleanDayCount: number;
  promotionEligible: boolean;
}

export interface MorningSurface {
  generatedAt: string;
  morningJson: MorningJsonSection;
  board: BoardSection;
  overnight: OvernightSection;
  needsYouCount: number;
  degraded: boolean;
  degradedReasons: string[];
  streak: MorningStreakSection;
  memory: MorningMemorySection;
}

export const MORNING_REFRESH_INTERVAL_MS = 60_000;

/** Latency bars (V6-3 "seconds fine, minutes not") — board/overnight
 *  sections are derived live server-side, so this bar is generous headroom
 *  for a slow poll/render, not a real staleness signal in normal operation. */
export const MORNING_BOARD_STALE_WARN_SECONDS = 120;
/** morning.json regenerates once a day -- this bar is deliberately close to
 *  the server's own MORNING_JSON_STALE_MS so the view and the push agree
 *  on what "stale" means. */
export const MORNING_JSON_STALE_WARN_SECONDS = 20 * 60 * 60;

/** Fetch the morning surface. Never throws -- a network/parse failure
 *  returns null so the caller can render an honest "can't reach the
 *  server" state instead of a stale or fabricated one. */
export async function fetchMorningSurface(): Promise<MorningSurface | null> {
  try {
    const res = await fetch('/api/morning');
    if (!res.ok) return null;
    return (await res.json()) as MorningSurface;
  } catch {
    return null;
  }
}

/** true when NOTHING needs Greg right now: zero needs-you, zero held
 *  jobs, and the surface itself composed honestly (not degraded) -- the
 *  explicit "✓ ALL CALM" state is only real when every section backing it
 *  is real, never a default rendered because data simply didn't load. */
export function isAllCalm(surface: MorningSurface): boolean {
  return (
    !surface.degraded &&
    surface.needsYouCount === 0 &&
    surface.board.heldBudget.count === 0 &&
    surface.morningJson.prs.count === 0
  );
}

/** Shape+word age label -- colorblind rule, never color alone. */
export function formatDataAge(seconds: number | null): string {
  if (seconds === null) return 'unknown age';
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h`;
}

export function isBoardStale(section: BoardSection): boolean {
  return section.dataAgeSeconds > MORNING_BOARD_STALE_WARN_SECONDS;
}

export function isMorningJsonStale(section: MorningJsonSection): boolean {
  if (!section.available) return false; // unavailable renders its own honest line, not ◷ STALE
  if (section.stale) return true;
  return (
    section.dataAgeSeconds !== null && section.dataAgeSeconds > MORNING_JSON_STALE_WARN_SECONDS
  );
}
