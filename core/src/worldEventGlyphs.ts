/**
 * SIM glyph pool (GAME-DESIGN.md §6.1/§6.3) — one glyph per world-event id,
 * reassigned off the fiction/real collision found in review (coffee_run/
 * client_call/mail_delivery moved off `○`, which the real dispatch set
 * already owns for EXPIRED). Lives in core/ (not webview-ui or server) so
 * both worldEventStore.ts (server) and signalChip.test.ts (webview) share
 * one source of truth — server never duplicates the table, webview never
 * hand-types a copy that could silently drift from it.
 */
export const WORLD_EVENT_GLYPHS = {
  power_surge: '⚡',
  inspection: '▣',
  rival_poach: '✦',
  coffee_run: '✧',
  birthday: '✦',
  printer_jam: '╳',
  client_call: '⟡',
  weather_rain: '≈',
  flavor_bonus: '✦',
  heatwave: '≈',
  power_outage_scare: '⚡',
  mail_delivery: '⬡',
} as const;

export const SIM_GLYPHS: ReadonlySet<string> = new Set(Object.values(WORLD_EVENT_GLYPHS));
