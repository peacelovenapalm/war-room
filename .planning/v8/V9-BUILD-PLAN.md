# V9-BUILD-PLAN — eyes-free meaning (AMBIENT rung 2)

Execution contract for a fresh build agent (codex gpt-5.6-sol as primary
builder). This plan turns `.planning/v8/V9-DESIGN.md` into
dependency-ordered, individually-verifiable deliverables. It adds nothing
the design didn't scope; it sequences it and pins every extension point to
real code (file:line verified 2026-07-13 against branch `war-room/v3`).

Provenance: authored 2026-07-13 off-board at the team lead's direction,
from V9-DESIGN (scope LOCKED: V9-1 sound grammar, V9-2 SHIFT replay, V9-3
assertive paging, V9-4 wall mode) + the house format of
`.planning/v5/C3-BUILD-PLAN.md` and `.planning/v6/RUN-MAP-v5-v7-2026-07-12.md`.
Symbols: ✓ pass / ✗ fail / ⚠ caution / ⊘ honest-absent — always with a word.

The deployed face is **webview-v3** (served on NEXUS, summoned via
Tailscale). `webview-ui` is the LEGACY face pending C4 retirement — V9
touches it for NOTHING. Every "the design says notificationSound.ts"
reference resolves to the v3 soundscape stack (see ⚠ Reconcile #1).

---

## PRECONDITIONS (codex MUST HALT if unmet)

Copied verbatim from V9-DESIGN § Preconditions. Neither is satisfied as of
this writing — the run map's morning surface shipped (deploy #2, 5bfeabc)
but the round trips have not been observed. **Do not begin D1–D6 until a
human confirms both. If unconfirmed, stop and report which is missing.**

1. Morning-push round trip observed live ≥3 mornings (streak counter
   recording honestly — first round trip still pending as of drafting).
2. V6 degraded-state push verified firing on a real degradation at least
   once (the sickness-announcement path must be proven before more ambient
   surface is added on top of it).

Verify precondition state, don't assume it:

- `ssh nexus-ts 'curl -s http://127.0.0.1:3141/api/morning'` → inspect
  `streak.count` (≥3) and `streak.lastRecordedDate`. A count <3 = HALT.
- `git log --oneline` + `.planning/v6/SPRINT-STATE.md` "Morning-streak
  counter" line — reconcile; the ledger said `0` at V7 close. If still 0,
  the preconditions are unmet regardless of what any handoff claims.
- Degraded-push proof: grep NEXUS logs / streak breach history for a
  real `morning-degraded` big-moment fire. No evidence = precondition 2
  unmet = HALT.

---

## Required reading for codex (in order, before writing anything)

1. `.planning/v8/V9-DESIGN.md` — the contract this plan implements.
2. `.planning/v5/HORIZON-v20.md` — Act II + the seven invariants (honest
   data ⊘, colorblind shape+word, Greg gates the irreversible,
   anti-friction-death Q49). The audio-honesty rule is the invariant #3
   analog for sound.
3. `CLAUDE.md` — architecture, constants policy, TS constraints, testing
   tiers, and the "Codex Delegation (sandboxed builds)" section (your
   gates run in that sandbox; socket/`ps` failures get re-verified
   UNSANDBOXED by the reviewing agent — do not treat them as real).
4. The real extension points, read before touching them:
   - `webview-v3/src/state/soundscape.ts` — `CHIRP_SPECS`,
     `SoundscapeChirpKind` (2 kinds today), mute persistence,
     `soundscapeToggleLabel`.
   - `webview-v3/src/engine/soundscape.ts` — WebAudio synthesis, ambience
     bed, `chirp()`.
   - `webview-v3/src/App.tsx:243-251` (engine wiring),
     `:639-648` (rising-edge chirp triggers), `:1209` (props to header).
   - `server/src/morningSurface.ts` — `MorningSurface`, `needsYouCount`,
     `degraded`, `isMorningAllCalm`.
   - `server/src/notifyBark.ts` — `BIG_MOMENT_CLASSES`, `notifyBigMoment`,
     `push()`, edge-notifier factories.
   - `server/src/morningPush.ts` — `buildMorningPushMessage` (the
     "NEEDS YOU: N" lead convention), the once-daily persisted gate.
   - `webview-v3/src/state/stopAll.ts` — `stoppedFromLatch`,
     `reduceAutomationStopped` (STOP-ALL is the paging kill switch).
   - `webview-v3/src/state/tailStore.ts` + `net/tailManager.ts` — the tail
     ring (ephemeral, `MAX_TAIL_ENTRIES=500`; server ring is retention
     authority) — the replay overlay source.
   - `webview-v3/src/state/parkedDrafts.ts` — the PARK primitive (paging
     "park as morning item" reuses this pattern, not a new list).
   - `server/src/httpServer.ts:521-655` — how `/api/shift`, `/api/morning`,
     `/api/ops/*`, `/api/memory/*` GET routes register (your replay +
     paging-status endpoints follow this exact idiom).
   - `webview-v3/src/state/crisisStore.ts` — `reduceCrisisState`
     transition edges (crisis sound + replay events).
5. `.planning/v6/SPRINT-STATE.md` + `.planning/v6/RUN-MAP-v5-v7-2026-07-12.md`
   — ledger conventions, GATED list (§5), Bark command discipline (never
   inline the key).

---

## ⚠ Reconcile before build (flag, do not paper over)

The design references a few things that don't match the deployed code.
Resolve each as written; if a resolution changes scope, STOP and ask.

1. **"existing notificationSound.ts" is the WRONG face.**
   `webview-ui/src/notificationSound.ts` is legacy. The deployed v3 sound
   stack is `webview-v3/src/state/soundscape.ts` (pure specs + persistence)
   - `webview-v3/src/engine/soundscape.ts` (WebAudio). Build V9-1 on the
     v3 stack. Do NOT import or extend `notificationSound.ts`.

2. **"persisted per-namespace (config.json pattern)" ≠ how v3 persists.**
   v3's soundscape mute persists to **localStorage**
   (`SOUNDSCAPE_MUTE_STORAGE_KEY`, `readSoundscapeMuted`), not server
   `config.json`. Server settings (`soundEnabled` etc.) flow through the
   `settingsLoaded` WS message and are a different, heavier plane
   (`webview-v3/src/state/settings.ts`). **Decision for the build:** quiet
   hours + per-sound toggles persist to **localStorage** via the exact
   `KeyValueStorage`-injection idiom `soundscape.ts`/`parkedDrafts.ts`
   already use (unit-testable in plain Node, no jsdom). "Per-namespace" is
   a webview-ui concept; the single v3 browser face has one namespace, so
   localStorage IS the per-face store. Do not migrate sound settings onto
   the server WS settings plane — that is out of scope and would touch the
   asyncapi contract for no honest gain.

3. **V9-1 "5 sounds" partly already exist.** `CHIRP_SPECS` today has 2:
   `dispatch-done`, `needs-input`. Map: `needs-input`→needs-you (rename or
   alias, keep the trigger), `dispatch-done`→dispatch-complete. ADD three:
   `crisis`, `all-calm`, `degraded-state`. Total = 5, hard cap 8 enforced
   in code (a `CHIRP_SPECS` with >8 keys must fail a unit test, not just a
   comment).

4. **V9-2 tail history is a bounded ephemeral ring, not durable.**
   `tailStore` caps at 500 entries/stream; the server ring is the
   retention authority and evicts. The design's own honest seam says "no
   new telemetry is added just for replay." Therefore: **persisted
   receipts are the durable replay spine** (autoExecutor receipts +
   `dispatchStore.getRecent` + morning/streak breach history); tails are a
   BEST-EFFORT overlay for windows the ring still holds. Anything the ring
   evicted renders ⊘ HONEST GAP, never interpolated. State this in the
   endpoint doc; do not add a durable tail log.

5. **V9-3 needs a NEW receipted escalator, but NOT a new push channel.**
   `notifyBigMoment` has a runtime-enforced fixed class allowlist
   (`BIG_MOMENT_CLASSES`). Add exactly ONE class (`needs-you-page`) and
   route escalation through the EXISTING `push()`/retry/mask machinery —
   never a second fetch path. The ladder's state (attempt count, backoff,
   receipts) is a new server module, but every phone push still goes out
   `notifyBigMoment`. This satisfies "receipted + rate-limited, never a new
   unreceipted push channel."

