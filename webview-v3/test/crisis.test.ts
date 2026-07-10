import { describe, expect, it } from 'vitest';

import {
  ALARM_AT_MS,
  buildTriageRows,
  escalationForecast,
  FIRE_AT_MS,
  formatAge,
  stageForAge,
} from '../src/state/crisis';

const NOW = 10_000_000;

describe('stageForAge', () => {
  it('smoke → fire → alarm at the real thresholds', () => {
    expect(stageForAge(0)).toBe('smoke');
    expect(stageForAge(FIRE_AT_MS - 1)).toBe('smoke');
    expect(stageForAge(FIRE_AT_MS)).toBe('fire');
    expect(stageForAge(ALARM_AT_MS - 1)).toBe('fire');
    expect(stageForAge(ALARM_AT_MS)).toBe('alarm');
  });
});

describe('escalationForecast', () => {
  it('names the NEXT stage and its threshold', () => {
    expect(escalationForecast('smoke')).toBe('→ ▲ FIRE at 1:30');
    expect(escalationForecast('fire')).toBe('→ ✱ ALARM at 4:00');
    expect(escalationForecast('alarm')).toBeUndefined();
  });
});

describe('buildTriageRows', () => {
  const fire = (agentId: number, ageMs: number, cause?: string) => ({
    agentId,
    since: NOW - ageMs,
    identity: `#${String(agentId)} [MACBOOK] repo-${String(agentId)}`,
    cause,
  });
  const debris = (agentId: number, kind: 'failed' | 'stopped', ageMs: number) => ({
    key: `${String(agentId)}:${kind}`,
    agentId,
    kind,
    label: `#${String(agentId)} [MACBOOK] repo-${String(agentId)}`,
    since: NOW - ageMs,
  });

  it('orders by score = severity × age, descending', () => {
    const rows = buildTriageRows(
      [fire(1, 60_000), fire(2, 200_000)],
      [debris(3, 'failed', 400_000)],
      NOW,
    );
    // blocked(3×200k)=600k < failed(2×400k)=800k → debris first, then fires.
    expect(rows.map((r) => r.rowKey)).toEqual(['debris:3:failed', 'fire:2', 'fire:1']);
  });

  it('fire rows carry stage shape+word, verbatim cause, forecast, and gate NONE', () => {
    const [row] = buildTriageRows([fire(5, 100_000, 'Approve? (y/n)')], [], NOW);
    expect(row.glyph).toBe('▲');
    expect(row.word).toBe('FIRE');
    expect(row.cause).toBe('Approve? (y/n)');
    expect(row.forecast).toBe('→ ✱ ALARM at 4:00');
    expect(row.gate).toBe('none');
    expect(row.loud).toBe(false);
  });

  it('ALARM rows are loud (inverted chip)', () => {
    const [row] = buildTriageRows([fire(5, ALARM_AT_MS)], [], NOW);
    expect(row.word).toBe('ALARM');
    expect(row.loud).toBe(true);
  });

  it('debris rows carry ✗ DEBRIS, the ack-undo gate, and their debrisKey', () => {
    const [row] = buildTriageRows([], [debris(4, 'stopped', 1_000)], NOW);
    expect(row.glyph).toBe('✗');
    expect(row.word).toBe('DEBRIS');
    expect(row.cause).toBe('Session stopped');
    expect(row.gate).toBe('ack-undo');
    expect(row.debrisKey).toBe('4:stopped');
  });

  it('falls back to a generic cause when no waitingFor exists', () => {
    const [row] = buildTriageRows([fire(1, 1_000)], [], NOW);
    expect(row.cause).toBe('Blocked — needs input');
  });
});

describe('formatAge', () => {
  it('formats m:ss under an hour and hNN above', () => {
    expect(formatAge(0)).toBe('0:00');
    expect(formatAge(134_000)).toBe('2:14');
    expect(formatAge(3_600_000)).toBe('1h00');
    expect(formatAge(5_040_000)).toBe('1h24');
  });
});
