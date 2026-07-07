/**
 * Help screen content registry (v1 cross-cutting requirement).
 *
 * "A mechanic isn't done until its help section exists" — enforced by
 * webview-ui/test/helpContent.test.ts, which asserts every STATE_CHIPS state
 * and every CRISIS_STAGE_SPECS stage has an entry here. Add the help text
 * WITH the mechanic, or the suite goes red.
 *
 * Every row is GLYPH + WORD + plain text — the registry renders grayscale-safe
 * by construction (shape + label first, color never carries meaning).
 */

import { AgentVisualState, STATE_CHIPS } from './office/agentState.js';
import { ALARM_AT_MS, CRISIS_STAGE_SPECS, CrisisStage, FIRE_AT_MS } from './office/crisis.js';

export interface HelpEntry {
  glyph: string;
  word: string;
  text: string;
}

export interface HelpSection {
  id: string;
  title: string;
  intro?: string;
  entries: HelpEntry[];
}

/** Per-state explanations (keyed so the completeness test can diff against STATE_CHIPS). */
export const STATE_CHIP_HELP: Record<AgentVisualState, string> = {
  [AgentVisualState.NEEDS_INPUT]:
    'The session is waiting on YOU — a permission prompt or an idle prompt. Loudest signal on screen; it also starts a fire at the desk.',
  [AgentVisualState.WORKING]: 'The session is actively running tools this turn.',
  [AgentVisualState.DONE]: 'The turn finished cleanly and nothing is waiting on you.',
  [AgentVisualState.FAILED]:
    'The session died with an error (reported by the per-machine poller). Leaves debris at the desk.',
  [AgentVisualState.STOPPED]:
    'The session was stopped before finishing (poller-reported). Leaves debris at the desk.',
  [AgentVisualState.IDLE]:
    'The session is open but between turns — nothing running, nothing waiting.',
};

/** Per-stage explanations (same completeness contract as the chips). */
export const CRISIS_STAGE_HELP: Record<CrisisStage, string> = {
  [CrisisStage.SMOKE]: `A session just became blocked (under ${Math.round(FIRE_AT_MS / 1000)} s). Gray puffs rise from the desk.`,
  [CrisisStage.FIRE]: `Still blocked after ${Math.round(FIRE_AT_MS / 1000)} s — a flame burns at the desk. Someone is waiting on you and has been for a while.`,
  [CrisisStage.ALARM]: `Blocked for ${Math.round(ALARM_AT_MS / 60_000)}+ minutes — the flame gains a white flashing beacon. Deal with this desk first.`,
};

function chipEntries(): HelpEntry[] {
  return (Object.keys(STATE_CHIP_HELP) as AgentVisualState[]).map((state) => ({
    glyph: STATE_CHIPS[state].glyph,
    word: STATE_CHIPS[state].label,
    text: STATE_CHIP_HELP[state],
  }));
}

function stageEntries(): HelpEntry[] {
  return (Object.keys(CRISIS_STAGE_HELP) as CrisisStage[]).map((stage) => ({
    glyph: CRISIS_STAGE_SPECS[stage].glyph,
    word: CRISIS_STAGE_SPECS[stage].label,
    text: CRISIS_STAGE_HELP[stage],
  }));
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'state-chips',
    title: 'AGENT STATE CHIPS',
    intro:
      'Every agent wears a chip: SHAPE + WORD are the signal, color is decoration. States come from live session activity plus the per-machine poller.',
    entries: chipEntries(),
  },
  {
    id: 'fire-stages',
    title: 'FIRE STAGES (CRISES)',
    intro:
      'A blocked session is a fire at that desk, and fires AGE. Each stage is a different silhouette, not a different color — check the tag under the chip for the stage word and how long it has burned.',
    entries: stageEntries(),
  },
  {
    id: 'debris',
    title: 'DEBRIS',
    intro: undefined,
    entries: [
      {
        glyph: '✗',
        word: 'DEBRIS',
        text: 'A failed or stopped session leaves a rubble pile + label at its desk until YOU acknowledge it — click the desk label or the CLEAR button on the board. It survives page refreshes on purpose. If the session recovers on its own, the debris cleans itself up.',
      },
    ],
  },
  {
    id: 'triage-board',
    title: 'TRIAGE BOARD',
    intro: undefined,
    entries: [
      {
        glyph: '⚠',
        word: 'TRIAGE',
        text: 'The top-right board appears whenever at least one crisis is open. Rows are sorted by age × severity (blocked > failed > stopped) — the top row is always the next thing to deal with. Each row: stage, agent identity, one-line cause (what it waits on), age. Click the header to collapse.',
      },
      {
        glyph: '✓',
        word: 'RESOLVED',
        text: 'Fix the real session (answer the prompt in its terminal) and the desk steams, a ✓ RESOLVED tag floats up, and the row collapses. Clearing the last crisis flashes ✓ ALL CLEAR.',
      },
    ],
  },
  {
    id: 'briefing',
    title: 'BRIEFING PANEL',
    intro: undefined,
    entries: [
      {
        glyph: '◷',
        word: 'BRIEFING',
        text: 'The Briefing button (bottom toolbar) shows today’s real todo top-3 and the half-baked project tracker gates, straight from the vault and tracker files on the server. Read-only; refreshes every 5 minutes while open.',
      },
    ],
  },
  {
    id: 'machines',
    title: 'MACHINE & IDENTITY LABELS',
    intro: undefined,
    entries: [
      {
        glyph: '#',
        word: 'IDENTITY',
        text: 'Every agent is labeled "#id [MACHINE] folder" in plain text — e.g. #3 [MACBOOK] vault vs #7 [MINI] arcade. Machine identity is never encoded as a color.',
      },
    ],
  },
  {
    id: 'data-sources',
    title: 'WHERE THE DATA COMES FROM',
    intro: 'Nothing here is a game score — everything reflects real state:',
    entries: [
      {
        glyph: '▶',
        word: 'SESSIONS',
        text: 'Live Claude Code sessions: local ones via their JSONL transcripts, remote machines via authenticated hook forwarders.',
      },
      {
        glyph: '⚠',
        word: 'BLOCKED / FAILED',
        text: 'A per-machine poller runs `claude agents --json` every ~15 s and reports blocked/failed/stopped states with what each session waits on. Fire ages are anchored to the real transition time.',
      },
      {
        glyph: '◔',
        word: 'TOKENS',
        text: 'Token gauges show real context usage from the sessions themselves. Low spend is good — nothing here rewards burning tokens.',
      },
      {
        glyph: '◆',
        word: 'GATES',
        text: 'Briefing gates and todos come from the real vault/tracker files. Closing them in real life is what moves this dashboard.',
      },
    ],
  },
];
