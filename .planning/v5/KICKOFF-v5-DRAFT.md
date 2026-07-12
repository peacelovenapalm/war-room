# KICKOFF v5 — DRAFT (feature-ideation pass, 2026-07-12)

Status: DRAFT — not a contract until Greg approves. Evidence base:
`.planning/v2/TUNING.md`, `.planning/v4/STATE-v4.md`,
`.planning/v4/FACE-MERGE-PLAN.md`, `.planning/v4/KICKOFF-v4.md`, repo
CLAUDE.md. Every candidate cites the recorded line that motivates it —
nothing here is blue-sky.

Doctrine carried forward unchanged: real data only (NO DATA over fake
zeros), colorblind shape+label-first, deploys Greg-gated, tailnet-only
never the funnel, deny-by-default runners + receipts, AuDHD comms.

## Summary — next 3 steps (start here)

1. Approve/edit the top-10 ranking below (15 min read).
2. Phase 1 items 4+5 are startable in under 5 minutes each (repoint 4
   stale e2e selectors; swap 3 TEMP icon paths) — say go and they run.
3. Decide the one design gate in this draft: the "born-managed" launcher
   wrapper (candidate 3) needs your yes/no before any code.

---

## 1. Top-10 candidates (ranked by value-to-Greg / effort)

### C1 — Districts full build-out + fresh-source wiring

- **What:** Grow ⌂ DISTRICTS from the 2-district proof slice to every
  active project, fed by fresh checkouts. Step 1 is pure ops: fresh TWE +
  war-room checkouts on nexus, uncomment the runbook mount block
  (d7fa85f deliberately unwired it). Step 2: N-project world layout,
  per-project buildings from real STATE.md milestone state.
- **Why:** KICKOFF-v4 T7 says it in writing: "Full build-out is v5
  scope; v4 proves the mapping with 2 districts." The Phase-5 deploy log
  left "decide districts fresh sources" as one of Greg's 3 remaining
  items. Today the live board shows honest `source:unknown` ×2 — the
  feature exists but renders NO DATA.
- **Size:** M (step 1 alone is S). **Risk:** low — read-only mounts,
  tolerant parser already verified against real ledgers.
- **Acceptance:** `curl /api/districts` returns ≥4 projects with real
  milestone-derived floors and zero `source:unknown` entries; phone view
  renders them.

### C2 — Sprite diversity pass (Blender) + asset-generation skill

- **What:** Rerun the Blender pipeline for body/hair/skin/uniform
  variety (kill the balding-men monoculture), and build Greg's
  parked asset-gen skill: style-guide extraction (palette / iso angle /
  proportions) + a generator that produces on-brand props/staff on an
  autonomous cadence. The v2 [G5] TUNING entry already documents the
  full transport, asset list (~40 jobs), wave sizing, and QA gate —
  no re-derivation needed.
- **Why:** Cut/rolled to v5 by name in the STATE-v4 Phase-5 open log
  ("Cut/rolled to v5: Blender sprite pass…"). Greg's own idea, recorded
  in TUNING Phase-2B live acceptance: "IDEA (Greg, parking lot):
  asset-generation skill … dovetails with T6's Blender + $imagegen
  lanes." D-2/D-29 named the monoculture originally.
- **Size:** L (splittable: Blender pass M, skill M). **Risk:** medium —
  burns real Codex/ChatGPT budget 3-5x per image; must run attended or
  /loop-batched around resets per Greg's recorded preference; 2-failed-
  regens→hue-shift fallback rule stands.
- **Acceptance:** ≥12 new distinct sprites pass the existing QA gate
  (dimension + alpha + grayscale-distinctness + decoder smoke) and
  render on the live board; the skill produces one on-brand prop
  end-to-end without hand-holding.

### C3 — "Born managed": free-form prompting via launcher wrapper (DESIGN GATE)

- **What:** Design gate first, then build: a war-room wrapper alias
  (`wr claude …` or similar) that launches Greg's OWN terminal sessions
  inside runner-owned tmux, so every session is born managed —
  answerable and free-form promptable from the phone through the
  existing T2 answer plane. No pty injection ever (rejected class,
  stands). Includes a general free-form PROMPT verb on managed sessions
  (today ANSWER exists; arbitrary prompting was ruled out only for
  unmanaged ones).
