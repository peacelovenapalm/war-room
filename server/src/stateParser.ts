/**
 * Tolerant STATE.md parser (v4 T7, D-35 "districts = projects").
 *
 * A project's `.planning/STATE.md` (or `.planning/v4/STATE-v4.md`) is a
 * human-edited markdown ledger, not a fixed schema — every real project on
 * this Mac uses a different shape (verified against war-room's own
 * .planning/v4/STATE-v4.md and two-wheel-events's .planning/STATE.md, both
 * read directly). This module tries a small set of format-specific
 * strategies, in order, and returns the FIRST one that recognizes the
 * file's shape. A strategy that can't confidently extract a field returns
 * `null` for it rather than guess — nulls flow all the way to the district
 * building as an honest "unknown" render, never a fake number.
 *
 * Strategies (first match wins, checked in this order):
 *  1. GSD frontmatter (`---\n...\n---` with `milestone_name:`/`milestone:`
 *     and a nested `progress:` block carrying `percent:`) — two-wheel-events
 *     STATE.md shape.
 *  2. Table ledger (`status: <value>` line + a markdown table under an
 *     "## Items" heading whose Status column starts with "done") —
 *     war-room's own .planning/v4/STATE-v4.md shape.
 *  3. Checkbox milestones (`- [x]`/`- [ ]` lines, optionally under a
 *     "## Milestones" heading) — war-room's original .planning/STATE.md
 *     (v0) shape.
 * No recognized shape -> every field null (never a throw, never a guess).
 */

export interface ParsedProjectState {
  /** Best-effort current phase/milestone label, or null if none found. */
  phase: string | null;
  /** 0..1 completion fraction, or null if it can't be derived honestly. */
  progress: number | null;
  /** ISO-ish timestamp string of the most recent recorded activity, or
   *  null if the format has no log/timestamp to read. */
  lastActivity: string | null;
}

const NULL_STATE: ParsedProjectState = { phase: null, progress: null, lastActivity: null };

export function parseProjectState(raw: string): ParsedProjectState {
  return (
    parseFrontmatterState(raw) ??
    parseTableLedgerState(raw) ??
    parseCheckboxState(raw) ??
    NULL_STATE
  );
}

// ── Strategy 1: GSD frontmatter (two-wheel-events STATE.md shape) ──────

function extractFrontmatter(raw: string): string[] | null {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return null;
  return lines.slice(1, end);
}

function parseFrontmatterState(raw: string): ParsedProjectState | null {
  const fm = extractFrontmatter(raw);
  if (!fm) return null;

  const milestoneNameLine = fm.find((l) => /^milestone_name:\s*/.test(l));
  const milestoneLine = fm.find((l) => /^milestone:\s*/.test(l));
  const phaseLine = milestoneNameLine ?? milestoneLine;
  if (!phaseLine) return null; // not this format after all

  const phase = stripQuotes(phaseLine.replace(/^milestone(?:_name)?:\s*/, ''));

  // `progress:` is a nested block (2-space indented keys); `percent:` is a
  // bare number 0-100. Only look INSIDE that block, not anywhere in the file.
  const progressIdx = fm.findIndex((l) => /^progress:\s*$/.test(l));
  let progress: number | null = null;
  if (progressIdx !== -1) {
    for (let i = progressIdx + 1; i < fm.length; i++) {
      if (!/^\s/.test(fm[i])) break; // dedented back out of the block
      const m = /^\s{2}percent:\s*(\d+(?:\.\d+)?)\s*$/.exec(fm[i]);
      if (m) {
        progress = Math.min(1, Math.max(0, Number(m[1]) / 100));
        break;
      }
    }
  }

  const lastUpdatedLine = fm.find((l) => /^last_updated:\s*/.test(l));
  const lastActivity = lastUpdatedLine
    ? stripQuotes(lastUpdatedLine.replace(/^last_updated:\s*/, '')) || null
    : null;

  return { phase: phase || null, progress, lastActivity };
}

// ── Strategy 2: table ledger (war-room .planning/v4/STATE-v4.md shape) ──

function parseTableLedgerState(raw: string): ParsedProjectState | null {
  const lines = raw.split('\n');
  const statusLine = lines.find((l) => /^status:\s*\S/.test(l));
  if (!statusLine) return null; // not this format

  const phase =
    statusLine
      .replace(/^status:\s*/, '')
      .replace(/<!--.*-->/, '')
      .trim() || null;

  // Markdown table rows: "| # | Item | Status | Evidence |" style, one
  // header row + one "---" separator row, then data rows. We only need the
  // Status column (find it by header text once, then read the same
  // pipe-index on every data row).
  const tableStart = lines.findIndex((l) => /^\|.*\bStatus\b.*\|$/.test(l.trim()));
  let done = 0;
  let total = 0;
  if (tableStart !== -1) {
    const headerCells = splitTableRow(lines[tableStart]);
    const statusCol = headerCells.findIndex((c) => /^status$/i.test(c.trim()));
    if (statusCol !== -1) {
      for (let i = tableStart + 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim().startsWith('|')) break; // table ended
        const cells = splitTableRow(line);
        const cell = cells[statusCol];
        if (cell === undefined) continue;
        total++;
        if (/^done\b/i.test(cell.trim())) done++;
      }
    }
  }
  const progress = total > 0 ? done / total : null;

  // "## Log" section, first bullet's leading ISO timestamp (log is
  // newest-first per STATE-v4.md's own header comment).
  const logIdx = lines.findIndex((l) => /^##\s+Log\s*$/i.test(l.trim()));
  let lastActivity: string | null = null;
  if (logIdx !== -1) {
    for (let i = logIdx + 1; i < lines.length; i++) {
      const m = /^-\s*(\d{4}-\d{2}-\d{2}T[\d:]+Z)/.exec(lines[i]);
      if (m) {
        lastActivity = m[1];
        break;
      }
    }
  }

  return { phase, progress, lastActivity };
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|');
}

// ── Strategy 3: checkbox milestones (war-room v0 STATE.md shape) ───────

function parseCheckboxState(raw: string): ParsedProjectState | null {
  const lines = raw.split('\n');
  const checkboxRe = /^\s*-\s*\[( |x|X)\]\s*(?:\*\*)?(.*)$/;
  const matches = lines
    .map((l) => checkboxRe.exec(l))
    .filter((m): m is RegExpExecArray => m !== null);
  if (matches.length === 0) return null; // not this format

  const done = matches.filter((m) => m[1].toLowerCase() === 'x').length;
  const progress = done / matches.length;

  // Phase = the last checked item's label if any are checked (most-recent
  // completed milestone), else the first unchecked item (what's next).
  const lastDone = [...matches].reverse().find((m) => m[1].toLowerCase() === 'x');
  const firstPending = matches.find((m) => m[1] === ' ');
  const source = lastDone ?? firstPending;
  const phase = source ? cleanMilestoneLabel(source[2]) : null;

  // No log section in this format — honestly null rather than guessing
  // from file mtime (a caller-level concern, not this parser's).
  return { phase, progress, lastActivity: null };
}

/** Strip markdown bold markers and cut at the first '.' sentence boundary
 *  so a whole paragraph-style checkbox line collapses to a short label. */
function cleanMilestoneLabel(text: string): string {
  const stripped = text.replace(/\*\*/g, '').trim();
  const cut = stripped.indexOf('.');
  const short = (cut === -1 ? stripped : stripped.slice(0, cut)).trim();
  return short || stripped;
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}
