# C3-DESIGN — Born-managed launcher wrapper + free-form PROMPT verb

Status: **DESIGN ONLY.** No code in this doc or from it until Greg gates
it (see §6). Phase E of `.planning/v5/RUN-MAP-2026-07-12.md` — design
gate is non-negotiable; the build stays gated regardless of how clean
this design reads.

## 0. One-sentence goal

Give Greg a launcher (`wr claude …` or similar) that starts HIS OWN
terminal sessions inside runner-owned tmux from the first keystroke, so
every session he starts is "born managed" — visible, answerable, and
now also free-form-promptable from the phone — through the _existing_
T2/T4 plane, with zero new containment class.

## 1. Why this is a design doc, not a ticket

Three independent recorded hits converge on this exact shape:

- **verified** — `.planning/v2/TUNING.md:846-856` ([KICKOFF v4 G-1]):
  Greg approved REMOTE-ANSWER-DESIGN.md's hand-started-sessions-stay-
  DESK-only constraint, but flagged it "not permanent doctrine,"
  naming _"relaunching via a war-room wrapper alias so ALL his sessions
  are born managed"_ as the research direction, and _"never pty
  injection (rejected class, stands)"_ in the same breath.
- **verified** — `.planning/v2/TUNING.md:937-940`: "UX gap (Greg): no
  free-form prompting of visible sessions — ANSWER exists only for
  managed sessions … A launcher shim or per-session opt-in needs its
  own design gate before any build."
- **verified** — `.planning/v5/HORIZON-v20.md:47-49` / register Q17
  (`.planning/v5/HORIZON-QUESTIONS.md:32` +
  `.planning/v5/HORIZON-v20.md:106-114`): Greg's answer is explicit —
  _"FULL free-form remote prompting wanted"_ and _"Q16 wrapper default
  decided at the C3 design gate"_ — i.e. the direction is settled, only
  the HOW and the default are open, and both are named as this
  document's job.

Nothing here argues a NEW containment surface. The wrapper's entire
job is to make MORE sessions eligible for the plane that already
exists and is already reviewed (T2/T4, see §2).

## 2. What already exists (verified, this session, via code read)

The T2/T4 answer plane described as "AWAITING APPROVAL" in
`.planning/v4/REMOTE-ANSWER-DESIGN.md` is actually **built and
tested**, not just designed — the design doc's own status header is
stale. Confirmed by direct code read:

| Piece                                       | Where                                                                                                                                       | What                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Managed-session launch (`action:'session'`) | `bin/dispatch-runner.mjs:777-830`                                                                                                           | Honors session-launch requests, calls `createManagedSession`, writes the manifest, audits `session-started`/`session-denied`/`session-manifest-write-failed` |
| tmux ownership                              | `bin/lib/managed-sessions.mjs:184-228`                                                                                                      | `createManagedSession` spawns `tmux new-session -d -s war-room-<dispatchId>`                                                                                 |
| Liveness sweep                              | `bin/dispatch-runner.mjs:734-775`                                                                                                           | `sweepManagedSessions` — manifest vs `tmux has-session`, prunes dead entries, posts `session-ended`                                                          |
| Answer delivery                             | `bin/lib/managed-sessions.mjs:257-272`                                                                                                      | `deliverAnswer` — literal `tmux send-keys -l`, Enter sent as a separate keystroke (never embedded)                                                           |
| Text validation                             | `bin/lib/managed-sessions.mjs:230-255`                                                                                                      | `validateAnswerText` — 4000-char cap, control-char reject                                                                                                    |
| One-shot nonce (runner side)                | `bin/dispatch-runner.mjs:848-911` (`processAnswerInstructions`)                                                                             | Consumes against `state.consumedNonces`, denies replay                                                                                                       |
| Nonce minting (server side)                 | `server/src/dispatchStore.ts:905-951` (`requestAnswer`)                                                                                     | Mints via `randomUUID()` (L935), enqueues, audits `answer-requested`                                                                                         |
| Drain-once queue                            | `server/src/dispatchStore.ts:956-964` (`drainAnswersFor`)                                                                                   | Same at-most-once contract as the existing `stop[]` channel                                                                                                  |
| Duplicate-outcome guard                     | `server/src/dispatchStore.ts:967-984`                                                                                                       | `answer-duplicate-outcome-dropped`                                                                                                                           |
| Deny-by-default capability flag             | `bin/lib/dispatch-rules.mjs:42,81,90,159-171`                                                                                               | `emptyAllowlist()` ships `sessions:false`; `action==='session'` denied unless `dispatch.json` sets `sessions:true` → `sessions-not-allowlisted`              |
| HTTP surface                                | `server/src/httpServer.ts:1320-1376`                                                                                                        | `POST /api/agents/answer`, `GET /api/agents/answer/:id`, `GET /api/agents/answers`, `POST /api/answers/:id/status`                                           |
| Board UI gate                               | `webview-v3/src/components/AgentDrawer.tsx:187`                                                                                             | `const managed = record?.managed ?? false;` — the ONLY gate that unlocks the ANSWER composer                                                                 |
| Tests                                       | `bin/test/managed-sessions.test.mjs` (nonce replay L436-460), `server/__tests__/answerPlane.test.ts`, `webview-v3/test/answerFacts.test.ts` | Nonce/manifest/delivery/receipts all covered today                                                                                                           |