- **Why:** Three recorded hits: TUNING Phase-2B "UX gap (Greg): no
  free-form prompting of visible sessions … needs its own design gate
  before any build"; the G-1 approval rider ("revisit answering
  HAND-STARTED terminal sessions later — not permanent doctrine"), which
  itself names the wrapper flow as a research direction; STATE-v4
  Phase-5 cut list rolled it to v5 explicitly.
- **Size:** S design + M build. **Risk:** medium — it's a containment
  surface (Fable-authored seams, codex review, same one-shot-nonce +
  receipt discipline as T2). The design doc must also answer: does a
  wrapped session lose anything (scrollback, resize, exit codes)?
- **Acceptance:** Greg starts a session via the wrapper on MACBOOK; it
  appears managed on the board; from the phone he sends a free-form
  prompt and watches the session act on it in the live tail.

### C4 — Old-face retirement (Tier 4) + real PWA icons

- **What:** After the /v1/ grace release + Greg's on-phone PWA
  acceptance: delete `webview-ui/` + its build lane + `test:webview`
  (archive per repo policy). Swap the three `*-TEMP.png` PWA icons for
  real art (three file paths in `vite.config.ts` manifest +
  `index.html` apple-touch-icon href — TUNING [G6] documents the exact
  swap; C2's pipeline can source the art, or crop the office banner).
- **Why:** FACE-MERGE-PLAN Tier 4 is the written contract ("Delete
  webview-ui/ … after one release of /v1/ grace and Greg's on-phone
  acceptance"). TUNING [G6] flags the TEMP icons as review-on-return.
  Every retained old-face line is dead weight the full gate still runs
  (webview-ui 294 tests per gate).
- **Size:** S. **Risk:** low but IRREVERSIBLE-ish — gate strictly on the
  on-phone acceptance (fresh install at root + old-PWA self-heal), which
  STATE-v4's Phase-6 entry already lists as AWAITING GREG.
- **Acceptance:** repo has no `webview-ui/` lane; full gate green
  without it; phone home-screen icon is real art, not a flat TEMP
  square.

### C5 — Gate integrity: repair 4 stale e2e specs + make check-types cover webview-v3

- **What:** (a) Repoint the stale selectors in the 4 timing-out
  standalone specs (budget-pause, disappearing-view, hud-layout ×2) —
  `button[title=…]` died when ControlTooltip absorbed the title attrs.
  (b) Add webview-v3 to root `check-types` (today its only type gate is
  the vite build — a Phase-5 lane shipped a type error root check-types
  missed).
- **Why:** TUNING [KICKOFF v4 3.5]: "Fix (cheap, mechanical): repoint
  the stale selectors … each burns 2×120s in retries" (a 2-hour smoke).
  STATE-v4 Phase-5 LANE FINDING: "root check-types does NOT cover
  webview-v3 → TUNING." Note: if C4 lands first, verify which of the 4
  specs target the retiring face and delete rather than repair those.
- **Size:** S. **Risk:** none. **Acceptance:** full standalone smoke
  green in one pass with no 120s retry burn; a seeded webview-v3 type
  error fails `npm run check-types` at root.

### C6 — Per-machine tokens (bind X-Machine to the bearer token)

- **What:** Server-side token→machine map so a machine can only speak as
  itself; lands in the single bearerAuth seam (D-43's auth single-seam
  rule means one module changes, not fifty call sites). Closes RoR-1.
- **Why:** TUNING [KICKOFF v4 1.6] RoR-1: one compromised machine can
  drain another's tail queue or inject fabricated output/usage — and the
  entry itself says "Natural home: … the v5 SaaS-seams pass." T1/T2
  widened what the single shared trust tier can DO; v5 should narrow who
  holds it.
- **Size:** M (token minting/rotation runbook is most of it). **Risk:**
  low-medium — a rotation misstep bricks runners until re-provisioned;
  ship with a dual-accept window.
- **Acceptance:** a request bearing machine A's token with
  `X-Machine: B` is rejected (test); all three runners (MACBOOK, MINI,
  nexus-local) still poll green after cutover.

### C7 — On-device tuning session: soundscape by ear + gesture feel

- **What:** One sit-down-with-Greg pass: unmute the WebAudio soundscape
  and judge the chirps (lane shipped it untested by ear, default muted);
  pinch/pan momentum + zoom-limit polish on the real phone (D-6). Both
  are tune-from-feel, not build work.
- **Why:** STATE-v4 Phase-5 deploy log, Greg's remaining-3 item 1:
  "unmute soundscape → judge the chirps (lane flagged untested-by-ear)".
  Gesture tuning rolled to v5 by name in the Phase-5 cut list.
- **Size:** S (per session; may take 2 rounds). **Risk:** none —
  parameters only, mute-persist and DPR grep-guard stand.
- **Acceptance:** Greg says the chirps and the pinch feel right on his
  actual phone — subjective gate, his call, recorded in TUNING.

### C8 — Addressing hardening: server-side focus validation + pid-reuse fix

- **What:** (a) Server re-validates `dispatchRequest{action:'focus'}`
  against the target machine's advertised `focus:true` (Phase-6 TICKET —
  runner-decides holds today, but the server check closes the
  forged-message path). (b) Key answer/kill/focus targeting on
  (machine, pid, startTime) or sessionId instead of bare (machine, pid),
  so a reused pid inside the 30s ad window can't route an action to the
  wrong process.
- **Why:** TUNING Phase-6 reconcile TICKET (focus validation,
  pre-existing) + Phase-2B codex DEFERRED item (pid-reuse "inherent to
  the whole codebase's pid addressing … out of v4 scope"). Both are the
  same theme: the server trusts addressing claims it can verify.
- **Size:** S+M. **Risk:** low — additive validation; the runner remains
  the final gate either way.
- **Acceptance:** focus request against a `focus:false` machine returns
  a 4xx with a receipt (test); an answer aimed at a recycled pid is
  denied rather than delivered (test with forged startTime).

### C9 — Ops hygiene bundle (4 small recorded leftovers, one lane)

- **What, each with its TUNING/ledger line:**
  - Durable STOP ALL server latch — TUNING v3.1 "a durable server latch
    is future scope" (chain-only halt doesn't survive page hydration).
  - `budget-paused` Bark push, edge-triggered on the false→true
    transition — TUNING [G4] deferred item 2 (the only still-live one of
    that pair; `employee-quit` died with the old face).
  - Drawer `since=` anchor — Post-Phase-4 live findings: "UNVERIFIED
    remainder: the drawer's since= anchor looked stale (16:34)".
  - Nonce/answerRequests LRU/TTL bounds — Phase-2B deferred "resource
    hygiene, not exploitable" ×2 (runner Set + server Map).
- **Size:** S each, M as a bundle. **Risk:** none. **Acceptance:** one
  check per item: STOP ALL state survives a fresh page load; exactly one
  Bark on a pause transition (not per tick); since= anchors to the
  documented timestamp; both stores bounded under a soak test.

### C10 — Mini managed sessions: decide + enable (config, not code)

- **What:** Greg's open call from the Phase-4 late findings: the Mini
  advertises `sessions:false` (its dispatch.json lacks `"sessions":
true`). If yes: hand-edit + runner restart, then one live acceptance
  (launch a PERSISTENT SESSION on the Mini from the board, phone-answer
  it). If no: record the decision so it stops appearing in ledgers.
- **Why:** TUNING Post-Phase-4: "It still advertises sessions:false …
  Greg's call whether the Mini gets managed sessions." T8 compute is
  live end-to-end; sessions is the one Mini capability left undecided.
- **Size:** S (minutes + one acceptance). **Risk:** low — deny-by-default
  flag, same tmux ≥3.2 gate as MACBOOK (verify the Mini's tmux version
  first; <3.2 denies launch by design).
- **Acceptance:** either the Mini launches+answers a managed session
  live, or a one-line DECLINED entry lands in TUNING.

---

## 2. Suggested 3-phase sprint shape

Same gate discipline as v4: full test gate re-derived by the
orchestrator per phase, codex cross-model review per phase diff, deploys
Greg-run only, containment seams Fable-authored.

- **Phase 1 — Close v4's tail (all S, mostly parallel):** C5 gate
  integrity → C4 old-face retirement + real icons (ordered: C5's spec
  triage depends on knowing what retires) → C7 on-device tuning session
  → C10 Mini decision. Exit: gate runs lean and green, phone face is
  final, no v4 leftovers in the ledger.
- **Phase 2 — The world gets real (the value phase):** C1 districts
  build-out (ops step first, world layout second) + C2 sprite/asset
  pipeline in a parallel lane (attended or /loop-batched around Codex
  resets). Exit: the office looks alive and the world maps to real
  projects.
- **Phase 3 — Control-plane hardening:** C3 design gate → build (the
  headline), C6 per-machine tokens, C8 addressing hardening, C9 hygiene
  bundle as filler. Exit: every session Greg starts is phone-steerable,
  and the trust model matches the capability the plane now carries.

Rationale for the order: Phase 1 is cheap and removes drag from every
later gate; Phase 2 is the daily-delight payoff (D-24: what brings him
back); Phase 3 spends the security effort where T1/T2 genuinely widened
the surface — after the design gate that C3 requires anyway.

---

## 3. CUT list (considered and rejected, with reasons)

- **Old-face economy bugs F1/F2/F4** (train/promote never debits; 4
  dead building buffs; free furniture placement — TUNING "Fable review
  2026-07-08"): the surfaces they live on (employee roster verbs, rooms,
  layout editor) are FACE-MERGE Tier-2 DECLARED DEAD and the whole face
  retires in C4. Fixing economy sinks on a corpse is waste. Re-open only
  if an economy surface is deliberately rebuilt in v3.
- **[G2] economy rate-table retune checkpoint:** same reason — the
  tune-from-telemetry pass presumed a played economy; the old face's
  game layer is dead and v3 doctrine rejects fake progression. Only the
  v3-visible numbers (contract +25 CASH, W/D/L mapping) survive, and
  Greg APPROVED those as settled 2026-07-10.
- **HUD-overlap dedicated layout pass** (3 recorded instances): all
  three were old-face overlays. v3 carries the z-60 STOP-ALL rule + a
  panels.spec.ts regression e2e. Handle any NEW v3 collision as a bug,
  not a pass.
- **Help-section UX rework + clickable crisis cards** (Greg's 2026-07-08
  items 1 and 3): old-face help modal and crisis cards — Tier-2 dead.
  v3's ANSWER lane + proposals already deliver the "click into the
  blocked agent" need the crisis-card item was really about.
- **pty injection for hand-started sessions:** rejected class, stands
  (REMOTE-ANSWER-DESIGN + G-1). C3's wrapper is the sanctioned angle.
- **Tier-2 resurrections** (progression HUD, unlocks, employee roster,
  world events, rotating tips, changelog modal, layout editor,
  openSessionsFolder): DECLARED DEAD by default per FACE-MERGE; no
  genuinely new angle argued for any of them here.
- **Multi-tenancy / auth accounts:** seams-only remains the rule (D-43);
  C6 deliberately stops at per-machine tokens, single-user.
- **LLM work on the Mini:** out per D-28/T8 contract; C10 is sessions
  config, not Mini LLM scope creep.
- **Remote-answer plane as a "panel":** the ratified honest-explainer
  treatment stands for anything unmanaged; C3 changes what's managed,
  never fakes the verb.
- **Clock-skew rollover + closed-enum-additive + wiring per-dir time
  budget (#4):** codex accepted-theoreticals under the tailnet trust
  tier; revisit only on observed drift / network-mount scan roots, per
  their own entries.
- **`employee-quit` Bark wiring:** the emit gap it needed fixing lives
  in the dead employee layer. Dropped with it.
- **FOCUS/osascript TCC consent:** not build work at all — a Greg
  System-Settings click, already fully documented in TUNING with exact
  steps. Stays a rider, not a candidate.

---

## 4. Open Greg gates in this draft (max 3)

1. Approve/edit the top-10 + phase shape (this doc becomes KICKOFF-v5).
2. C3 design gate: yes/no on the born-managed wrapper direction before
   any design doc is written.
3. C4 is irreversible-ish: confirm the on-phone PWA acceptance
   (STATE-v4 Phase-6 AWAITING item) before Tier-4 deletion is scheduled.
