/**
 * WorldEventBanner tests (v2 mechanic G5, BUILD-PLAN §G5 task 2) — pure
 * selection logic behind the component, same split every Panel/Tray
 * component in this repo uses (no jsdom/testing-library render tests).
 */

import { describe, expect, it } from 'vitest';

import {
  latestVisibleWorldEvent,
  WORLD_EVENT_BANNER_AUTO_HIDE_MS,
  type WorldEventEntryClient,
} from '../src/worldEventBanner.js';

function event(overrides: Partial<WorldEventEntryClient> = {}): WorldEventEntryClient {
  return {
    id: 'coffee_run',
    glyph: '✧',
    ts: 1_000,
    summary: 'A couple of people made a coffee run.',
    ...overrides,
  };
}

describe('latestVisibleWorldEvent', () => {
  it('returns null when there are no events', () => {
    expect(latestVisibleWorldEvent([], new Set(), 1_000)).toBeNull();
  });

  it('returns the most recent event', () => {
    const events = [event({ ts: 1_000 }), event({ ts: 2_000, summary: 'later' })];
    const result = latestVisibleWorldEvent(events, new Set(), 2_000);
    expect(result?.summary).toBe('later');
  });

  it('skips a dismissed event and falls back to an earlier undismissed one', () => {
    const events = [
      event({ ts: 1_000, summary: 'first' }),
      event({ ts: 2_000, summary: 'second' }),
    ];
    const result = latestVisibleWorldEvent(events, new Set([2_000]), 2_100);
    expect(result?.summary).toBe('first');
  });

  it('returns null once every event is dismissed', () => {
    const events = [event({ ts: 1_000 })];
    expect(latestVisibleWorldEvent(events, new Set([1_000]), 1_100)).toBeNull();
  });

  it('auto-hides an undismissed event once its window elapses', () => {
    const events = [event({ ts: 1_000 })];
    const justBefore = 1_000 + WORLD_EVENT_BANNER_AUTO_HIDE_MS - 1;
    const atOrAfter = 1_000 + WORLD_EVENT_BANNER_AUTO_HIDE_MS;
    expect(latestVisibleWorldEvent(events, new Set(), justBefore)).not.toBeNull();
    expect(latestVisibleWorldEvent(events, new Set(), atOrAfter)).toBeNull();
  });

  it('does not resurrect an auto-hidden event behind a still-fresh later one', () => {
    const events = [
      event({ ts: 1_000, summary: 'stale' }),
      event({ ts: 1_000 + WORLD_EVENT_BANNER_AUTO_HIDE_MS + 5_000, summary: 'fresh' }),
    ];
    const now = 1_000 + WORLD_EVENT_BANNER_AUTO_HIDE_MS + 5_100;
    expect(latestVisibleWorldEvent(events, new Set(), now)?.summary).toBe('fresh');
  });
});
