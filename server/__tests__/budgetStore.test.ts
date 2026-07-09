/**
 * Unit tests for the budget guardrail store (v2 mechanic G3,
 * GAME-DESIGN.md §7.4). Covers: fail-safe stale-snapshot pause (including
 * the exact BUDGET_STALE_MS+1 / boundary-at-threshold cases), the 70/80
 * base thresholds and the Night Shift Foreman 80/88 raise, the hard
 * ceilings never moving past 95/95, and the Codex weekly-cap heuristic
 * (est.-prefixed, never the bare % the Claude meter gets).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BUDGET_PAUSE_5H_PCT_BASE,
  BUDGET_PAUSE_5H_PCT_FOREMAN,
  BUDGET_PAUSE_7D_PCT_BASE,
  BUDGET_PAUSE_HARD_CEILING_5H,
  BUDGET_STALE_MS,
  BudgetStore,
  budgetStore,
} from '../src/budgetStore.js';

let vitestGuardHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => vitestGuardHome };
});

let tmpDir: string;
let statePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-store-'));
  statePath = path.join(tmpDir, 'budget.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const T0 = new Date(2026, 6, 7, 12, 0, 0).getTime();

describe('BudgetStore — fail-safe stale-snapshot pause', () => {
  it('pauses with stale-snapshot when no report has ever been received', () => {
    const s = new BudgetStore(statePath);
    const result = s.isAutomationPaused('claude', {}, T0);
    expect(result).toEqual({ paused: true, reason: 'stale-snapshot' });
  });

  it('pauses at exactly BUDGET_STALE_MS since the last report (boundary, >= pauses)', () => {
    const s = new BudgetStore(statePath);
    s.reportClaudeSnapshot({ five_hour: { used_percentage: 10 } }, T0);
    const result = s.isAutomationPaused('claude', {}, T0 + BUDGET_STALE_MS);
    expect(result).toEqual({ paused: true, reason: 'stale-snapshot' });
  });

  it('does NOT pause for staleness one ms before the boundary', () => {
    const s = new BudgetStore(statePath);
    s.reportClaudeSnapshot(
      { five_hour: { used_percentage: 10 }, seven_day: { used_percentage: 10 } },
      T0,
    );
    const result = s.isAutomationPaused('claude', {}, T0 + BUDGET_STALE_MS - 1);
    expect(result).toEqual({ paused: false });
  });

  it('pauses again once a fresh report goes stale (BUDGET_STALE_MS+1 old)', () => {
    const s = new BudgetStore(statePath);
    s.reportClaudeSnapshot({ five_hour: { used_percentage: 10 } }, T0);
    const result = s.isAutomationPaused('claude', {}, T0 + BUDGET_STALE_MS + 1);
    expect(result).toEqual({ paused: true, reason: 'stale-snapshot' });
  });
});

describe('BudgetStore — 5h/7d thresholds', () => {
  it('does not pause below the base 70/80 thresholds', () => {
    const s = new BudgetStore(statePath);
    s.reportClaudeSnapshot(
      { five_hour: { used_percentage: 69 }, seven_day: { used_percentage: 79 } },
      T0,
    );
    expect(s.isAutomationPaused('claude', {}, T0)).toEqual({ paused: false });
  });

  it(`pauses at the base 5h threshold (${BUDGET_PAUSE_5H_PCT_BASE}%)`, () => {
    const s = new BudgetStore(statePath);
    s.reportClaudeSnapshot({ five_hour: { used_percentage: BUDGET_PAUSE_5H_PCT_BASE } }, T0);
    expect(s.isAutomationPaused('claude', {}, T0)).toEqual({
      paused: true,
      reason: '5h-threshold',
    });
  });

  it(`pauses at the base 7d threshold (${BUDGET_PAUSE_7D_PCT_BASE}%)`, () => {
    const s = new BudgetStore(statePath);
    s.reportClaudeSnapshot(
      {
        five_hour: { used_percentage: 0 },
        seven_day: { used_percentage: BUDGET_PAUSE_7D_PCT_BASE },
      },
      T0,
    );
    expect(s.isAutomationPaused('claude', {}, T0)).toEqual({
      paused: true,
      reason: '7d-threshold',
    });
  });

  it('Night Shift Foreman raises the base threshold to 80/88 — 72% no longer pauses', () => {
    const s = new BudgetStore(statePath);
    s.reportClaudeSnapshot({ five_hour: { used_percentage: 72 } }, T0);
    expect(s.isAutomationPaused('claude', { nightShiftForeman: true }, T0)).toEqual({
      paused: false,
    });
    expect(s.isAutomationPaused('claude', {}, T0)).toEqual({
      paused: true,
      reason: '5h-threshold',
    });
  });

  it('the hard ceiling (95%) pauses even with Night Shift Foreman owned', () => {
    const s = new BudgetStore(statePath);
    s.reportClaudeSnapshot({ five_hour: { used_percentage: BUDGET_PAUSE_HARD_CEILING_5H } }, T0);
    expect(s.isAutomationPaused('claude', { nightShiftForeman: true }, T0)).toEqual({
      paused: true,
      reason: '5h-threshold',
    });
  });
});

describe('BudgetStore — Codex weekly-cap heuristic', () => {
  it('never pauses codex when no cap has been configured', () => {
    const s = new BudgetStore(statePath);
    expect(s.isAutomationPaused('codex', {}, T0)).toEqual({ paused: false });
  });

  it('pauses codex once weeklyUsed reaches the configured cap', () => {
    const s = new BudgetStore(statePath);
    s.setCodexWeeklyCap(3, T0);
    s.recordCodexDispatchExit(T0);
    s.recordCodexDispatchExit(T0);
    expect(s.isAutomationPaused('codex', {}, T0)).toEqual({ paused: false });
    s.recordCodexDispatchExit(T0);
    expect(s.isAutomationPaused('codex', {}, T0)).toEqual({
      paused: true,
      reason: 'codex-cap-reached',
    });
  });

  it('the codex snapshot is rendered with an est. prefix, never the bare % the Claude meter gets', () => {
    const s = new BudgetStore(statePath);
    s.setCodexWeeklyCap(4, T0);
    s.recordCodexDispatchExit(T0);
    const snapshot = s.getSnapshot(T0);
    expect(snapshot.codex.estimatedPct).toBe(25);
    expect(snapshot.claude.fiveHourUsedPct).toBeNull(); // never reported — honestly null, not 0
  });

  it('resets the weekly counter at the Monday 00:00 local boundary', () => {
    const s = new BudgetStore(statePath);
    s.setCodexWeeklyCap(1, T0);
    s.recordCodexDispatchExit(T0);
    expect(s.isAutomationPaused('codex', {}, T0)).toEqual({
      paused: true,
      reason: 'codex-cap-reached',
    });
    const nextWeek = T0 + 7 * 86_400_000;
    expect(s.isAutomationPaused('codex', {}, nextWeek)).toEqual({ paused: false });
  });
});

describe('BudgetStore VITEST guard (cloned from economyStore.test.ts pattern)', () => {
  beforeEach(() => {
    vitestGuardHome = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-store-vitest-guard-'));
  });

  it('never writes the real default sidecar path under VITEST, even via the process-wide singleton', () => {
    budgetStore.reportClaudeSnapshot({ five_hour: { used_percentage: 1 } }, T0);
    const expectedPath = path.join(vitestGuardHome, '.pixel-agents', 'budget.json');
    expect(fs.existsSync(expectedPath)).toBe(false);
  });
});
