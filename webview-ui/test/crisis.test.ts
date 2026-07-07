/**
 * Unit tests for the crisis & triage layer (crisis.ts, v1 mechanic #1).
 *
 * Under test: stage aging (smoke → fire → alarm), the per-agent crisis state
 * machine (ignite / keep earliest anchor / resolve / debris spawn+clear),
 * triage ordering (age × severity), and age formatting.
 */

import { describe, expect, it } from 'vitest';

import { AgentVisualState } from '../src/office/agentState.js';
import {
  ALARM_AT_MS,
  buildTriageRows,
  computeCrisisUpdate,
  CRISIS_STAGE_SPECS,
  CrisisStage,
  debrisKey,
  type DebrisRecord,
  FIRE_AT_MS,
  formatAge,
  SEVERITY_WEIGHTS,
  stageForAge,
} from '../src/office/crisis.js';

const NOW = 10_000_000;

describe('stageForAge', () => {
  it('ages smoke → fire → alarm at the documented thresholds', () => {
    expect(stageForAge(0)).toBe(CrisisStage.SMOKE);
    expect(stageForAge(FIRE_AT_MS - 1)).toBe(CrisisStage.SMOKE);
    expect(stageForAge(FIRE_AT_MS)).toBe(CrisisStage.FIRE);
    expect(stageForAge(ALARM_AT_MS - 1)).toBe(CrisisStage.FIRE);
    expect(stageForAge(ALARM_AT_MS)).toBe(CrisisStage.ALARM);
  });

  it('every stage has a distinct glyph and label (shape+text, never a tint)', () => {
    const glyphs = new Set(Object.values(CRISIS_STAGE_SPECS).map((s) => s.glyph));
    const labels = new Set(Object.values(CRISIS_STAGE_SPECS).map((s) => s.label));
    expect(glyphs.size).toBe(3);
    expect(labels.size).toBe(3);
    // ALARM is the loud stage (inverted white, house "loudest" pattern)
    expect(CRISIS_STAGE_SPECS[CrisisStage.ALARM].loud).toBe(true);
  });
});

describe('computeCrisisUpdate — the per-agent state machine', () => {
  it('ignites on needs-input using the server anchor when provided', () => {
    const r = computeCrisisUpdate({
      vState: AgentVisualState.NEEDS_INPUT,
      pollSince: NOW - 30_000,
      now: NOW,
    });
    expect(r.crisis).toEqual({ since: NOW - 30_000 });
    expect(r.resolved).toBe(false);
  });

  it('ignites from client first-seen when there is no poll anchor (local permission)', () => {
    const r = computeCrisisUpdate({ vState: AgentVisualState.NEEDS_INPUT, now: NOW });
    expect(r.crisis).toEqual({ since: NOW });
  });

  it('keeps the EARLIEST honest anchor while burning (a late rebroadcast must not reset the fire)', () => {
    const burning = computeCrisisUpdate({
      vState: AgentVisualState.NEEDS_INPUT,
      prevVState: AgentVisualState.NEEDS_INPUT,
      prevCrisis: { since: NOW - 200_000 },
      pollSince: NOW - 50_000, // later than the existing anchor
      now: NOW,
    });
    expect(burning.crisis).toEqual({ since: NOW - 200_000 });
    // …but a server anchor EARLIER than first-seen improves the record
    const improved = computeCrisisUpdate({
      vState: AgentVisualState.NEEDS_INPUT,
      prevVState: AgentVisualState.NEEDS_INPUT,
      prevCrisis: { since: NOW - 10_000 },
      pollSince: NOW - 120_000,
      now: NOW,
    });
    expect(improved.crisis).toEqual({ since: NOW - 120_000 });
  });

  it('resolves when the blocked state ends (fire out, calm feedback)', () => {
    const r = computeCrisisUpdate({
      vState: AgentVisualState.WORKING,
      prevVState: AgentVisualState.NEEDS_INPUT,
      prevCrisis: { since: NOW - 60_000 },
      now: NOW,
    });
    expect(r.crisis).toBeUndefined();
    expect(r.resolved).toBe(true);
  });

  it('spawns debris exactly on the transition into failed/stopped', () => {
    const failed = computeCrisisUpdate({
      vState: AgentVisualState.FAILED,
      prevVState: AgentVisualState.WORKING,
      now: NOW,
    });
    expect(failed.spawnDebris).toBe('failed');
    // staying failed does NOT respawn
    const still = computeCrisisUpdate({
      vState: AgentVisualState.FAILED,
      prevVState: AgentVisualState.FAILED,
      now: NOW,
    });
    expect(still.spawnDebris).toBeUndefined();
    const stopped = computeCrisisUpdate({
      vState: AgentVisualState.STOPPED,
      prevVState: AgentVisualState.IDLE,
      now: NOW,
    });
    expect(stopped.spawnDebris).toBe('stopped');
  });

  it('a fire that turns into failure both resolves and leaves debris', () => {
    const r = computeCrisisUpdate({
      vState: AgentVisualState.FAILED,
      prevVState: AgentVisualState.NEEDS_INPUT,
      prevCrisis: { since: NOW - 60_000 },
      now: NOW,
    });
    expect(r.resolved).toBe(true);
    expect(r.spawnDebris).toBe('failed');
  });

  it('clears debris when the agent recovers (wreck cleaned itself up)', () => {
    const r = computeCrisisUpdate({
      vState: AgentVisualState.WORKING,
      prevVState: AgentVisualState.FAILED,
      now: NOW,
    });
    expect(r.clearDebris).toBe(true);
  });
});

