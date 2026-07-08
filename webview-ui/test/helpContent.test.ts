/**
 * Help-screen completeness contract (v1): "a mechanic isn't done until its
 * help section exists." These tests fail when a new agent state, crisis
 * stage, or shipped surface lacks help coverage — add the help text WITH the
 * mechanic.
 */

import { describe, expect, it } from 'vitest';

import { CRISIS_STAGE_HELP, HELP_SECTIONS, STATE_CHIP_HELP } from '../src/helpContent.js';
import { AgentVisualState, STATE_CHIPS } from '../src/office/agentState.js';
import { CRISIS_STAGE_SPECS, CrisisStage } from '../src/office/crisis.js';

/** Surfaces shipped on the dashboard — each must have a help section. */
const REQUIRED_SECTION_IDS = [
  'state-chips',
  'fire-stages',
  'debris',
  'triage-board',
  'briefing',
  'shift-report',
  'machines',
  'progression',
  'coworkers',
  'emergence',
  'data-sources',
  'decor',
  'sound',
];

describe('help content completeness', () => {
  it('covers every agent state chip', () => {
    for (const state of Object.values(AgentVisualState)) {
      expect(STATE_CHIP_HELP[state], `missing help text for state "${state}"`).toBeTruthy();
    }
    const chipSection = HELP_SECTIONS.find((s) => s.id === 'state-chips')!;
    const words = chipSection.entries.map((e) => e.word);
    for (const state of Object.values(AgentVisualState)) {
      expect(words).toContain(STATE_CHIPS[state].label);
    }
  });

  it('covers every crisis stage', () => {
    for (const stage of Object.values(CrisisStage)) {
      expect(CRISIS_STAGE_HELP[stage], `missing help text for stage "${stage}"`).toBeTruthy();
    }
    const stageSection = HELP_SECTIONS.find((s) => s.id === 'fire-stages')!;
    const words = stageSection.entries.map((e) => e.word);
    for (const stage of Object.values(CrisisStage)) {
      expect(words).toContain(CRISIS_STAGE_SPECS[stage].label);
    }
  });

  it('has a section for every shipped surface', () => {
    const ids = HELP_SECTIONS.map((s) => s.id);
    for (const required of REQUIRED_SECTION_IDS) {
      expect(ids, `missing help section "${required}"`).toContain(required);
    }
  });

  it('every entry is glyph + WORD + text (shape+label rule, grayscale-safe)', () => {
    for (const section of HELP_SECTIONS) {
      expect(section.title).toBeTruthy();
      expect(section.entries.length).toBeGreaterThan(0);
      for (const entry of section.entries) {
        expect(entry.glyph.trim(), `${section.id} entry missing glyph`).toBeTruthy();
        expect(entry.word.trim(), `${section.id} entry missing word`).toBeTruthy();
        expect(
          entry.text.trim().length,
          `${section.id}/${entry.word} text too short`,
        ).toBeGreaterThan(20);
      }
    }
  });
});
