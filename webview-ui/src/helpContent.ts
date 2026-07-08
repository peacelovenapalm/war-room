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

import { DISPATCH_STATUS_CHIPS, DISPATCH_STATUSES, type DispatchStatusValue } from './dispatch.js';
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

/** Per-status explanations (same completeness contract as the state chips —
 *  enforced by helpContent.test.ts against DISPATCH_STATUSES). */
export const DISPATCH_STATUS_HELP: Record<DispatchStatusValue, string> = {
  ringing:
    'The request is queued on the server, waiting for that machine’s runner to poll and decide.',
  answered:
    'The runner accepted the request and started the real CLI process (or fronted the terminal for a FOCUS request).',
  denied:
    'The runner’s local allowlist rejected the request — sticky until you dismiss it, and it always carries a plain-text reason (e.g. path-not-allowlisted).',
  expired:
    'Nobody’s runner answered within the 10-minute TTL — the machine is probably offline or has no runner installed.',
  exited: 'The dispatched process finished; the exit code (0 = clean) is shown alongside.',
};

function dispatchEntries(): HelpEntry[] {
  return DISPATCH_STATUSES.map((status) => ({
    glyph: DISPATCH_STATUS_CHIPS[status].glyph,
    word: DISPATCH_STATUS_CHIPS[status].word,
    text: DISPATCH_STATUS_HELP[status],
  }));
}

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
    id: 'shift-report',
    title: 'SHIFT REPORT',
    intro: undefined,
    entries: [
      {
        glyph: '✦',
        word: 'SCORECARD',
        text: 'The Shift button shows today’s numbers from real events: completed turns, tokens spent, crises ignited/resolved with mean time-to-unblock, and todos/gates that moved since the day started. Resets at midnight.',
      },
      {
        glyph: '✦',
        word: 'EFFICIENCY',
        text: 'Graded LEAN / STEADY / HEAVY by average output tokens per completed turn — LOWER is always better. Tokens are real money; nothing on this dashboard ever rewards spending more.',
      },
      {
        glyph: '◐',
        word: 'YESTERDAY',
        text: 'A compact YESTERDAY card sits under today’s numbers, built from the last ledger that closed at midnight — checking out for the day no longer means losing yesterday’s scorecard.',
      },
      {
        glyph: '⚠',
        word: 'STALE',
        text: 'If a refresh of the shift numbers fails, the panel marks what’s on screen STALE with the last-updated time — it never silently keeps showing old numbers as if they were current.',
      },
      {
        glyph: '➤',
        word: 'PUSH',
        text: 'When WAR_ROOM_PUSH_URLS is set in the server environment, the closed shift’s summary also POSTs as plain text to your morning page or phone (Bark) at day rollover. Unset by default — no push, no noise, and a failed delivery never blocks or slows the dashboard.',
      },
    ],
  },
  {
    id: 'progression',
    title: 'PROGRESSION (LEVEL / STREAK / XP)',
    intro:
      'The top-left strip is honest about what earns XP and what does not — nothing here is gated: every data view above stays reachable no matter your level.',
    entries: [
      {
        glyph: '▲',
        word: 'LEVEL',
        text: 'XP comes ONLY from real, observed events: a completed turn (hook Stop), an observed crisis resolution (a real state change away from blocked — never a stale poller-silence clear), and the daily shift-report grade at day rollover. Burning more tokens never earns XP — tokens are real money, and nothing on this dashboard rewards spending more.',
      },
      {
        glyph: '◐',
        word: 'STREAK',
        text: 'Counts consecutive local-calendar days with at least one observed real completed turn — the daily-use habit made literal. A day with no activity breaks it back to zero; the longest streak you have ever reached is remembered separately.',
      },
      {
        glyph: '✦',
        word: 'XP BAR',
        text: 'Fill shows progress toward the next level as a percentage (shown as a number, not just a bar — the fill color is reinforcement only). State lives on the server, not your browser, so it is shared across every screen you open this dashboard from and survives a cache clear.',
      },
      {
        glyph: '◆',
        word: 'UNLOCKS',
        text: 'Streak length, LEAN-graded shift days, and level milestones flip permanent unlock flags server-side. They are data only for now — a later mechanic will use them to unlock office decor. Nothing renders from them yet, and unlocking never removes access to any real dashboard function.',
      },
    ],
  },
  {
    id: 'coworkers',
    title: 'AI COWORKERS (CODEX / GEMINI)',
    intro: undefined,
    entries: [
      {
        glyph: '▣',
        word: 'CODEX',
        text: 'Codex CLI sessions appear as coworkers with a SQUARE badge above their head and a [CODEX] text label. Their activity streams in via a per-provider adapter tailing the real Codex session files.',
      },
      {
        glyph: '◆',
        word: 'GEMINI',
        text: 'Gemini CLI sessions wear a DIAMOND badge and a [GEMINI] text label. Gemini logs are sparse, so its presence is heartbeat-level: working when it is actively used, idle after it goes quiet.',
      },
    ],
  },
  {
    id: 'emergence',
    title: 'OFFICE LIFE (EMERGENT RULES)',
    intro: 'Cheap simple rules that interact — none deeper than a few lines:',
    entries: [
      {
        glyph: '◎',
        word: 'CROWD',
        text: 'A desk that has burned to FIRE or ALARM draws a crowd: idle agents bias their wandering toward the oldest fire. A knot of onlookers forming is itself a signal something has been stuck too long.',
      },
      {
        glyph: '◐',
        word: 'NIGHT SHIFT',
        text: 'When no sessions are running anywhere, the lights dim and a NIGHT SHIFT label appears. An empty office should look empty.',
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
  {
    id: 'decor',
    title: 'OFFICE DECOR (UNLOCKS)',
    intro:
      'Purely cosmetic — nothing here changes what you can see or do. Streaks, levels, and LEAN shift days from the progression strip permanently unlock office decor; the Unlocks button (bottom toolbar) lists every item and its requirement.',
    entries: [
      {
        glyph: '◆',
        word: 'DECOR',
        text: 'Reaching a streak length, a level milestone, or 5 cumulative LEAN-graded shift days permanently unlocks one decor item (a plant, a coffee machine, a clock, a painting) at a fixed spot in the office. Unlocks never revert and are never required to reach — every real dashboard view and function stays reachable at level 1 with no streak.',
      },
      {
        glyph: '✓',
        word: 'UNLOCKED / LOCKED',
        text: 'The Unlocks panel marks each item UNLOCKED or LOCKED by shape and word (✓/✗), never by color alone. Locked items simply do not render in the office — there is no grayed-out preview or nag to unlock them.',
      },
    ],
  },
  {
    id: 'dispatch',
    title: 'CALL A COWORKER (DISPATCH)',
    intro:
      'The server never shells out — it only queues a request. A per-machine runner you opt into (install-dispatch-runner-launchd.sh) polls it and decides locally against its OWN allowlist; the dashboard can never force a machine to run anything.',
    entries: [
      {
        glyph: '☎',
        word: 'CALL',
        text: 'The Call button (bottom toolbar) opens a modal to pick a machine, provider, project, and prompt — options only ever come from machines with a LIVE runner (GET /api/dispatch/machines); a machine with no runner installed is honestly absent, not a dead choice.',
      },
      {
        glyph: '▤',
        word: 'PROJECT + SUBFOLDER',
        text: 'PROJECT picks one of the machine\'s allowlisted roots; the optional SUBFOLDER field runs the coworker in any folder underneath it (e.g. "packages/api") instead of only the root itself. A ".." attempt is rejected client-side as an honest early no — the runner\'s own allowlist containment check is the real, unbypassable gate.',
      },
      {
        glyph: '☰',
        word: 'MODEL + EFFORT',
        text: "Both optional. MODEL is a free-text id/alias (e.g. 'fable', 'opus', 'o3') passed to whichever provider's --model flag; EFFORT is a dropdown shown only for providers that actually have a reasoning-effort flag (currently claude) — a provider without one silently ignores it rather than erroring.",
      },
      ...dispatchEntries(),
      {
        glyph: '▤',
        word: 'RESULT',
        text: "An EXITED chip is clickable: it opens a monospace, scrollable view of the run's last ~8KB of output (resultTail) — previously visible only in a log file on whichever machine ran it. A page refresh still shows recent results (GET /api/dispatch/recent), not just in-flight ones.",
      },
      {
        glyph: '➤',
        word: 'DISPATCH (TODO BRIDGE)',
        text: "Every BRIEFING todo line has its own Dispatch button that pre-fills the Call modal's prompt with that line's text — pick the machine/project/provider and send it.",
      },
      {
        glyph: '⚠',
        word: 'NOT QUEUED',
        text: "Sending a request has no server acknowledgement — if nothing appears in this tray within about 1.5 seconds, the dashboard assumes it was silently dropped (bad provider, missing field, or that machine's 5-ringing cap) and shows this chip instead of staying silent.",
      },
    ],
  },
  {
    id: 'agent-drawer',
    title: 'AGENT DETAIL DRAWER',
    intro: undefined,
    entries: [
      {
        glyph: '▤',
        word: 'DETAILS',
        text: 'Click any agent to open its drawer: machine, project dir, session id, provider, state, the exact NEEDS-INPUT/permission text, how long it has been blocked, and token spend — the "which window is on fire" problem, solved.',
      },
      {
        glyph: '▶',
        word: 'FOCUS',
        text: 'Best-effort: dispatches a focus request (by OS process id) to that machine\'s runner, which fronts the real terminal window. Disabled with "⚠ NO PID — use COPY ID" until process-id telemetry exists for that session, or "⚠ NO RUNNER" when the machine has no live runner — answering a permission prompt from the browser itself is never possible, by design.',
      },
      {
        glyph: '⧉',
        word: 'COPY ID',
        text: "Always works, no runner required: copies a one-line machine + project dir + session id to your clipboard — the honest fallback when FOCUS can't reach a machine.",
      },
    ],
  },
  {
    id: 'sound',
    title: 'SOUND (AMBIENCE + EVENT CHIRPS)',
    intro:
      'Procedural WebAudio only — no audio files, no network fetches. Every sound reinforces a signal that is ALSO on screen as shape+text; audio never carries information alone, and it never machine-guns during a burst of events.',
    entries: [
      {
        glyph: '♪',
        word: 'SOUND: ON',
        text: 'A quiet, procedurally-generated office hum plays continuously — subtle room tone, designed to stay non-fatiguing over a full 8-hour session. On by default; toggle it from the bottom toolbar, saved per-browser.',
      },
      {
        glyph: '♪',
        word: 'CLICK TO START',
        text: 'Browsers block audio until you interact with the page. The toggle shows "SOUND: ON (click to start)" honestly rather than pretending audio is already playing — click anywhere (or the toggle itself) to unlock it.',
      },
      {
        glyph: '▲',
        word: 'ALARM CHIRP',
        text: 'A short double-beep plays the moment any desk escalates to the FIRE or ALARM stage — the exact same transition that changes the fire silhouette and stage label.',
      },
      {
        glyph: '✓',
        word: 'RESOLVED DING',
        text: 'A single bright note plays for every observed "✓ RESOLVED" — the same honest-resolution rule applies: a fire that drops from lost telemetry, not a real fix, stays silent.',
      },
      {
        glyph: '✓',
        word: 'ALL CLEAR CHIME',
        text: 'A warmer three-note chime plays when the last open crisis clears and the board flashes "✓ ALL CLEAR".',
      },
      {
        glyph: '●',
        word: 'ARRIVAL BLIP',
        text: 'A soft, low blip plays when a new session or coworker joins the office — not on the initial bulk load of sessions that were already running.',
      },
      {
        glyph: '◐',
        word: 'NIGHT DUCK',
        text: 'During NIGHT SHIFT (no active sessions) the ambience ducks to near-silent — an empty office should sound as empty as it looks.',
      },
    ],
  },
];
