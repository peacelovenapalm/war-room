/**
 * Shift-report push delivery (v1 mechanic #2 follow-up, Greg's decision
 * 2026-07-07): at day rollover, POST a compact plain-text summary of the
 * closed shift to whatever URLs Greg points it at (his morning page /
 * Bark wrapper on NEXUS — wiring NEXUS itself is out of scope here).
 *
 * Hard rules:
 *   - Unset `WAR_ROOM_PUSH_URLS` = feature off, zero noise (no fetch calls).
 *   - Fire-and-forget: NEVER blocks or delays the event plane. Callers
 *     invoke `pushShiftReport` and move on; results land in a log line only.
 *   - Tolerant per-URL: one URL failing (or throwing) never affects another,
 *     never crashes the process, never retry-storms — at most ONE retry.
 *   - Never log the raw URL (it may embed a device/webhook token) — only
 *     the host, masked.
 */

import type { ShiftReport } from './shiftStats.js';

/** Total attempts per URL: the initial try + exactly one retry. */
const MAX_ATTEMPTS = 2;
/** Per-attempt network timeout — must never hang the process. */
export const PUSH_TIMEOUT_MS = 5_000;

export interface PushResult {
  url: string;
  ok: boolean;
  error?: string;
}

/** Read + parse the comma-separated push-target env var. Empty/unset → []. */
export function getPushUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.WAR_ROOM_PUSH_URLS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Host-only, for logging — never print a full URL (may carry a token/key). */
export function maskUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return '<invalid-url>';
  }
}

function grade(report: ShiftReport): string {
  return report.efficiency ?? 'n/a';
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return 'n/a';
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h${mins % 60}m`;
}

/** Compact plain-text summary — turns, tokens, crisis throughput, grade
 *  (WORD, never color). Meant for a phone push / morning-page tile. */
export function formatShiftPushText(report: ShiftReport): string {
  const lines = [
    `SHIFT REPORT — ${report.date}`,
    `Turns: ${report.turnsCompleted} completed`,
    `Tokens: ${report.tokensIn} in / ${report.tokensOut} out`,
    `Crises: ${report.crisesIgnited} ignited, ${report.crisesResolved} resolved` +
      (report.crisesOpen > 0 ? `, ${report.crisesOpen} still open` : '') +
      ` (mean unblock ${fmtDuration(report.meanTimeToUnblockMs)}, worst ${fmtDuration(report.longestBlockedMs)})`,
    `Efficiency: ${grade(report)}` +
      (report.outputTokensPerTurn !== null
        ? ` (${report.outputTokensPerTurn} output tok/turn)`
        : ''),
  ];
  if (report.todosClosed !== null || report.gatesAdvanced !== null) {
    lines.push(
      `Progress: ${report.todosClosed ?? '—'} todos closed, ${report.gatesAdvanced ?? '—'} gates advanced`,
    );
  }
  return lines.join('\n');
}

async function postOnce(url: string, body: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/** POST to one URL with at most one retry. Never throws. */
export async function pushToUrl(
  url: string,
  body: string,
  timeoutMs: number = PUSH_TIMEOUT_MS,
): Promise<PushResult> {
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await postOnce(url, body, timeoutMs);
      return { url, ok: true };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { url, ok: false, error: lastError };
}

export interface PushShiftReportOptions {
  /** Override the env-sourced URL list (tests). */
  urls?: string[];
  /** Override the per-attempt timeout (tests). */
  timeoutMs?: number;
  /** Override the log sink (tests); defaults to console.log/console.warn. */
  log?: (line: string) => void;
}

/**
 * Fire-and-forget fan-out of the closed shift's summary to every configured
 * push URL. Returns immediately — never awaited by callers on the hot path
 * (day rollover happens inline inside stat-recording calls, which must never
 * block on network I/O). Failures log a single ⚠ line per URL; they never
 * throw back into the caller.
 */
export function pushShiftReport(report: ShiftReport, options: PushShiftReportOptions = {}): void {
  const urls = options.urls ?? getPushUrls();
  if (urls.length === 0) return; // feature off — zero noise
  const log = options.log ?? ((line: string) => console.log(line));
  const text = formatShiftPushText(report);
  for (const url of urls) {
    void pushToUrl(url, text, options.timeoutMs)
      .then((result) => {
        if (!result.ok) {
          log(`⚠ [Pixel Agents] shift push failed for ${maskUrlForLog(url)}: ${result.error}`);
        } else {
          log(`[Pixel Agents] shift push delivered to ${maskUrlForLog(url)}`);
        }
      })
      .catch((err: unknown) => {
        // Defense-in-depth: pushToUrl already swallows its own errors, but a
        // rejected promise here must still never surface — log only.
        log(`⚠ [Pixel Agents] shift push threw for ${maskUrlForLog(url)}: ${String(err)}`);
      });
  }
}
