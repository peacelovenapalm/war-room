/**
 * Rotating "Skyrim-style" tip strings (KICKOFF v1.1 item 8) — a plain data
 * file Greg can extend without touching component code. Rendered by
 * RotatingTip.tsx, one line at a time, on a timer. Keep each entry short
 * (one line, no paragraphs) and grounded in a real mechanic — see
 * helpContent.ts for the full explanation of anything mentioned here.
 */
export const ROTATING_TIPS: string[] = [
  'Click any agent on the office floor to open its detail drawer.',
  'STOP ALL halts every automation — standing orders and in-flight chain runs — with one click.',
  'A blocked session becomes a fire at its desk, and fires AGE — deal with the oldest one first.',
  'The TRIAGE board sorts by age × severity so the top row is always what to fix next.',
  "FOCUS fronts a session's real terminal window; COPY ID always works as the honest fallback.",
  'KILL ends any worker with a known process id — a two-step confirm, just like STOP ALL.',
  'Standing Orders run chains automatically on a schedule or trigger, no manual dispatch needed.',
  'Chains are built once in the Chains panel and can be fired from a Standing Order or by hand.',
  'The Economy HUD shows Cash and Reputation from real events only — nothing here rewards burning tokens.',
  'LEAN is the best efficiency grade: fewer output tokens per completed turn, always better.',
  'Your streak counts consecutive days with at least one real completed turn — inactivity resets it.',
  'Debris (a failed or stopped session) sits at its desk until you click CLEAR or it recovers on its own.',
  'Press ? anywhere to open Help — it works even while a modal is open.',
  'Codex sessions wear a square badge; Gemini sessions wear a diamond — shape, not color, tells them apart.',
  'NIGHT SHIFT dims the office when nothing is running anywhere — an empty office looks empty on purpose.',
  'Sound reinforces signals already on screen as shape+text — mute it any time from the bottom toolbar.',
  "Edit mode (Layout button) lets you repaint floors and move furniture — Save or Reset when you're done.",
  'The Call button only ever lists machines with a live runner installed — no dead choices.',
  'Office decor unlocks are cosmetic only — every real dashboard function stays reachable at level 1.',
  'A paused automation shows its real reason (budget, stale snapshot, cap) — never just "paused".',
];