---

## Deliverables (dependency order)

Each deliverable: exact paths, behavior spec, what MUST NOT change, and one
pass/fail check (a command or an observation). Build in order — D2 depends
on D1's honesty-fixture pattern; D3 depends on D2's server contract; D5
depends on D4's endpoint; D6 depends on nothing and may slip.

### D1 — V9-1 Learnable sound grammar (client only)

**Files:**

- `webview-v3/src/state/soundscape.ts` (extend): grow `CHIRP_SPECS` to the
  5 kinds; add the hard-cap-8 invariant; add quiet-hours + per-sound-toggle
  pure helpers (localStorage-injected, per ⚠ #2); add the fired-caption
  data (`♪ needs-you` transient label text per kind — shape+word).
- `webview-v3/src/engine/soundscape.ts` (extend): `chirp(kind)` handles all
  5 kinds; distinct musical SHAPES (interval/rhythm), not volume levels
  (design V9-1). A single-oscillator beep-at-different-pitch is NOT a
  distinct shape — each kind gets a distinguishable envelope/interval.
- `webview-v3/src/App.tsx` (wire): add the three new rising-edge triggers —
  `crisis` off `crisisStore` transitions (near `:643-648`), `all-calm` off
  the morning `isAllCalm` rising edge (`net/morningFacts.ts#isAllCalm`),
  `degraded-state` off `/api/morning` `surface.degraded` rising edge.
  Emit the transient board caption on every fired chirp.
- `webview-v3/src/components/SettingsModal.tsx` (extend): a "Sound grammar"
  section — one row per sound that PLAYS the sound with its label (design
  V9-1 learnability aid), plus per-sound mute + a quiet-hours control. Keep
  the existing `Toggle` idiom and colorblind `● ON`/`○ OFF` state words.
- `webview-v3/src/constants.ts` (add): quiet-hours default window, caption
  TTL, cap constant `SOUNDSCAPE_MAX_KINDS = 8`. No inline magic numbers.

**Behavior:** 5 distinct sounds; each mirrors a visible board state saying
the same thing in shape+word (AUDIO-HONESTY RULE — a muted or missed sound
never loses information). Settings panel plays each with its label. A
just-fired sound shows a transient on-board caption (`♪ needs-you`). Quiet
hours + per-sound toggles persist across reload (localStorage). Default
posture stays MUTED (existing `readSoundscapeMuted` spec — a missing key
reads muted).

**MUST NOT change:** the default-muted contract; the ambience bed;
`notificationSound.ts` (untouched, legacy); the server settings WS plane;
asyncapi.yaml (pure client feature, zero wire change).

**Pass/fail:** `npm run test:webview-v3` green with NEW tests proving
(a) `CHIRP_SPECS` has ≤8 kinds and a >8 fixture fails the cap assertion;
(b) each of the 5 kinds maps to a distinct visible-state label
(audio-honesty: every chirp kind has a board-state twin); (c) quiet-hours +
per-sound-toggle round-trip through the in-memory `KeyValueStorage` fake.
Manual: open Settings, each sound plays on click with its label visible.

### D2 — V9-3 Paging escalator (server)

**Files:**

- `server/src/needsYouPager.ts` (new): the escalation state machine. Watches
  the unanswered needs-you set (same `pollState.state === 'blocked'` source
  `morningSurface.loadBoardSection` uses — never a second derivation).
  Ladder: board bubble (already visible) → after `PAGE_ESCALATE_DELAY_MS`,
  Bark push via `notifyBigMoment('needs-you-page', …)` carrying the
  needs-you COUNT (Q6, reuse `buildMorningPushMessage`'s "NEEDS YOU: N"
  lead) → repeat with backoff, MAX 3 pushes, then PARK as a morning item.
  Every escalation writes a receipt (verbatim: which agent(s), attempt N,
  ts, delivered/failed) to a persisted ledger following the autoExecutor
  receipts + `V3JsonPersistence` sidecar discipline. Per-project mute +
  STOP-ALL both silence: check the durable stop latch
  (`stoppedFromLatch` server equivalent / the `automationStopped` latch)
  BEFORE any push. An answered needs-you (state leaves `blocked`) resets
  that agent's ladder.
- `server/src/notifyBark.ts` (extend): add `'needs-you-page'` to
  `BIG_MOMENT_CLASSES` + `BIG_MOMENT_STATUS` (`'warning'` tier). No new
  fetch path — routes through existing `push()`.
- `server/src/httpServer.ts` (wire): register the pager tick on the SAME
  `setInterval` idiom `morningPush` uses (no shared tick primitive exists;
  each module exposes a pure tick, httpServer wires interval + onClose
  cleanup — verified pattern). Register a `GET /api/paging` status route
  (receipts + current ladder state) next to `/api/ops/self-heal:548`.
- `server/src/constants.ts` (add): `PAGE_ESCALATE_DELAY_MS`,
  `PAGE_BACKOFF_MS`, `PAGE_MAX_ATTEMPTS = 3`. Centralized, no inline.

**Behavior:** an unanswered needs-you escalates on a receipted ladder,
capped at 3 pushes, then parks; STOP-ALL and per-project mute silence it;
answering resets it. Escalation timing lives in constants; V8-5's
responsive-window histogram (if it ships) can inform WHEN to page but never
WHETHER (design V9-3) — do not gate paging on histogram presence.

**MUST NOT change:** `bin/dispatch-runner.mjs`, `bin/lib/dispatch-rules.mjs`
(zero diff — RUN-MAP GATED); the once-daily morning digest gate; the
existing big-moment classes' behavior; the STOP-ALL latch semantics. Never
echo `WAR_ROOM_BARK_URL` or any token (mask always).

**Pass/fail:** `npm run test:server` green with NEW tests proving:
(a) escalation stops at exactly 3 pushes then parks; (b) a STOP-ALL latch
engaged → zero pushes; (c) per-project mute → zero pushes for that project;
(d) answering (state leaves `blocked`) resets the ladder; (e) every push
emits exactly one persisted receipt; (f) the pager reads the temp-HOME
sidecar (no real `~/.pixel-agents` write — `vi.mock('os')`). All timing via
fake timers/injected `now`, never real sleeps.

### D3 — V9-3 Paging surface (client)

**Files:**

- `webview-v3/src/state/paging.ts` (new): pure reducer over `GET /api/paging`
  (or a WS broadcast if D2 adds one — see asyncapi note below) → escalation
  state per agent (bubble → paged Nx → parked). Colorblind: shape+word
  (`⚠ PAGED ×2`, `⊘ PARKED`), never color.
- `webview-v3/src/components/` (extend the needs-you surface, likely
  `TriageBoard.tsx` / `MorningPanel.tsx`): show the escalation state on the
  agent's card; a per-project mute control; parked pages appear as morning
  items (reuse `parkedDrafts.ts` — never invent a second list). STOP-ALL
  control already exists (`StopAllControl.tsx`) — surface that it silences
  paging in its label/help.
- `webview-v3/src/components/SettingsModal.tsx` or the morning surface:
  a receipts view for the escalation ladder (verbatim receipts on tap).

**Behavior:** open boards show the live escalation state; muting a project
and STOP-ALL both visibly silence paging; parked pages land in the morning
items list with an explicit re-confirm tap to re-arm (parkedDrafts contract:
never auto-fires).

**MUST NOT change:** the STOP-ALL latch reducer semantics
(`reduceAutomationStopped`); the parkedDrafts "never auto-fire" contract.

**Pass/fail:** `npm run test:webview-v3` green with NEW tests: the paging
reducer renders bubble→paged→parked from a fixture; STOP-ALL state hides/
silences the paging affordance; a parked page requires explicit re-confirm.
Manual: with a blocked agent, escalation state renders and per-project mute
silences it.

### D4 — V9-2 SHIFT replay data (server)

**Files:**

- `server/src/replayWindow.ts` (new): pure aggregation of a time window
  into an ordered event timeline. Sources (durable spine, per ⚠ #4):
  autoExecutor receipts, `dispatchStore.getRecent`, morning/streak breach
  history, crisis records if persisted; tails are a best-effort overlay for
  windows the server ring still holds. Windows with no data → explicit
  `{ kind: 'gap' }` markers, NEVER interpolated activity. Default window =
  last all-calm → now (design V9-2). Every event carries its real ts +
  source; the payload is honest about which spans are ⊘ (ring-evicted).
- `server/src/httpServer.ts` (wire): `GET /api/replay?from=&to=` next to
  `/api/morning:578`, same registration idiom.
- `server/src/constants.ts` (add): default window bounds, ⊘-gap threshold.

**Behavior:** a GET returns an ordered, honest timeline for a window; gaps
are explicit; no fabricated activity; no new telemetry added (reads only
what already persists).

**MUST NOT change:** the tail ring retention (do not add a durable tail
log); dispatch/receipt schemas; asyncapi.yaml (a GET REST route is outside
the WS contract — no wire change, no generate).

**Pass/fail:** `npm run test:server` green with NEW tests: a window with a
known receipt gap yields a `gap` marker (not interpolation); events are
ts-ordered; an empty window yields all-⊘, never fabricated events;
temp-HOME isolation via `vi.mock('os')`.

### D5 — V9-2 Replay timeline (client)

**Files:**

- `webview-v3/src/state/shiftReplay.ts` (new): pure timeline model over
  `GET /api/replay` — playhead, scrub position, per-frame agent states, ⊘
  gap spans. Distinct from `state/shiftReport.ts` (the scorecard) — replay
  is the animated timeline.
- `webview-v3/src/components/ShiftPanel.tsx` (extend) or a new
  `ReplayPanel.tsx`: scrubber + play/pause; a PERMANENT on-screen `⧖ REPLAY`
  label visible the ENTIRE time (design V9-2's hardest honesty test — a
  replayed crisis must be unmistakable from a live one); ⊘ gap spans
  rendered explicitly on the scrubber.
- `webview-v3/src/engine/` (the office canvas render path): drive agents'
  recorded state changes from the replay playhead when replay is active;
  gate all LIVE telemetry mutation while replaying so live and replay never
  interleave. The permanent REPLAY chrome must be impossible to lose
  behind a scroll or a modal.
- `webview-v3/src/components/MorningPanel.tsx` (wire): the morning summary
  line links to the replay of the overnight window (design V9-2 morning
  integration, Q1 made visual) — reuse the existing `?open=` deep-link
  form (`state/launch.ts`, e.g. `?open=replay&window=overnight`).

**Behavior:** scrub/play a recorded window; agents animate their recorded
states on the canvas; REPLAY is labeled the entire time; ⊘ gaps are
visible, never interpolated; the morning push's summary links here.

**MUST NOT change:** the live telemetry stores' own reducers (replay reads
a separate model; it must not write into `agentStore`/`crisisStore`); the
honest-⊘ gap rendering from D4.

**Pass/fail:** `npm run test:webview-v3` green with NEW tests: the replay
model exposes REPLAY-active as a first-class flag (the label can't be
conditionally dropped); a ⊘ gap span in the fixture renders as a gap on the
scrubber; scrubbing to a gap shows no agent activity. Manual: replay an
overnight window, confirm the `⧖ REPLAY` label never disappears and a live
crisis is visually distinct from a replayed one.

### D6 — V9-4 Wall-display glance mode (client kiosk) — LAST, may slip

**Files:**

- `webview-v3/src/` new kiosk route/mode (a `?kiosk=1` or `/wall` view
  toggled off the existing route/launch plane): full-screen, ultra-low
  density — needs-you count HUGE, district health strip, degraded banner.
  Readable at 3 m.
- Auto-recovers from WS disconnects without interaction (it's a wall — no
  keyboard). Reuse `WebSocketTransport` reconnect/backoff; no manual
  re-connect affordance.

**Behavior:** a glanceable kiosk render; recovers from disconnects on its
own. Explicitly SECOND priority to D1–D5.

**MUST NOT change:** any D1–D5 behavior; the normal board route.

**Pass/fail:** renders the needs-you count, district strip, degraded banner
at kiosk scale; a simulated disconnect auto-recovers with no interaction.
**If the physical move / time runs out, D6 SLIPS to v10+ without ceremony
(design V9-4). Record the slip in the ledger; it is not a failure.**

---

## HARD CONSTRAINTS (every deliverable)

- **Test isolation:** any test touching HOME/`~/.pixel-agents` uses the
  temp-HOME `vi.mock('os')` idiom (budgetStore/morningPush pattern) —
  NEVER the real homedir. A sandboxed homedir denial = fix the test's
  isolation, never add the real homedir to `writable_roots` (CLAUDE.md
  Codex Delegation #3).
- **Zero diff** in `bin/dispatch-runner.mjs` and `bin/lib/dispatch-rules.mjs`
  — any diff there is a plan violation.
- **Bark/push paths stay receipted + rate-limited.** No new unreceipted
  push channel. V9-3 routes through the existing `notifyBark.push()` with
  ONE new class; every push emits a persisted receipt.
- **Sounds toggleable + quiet hours persisted** (localStorage, per ⚠ #2).
  Default posture MUTED. Audio-honesty rule on every sound: a sound is
  NEVER the sole carrier — every sound mirrors a visible shape+word state.
- **AsyncAPI:** only if the wire protocol GENUINELY needs a new WS message
  (e.g. a live paging-escalation broadcast in D3 instead of GET polling).
  Default to GET polling to avoid a wire change. If a message IS added:
  edit `core/asyncapi.yaml` → `npm run asyncapi:generate` → commit the
  regenerated `core/src/messages.ts` → CI drift check must be zero. Never
  hand-edit `messages.ts`.
- **Constants centralized** per the Constants Policy table (server timing →
  `server/src/constants.ts`; webview magic numbers → `webview-v3/src/constants.ts`;
  CSS vars via `index.css :root`). No inline colors/magic numbers — the
  custom ESLint rules block PRs.
- **TS constraints:** `.js` extensions on all relative server imports; no
  `enum` (use `as const`); `import type` for type-only imports;
  `noUnusedLocals`/`noUnusedParameters` strict.
- **Colorblind + audio-honesty on EVERY UI/sound deliverable:** shape +
  word first, color never load-bearing; ⊘ honest-absent over fabricated
  values, at every scale (states, gaps, staleness).
- **Secrets masked always** (`maskUrlForLog` pattern); never echo tokens or
  Bark keys.

## GATES (all green in one pass before hand-back)

```
npm run check-types      # tsc + server test tsconfig + webview-v3 tsc -b
npm run lint
npm run test:server
npm run test:webview-v3
npm run test:poller
npm run asyncapi:generate && git diff --exit-code core/src/messages.ts   # zero drift
```

Sandbox note: `test:server` binds 127.0.0.1 sockets and `test:poller` may
hit `ps` EPERM under `workspace-write` — pass
`-c sandbox_workspace_write.network_access=true` and expect the reviewing
agent to re-verify any socket/`ps` failures UNSANDBOXED (CLAUDE.md Codex
Delegation). A green sandbox run that skipped those is not a pass; say so.

No NEXUS deploy in this plan — deploys are Greg-gated at version boundaries
only (RUN-MAP §0.2). This plan carries no deploy authorization.

## Commit discipline

- Explicit-path staging only. NEVER `git add -A`. Stage the exact files a
  deliverable touched; guard with a staged-count check.
- One commit per deliverable (or per coherent sub-step), em-dash
  conventional subject, e.g.
  `feat(wr): V9-1 — 5-sound learnable grammar + audio-honesty fixtures`.
- Trailer on every commit:
  `Co-Authored-By: Codex (gpt-5.6-sol) <noreply@openai.com>`
- Pushes are owned by the REVIEWING agent, never codex (sandbox grants
  codex write to all refs via the main `.git`; keep pushes human/reviewer).
- Watch for parallel sessions / stale worktree locks before staging
  (CLAUDE.md Worktrees).

## FINAL MESSAGE format (codex → reviewer)

Return, do not write a report file:

1. Per-deliverable status: `✓ built` / `⚠ partial` / `⊘ skipped` with one
   line each (D6 slip is a legitimate ⊘ — say why).
2. Test deltas: before/after counts for server, webview-v3, poller.
3. Gate results verbatim (which ran sandboxed vs need unsandboxed re-verify).
4. Honest gaps (⊘): anything the design wanted that the code can't yet
   honor, and why. No completion theater — an artifact is not an outcome.
5. Any asyncapi change made (with the drift-check result) or an explicit
   "no wire change".

---

## Greg gates (explicit go before going live)

These are Greg's to decide; build them behind a flag/default and record the
default in the ledger rather than stalling:

1. **Paging escalation default state (V9-3).** ON-by-default vs opt-in is
   Greg's call — this is assertive, phone-interrupting behavior. Ship it
   defaulting to the smallest reversible posture (recommend: escalation
   ladder present but the Bark rungs OFF until Greg flips it on per
   project) and Bark him for the go. Board-bubble escalation (no push) can
   default on.
2. **Sound vocabulary sign-off by ear (V9-1).** The exit question requires
   Greg to identify all five sounds blind after a week. He signs off on the
   actual musical shapes by ear — do not consider V9-1 "done" on tests
   alone; deliver the Settings play-each-sound panel and get his verdict.
3. **Wall mode slipping (V9-4).** May slip to v10+ without ceremony if the
   move hasn't happened — record the slip, no gate needed to slip it.
4. **Deploy** (all of V9) — version-boundary, Greg-gated, per RUN-MAP §0.2.
