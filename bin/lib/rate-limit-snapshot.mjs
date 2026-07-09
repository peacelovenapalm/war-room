/**
 * Pure parser for a Claude Code statusline hook's stdin payload -> the
 * rate-limit snapshot the war-room budget guardrail persists (v2 mechanic
 * G3, GAME-DESIGN.md §7.4).
 *
 * Field names verified against ~/.claude/statusline.js's own parse sites
 * (Greg-owned, not part of this repo — never edited by this module):
 * `data.rate_limits` (statusline.js:353), windows `five_hour`/`seven_day`
 * each `{used_percentage, resets_at}` (statusline.js:357-366, `resets_at`
 * in Unix SECONDS per the comment at statusline.js:174). This mirrors the
 * shape statusline.js already parses successfully from the SAME stdin
 * payload every prompt render — it does not invent a new shape.
 *
 * Pure ESM, zero dependencies, unit-tested with node:test
 * (bin/test/rate-limit-snapshot.test.mjs).
 */

const WINDOW_KEYS = Object.freeze(['five_hour', 'seven_day']);

/**
 * @param {unknown} raw - stdin string, or an already-parsed JSON value.
 * @returns {{ ok: true, snapshot: null | Record<string, {used_percentage:number, resets_at?:number}> }
 *         | { ok: false, reason: string }}
 */
export function parseRateLimitSnapshot(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text === '') return { ok: false, reason: 'empty stdin' };
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { ok: false, reason: `not JSON: ${err instanceof Error ? err.message : err}` };
    }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, reason: 'not an object' };
  }

  const rateLimits = /** @type {Record<string, unknown>} */ (parsed).rate_limits;
  if (rateLimits === undefined) {
    // Honest absence — a render before the CLI has ever attached
    // rate_limits (e.g. no subscriber usage yet) is not malformed, just
    // nothing to snapshot this tick.
    return { ok: true, snapshot: null };
  }
  if (rateLimits === null || typeof rateLimits !== 'object') {
    return { ok: false, reason: 'rate_limits is not an object' };
  }

  const snapshot = {};
  for (const key of WINDOW_KEYS) {
    const window = /** @type {Record<string, unknown>} */ (rateLimits)[key];
    if (window && typeof window === 'object' && typeof window.used_percentage === 'number') {
      snapshot[key] = {
        used_percentage: window.used_percentage,
        ...(typeof window.resets_at === 'number' ? { resets_at: window.resets_at } : {}),
      };
    }
  }
  return { ok: true, snapshot };
}

/**
 * Read + parse the snapshot file the hook writes — tolerant of absence
 * (no hook wired yet is expected, not an error).
 * @param {string} filePath
 * @param {{ readFileSync: (p: string, enc: string) => string }} fsImpl
 * @returns {{ ok: true, snapshot: object } | { ok: false, reason: string }}
 */
export function readSnapshotFile(filePath, fsImpl) {
  try {
    const raw = fsImpl.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, snapshot: parsed };
    }
    return { ok: false, reason: 'not an object' };
  } catch (err) {
    const code =
      err && typeof err === 'object' ? /** @type {{code?:string}} */ (err).code : undefined;
    return { ok: false, reason: code === 'ENOENT' ? 'absent' : String(err) };
  }
}
