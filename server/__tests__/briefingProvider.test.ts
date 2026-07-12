/**
 * Unit tests for the post-v0 briefing provider: two tolerant parsers
 * (todo-compiler markdown, tracker STATE.md) plus the env-wired, cached
 * getBriefing() entry point. Fixtures below are representative excerpts of
 * the real formats (todo-compiler daily output, gsd-state STATE.md) -- not
 * copies of any specific project's file, and the code never references a
 * concrete path; both sources are env-var wired.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearBriefingCache,
  getBriefing,
  parseDigestMarkdown,
  parseTodoMarkdown,
  parseTrackerState,
} from '../src/briefingProvider.js';

const TODO_FIXTURE = `---
title: todo 2026-07-06
type: worklog
---

# Today — 2026-07-06

## Start now (max 3)

1. **Check the Vercel account for the billing block** — it's the single remaining item (32/32 reqs done). Open 4 days. (source: \`project-pulse\` 2026-07-06; \`Projects/Current/Diablito/STATE.md\`)
2. One-click merge [TWE PR #46](https://example.com/pr/46) — no build work left, just the click. (source: \`Maps/TWE MOC.md\`)
3. Pick the AMC site host — closes Gate A, a plain decision with no build work attached.

## Full list

### Blocked / stalled
- [ ] Diablito — clear the Vercel billing block ⚠ blocked
- [ ] AMC — work Gate B ⚠ blocked
- [ ] ecliptic-lunar — no STATE.md, open 28d ⚠ blocked

### Aging (oldest first)
- [ ] refresh-mocs README missing frontmatter ◷ aging
- [ ] Oldest proposed-plans batch ◷ aging

### Quick wins
- [ ] Career MOC — author the Thales note ✦ quick-win
`;

const TRACKER_FIXTURE = `---
gsd_state_version: 1.0
milestone: completion-2026-07
milestone_name: Half-Baked Project Close-Out
status: in-progress
gates:
  - id: closed-since-audit
    label: "Closed since the 2026-06-29 audit (verified)"
    status: DONE
    tasks:
      - { id: closed-notifier, title: "Notifier watchdog fixed", status: DONE, blocking: true, how: "..." }
      - { id: closed-mocs, title: "refresh-mocs merged", status: DONE, blocking: true, how: "..." }
  - id: dispatch-zombie
    label: "Kill the DISPATCH zombie"
    status: IN_PROGRESS
    blocker: "durable n8n UI archive remains"
    tasks:
      - { id: dispatch-decide, title: "Confirm kill decision", status: DONE, blocking: true, how: "..." }
      - { id: dispatch-n8n, title: "Archive DISPATCH n8n workflows", status: IN_PROGRESS, blocking: false, how: "..." }
      - { id: dispatch-scratch, title: "Tidy loose scratch JSON", status: TODO, blocking: false, how: "..." }
  - id: safety-hooks
    label: "Safety hooks"
    status: BLOCKED
    tasks:
      - { id: sh-pretool, title: "Fix pre-tool-safety.sh", status: IN_PROGRESS, blocking: true, how: "..." }
---

# State
`;

describe('parseTodoMarkdown', () => {
  it('extracts plain-text Start now items with markdown noise stripped', () => {
    const result = parseTodoMarkdown(TODO_FIXTURE, '2026-07-06');
    expect(result.date).toBe('2026-07-06');
    expect(result.startNow).toEqual([
      "Check the Vercel account for the billing block — it's the single remaining item (32/32 reqs done). Open 4 days.",
      'One-click merge TWE PR #46 — no build work left, just the click.',
      'Pick the AMC site host — closes Gate A, a plain decision with no build work attached.',
    ]);
  });

  it('counts "- [ ]" items per own-section body, not nested subsections', () => {
    const result = parseTodoMarkdown(TODO_FIXTURE, '2026-07-06');
    const byTitle = Object.fromEntries(result.sections.map((s) => [s.title, s.count]));
    expect(byTitle['Full list']).toBe(0); // heading has no direct items, only subsections
    expect(byTitle['Blocked / stalled']).toBe(3);
    expect(byTitle['Aging (oldest first)']).toBe(2);
    expect(byTitle['Quick wins']).toBe(1);
  });

  it('never throws on empty or headerless input', () => {
    expect(parseTodoMarkdown('', '2026-01-01')).toEqual({
      date: '2026-01-01',
      startNow: [],
      sections: [],
    });
    expect(parseTodoMarkdown('just some text, no headings at all', '2026-01-01').sections).toEqual(
      [],
    );
  });

  it('tolerates a malformed Start now section (no numbered items)', () => {
    const md = `## Start now\n\n- not numbered\n\n## Other\n- [ ] x\n`;
    const result = parseTodoMarkdown(md, '2026-01-01');
    expect(result.startNow).toEqual([]);
    expect(result.sections).toEqual([{ title: 'Other', count: 1 }]);
  });
});

describe('parseTrackerState', () => {
  it('extracts milestone name and per-gate status/tallies', () => {
    const result = parseTrackerState(TRACKER_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.milestone).toBe('Half-Baked Project Close-Out');
    expect(result!.gates).toEqual([
      {
        id: 'closed-since-audit',
        label: 'Closed since the 2026-06-29 audit (verified)',
        status: 'DONE',
        done: 2,
        total: 2,
      },
      {
        id: 'dispatch-zombie',
        label: 'Kill the DISPATCH zombie',
        status: 'IN_PROGRESS',
        done: 1,
        total: 3,
      },
      {
        id: 'safety-hooks',
        label: 'Safety hooks',
        status: 'BLOCKED',
        done: 0,
        total: 1,
      },
    ]);
  });

  it('returns null when there is no YAML frontmatter block at all', () => {
    expect(parseTrackerState('# just a heading\nno frontmatter here\n')).toBeNull();
    expect(parseTrackerState('')).toBeNull();
    expect(parseTrackerState('---\nonly one delimiter\n')).toBeNull();
  });

  it('tolerates missing milestone_name and an empty gates list', () => {
    const md = `---\nstatus: in-progress\n---\n# State\n`;
    const result = parseTrackerState(md);
    expect(result).toEqual({ milestone: null, gates: [] });
  });

  it('defaults a gate with no own status line to TODO', () => {
    const md = `---\nmilestone_name: X\ngates:\n  - id: g1\n    label: "No status line"\n    tasks:\n      - { id: t1, status: TODO }\n---\n`;
    const result = parseTrackerState(md);
    expect(result!.gates[0]).toEqual({
      id: 'g1',
      label: 'No status line',
      status: 'TODO',
      done: 0,
      total: 1,
    });
  });
});

describe('parseDigestMarkdown', () => {
  const DIGEST_FIXTURE = `---
title: daily digest 2026-07-11
routine: daily-digest
---

# Daily digest — 2026-07-11

## Morning flags (from today's flag routines)
- vault-health: 4 issues (Δ +0/-0, no change since 07-10) · project-pulse: 4 flagged (Δ none) · docs-tracker: 9 flagged (Δ +0/-0, no change since 07-10)

## Standing flags (top 10 by age)
- \`ecliptic-lunar\` — missing-state — open 33d (project-pulse)
- \`Projects/Current/two-wheel-events/\` — stale-siblings — open 31d (docs-tracker)
- \`_meta/MOC Template.md\` — stale-siblings — open 31d (docs-tracker)
- \`_meta/Vault Design v2.md\` — stale-siblings — open 31d (docs-tracker)

## ✓ Cleared since yesterday
- nothing
`;

  it('extracts the morning-flags summary line and top 3 standing flags', () => {
    const result = parseDigestMarkdown(DIGEST_FIXTURE, '2026-07-11');
    expect(result.date).toBe('2026-07-11');
    expect(result.flagsSummary).toBe(
      'vault-health: 4 issues (Δ +0/-0, no change since 07-10) · project-pulse: 4 flagged (Δ none) · docs-tracker: 9 flagged (Δ +0/-0, no change since 07-10)',
    );
    expect(result.topStandingFlags).toEqual([
      'ecliptic-lunar — missing-state — open 33d (project-pulse)',
      'Projects/Current/two-wheel-events/ — stale-siblings — open 31d (docs-tracker)',
      '_meta/MOC Template.md — stale-siblings — open 31d (docs-tracker)',
    ]);
  });

  it('never throws on empty or headerless input', () => {
    expect(parseDigestMarkdown('', '2026-01-01')).toEqual({
      date: '2026-01-01',
      flagsSummary: '',
      topStandingFlags: [],
    });
  });
});

describe('getBriefing (env-wired, cached)', () => {
  let tmpDir: string;
  const originalTodoDir = process.env['WAR_ROOM_TODO_DIR'];
  const originalTrackerState = process.env['WAR_ROOM_TRACKER_STATE'];
  const originalRoutinesDir = process.env['WAR_ROOM_ROUTINES_DIR'];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'war-room-briefing-test-'));
    clearBriefingCache();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalTodoDir === undefined) delete process.env['WAR_ROOM_TODO_DIR'];
    else process.env['WAR_ROOM_TODO_DIR'] = originalTodoDir;
    if (originalTrackerState === undefined) delete process.env['WAR_ROOM_TRACKER_STATE'];
    else process.env['WAR_ROOM_TRACKER_STATE'] = originalTrackerState;
    if (originalRoutinesDir === undefined) delete process.env['WAR_ROOM_ROUTINES_DIR'];
    else process.env['WAR_ROOM_ROUTINES_DIR'] = originalRoutinesDir;
    clearBriefingCache();
  });

  it('returns all three parts null when no env var is set', () => {
    delete process.env['WAR_ROOM_TODO_DIR'];
    delete process.env['WAR_ROOM_TRACKER_STATE'];
    delete process.env['WAR_ROOM_ROUTINES_DIR'];
    const briefing = getBriefing();
    expect(briefing.todo).toBeNull();
    expect(briefing.tracker).toBeNull();
    expect(briefing.digest).toBeNull();
    expect(typeof briefing.generatedAt).toBe('string');
    expect(new Date(briefing.generatedAt).toString()).not.toBe('Invalid Date');
  });

  it('picks the lexicographically-latest YYYY-MM-DD-digest.md file under routines/summary', () => {
    const summaryDir = path.join(tmpDir, 'summary');
    fs.mkdirSync(summaryDir);
    fs.writeFileSync(
      path.join(summaryDir, '2026-07-10-digest.md'),
      '## Morning flags\n- old summary\n',
    );
    fs.writeFileSync(
      path.join(summaryDir, '2026-07-11-digest.md'),
      '## Morning flags\n- newest summary\n',
    );
    process.env['WAR_ROOM_ROUTINES_DIR'] = tmpDir;

    const briefing = getBriefing();
    expect(briefing.digest).not.toBeNull();
    expect(briefing.digest!.date).toBe('2026-07-11');
    expect(briefing.digest!.flagsSummary).toBe('newest summary');
  });

  it('never crashes when WAR_ROOM_ROUTINES_DIR has no summary subdir', () => {
    process.env['WAR_ROOM_ROUTINES_DIR'] = tmpDir; // empty dir, no summary/
    expect(getBriefing().digest).toBeNull();
  });

  it('picks the lexicographically-latest YYYY-MM-DD.md file and returns null for a missing tracker file', () => {
    fs.writeFileSync(path.join(tmpDir, '2026-07-04.md'), '## Start now\n1. old item\n');
    fs.writeFileSync(path.join(tmpDir, '2026-07-06.md'), '## Start now\n1. newest item\n');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'not a dated file');
    process.env['WAR_ROOM_TODO_DIR'] = tmpDir;
    process.env['WAR_ROOM_TRACKER_STATE'] = path.join(tmpDir, 'does-not-exist.md');

    const briefing = getBriefing();
    expect(briefing.todo).not.toBeNull();
    expect(briefing.todo!.date).toBe('2026-07-06');
    expect(briefing.todo!.startNow).toEqual(['newest item']);
    expect(briefing.tracker).toBeNull();
  });

  it('never crashes on a directory with no dated files', () => {
    process.env['WAR_ROOM_TODO_DIR'] = tmpDir; // empty dir
    delete process.env['WAR_ROOM_TRACKER_STATE'];
    expect(getBriefing().todo).toBeNull();
  });

  it('never crashes when WAR_ROOM_TODO_DIR points at a nonexistent directory', () => {
    process.env['WAR_ROOM_TODO_DIR'] = path.join(tmpDir, 'nope');
    delete process.env['WAR_ROOM_TRACKER_STATE'];
    expect(getBriefing().todo).toBeNull();
  });

  it('serves from cache within the TTL and recomputes after clearBriefingCache()', () => {
    fs.writeFileSync(path.join(tmpDir, '2026-07-06.md'), '## Start now\n1. first\n');
    process.env['WAR_ROOM_TODO_DIR'] = tmpDir;
    delete process.env['WAR_ROOM_TRACKER_STATE'];

    const first = getBriefing(1_000);
    fs.writeFileSync(path.join(tmpDir, '2026-07-06.md'), '## Start now\n1. changed\n');
    const stillCached = getBriefing(1_000 + 30_000); // within 60s TTL
    expect(stillCached.todo!.startNow).toEqual(first.todo!.startNow);

    clearBriefingCache();
    const recomputed = getBriefing(1_000 + 30_000);
    expect(recomputed.todo!.startNow).toEqual(['changed']);
  });
});
