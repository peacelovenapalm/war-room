/**
 * Morning spot-check spool (V6-5 "cross-model spot checks", V6-DESIGN
 * §V6-5). Sampled, non-blocking: this module NEVER calls codex itself —
 * it only decides whether TODAY is a sampled morning and, if so, writes
 * the composed morning summary + raw section data to a spool file an
 * EXTERNAL `codex exec` runner can pick up on its own schedule.
 *
 * Per the design's own honesty bar ("if codex isn't reachable from the
 * server, the spool + a documented manual/runner path is acceptable —
 * never block the push"): the runner is intentionally NOT shipped as a
 * committed binary/daemon here. The documented path is —
 *
 *   1. this module writes `<spoolDir>/<date>.json` with
 *      `{ date, summary, sections }` whenever `shouldSpotCheck()` is true
 *      for that morning (called from morningPush.ts's tick, same call
 *      site the push itself fires from — writing the spool is a pure
 *      side file write, it can never fail the push).
 *   2. a manual or cron'd step, wherever `codex` is actually reachable,
 *      runs something like:
 *        codex exec "Read <spoolDir>/<date>.json. Does the `summary`
 *        text honestly match the `sections` data? If not, POST a
 *        {date, summary, detail} discrepancy to
 *        POST /api/ops/narrative-finding (Bearer $WAR_ROOM_TOKEN)."
 *   3. narrativeFindingStore.ts is the landing pad; opsAdvisor.ts folds
 *      any filed discrepancy into GET /api/ops/review as kind:'narrative'.
 *
 * Sampling is deterministic on the local CALENDAR DATE (not
 * process-lifetime Math.random()) so a restart never skews the 1-in-N
 * rate, PLUS unconditionally true the morning after a degraded one (a
 * fresh eye on exactly the mornings most likely to need one).
 */

import * as fs from 'fs';
import * as path from 'path';

import { MORNING_SPOT_CHECK_SAMPLE_RATE } from './constants.js';
import type { MorningSurface } from './morningSurface.js';

/** Simple deterministic hash of a YYYY-MM-DD string -> a small non-negative
 *  int, stable across process restarts (no Math.random dependency). */
function dateSampleIndex(date: string): number {
  let hash = 0;
  for (let i = 0; i < date.length; i++) {
    hash = (hash * 31 + date.charCodeAt(i)) >>> 0;
  }
  return hash % MORNING_SPOT_CHECK_SAMPLE_RATE;
}

export function shouldSpotCheck(date: string, previousMorningDegraded: boolean): boolean {
  if (previousMorningDegraded) return true;
  return dateSampleIndex(date) === 0;
}

function isSafeDateSegment(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/** Writes the spool file for `date`. Never throws — a write failure is
 *  logged and swallowed (same "state loss on write failure is acceptable,
 *  crashing is not" posture as V3JsonPersistence), and is NEVER on the
 *  critical path of the push itself (call this AFTER the push fires, or
 *  in parallel — never gate notifyMorningDigest on this succeeding). */
export function writeMorningSpotCheckSpool(
  date: string,
  surface: MorningSurface,
  summary: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const dir = env['WAR_ROOM_MORNING_SPOOL_DIR'];
  if (!dir) {
    console.log(
      '[MorningSpotCheck] ⚠ WAR_ROOM_MORNING_SPOOL_DIR not set -- spot-check spool disabled',
    );
    return;
  }
  if (!isSafeDateSegment(date)) {
    console.log(`[MorningSpotCheck] ⚠ refusing unsafe date segment: ${date}`);
    return;
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${date}.json`);
    const payload = {
      date,
      summary,
      sections: {
        morningJson: surface.morningJson,
        board: surface.board,
        overnight: surface.overnight,
      },
      degraded: surface.degraded,
      degradedReasons: surface.degradedReasons,
    };
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`[MorningSpotCheck] spool written -> ${target}`);
  } catch (err) {
    console.log(`[MorningSpotCheck] ⚠ failed to write spool (${dir}): ${(err as Error).message}`);
  }
}
