/**
 * HELP screen content registry — v3 rewrite, NOT a verbatim copy of
 * webview-ui/src/helpContent.ts (the frozen fallback's vocabulary belongs
 * to v1's office engine and doesn't match what's actually on the v3
 * screen). Every glyph below is grepped straight from the v3 source it
 * documents (state/visualState.ts, state/crisis.ts, components/*) so this
 * stays truthful to what Greg can actually tap.
 *
 * "A mechanic isn't done until its help section exists" (v1 convention,
 * kept): add the entry WITH the mechanic.
 */

export interface HelpEntry {
  glyph: string;
  word: string;
  text: string;
}

export const HELP_CATEGORIES = [
  'SIGNALS',
  'TRIAGE BOARD',
  'AGENT DRAWER',
  'DISPATCH & AUTOMATION',
  'PROGRESS & ECONOMY',
  'BRIEFING & SHIFT',
  'CHROME',
] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];

export interface HelpSection {
  id: string;
  title: string;
  intro?: string;
  category: HelpCategory;
  entries: HelpEntry[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'agent-states',
    title: 'Agent states (desk chips + drawer STATE row)',
    category: 'SIGNALS',
    intro: 'Every desk chip and drawer STATE row is one of these, shape + word.',
    entries: [
      {
        glyph: '⚠',
        word: 'NEEDS INPUT',
        text: 'Waiting on YOU — a permission prompt or an idle prompt. Renders inverted (loud). Feeds the triage board.',
      },
      { glyph: '▶', word: 'WORKING', text: 'Actively running tools this turn.' },
      { glyph: '✓', word: 'DONE', text: 'The turn finished cleanly, nothing waiting on you.' },
      {
        glyph: '✗',
        word: 'FAILED',
        text: 'The session died with an error (poller-reported). Leaves debris on the board.',
      },
      {
        glyph: '⏸',
        word: 'WAITING',
        text: 'Open but between turns — nothing running, nothing waiting.',
      },
    ],
  },
  {
    id: 'crisis-stages',
    title: 'Crisis stages (triage board)',
    category: 'SIGNALS',
    intro:
      'A blocked or needs-input agent ages through these stages, ordered by severity × age on the board.',
    entries: [
      { glyph: '▲', word: 'FIRE', text: 'Blocked/needs-input for 90+ seconds.' },
      {
        glyph: '✱',
        word: 'ALARM',
        text: 'Blocked/needs-input for 240+ seconds — the loudest live stage, renders inverted. The board shows an escalation forecast line before it hits.',
      },
      {
        glyph: '✗',
        word: 'DEBRIS',
        text: 'A crisis that ended in FAILED or STOPPED, not resolved — sits on the board until you ✓ ACK it (5s ↩ UNDO window).',
      },
    ],
  },
  {
    id: 'hud-chips',
    title: 'HUD strip chips',
    category: 'SIGNALS',
    intro:
      'Every stat chip is a button — tap for the verbatim wire data behind the number (one-tap-real).',
    entries: [
      {
        glyph: '●/◌/✕',
        word: 'LIVE / CONNECTING / OFFLINE',
        text: 'WS connection to the real server.',
      },
      {
        glyph: '$',
        word: 'CASH',
        text: 'Shows "—" until the first economyUpdate — an absent feed and a zero balance are different facts, never conflated.',
      },
      { glyph: '★', word: 'REP', text: 'Reputation, same honesty rule as CASH.' },
      {
        glyph: '◉ ▶ ⚠ ✗',
        word: 'AGENT TALLY',
        text: 'total · working · needs-input · failed, counted live.',
      },
      { glyph: '▣', word: 'PER-MACHINE WING', text: 'Agent + open-crisis count for one machine.' },
      {
        glyph: '✓/⚠',
        word: 'OFFICE MOOD',
        text: 'CALM when no crisis is open, STRAINED (n) otherwise.',
      },
    ],
  },
  {
    id: 'triage-verbs',
    title: 'Triage board verbs',
    category: 'TRIAGE BOARD',
    entries: [
      {
        glyph: '✓',
        word: 'APPROVE',
        text: 'Tap explains itself: the wire currently has NO remote approve gate for a blocked agent, so this opens the honest reason instead of faking a success — go to the DESK and use COPY ID / KILL.',
      },
      {
        glyph: '▸',
        word: 'DESK',
        text: 'Opens the agent drawer AND walks the camera there (bounded, ≤2s ease).',
      },
      {
        glyph: '✓',
        word: 'ACK',
        text: 'Dismisses a DEBRIS row — genuinely reversible for 5s via ↩ UNDO (client-side only; the real crisis record is untouched either way).',
      },
      { glyph: '↩', word: 'UNDO', text: 'Restores an ACKed debris row within its 5s window.' },
    ],
  },
  {
    id: 'drawer',
    title: 'Agent drawer',
    category: 'AGENT DRAWER',
    intro:
      'Opens from a desk chip, a triage row, or a pin-dock slot. Every fact is verbatim server telemetry.',
    entries: [
      {
        glyph: '⧉',
        word: 'COPY ID',
        text: 'Copies "MACHINE · project dir · session id" — works even when KILL is unavailable.',
      },
      {
        glyph: '✕',
        word: 'KILL',
        text: 'Two-step confirm, real /api/agents/kill. Honestly disabled with NO PID or NO RUNNER when there is no way to deliver the stop instruction; NO RUNNER means no live dispatch runner is advertising for that machine.',
      },
      {
        glyph: '⏸/▶',
        word: 'PAUSE / RESUME (tail)',
        text: 'Freezes the live tail; buffers new lines and shows "+N NEW WHILE PAUSED" until resumed (lossless).',
      },
      {
        glyph: '⊞/✕',
        word: 'PIN TAIL / UNPIN',
        text: "Docks this agent's tail in the desktop pin strip (3 slots max — a deliberate attention-scarcity budget, not a rendering limit).",
      },
    ],
  },
  {
    id: 'call',
    title: 'CALL — dispatch a coworker',
    category: 'DISPATCH & AUTOMATION',
    intro:
      'Opens from the ☎ phone prop or the dock. Machine/provider/project choices come ONLY from live runner advertisements (GET /api/dispatch/machines) — a machine with no runner is honestly absent, never a dead dropdown entry.',
    entries: [
      { glyph: '◎', word: 'RINGING', text: 'Sent, waiting on the runner to pick it up.' },
      { glyph: '✓', word: 'ANSWERED', text: 'The runner accepted and is starting the session.' },
      {
        glyph: '⊘',
        word: 'DENIED',
        text: 'The runner rejected it (shown with the real reason). Sticky — dismiss only.',
      },
      { glyph: '○', word: 'EXPIRED', text: 'Nobody answered in time.' },
      {
        glyph: '■',
        word: 'EXITED',
        text: 'The dispatched run finished — tap the chip for its result tail.',
      },
      { glyph: '✕', word: 'KILLED', text: 'The dispatched run was stopped.' },
      {
        glyph: '⚠',
        word: 'NOT QUEUED',
        text: 'dispatchRequest has no ack on the wire — if no lifecycle chip shows up within 1.5s, the client assumes it was silently dropped and says so.',
      },
    ],
  },
  {
    id: 'automation',
    title: 'Chains & standing orders',
    category: 'DISPATCH & AUTOMATION',
    intro:
      'Multi-step dispatch sequences (chains, run once) and scheduled dispatches (standing orders, recur).',
    entries: [
      {
        glyph: '◎',
        word: 'CHAIN RUNNING',
        text: 'Step N/total in flight. ⏸ PAUSED variant means a budget gate is holding step continuation — never a human approval gate.',
      },
      {
        glyph: '✓/⊘/■',
        word: 'CHAIN COMPLETED / FAILED / HALTED',
        text: 'FAILED is sticky (dismiss only); COMPLETED/HALTED auto-clear.',
      },
      {
        glyph: '⚠',
        word: 'NEEDS FIRST-RUN CONFIRM',
        text: 'Every new standing order needs one explicit human CONFIRM click before it can ever fire unattended — no perk or setting bypasses this.',
      },
      { glyph: '●/○', word: 'ACTIVE / DISABLED', text: "A confirmed order's current state." },
    ],
  },
  {
    id: 'stop-all',
    title: 'STOP ALL',
    category: 'DISPATCH & AUTOMATION',
    intro: 'Always visible in the HUD — the global automation kill switch.',
    entries: [
      {
        glyph: '■',
        word: 'STOP ALL',
        text: 'Server-authoritative: disables every standing order and halts every running chain in one transaction, even if this webview disconnects mid-request. Manual CALL dispatch stays available throughout — this targets autonomy, not you.',
      },
      {
        glyph: '▶',
        word: 'RESUME',
        text: 'A separate explicit action with its own confirm click — never automatic.',
      },
    ],
  },
  {
    id: 'contracts',
    title: 'Contracts',
    category: 'PROGRESS & ECONOMY',
    intro: 'Real vault todos/tracker gates rendered as payout-bearing contracts.',
    entries: [
      {
        glyph: '▲/≋/✱',
        word: 'PRIORITY / BACKLOG / GATE',
        text: 'Real source — todo-disappeared or gate-flipped completion is verified against the actual vault/tracker state.',
      },
      {
        glyph: '✧/✦',
        word: 'DAILY / WEEKLY',
        text: 'Game-generated flavor contracts, never claimed as real.',
      },
      {
        glyph: '—',
        word: 'CLAIMED (unverified)',
        text: 'Manual-claim escape hatch, rate-limited server-side — the one documented exception to the real/sim border.',
      },
    ],
  },
  {
    id: 'briefing',
    title: 'BRIEFING',
    category: 'BRIEFING & SHIFT',
    intro: "Today's todo top-3 + tracker gates. Opens from the clipboard prop or the dock.",
    entries: [
      {
        glyph: '○/◷/⚠/✓',
        word: 'TODO / IN PROGRESS / BLOCKED / DONE',
        text: 'Tracker gate status, shape + word.',
      },
      {
        glyph: '—',
        word: 'DISPATCH',
        text: "Prefills the CALL modal's prompt with a todo line and opens it.",
      },
    ],
  },
  {
    id: 'shift',
    title: 'SHIFT report',
    category: 'BRIEFING & SHIFT',
    intro:
      "Today's scorecard from real events — completed turns, real token spend, crisis throughput.",
    entries: [
      {
        glyph: '✦',
        word: 'EFFICIENCY',
        text: 'LEAN / STEADY / HEAVY — rewards LOW spend per completed turn. Tokens are money; the grade is always a word, never a bare number pretending to be neutral.',
      },
      {
        glyph: '⚠',
        word: 'STALE',
        text: 'Shown whenever a refresh fails instead of silently leaving old numbers looking fresh.',
      },
    ],
  },
  {
    id: 'chrome',
    title: 'Chrome',
    category: 'CHROME',
    entries: [
      {
        glyph: '◑',
        word: 'GRAYSCALE',
        text: 'Applies a real CSS grayscale filter to the whole app — every signal on screen must still read by shape + text alone under it.',
      },
      {
        glyph: '⌂/▦',
        word: 'FLOOR / BOARD',
        text: 'Toggles between the office floor view and the full-height triage board.',
      },
      { glyph: '?', word: 'HELP', text: 'This screen. Press ? anytime.' },
    ],
  },
];
