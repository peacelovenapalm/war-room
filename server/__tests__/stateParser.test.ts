/**
 * stateParser tests (Phase 5 Lane C, T7/D-35 districts) — fixtures modeled
 * directly on the two REAL STATE.md files read during design (war-room's
 * own .planning/v4/STATE-v4.md and two-wheel-events's .planning/STATE.md),
 * plus the legacy war-room v0 checkbox shape and the honest-null cases.
 */

import { describe, expect, it } from 'vitest';

import { parseProjectState } from '../src/stateParser.js';

describe('parseProjectState', () => {
  it('unrecognized content -> every field null, never a throw', () => {
    expect(parseProjectState('just some prose\nwith no structure at all')).toEqual({
      phase: null,
      progress: null,
      lastActivity: null,
    });
  });

  it('empty file -> every field null', () => {
    expect(parseProjectState('')).toEqual({ phase: null, progress: null, lastActivity: null });
  });

  describe('strategy 1: GSD frontmatter (two-wheel-events shape)', () => {
    const fixture = `---
gsd_state_version: 1.0
milestone: v6.0
milestone_name: Sale Readiness
status: "some long status blob"
last_updated: "2026-07-08"
progress:
  total_phases: 9
  completed_phases: 4
  total_plans: 0
  completed_plans: 0
  percent: 44
  note: "some note"
---

# Project State
body content here
`;

    it('extracts milestone_name as phase, progress/100 as fraction, last_updated as lastActivity', () => {
      expect(parseProjectState(fixture)).toEqual({
        phase: 'Sale Readiness',
        progress: 0.44,
        lastActivity: '2026-07-08',
      });
    });

    it('falls back to milestone: when milestone_name: is absent', () => {
      const noName = `---
milestone: v6.0
progress:
  percent: 10
---
`;
      expect(parseProjectState(noName)).toEqual({
        phase: 'v6.0',
        progress: 0.1,
        lastActivity: null,
      });
    });

    it('clamps an out-of-range percent into [0,1]', () => {
      const overshoot = `---
milestone_name: X
progress:
  percent: 150
---
`;
      expect(parseProjectState(overshoot).progress).toBe(1);
    });

    it('no progress block -> progress null, phase still extracted', () => {
      const noProgress = `---
milestone_name: X
---
`;
      expect(parseProjectState(noProgress)).toEqual({
        phase: 'X',
        progress: null,
        lastActivity: null,
      });
    });
  });

  describe('strategy 2: table ledger (war-room STATE-v4.md shape)', () => {
    const fixture = `# STATE v4 — run ledger

status: RUN COMPLETE <!-- IN PROGRESS | RUN COMPLETE | BLOCKED-AWAITING-GREG -->

## Items

| #   | Item                     | Status                          | Evidence |
| --- | ------------------------ | -------------------------------- | -------- |
| 0.1 | Ledger + gate re-derive  | done (gate green)                | evidence one |
| 1.1 | T1 server ingest         | done (orchestrator-verified)     | evidence two |
| 4.x | T6/T7 riders             | pending                          |          |
| G-2 | GREG GATE — deploy       | pending                          |          |

## Log

- 2026-07-12T07:15:00Z — PHASE 4 COMPLETE + DEPLOYED.
- 2026-07-12T06:55:00Z — PHASE 4 PROGRESS.
`;

    it('extracts the status line as phase', () => {
      expect(parseProjectState(fixture).phase).toBe('RUN COMPLETE');
    });

    it('computes progress as done-rows / total-rows', () => {
      expect(parseProjectState(fixture).progress).toBe(0.5);
    });

    it('extracts the first (newest) Log timestamp as lastActivity', () => {
      expect(parseProjectState(fixture).lastActivity).toBe('2026-07-12T07:15:00Z');
    });

    it('status line with no table -> phase set, progress null (no rows to count)', () => {
      const noTable = `status: BLOCKED-AWAITING-GREG\n\nSome prose, no table here.\n`;
      expect(parseProjectState(noTable)).toEqual({
        phase: 'BLOCKED-AWAITING-GREG',
        progress: null,
        lastActivity: null,
      });
    });
  });

  describe('strategy 3: checkbox milestones (war-room v0 STATE.md shape)', () => {
    const fixture = `# STATE — War Room v0

## Milestones

- [x] **M0 Bootstrap.** Fork cloned, standalone CLI built and run locally.
- [x] **M1 Decapitate.** Standalone server + static browser build.
- [ ] **M2 Second machine over Tailscale.** Gated runbooks, not run.
- [ ] **M3 Colorblind pass.** Not started.
`;

    it('computes progress as checked / total', () => {
      expect(parseProjectState(fixture).progress).toBe(0.5);
    });

    it('phase = the last checked milestone label when any are checked', () => {
      expect(parseProjectState(fixture).phase).toBe('M1 Decapitate');
    });

    it('lastActivity is honestly null (no log section in this format)', () => {
      expect(parseProjectState(fixture).lastActivity).toBeNull();
    });

    it('all-unchecked -> phase = first pending item', () => {
      const allPending = `- [ ] **M0 Bootstrap.** Not started yet.\n- [ ] **M1 Next.** Also not started.\n`;
      expect(parseProjectState(allPending).phase).toBe('M0 Bootstrap');
      expect(parseProjectState(allPending).progress).toBe(0);
    });
  });
});