describe('buildTriageRows — age × severity ordering', () => {
  const debris = (agentId: number, kind: 'failed' | 'stopped', since: number): DebrisRecord => ({
    key: debrisKey(agentId, kind),
    agentId,
    kind,
    label: `#${agentId} [MINI] repo`,
    x: 0,
    y: 0,
    since,
  });

  it('orders by score descending; blocked outweighs debris of the same age', () => {
    const rows = buildTriageRows(
      [{ agentId: 1, since: NOW - 60_000, identity: '#1 [MACBOOK] vault' }],
      [debris(2, 'failed', NOW - 60_000), debris(3, 'stopped', NOW - 60_000)],
      NOW,
    );
    expect(rows.map((r) => r.rowKey)).toEqual(['fire:1', 'debris:2:failed', 'debris:3:stopped']);
    expect(rows[0].score).toBe(SEVERITY_WEIGHTS.blocked * 60_000);
  });

  it('an old low-severity item outranks a brand-new fire (age matters)', () => {
    const rows = buildTriageRows(
      [{ agentId: 1, since: NOW - 1_000, identity: '#1' }],
      [debris(2, 'stopped', NOW - 3_600_000)],
      NOW,
    );
    expect(rows[0].rowKey).toBe('debris:2:stopped');
  });

  it('fire rows carry stage + waitingFor cause; debris rows carry an ACK key', () => {
    const rows = buildTriageRows(
      [
        {
          agentId: 5,
          since: NOW - ALARM_AT_MS - 1,
          identity: '#5 [MINI] turffinder',
          cause: 'Permission: Bash(supabase db push)',
        },
      ],
      [debris(6, 'failed', NOW - 10_000)],
      NOW,
    );
    const fire = rows.find((r) => r.rowKey === 'fire:5')!;
    expect(fire.stage).toBe(CrisisStage.ALARM);
    expect(fire.loud).toBe(true);
    expect(fire.cause).toBe('Permission: Bash(supabase db push)');
    expect(fire.debrisKey).toBeUndefined();
    const deb = rows.find((r) => r.rowKey === 'debris:6:failed')!;
    expect(deb.debrisKey).toBe('6:failed');
    expect(deb.glyph).toBe('✗');
    expect(deb.word).toBe('DEBRIS');
    expect(deb.cause).toBe('Session failed');
  });

  it('falls back to a generic TEXT cause when the poller gave no waitingFor', () => {
    const rows = buildTriageRows([{ agentId: 7, since: NOW, identity: '#7' }], [], NOW);
    expect(rows[0].cause).toBe('Blocked — needs input');
  });
});

describe('formatAge', () => {
  it('formats m:ss under an hour, h:mm above', () => {
    expect(formatAge(0)).toBe('0:00');
    expect(formatAge(59_000)).toBe('0:59');
    expect(formatAge(161_000)).toBe('2:41');
    expect(formatAge(3_600_000)).toBe('1h00');
    expect(formatAge(3_840_000)).toBe('1h04');
    expect(formatAge(-5)).toBe('0:00');
  });
});