**Confirmed absent:** no distinct `PROMPT` verb exists anywhere in
code. `ANSWER` is the only verb on the wire (verified — grep across
`webview-v3`, `server/src`, `bin/` found `DISPATCH_PROMPT_MAX_CHARS`
only on the unrelated CALL-modal free-text field). §4 below is new
work, not a rename.

**Net effect for this design:** the wrapper does not touch tmux
plumbing, nonce logic, delivery, or the manifest at all. It only
changes _how a session comes to exist inside that manifest in the
first place_ — today only T4's own CALL-modal launch path creates one;
the wrapper adds a second, human-initiated entry point into the exact
same `createManagedSession` call.

## 3. The wrapper itself

### 3.1 Launch mechanism — four options, honestly compared (codex review correction)

An earlier draft of this section claimed the wrapper "calls the SAME
`createManagedSession(...)` path T4 already uses" with "zero lines of
`bin/dispatch-runner.mjs` changed." **That claim does not survive a
close read of the code and has been corrected.** Verified this
session: `bin/dispatch-runner.mjs` is a script entrypoint
(`#!/usr/bin/env node`, line 1) — `audit()` (line 424) and
`readAllowlist()` (line 201) are private `function` declarations with
no `export`, and the session-launch gate itself
(`handleItem()` line 916 → `runSessionLaunch()` line 784, both
private) is not an importable module boundary. A separate wrapper
process cannot call into it in-process today. The reusable pieces
genuinely are exported from `bin/lib/` — `dispatch-rules.mjs` exports
`validateRequest`/`parseAllowlist` (lines 41, 56, 159) and
`managed-sessions.mjs` exports `createManagedSession`/manifest I/O
(lines 45-274) — but the glue that constitutes "the gate" (read
allowlist from disk → validate → audit → create session → POST
decision) lives only inside the private orchestration in
`dispatch-runner.mjs`. So: four real options, not one free lunch.

- **(a) Wrapper duplicates the gate/audit logic in its own code.**
  **REJECTED.** Two independently-maintained copies of a deny-by-
  default security check will drift; a fix to one path silently
  leaves the other stale. Never acceptable for containment logic.
- **(b) Wrapper skips the gate entirely** (assumes launch is always
  fine since it's Greg's own machine). **REJECTED.** Breaks
  acceptance criterion #4 below and the "no wrapper-specific bypass,
  ever" invariant this whole design rests on — the capability flag
  must mean the same thing regardless of which code path asks.
