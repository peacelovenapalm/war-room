/**
 * Briefing provider (post-v0 addition, not part of the original M0-M4 scope).
 *
 * Reads operator-authored files from disk and exposes them as one JSON
 * payload for the HUD BRIEFING panel (and, for the digest, the SHIFT
 * panel's morning fold -- KICKOFF-v4 T7). All sources live outside this
 * repo on the deploy host, so they are wired via env vars -- never
 * hardcoded paths:
 *
 *   - WAR_ROOM_TODO_DIR: a directory of daily todo-compiler files named
 *     YYYY-MM-DD.md. The lexicographically-latest filename wins.
 *   - WAR_ROOM_TRACKER_STATE: a single STATE.md tracking half-baked project
 *     gates. YAML frontmatter, hand-parsed line-by-line -- no YAML dependency
 *     is added for one file.
 *   - WAR_ROOM_ROUTINES_DIR: the vault's `_inbox/routines/` root (also the
 *     source for GET /api/inbox -- see inboxProvider.ts). The daily-digest
 *     routine writes `summary/YYYY-MM-DD-digest.md`; the
 *     lexicographically-latest file in that subdir wins, same rule as todo.
 *
 * Missing env var, missing file, or a parse failure never throws: that part
 * of the briefing is `null` and one `⚠` line is logged. The GET /api/briefing
 * route (httpServer.ts) is unauthenticated, same as /api/health -- the server
 * itself is tailnet-only.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface TodoBriefing {
  /** YYYY-MM-DD parsed from the source filename. */
  date: string;
  /** Plain-text "Start now" items, markdown noise stripped. */
  startNow: string[];
  /** One entry per other "##"/"###" section: its own heading title + "- [ ]" count. */
  sections: Array<{ title: string; count: number }>;
}

export type GateStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';

export interface TrackerGate {
  id: string;
  label: string;
  status: GateStatus;
  done: number;
  total: number;
}

export interface TrackerBriefing {
  milestone: string | null;
  gates: TrackerGate[];
}

export interface DigestBriefing {
  /** YYYY-MM-DD parsed from the source filename. */
  date: string;
  /** The "Morning flags" heading's summary line, markdown noise stripped
   *  (empty string when the heading has no body line). */
  flagsSummary: string;
  /** Up to 3 "Standing flags" bullets (oldest-first per the routine's own
   *  ordering), markdown noise stripped. */
  topStandingFlags: string[];
}

export interface Briefing {
  todo: TodoBriefing | null;
  tracker: TrackerBriefing | null;
  digest: DigestBriefing | null;
  generatedAt: string;
}

const DIGEST_TOP_FLAGS_MAX = 3;

const CACHE_TTL_MS = 60_000;
const GATE_STATUSES: readonly GateStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'];

let cache: { at: number; value: Briefing } | null = null;

/** Get the briefing payload, serving from a 60s TTL cache when fresh. */
export function getBriefing(now: number = Date.now()): Briefing {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  const value: Briefing = {
    todo: loadTodoBriefing(),
    tracker: loadTrackerBriefing(),
    digest: loadDigestBriefing(),
    generatedAt: new Date(now).toISOString(),
  };
  cache = { at: now, value };
  return value;
}

/** Test-only: force the next getBriefing() call to recompute instead of serving the cache. */
export function clearBriefingCache(): void {
  cache = null;
}

// ── Todo (WAR_ROOM_TODO_DIR) ────────────────────────────────────

