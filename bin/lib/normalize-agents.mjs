/**
 * Tolerant normalizer for `claude agents --json` output (M4 needs-input poller).
 *
 * `claude agents --json` is a RESEARCH-PREVIEW surface (v2.1.139+) — expect
 * churn. This module is the single place that absorbs it. Contract:
 *
 *   - Normalized fields per agent: id, state ∈ {working, blocked, done,
 *     failed, stopped}, waitingFor?, cwd?, pid?, startedAt?  (+ sessionId?
 *     passthrough — the server matches poll entries to adopted agents by
 *     session id first, so we forward it when the CLI provides one).
 *   - Unknown fields are ignored.
 *   - Entries missing a usable id or a valid state are SKIPPED (counted),
 *     not fatal. Observed live on 2.1.202: `kind:"interactive"` sessions
 *     carry `status: idle|busy` but NO `state` — those are skipped; the
 *     local JSONL/hook pipeline already covers interactive sessions.
 *   - Malformed payloads (not JSON, wrong shape) return { ok: false } so the
 *     poller skips the tick with a ⚠ log. This module never throws.
 *
 * Pure ESM, zero dependencies, unit-tested with node:test
 * (bin/test/normalize-agents.test.mjs).
 */

export const VALID_STATES = Object.freeze(['working', 'blocked', 'done', 'failed', 'stopped']);

/** Cap waitingFor so a runaway CLI string cannot bloat the POST body. */
export const WAITING_FOR_MAX_CHARS = 200;

/**
 * Normalize raw `claude agents --json` output.
 *
 * @param {unknown} raw - stdout string, or already-parsed JSON value.
 * @returns {{ ok: true, agents: Array<object>, skipped: number }
 *         | { ok: false, reason: string }}
 */
export function normalizeAgents(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text === '') return { ok: false, reason: 'empty output' };
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { ok: false, reason: `not JSON: ${err instanceof Error ? err.message : err}` };
    }
  }

  // Accept a top-level array, or a { agents: [...] } wrapper (shape churn guard).
  let list = parsed;
  if (list !== null && typeof list === 'object' && !Array.isArray(list)) {
    list = list.agents;
  }
  if (!Array.isArray(list)) {
    return { ok: false, reason: `unexpected shape: ${describeShape(parsed)}` };
  }

  const agents = [];
  let skipped = 0;
  for (const entry of list) {
    const norm = normalizeEntry(entry);
    if (norm) agents.push(norm);
    else skipped++;
  }
  return { ok: true, agents, skipped };
}

/** Normalize one agent entry, or return null to skip it. Never throws. */
function normalizeEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;

  const id = toId(entry.id) ?? toId(entry.sessionId);
  if (id === undefined) return null;

  const state = typeof entry.state === 'string' ? entry.state : undefined;
  if (state === undefined || !VALID_STATES.includes(state)) return null;

  const out = { id, state };

  const sessionId = toId(entry.sessionId);
  if (sessionId !== undefined) out.sessionId = sessionId;

  if (typeof entry.waitingFor === 'string' && entry.waitingFor.trim() !== '') {
    out.waitingFor = entry.waitingFor.trim().slice(0, WAITING_FOR_MAX_CHARS);
  }
  if (typeof entry.cwd === 'string' && entry.cwd !== '') {
    out.cwd = entry.cwd;
  }
  if (Number.isInteger(entry.pid) && entry.pid > 0) {
    out.pid = entry.pid;
  }
  if (
    (typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt)) ||
    (typeof entry.startedAt === 'string' && entry.startedAt !== '')
  ) {
    out.startedAt = entry.startedAt;
  }
  return out;
}

/** Coerce an id-ish value (non-empty string, or number) to a string, else undefined. */
function toId(value) {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function describeShape(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