- **(c) Refactor `dispatch-runner.mjs` to export its gate + audit
  helpers** (`readAllowlist`, `audit`, and the session-launch branch of
  `handleItem`/`runSessionLaunch`) into `bin/lib/`, then have both the
  runner's own poll loop AND the new wrapper call the same exported
  function in-process. Real reuse, zero logic duplicated — but it is a
  genuine (if small) change to security-critical code in
  `dispatch-runner.mjs`, and it only works when the wrapper runs on
  the SAME machine/process context as the runner (no cross-machine
  launch story).
- **(d) Wrapper submits the launch through the EXISTING server
  dispatch path and waits for the result** — **RECOMMENDED.** Verified
  this session: the CALL modal's own session-launch request is not an
  HTTP POST at all, it is a WebSocket message
  (`case 'dispatchRequest'` in `server/src/clientMessageHandler.ts:132-173`,
  requiring `action:'session'` + `machine`, calling
  `dispatchStore.enqueue()` at lines 141-171) on the same trusted,
  tailnet-only WS plane every board client already uses. The runner's
  ONLY inbound surface is its own poll
  (`/api/dispatch/poll`, `httpServer.ts:1008`), driven by a
  `setTimeout` chain — not `setInterval`, chosen so slow ticks never
  overlap (`bin/dispatch-runner.mjs:1087-1091) — at
`WAR_ROOM_DISPATCH_POLL_MS`, default **5000ms**, floor
`MIN_INTERVAL_MS`=2000ms (`bin/dispatch-runner.mjs:85,162,192-193`).
So option (d) means: the wrapper CLI opens a WS connection using the
same auth every board client uses, sends the identical
`dispatchRequest{action:'session', machine, ...}`message the CALL
modal sends, then waits — either polling`GET /api/agents/answers`-style state or listening on the same WS
connection for the accept/deny broadcast every client already
receives — until the manifest entry/tmux session exists, then
`tmux attach -t war-room-<dispatchId>`locally. **This requires
ZERO changes to`dispatch-runner.mjs`, `dispatch-rules.mjs`, or the
  gate/audit logic** — the wrapper is a new WS _client_, structurally
  identical to the browser board, not a new privileged caller.

**Recommendation: (d).** It is genuine wholesale reuse of the gate the
codex review asked this document to name honestly — no runner code
touched, no duplicated security logic, same audit trail, same deny
path. Trade-off, stated plainly: **latency** (session appears
2-7s after request, bounded by the poll floor/default above — a real
UX cost vs. the "instant" feel of typing `claude` directly, worth
Greg's sign-off, see §6) and **offline-server behavior** (if NEXUS is
unreachable, the wrapper cannot enqueue at all — it must fail closed
with a clear local message, e.g. "war-room server unreachable, launch
a plain unmanaged `claude` instead," never silently falling back to an
unmanaged launch that LOOKS managed). Option (c) remains the fallback
recommendation if the build phase decides the poll latency is
unacceptable — it is a strictly larger, security-code-touching change,
so (d) is the harder-to-regret starting point.

### 3.1b What the wrapper does (mechanism (d), the recommended shape)

`wr claude [any claude args...]` (name TBD — `wr` chosen here as a
short, memorable, non-colliding alias; Greg's call, see §6):

1. Generates a `dispatchId` locally, opens a WS connection to the
   server using the same tailnet-bearer auth every board client uses.
2. Sends `dispatchRequest{action:'session', machine:<this machine>,
cwd:<pwd>, provider:'claude', args:<argv>, dispatchId}` — the
   IDENTICAL message shape the CALL modal already sends
   (`server/src/clientMessageHandler.ts:132-171`).
3. Waits for the runner's decision to come back over the SAME channel
   every board client watches (accept/deny + reason) — same
   `sessions-not-allowlisted`-class denial as any other launch if the
   machine's `dispatch.json` lacks `sessions:true`.
4. On accept, polls (or listens) until the manifest/board shows the
   session alive, then runs `tmux attach -t war-room-<dispatchId>`
   locally — Greg's terminal becomes a normal tmux client of a session
   the runner ALSO owns, created via the runner's own unmodified
   `runSessionLaunch` → `createManagedSession` path
   (`bin/lib/managed-sessions.mjs:184-228`).
5. On detach/exit, lifecycle is identical to any CALL-launched
   session — `sweepManagedSessions` (`bin/dispatch-runner.mjs:734-775`)
   already handles it, no wrapper-specific cleanup code.
6. The runner's next poll tick advertises it exactly like a
   CALL-launched session (`bin/dispatch-runner.mjs:999` + `:277`) — no
   new advertisement path, no new manifest shape.

### 3.2 Containment — no new rejected-class code

- **NO pty injection, anywhere, ever** (rejected class stands per
  `.planning/v4/REMOTE-ANSWER-DESIGN.md` §"The founding constraint" and
  reaffirmed in TUNING G-1). The wrapper does not attach to an
  existing unmanaged pty — it creates a brand-new tmux session and the
  user's own terminal becomes ITS client. This is categorically
  different from "adopt into tmux" schemes that would reparent an
  already-running unmanaged process; the wrapper only ever wraps a
  _fresh_ launch.
- **One-shot nonce + receipts**: unchanged, inherited wholesale. A
  wrapper-launched session answers through the identical
  `requestAnswer` → `drainAnswersFor` → `processAnswerInstructions` →
  `deliverAnswer` path as a CALL-launched one. No new nonce logic to
  design or review.
- **Deny-by-default**: the wrapper still routes launch through
  `dispatch-rules.mjs`'s `sessions:true` capability flag
  (`bin/lib/dispatch-rules.mjs:159-171`). A machine with
  `sessions:false` (or missing) denies the wrapper's launch exactly
  like it denies a CALL-modal one today — same `sessions-not-
allowlisted` reason, same receipt shape. **No wrapper-specific
  bypass of the machine capability flag, ever.**
- **Audit parity**: `session-started` / `session-denied` /
  `session-ended` audit lines fire identically regardless of which
  entry point created the session — the manifest doesn't record origin
  today (verified: `bin/lib/managed-sessions.mjs:45-98` manifest shape
  has no `source` field). **Open item, not a blocker**: consider
  adding a `launchedVia: 'wrapper'|'call-modal'` field to the manifest
  entry so the board/audit can distinguish Greg's own terminal
  sessions from dispatch-launched ones. Low-risk additive field;
  recommend including it in the build, not gating the design on it.
- **Manifest write race (codex MINOR, reconciled) — dissolved by
  mechanism (d).** `managed-sessions.mjs` persists the manifest via
  whole-array temp+rename (`readManifest`/`writeManifest`,
  `bin/lib/managed-sessions.mjs:45-98`), and the runner does its own
  read-modify-write around it
  (`bin/dispatch-runner.mjs:801-810`). If a wrapper process wrote to
  the manifest directly and concurrently with the runner's own RMW,
  an update could be silently lost (last-writer-wins on the
  temp+rename). **Because §3.1's recommended mechanism (d) never has
  the wrapper touch the manifest at all — only the runner's own
  `runSessionLaunch` path writes it, exactly as today — the runner
  remains the manifest's single writer and this race does not exist
  under (d).** Recorded here as a build-phase requirement ONLY if a
  future revision moves to mechanism (c) (in-process refactor) or any
  design where a second process writes the manifest: that build must
  add a lockfile or otherwise enforce single-writer discipline before
  shipping, not discover the race by losing a real session.

### 3.3 What a wrapped session does NOT lose (verified/inferred split)

The kickoff draft (`.planning/v5/KICKOFF-v5-DRAFT.md`, C3 entry) names
this as the open question the design doc must answer. Per item:

- **Scrollback** — **inferred, needs a build-time check, not a design
  blocker.** tmux maintains its own scrollback buffer independent of
  the outer terminal's; Greg's terminal emulator's native scrollback
  (e.g. Cmd+F search, click-to-select) stops working the way he's used
  to and tmux's own scrollback (`prefix + [`) takes over. This is a
  **real UX change**, not a loss of capability — call it out in the
  wrapper's first-run banner rather than pretend it's invisible.
- **Resize behavior** — **verified via tmux semantics, not this repo's
  code**: tmux resizes its virtual terminal to match the LARGEST
  attached client by default (`aggressive-resize` off) or the active
  client (`aggressive-resize` on). With exactly one client (Greg's own
  terminal, the common case), resize tracks his terminal 1:1 — no
  visible difference. If a second client ever attaches (e.g. a future
  "watch this session" board feature), only then does multi-attach
  resize contention appear. **Not a problem for this design's scope**
  (single human client), flag as a watch-item if multi-attach is ever
  built.
- **Exit codes** — **⊘ NO DATA, needs verification at build time.**
  tmux does not propagate the inner process's exit code to the
  attaching client's shell by default (`tmux attach` returns tmux's own
  exit status, not claude's). Any of Greg's shell scripting that
  depends on `$?` after `claude` returning claude's actual exit code
  will observe tmux's exit status instead unless the wrapper
  explicitly re-derives and re-exits with the inner code (achievable
  via `tmux wait-for` + a post-exit marker, a known pattern — not
  designed here, flagged for the build phase).
- **Ctrl-C / signal semantics** — not named in the kickoff draft but
  worth flagging: tmux's own prefix-key (default `Ctrl-b`) can collide
  with Claude Code's own keybindings if Greg or Claude Code use
  `Ctrl-b`-prefixed sequences. **⊘ NO DATA on whether Claude Code uses
  Ctrl-b** — verify before shipping; if it collides, the wrapper should
  set a war-room-specific tmux prefix (e.g. a dedicated
  `~/.war-room/tmux.conf` loaded via `-f`) rather than touching Greg's
  own `~/.tmux.conf`.

## 4. Free-form PROMPT verb

### 4.1 Scope

Q17 settled the direction: **full free-form remote prompting is
wanted**, on managed sessions, full stop — not just answer-when-asked.
This means a NEW verb, `PROMPT`, distinct from `ANSWER`:

- **ANSWER** (existing): responds to a session that IS currently
  blocked/waiting — the drawer shows `waitingFor`, the composer's
  one-tap options come from parsing it
  (`webview-v3/src/components/AgentDrawer.tsx:316-348`,
  `parseAnswerOptions`). Semantically: "answer the question this
  session asked."
- **PROMPT** (new): sends free text to a managed session regardless of
  whether it's currently blocked — Greg steering a session that's mid-
  task, not just unblocking one that's stuck. Semantically: "tell this
  session something," same as typing into its terminal directly.

### 4.2 Why this is additive, not a rebuild

Every mechanical piece ANSWER already has is verb-agnostic in practice:
`deliverAnswer`'s `tmux send-keys -l` + separate Enter
(`bin/lib/managed-sessions.mjs:257-272`) does not care whether the
text is a response to a question or an unprompted instruction. The
nonce mint/consume/drain/duplicate-guard chain
(`server/src/dispatchStore.ts:905-984`,
`bin/dispatch-runner.mjs:848-911`) is generic delivery infrastructure,
not ANSWER-specific. The recommended shape:

- Reuse the SAME wire shape (`{id, managedSessionRef, text, nonce}`)
  under a new discriminant, e.g. `verb: 'answer' | 'prompt'` on the
  instruction, OR a parallel `promptQueue`/`PromptInstruction` mirroring
  `AnswerInstruction` 1:1 if AsyncAPI's discriminated-union style
  (`core/asyncapi.yaml`) makes a shared type awkward — **Greg/build-
  phase call, not designed here**, but either way it is a schema
  addition to `core/asyncapi.yaml` (regenerates `core/src/messages.ts`,
  same CI drift-check discipline as every other wire change).
- Delivery-side: `deliverAnswer` in `bin/lib/managed-sessions.mjs`
  either gets a second thin wrapper (`deliverPrompt`) or a `verb`
  parameter — no new tmux mechanism.
- UI-side: the drawer composer gains a mode toggle (Answer vs. Prompt)
  or a second entry point, gated on the SAME `managed === true` check
  already at `webview-v3/src/components/AgentDrawer.tsx:187` — the
  verbatim-confirm step (`.planning/v4/REMOTE-ANSWER-DESIGN.md`'s "UI
  contract" — always show exact text before send) carries over
  unchanged; it is, if anything, MORE important for free-form prompts
  than for answers, since there's no question text to anchor against.
- **No relaxation of any existing guard.** Text cap, control-char
  reject, one-shot nonce, at-most-once drain, duplicate-outcome
  drop — all apply identically to PROMPT. The only thing that changes
  is that the send is not gated on the session currently being in a
  waiting/blocked state.

### 4.3 Why PROMPT does not reopen the unmanaged-session question

REMOTE-ANSWER-DESIGN's founding constraint — _"the runner can only
ever answer sessions it supervises"_ — is untouched. PROMPT is a
capability of the SAME managed-session set ANSWER already operates on;
it does not extend reach to any session outside the manifest. Unmanaged
(hand-started, non-wrapper) sessions remain DESK-only, forever, exactly
as REMOTE-ANSWER-DESIGN states. The wrapper (§3) is what grows the
managed set; PROMPT (§4) is what you can now do to sessions already in
it. These are two independent, additive changes to the same plane —
not a reopening of the rejected pty-injection class.

## 5. Acceptance criteria (from KICKOFF-v5-DRAFT C3, restated as tests)

1. Greg runs the wrapper command on MACBOOK; a `tmux new-session` with
   the `war-room-<id>` naming convention is observably created
   (`tmux ls` shows it), and Greg's terminal is attached to it as a
   normal interactive Claude session.
2. Within one poll tick (bounded by `WAR_ROOM_DISPATCH_POLL_MS`,
   default 5000ms, floor 2000ms —
   `bin/dispatch-runner.mjs:85,162,192-193`), the session appears on
   the board with `managed: true` — same code path as a CALL-modal
   launch (`bin/dispatch-runner.mjs:999`), zero runner-side code
   changes under the recommended mechanism (d, §3.1); the wrapper
   itself is new code (a WS client), the gate/audit path it drives is
   not.
3. From the phone, Greg sends a free-form PROMPT (not a reply to a
   pending question) to that session; the live tail (T1 plane) shows
   the session act on it — i.e. the text appears as if typed at the
   keyboard and Claude responds to it in-transcript.
4. A machine with `sessions:false` (or no `dispatch.json`) denies the
   wrapper's launch attempt with the same `sessions-not-allowlisted`
   receipt CALL-modal launches get today — proving no wrapper-specific
   bypass exists.
5. A PROMPT send against a session NOT in the manifest (e.g. Greg's
   plain unwrapped `claude` in another tab) is denied — proving PROMPT
   never reaches beyond the managed set.

## 6. Greg gates (every decision reserved for him — max these, nothing silently decided)

1. **Wrapper name/command** — `wr claude …` is a placeholder in this
   doc; Greg picks the actual alias.
2. **Opt-in vs. opt-out default (register Q16)** — HORIZON-v20 records
   this as "decided at the C3 design gate," but this document does not
   pick a side. Two real options:
   - **Opt-in (alias)**: Greg types a NEW command (`wr claude`) when he
     wants a session managed; his existing muscle-memory `claude`
     invocation is untouched and stays unmanaged/DESK-only.
   - **Opt-out (shadow default)**: a shell function/alias named
     literally `claude` shadows the real binary so EVERY invocation is
     wrapped by default, with an escape hatch (e.g. `command claude`)
     for the rare unmanaged case.
     Opt-out delivers on "ALL his sessions are born managed" (the literal
     G-1 language) but is the more invasive, harder-to-undo change to
     Greg's daily terminal habit — and the AuDHD-comms doctrine this repo
     runs under (`CLAUDE.md` "Never cut over Greg's working morning
     unattended" analog) argues for starting opt-in and letting him
     promote it once proven. **Recommendation: opt-in first, revisit
     opt-out after Greg has used the wrapper daily for a while** — but
     this is his call, not a default silently taken.
3. **Scrollback/resize/exit-code tradeoffs (§3.3)** — whether the UX
   change (tmux scrollback replacing native terminal scrollback,
   `Ctrl-b` prefix collision risk) is acceptable as shipped, or needs
   the mitigations named (custom tmux.conf, exit-code re-derivation)
   BEFORE first use rather than as fast-follow.
4. **PROMPT wire shape (§4.2)** — shared discriminated instruction type
   vs. a parallel queue; an AsyncAPI schema decision with a CI drift-
   check consequence, worth Greg's or the build session's explicit
   choice rather than an implementer's silent pick.
5. **`launchedVia` manifest field (§3.2)** — additive and low-risk,
   recommended but not mandated by this design; Greg/build-phase can
   decline it without touching the core mechanism.
6. **Launch mechanism (§3.1) — (d) vs (c)** — this document
   recommends (d) (wrapper as a WS dispatch client, zero runner code
   touched, accepts poll-interval launch latency of a few seconds) over
   (c) (small export-only refactor of `dispatch-runner.mjs`'s gate/audit
   helpers, instant local launch, touches security-critical code). This
   is a real fork in what the build touches — confirm the recommendation
   or pick (c) before any build ticket is opened.
7. **Build authorization itself** — this entire document is design
   only. No T-numbered build ticket, no code, until Greg says go.

## 7. What this design deliberately does NOT do

- **This document itself** does not touch `core/asyncapi.yaml`,
  `bin/dispatch-runner.mjs`, `bin/lib/managed-sessions.mjs`,
  `server/src/dispatchStore.ts`, `server/src/httpServer.ts`,
  `bin/lib/dispatch-rules.mjs`, or
  `webview-v3/src/components/AgentDrawer.tsx` — read-only research
  citations only, verified this session, zero lines changed.
- **The recommended build (mechanism (d), §3.1)** likewise requires
  zero changes to `bin/dispatch-runner.mjs`, `bin/lib/dispatch-
rules.mjs`, or the gate/audit logic itself — the wrapper is new code
  (a WS client + local `tmux attach`), not a modification of the
  runner. This corrects an earlier draft of this document, which
  claimed the wrapper reused the runner's gate "wholesale" while also
  implying it called `createManagedSession` directly in-process — that
  was not achievable without new code, since `readAllowlist`/`audit`/
  the session-launch branch are private, unexported functions in a
  script entrypoint (verified, corrected in §3.1 after codex review).
  The PROMPT verb (§4) DOES require new code: an `core/asyncapi.yaml`
  schema addition (regenerated `messages.ts`), a `deliverPrompt`-style
  addition in `bin/lib/managed-sessions.mjs`, and a drawer UI addition
  — none of that is a design gap, it's new work correctly scoped as
  new work in §4.2, not disguised as pure reuse.
- Does not invent a new trust tier, new bearer scope, or new machine
  capability flag beyond the existing `sessions: true/false` (deny-by-
  default) already governing T4.
- Does not reopen pty injection, unmanaged-session answering, or any
  item on RUN-MAP §3's GATED list.

## 8. Cross-doc note for the adversarial audit (Q43)

`.planning/v5/ADVERSARIAL-AUDIT-2026-07-12.md`'s invariant "reaches
only managed sessions ✓ by construction" (if written with that exact
framing) assumes every manifest entry passed the `sessions:true` gate
at creation time. That assumption holds today (T4's only creation path
is the gated `runSessionLaunch`) and continues to hold if C3 is built
per this document's recommended mechanism (d), since the wrapper never
bypasses the gate. **If a future revision of C3 is built via mechanism
(c) instead** (or any mechanism where a second code path can write the
manifest), that audit's invariant needs re-verification against the
new code, not re-assumed from this document. Whoever owns the
adversarial audit doc should re-check that row once C3 actually
builds, referencing whichever mechanism was actually shipped.