function loadTodoBriefing(): TodoBriefing | null {
  const dir = process.env['WAR_ROOM_TODO_DIR'];
  if (!dir) {
    console.log('[Briefing] ⚠ WAR_ROOM_TODO_DIR not set -- todo panel disabled');
    return null;
  }
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort();
    const latest = files[files.length - 1];
    if (!latest) {
      console.log(`[Briefing] ⚠ no YYYY-MM-DD.md files found in WAR_ROOM_TODO_DIR (${dir})`);
      return null;
    }
    const raw = fs.readFileSync(path.join(dir, latest), 'utf-8');
    return parseTodoMarkdown(raw, latest.replace(/\.md$/, ''));
  } catch (err) {
    console.log(
      `[Briefing] ⚠ failed to read WAR_ROOM_TODO_DIR (${dir}): ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * Tolerant markdown parse of a todo-compiler daily file:
 *  - The "## Start now" section's numbered items become plain-text strings
 *    (bold/link/backtick markup stripped, cut at "(source:" when present).
 *  - Every other "##"/"###" heading becomes {title, count}, where count is
 *    the number of "- [ ]" lines in THAT heading's own body (not nested
 *    subsection bodies -- each heading is scoped up to the next heading line).
 */
export function parseTodoMarkdown(markdown: string, date: string): TodoBriefing {
  const lines = markdown.split('\n');
  const headings: Array<{ index: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{2,3}\s+(.*)$/.exec(lines[i]);
    if (m) headings.push({ index: i, title: m[1].trim() });
  }

  const startNow: string[] = [];
  const sections: Array<{ title: string; count: number }> = [];

  for (let h = 0; h < headings.length; h++) {
    const { index, title } = headings[h];
    const end = h + 1 < headings.length ? headings[h + 1].index : lines.length;
    const body = lines.slice(index + 1, end);

    if (/^start now\b/i.test(title)) {
      for (const line of body) {
        const m = /^\s*\d+\.\s+(.*)$/.exec(line);
        if (m) startNow.push(cleanTodoLine(m[1]));
      }
      continue;
    }

    const count = body.filter((l) => /^\s*-\s*\[ \]/.test(l)).length;
    sections.push({ title, count });
  }

  return { date, startNow, sections };
}

/** Strip markdown noise from a "Start now" line and keep only the lead text. */
function cleanTodoLine(raw: string): string {
  let text = raw;
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // [text](link) -> text
  text = text.replace(/\*\*([^*]*)\*\*/g, '$1'); // **bold** -> bold
  text = text.replace(/`([^`]*)`/g, '$1'); // `code` -> code
  const sourceIdx = text.indexOf('(source:');
  if (sourceIdx !== -1) text = text.slice(0, sourceIdx);
  return text.replace(/\s+/g, ' ').trim();
}

// ── Tracker (WAR_ROOM_TRACKER_STATE) ────────────────────────────

function loadTrackerBriefing(): TrackerBriefing | null {
  const file = process.env['WAR_ROOM_TRACKER_STATE'];
  if (!file) {
    console.log('[Briefing] ⚠ WAR_ROOM_TRACKER_STATE not set -- tracker panel disabled');
    return null;
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = parseTrackerState(raw);
    if (!parsed) {
      console.log(`[Briefing] ⚠ WAR_ROOM_TRACKER_STATE (${file}) has no usable frontmatter`);
    }
    return parsed;
  } catch (err) {
    console.log(
      `[Briefing] ⚠ failed to read WAR_ROOM_TRACKER_STATE (${file}): ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * Tolerant line-based parse of a STATE.md tracker file. No YAML dependency:
 *  - Frontmatter = lines between the first two bare "---" lines.
 *  - `milestone_name:` at the top level of the frontmatter.
 *  - Each gate starts at a line shaped exactly "  - id: <value>" (2-space
 *    indent, bare scalar -- distinct from a task's single-line "{ id: ... }"
 *    form, so the two never collide).
 *  - A gate's own `label:`/`status:` are read from its 4-space-indented,
 *    whole-line form (also distinct from a task's inline `status:` inside
 *    "{ ... }").
 *  - Tasks are counted by matching `- { ... status: X ... }` lines anywhere
 *    inside the gate's block; `done` = tasks with status DONE.
 * Returns null when no frontmatter block is found at all.
 */
export function parseTrackerState(raw: string): TrackerBriefing | null {
  const lines = raw.split('\n');
  const dashIndices: number[] = [];
  for (let i = 0; i < lines.length && dashIndices.length < 2; i++) {
    if (lines[i].trim() === '---') dashIndices.push(i);
  }
  if (dashIndices.length < 2) return null;
  const fm = lines.slice(dashIndices[0] + 1, dashIndices[1]);

  const milestoneLine = fm.find((l) => /^milestone_name:\s*/.test(l));
  const milestone = milestoneLine
    ? stripQuotes(milestoneLine.replace(/^milestone_name:\s*/, ''))
    : null;

  const gateStarts: number[] = [];
  for (let i = 0; i < fm.length; i++) {
    if (/^ {2}- id:\s*\S/.test(fm[i])) gateStarts.push(i);
  }

  const gates: TrackerGate[] = [];
  for (let g = 0; g < gateStarts.length; g++) {
    const start = gateStarts[g];
    const end = g + 1 < gateStarts.length ? gateStarts[g + 1] : fm.length;
    const block = fm.slice(start, end);

    const idMatch = /^ {2}- id:\s*(\S+)/.exec(block[0]);
    const id = idMatch ? idMatch[1] : `gate-${g}`;

    const labelLine = block.find((l) => /^ {4}label:\s*/.test(l));
    const label = labelLine ? stripQuotes(labelLine.replace(/^ {4}label:\s*/, '')) : id;

    const statusLine = block.find((l) =>
      new RegExp(`^ {4}status:\\s*(${GATE_STATUSES.join('|')})\\s*$`).test(l),
    );
    const statusMatch = statusLine ? /status:\s*(\w+)/.exec(statusLine) : null;
    const status = isGateStatus(statusMatch?.[1]) ? statusMatch![1] : 'TODO';

    let done = 0;
    let total = 0;
    for (const line of block) {
      if (!/^\s*-\s*\{.*\bid:/.test(line)) continue;
      const taskStatus = /status:\s*(\w+)/.exec(line);
      if (!taskStatus || !isGateStatus(taskStatus[1])) continue;
      total++;
      if (taskStatus[1] === 'DONE') done++;
    }

    gates.push({ id, label, status, done, total });
  }

  return { milestone, gates };
}

function isGateStatus(value: string | undefined): value is GateStatus {
  return !!value && (GATE_STATUSES as readonly string[]).includes(value);
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

// ── Digest (WAR_ROOM_ROUTINES_DIR/summary) ──────────────────────

function loadDigestBriefing(): DigestBriefing | null {
  const routinesDir = process.env['WAR_ROOM_ROUTINES_DIR'];
  if (!routinesDir) {
    console.log('[Briefing] ⚠ WAR_ROOM_ROUTINES_DIR not set -- digest fold disabled');
    return null;
  }
  const dir = path.join(routinesDir, 'summary');
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}-digest\.md$/.test(f))
      .sort();
    const latest = files[files.length - 1];
    if (!latest) {
      console.log(`[Briefing] ⚠ no YYYY-MM-DD-digest.md files found in ${dir}`);
      return null;
    }
    const raw = fs.readFileSync(path.join(dir, latest), 'utf-8');
    return parseDigestMarkdown(raw, latest.replace(/-digest\.md$/, ''));
  } catch (err) {
    console.log(`[Briefing] ⚠ failed to read digest dir (${dir}): ${(err as Error).message}`);
    return null;
  }
}

/**
 * Tolerant markdown parse of a daily-digest routine file:
 *  - "## Morning flags ..." heading's first bullet/text line becomes
 *    `flagsSummary` (markup stripped, same cleaning as todo lines).
 *  - "## Standing flags ..." heading's first N bullets become
 *    `topStandingFlags`.
 * Heading match is prefix-based ("Morning flags", "Standing flags") since
 * the routine appends parenthetical detail that varies day to day.
 */
export function parseDigestMarkdown(markdown: string, date: string): DigestBriefing {
  const lines = markdown.split('\n');
  const headings: Array<{ index: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{2,3}\s+(.*)$/.exec(lines[i]);
    if (m) headings.push({ index: i, title: m[1].trim() });
  }

  let flagsSummary = '';
  const topStandingFlags: string[] = [];

  for (let h = 0; h < headings.length; h++) {
    const { index, title } = headings[h];
    const end = h + 1 < headings.length ? headings[h + 1].index : lines.length;
    const body = lines.slice(index + 1, end).filter((l) => l.trim().length > 0);

    if (/^morning flags\b/i.test(title)) {
      const first = body.find((l) => /^\s*-\s+/.test(l)) ?? body[0];
      if (first) flagsSummary = cleanTodoLine(first.replace(/^\s*-\s+/, ''));
    } else if (/^standing flags\b/i.test(title)) {
      for (const line of body) {
        if (topStandingFlags.length >= DIGEST_TOP_FLAGS_MAX) break;
        if (!/^\s*-\s+/.test(line)) continue;
        topStandingFlags.push(cleanTodoLine(line.replace(/^\s*-\s+/, '')));
      }
    }
  }

  return { date, flagsSummary, topStandingFlags };
}
