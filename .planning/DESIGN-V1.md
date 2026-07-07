# DESIGN — War Room v1 visual + functionality pass (2026-07-07)

Design contract for the v1 build (mechanics #1, help screen, #6a). Process per
the frontend-design skill (brainstorm → plan → critique → build); the
colorblind deuteranopia guardrails from GOAL.md override it wherever they
conflict. House tokens (dark `#1e1e2e`, FS Pixel Sans, `.pixel-panel`,
1px-spacing Tailwind, shape+word chips) carry over unchanged — v1 adds a
crisis vocabulary on top.

## Subject / audience / job

A pixel-art ops war room of real AI agents. Audience: Greg (deuteranopia).
The page's single job: make triage decisions legible and resolving them
satisfying. Every new signal is SHAPE + TEXT LABEL first; color reinforces.

## Signature element

**The incident board** — a wall-mounted TRIAGE panel (top-right, docked, not
a modal) that reads like an old departure board: monospace-feel rows sorted
by `age × severity`, each row = stage silhouette glyph + stage word +
agent identity + one-line cause + tabular age. It auto-appears when a crisis
exists and flashes `✓ ALL CLEAR` when the last one resolves. Everything else
around it stays quiet — the office itself only escalates at the affected desk.

## Crisis vocabulary (mechanic #1)

Stage is a function of AGE of the blocked state (thresholds in
`webview-ui/src/office/crisis.ts`):

| Stage | Age        | Silhouette (canvas, procedural)                 | Glyph | Label |
| ----- | ---------- | ----------------------------------------------- | ----- | ----- |
| SMOKE | 0 – 90 s   | small gray puffs rising above the desk          | ≋     | SMOKE |
| FIRE  | 90 s – 4 m | flickering flame triangle, dark outline, embers | ▲     | FIRE  |
| ALARM | ≥ 4 m      | fire + white flashing beacon + radiating rings  | ✱     | ALARM |

- Distinct SILHOUETTES, not tints: puffs (round, drifting) vs flame
  (triangular, flickering) vs beacon (white bar + rings — white = the house
  "loudest" pattern, same as the NEEDS INPUT chip).
- The DOM overlay adds a crisis tag under the state chip: `▲ FIRE 2:41`
  (glyph + word + m:ss age, tabular nums).
- **Debris**: an agent that FAILED or was STOPPED leaves a gray rubble-pile
  sprite + `✗ DEBRIS` label at its desk until acknowledged (click the label
  or the board row's CLEAR button). Persisted to localStorage so a refresh
  doesn't silently tidy the room.
- **Resolution feedback**: crisis ends → white steam puff (~1.2 s) + floating
  `✓ RESOLVED` label at the desk; the board row collapses; last crisis →
  `✓ ALL CLEAR` flash. The loop is: see fire → act in the real terminal →
  watch the room calm.

Severity weights for the queue score (`score = weight × age`): blocked 3,
failed 2, stopped 1. Real triage: a blocked session wastes a live agent;
debris is cleanup.

### Data honesty (aging)

Poll-driven blocked states get a server-authoritative age: the server keeps
`since` (transition time) per poll state and broadcasts `ageMs` (skew-free);
the client derives `since = now − ageMs`. The server also REBROADCASTS an
unchanged poll state every 20 s — this fixes a real v0 defect where a session
blocked > 60 s lost its NEEDS INPUT badge (client TTL expiry with no refresh
broadcast). Locally-detected needs-input (permission bubbles) ages from
client first-seen. No fake ages, no demo randomness.

## Help screen

`HelpModal` (house `Modal`), opened by `?` and a visible `Help` word-button
in the bottom toolbar. Content is a data registry (`helpContent.ts`) —
sections: state chips (all 6), fire stages (all 3), debris, triage board,
resolution feedback, briefing panel, machine labels, coworker labels, data
sources (real sessions / real tokens / real gates). A unit test asserts the
registry covers every STATE_CHIPS state and every crisis stage — "a mechanic
isn't done until its help section exists" is enforced by CI, not memory.
The modal itself uses glyph+word rows — grayscale-safe.

## Coworkers (#6a)

Codex / Gemini sessions render as coworkers: same office, hooks-only agents
(the M2 remote-Mac path) with `providerId` threaded to the webview →
distinct badge silhouette on the name tag + `[CODEX]` / `[GEMINI]` TEXT
label. Ingest = per-provider adapter POSTing normalized events to the
existing authed `/api/hooks/:providerId`. #6b dispatch is design-only:
`.planning/DISPATCH-6B-DESIGN.md`.

## Explicit non-goals (this pass)

Sound beyond the existing permission chime (open question #3 unanswered),
shift report (#2), progression (#3), emergence (#4), expression (#5),
any steering/dispatch execution surface.
