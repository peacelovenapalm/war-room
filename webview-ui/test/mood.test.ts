import { describe, expect, it } from 'vitest';

import {
  idleStateFor,
  MOOD_SPEED_MULTIPLIER_BURNED_OUT,
  moodBand,
  moodGlyph,
  moodSpeedMultiplier,
} from '../src/office/mood.js';
import { CharacterState } from '../src/office/types.js';

describe('moodBand', () => {
  it('is low below 35', () => {
    expect(moodBand(0)).toBe('low');
    expect(moodBand(34)).toBe('low');
  });

  it('is neutral between 35 and 69', () => {
    expect(moodBand(35)).toBe('neutral');
    expect(moodBand(69)).toBe('neutral');
  });

  it('is high at 70 and above', () => {
    expect(moodBand(70)).toBe('high');
    expect(moodBand(100)).toBe('high');
  });
});

describe('moodSpeedMultiplier', () => {
  it('slows a low-mood character', () => {
    expect(moodSpeedMultiplier('low')).toBe(MOOD_SPEED_MULTIPLIER_BURNED_OUT);
  });

  it('never slows neutral, high, or undefined (no mood data) characters', () => {
    expect(moodSpeedMultiplier('neutral')).toBe(1);
    expect(moodSpeedMultiplier('high')).toBe(1);
    expect(moodSpeedMultiplier(undefined)).toBe(1);
  });
});

describe('idleStateFor', () => {
  it('returns BURNED_OUT for a low mood band', () => {
    expect(idleStateFor({ moodBand: 'low' })).toBe(CharacterState.BURNED_OUT);
  });

  it('returns IDLE for neutral/high/undefined mood bands', () => {
    expect(idleStateFor({ moodBand: 'neutral' })).toBe(CharacterState.IDLE);
    expect(idleStateFor({ moodBand: 'high' })).toBe(CharacterState.IDLE);
    expect(idleStateFor({ moodBand: undefined })).toBe(CharacterState.IDLE);
  });
});

describe('moodGlyph (EmployeeRoster.tsx roster row — shape+number, never color-only)', () => {
  it('is the loudest/saddest glyph below 20 (quit-risk territory)', () => {
    expect(moodGlyph(0)).toBe('☹');
    expect(moodGlyph(19)).toBe('☹');
  });

  it('is neutral between 20 and 49', () => {
    expect(moodGlyph(20)).toBe('◑');
    expect(moodGlyph(49)).toBe('◑');
  });

  it('is content at 50 and above', () => {
    expect(moodGlyph(50)).toBe('☺');
    expect(moodGlyph(100)).toBe('☺');
  });
});
