# KICKOFF v3.1 — "Living Studio" sprint (2026-07-10)

Execution contract for the 8-hour ultracode burn (10:00–18:00 PDT
2026-07-10, weekly token reset at the far end) and the /loop that
continues it. Supersedes the Phase-3 scope of KICKOFF-v2.0 item 3;
Phase-4 gates (adversarial review, full gate, deploy, real-iPhone
acceptance) unchanged. Authored from Greg's live 36-question design
Q&A this morning — every decision below is his, given interactively.

Source research: `.planning/v2/GAME-DESIGN-V3.md` (living-office
synthesis — its DESIGN survives; its procedural-art execution is
superseded), `.planning/v2/MOBILE-FORENSICS.md` (DPR constraints,
binding), workflow wf_a6668649 (feature inventory: 48 features,
v1-vs-synthesis + 6-lens ideation + question bank), workflow
wf_f411de01 (28-game tycoon research: praise patterns, top-15
imports, spine candidates).

---

## 1. Decision register (36 live answers, 2026-07-10)

### Identity

| Decision                    | Greg's pick                                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spine                       | **Living Studio** — named staff who text you their real blockers; answering them IS running the studio (anchors: The Tenants' SMS feed, Empire of Sin sit-downs, Two Point's charm layer) |
| Meta layer                  | **City districts** — repos/machines as a skyline that grows from real work                                                                                                                |
| Cold open (desktop + phone) | **Triage adrenaline** — straight to the crisis board, age × severity                                                                                                                      |
| Fiction costume             | **Full diegetic** — maximum game feel; the verbatim real ops text is ALWAYS one tap away (one-tap-real rule)                                                                              |

### Art

| Decision                     | Greg's pick                                                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base direction               | **Full isometric 2.5D** — committed with the XL cost known (evidence check shown: ~40% pipeline reuse, re-authored layout math)                                                                                                   |
| Asset source                 | **Generated-first (Blender)** — headless bpy pipeline renders iso sprites at fixed angles; codex `$imagegen` (ChatGPT subscription, verified 2026-07-06 Diablito) for portraits/signage/textures; FAL fallback unkeyed → not used |
| World scale (this iteration) | **One floor, wings** — districts city arrives a later iteration                                                                                                                                                                   |
| Tail render                  | **DOM always** — canvas draws monitor glow/frames only; tails stay crisp, selectable text                                                                                                                                         |
| Idle motion                  | **Calm channels + ambient walkers** — janitor rounds, coffee drift, night-shift arrivals from the real schedule                                                                                                                   |

### Core loop

| Decision         | Greg's pick                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tentpole         | **Match Day** — chains as fixtures: team sheet, live commentary synthesized from real tail lines, result card from real git/test outcomes; W/D/L mapping must stay honest    |
| Return hook      | **Aging contracts** — progress bars filled by real outcomes, bonus-only, quiet expiry; targets sit BELOW natural pace (no-dark-pattern rule)                                 |
| Failure loop     | **Scrap & Rework Bin** — failures pile as visible crates until reworked (one-click re-dispatch through normal confirm) or dismissed (dismiss verb REQUIRED or it is nagware) |
| Emergence anchor | **Rivalries & Bonds** — relationship strings from real repo/worktree overlap; ⚠ RIVALRY doubles as a genuine worktree-collision early warning                                |

### Progression + economy

| Decision              | Greg's pick                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Progression principle | **REAL progress only** (Greg verbatim intent: "seeing the progress that we're making against all of the things that we have to do and where our projects are and where we've come" — never random fake numbers)                                                                                                               |
| Real-progress anchor  | **Milestone skyline + contracts wall** — district buildings gain floors from real tracker gates / todos closed / merged PRs; completed contracts frame the office walls                                                                                                                                                       |
| CASH                  | **Lightweight/cosmetic now, REVENUE-READY by design** — Greg: "eventually pull real numbers from how much we are actually making, but at the moment none of our projects make any money." Define the revenue ingest point now; do not build a deep synthetic economy. (Orchestrator translation — Greg vetoes at plan review) |
| Collection            | **Trophy Vault** — merged PRs as shelf trophies engraved with the real PR URL                                                                                                                                                                                                                                                 |
| Ratings               | **Global REP only** — MTU-tiered + bounce clawback as V3 designed; no wing stars, no agent form (parked)                                                                                                                                                                                                                      |

### Surfaces (the "lost tabs" answer — ALL of these return)

| Cluster              | Returns in v-next                                                                                                                                | Parked             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Automation           | Chains, Standing orders (+ first-fire confirm intact), Dispatch templates (cap 20), **STOP ALL always visible**                                  | —                  |
| Colony               | Employee roster + 8 real verbs, Contracts panel (real vault todos)                                                                               | World events, Pets |
| Chrome               | BRIEFING panel, Settings modal, Tips + changelog, Debug view                                                                                     | —                  |
| Also kept            | HELP (full vocabulary), SHIFT report, agent drawer (upgraded), CALL modal, dispatch tray + result view, economy HUD, budget/rate-limit meter     | —                  |
| Desktop chrome model | **Room is interface + compact dock** — every surface reachable via its in-world prop; dock holds prop-less surfaces (Settings, Debug, Changelog) | —                  |
| Editor               | **Decor placement only** in v1 (place/move unlocked decor; no wall/desk restructuring)                                                           | Full layout editor |

### Mobile

| Decision         | Greg's pick                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Phone world view | **Restored pinch/pan** — fit-to-view camera, zoom NEVER derived from DPR, gated behind the permanent DPR-3 e2e |
| Phone cold open  | **Triage board**                                                                                               |
| Push landing     | **Board + auto-opened crisis sheet** (settled in round 1)                                                      |
| Board verbs      | **One-tap approve** + undo window where the underlying gate allows one                                         |

### Juice

| Decision          | Greg's pick                                                                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Sound             | **Alerts only**; SFX vocabulary **tiered by severity** (orchestrator default consistent with alerts-only — Greg vetoes at review)                                                                                                            |
| Set-pieces        | **Review Panel card-flip** (real test/merge/scope/burn axes; NO DATA never guessed), **Outbreak containment** (real 3+ simultaneous blocks, real escalation clock), **Ambulance arrivals** (NEXUS watchdog/Bark ingest, verbatim alert text) | Wing construction parked |
| Animation honesty | **Bounded theater** — WRITTEN INVARIANT: transit/ceremony animations ≤ ~2s and NEVER delay real state display or the real action                                                                                                             |

### Sequencing

| Decision    | Greg's pick                                                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Milestone 1 | **DPR-done-right + reskin** — iso foundation with fit-to-view camera and the permanent DPR-3 e2e from first commit                                                   |
| Strategy    | **Vertical slices** — every iteration lands a playable delta end-to-end                                                                                              |
| Loop gates  | **Hard-rule adjacent only** — auto-continue except: economy rules, auto-ACK/sweep, standing orders, real-money display, DPR/grayscale invariants                     |
| Scope       | **8-hour ultracode burn** (Greg by fiat: burn the week's tokens before the 18:00 PDT reset; parallel workstreams sewn together), then reassess for the ongoing /loop |

---

## 2. Hard rules (non-negotiable, carried + extended)

1. Colorblind: every signal SHAPE + TEXT LABEL first; survives grayscale.
2. Never gate real functionality behind game progress.
3. No dark patterns around real money or attention (no loss-aversion, no streak shame, contract targets below natural pace).
4. Tailnet-only; never funnel.
5. **One-tap-real**: every game-face number/state decomposes on tap into verbatim telemetry (the 28-game research's universal lesson: opaque scoring is poison).
6. **Bounded theater** (new, from Q&A): animations ≤ ~2s, never delay real state or action; replays would be visually labeled (none in this iteration).
7. DPR constraints (MOBILE-FORENSICS, binding): no camera/layout value derived from devicePixelRatio; canvas resolution cap 2; no eager ~1MB push before first paint; skeleton/placeholder paint first; permanent DPR-3 WebKit e2e asserting non-blank canvas content.
8. Never weaken the unattended-run safety net: first-fire confirm, budget fail-safe, STOP ALL.
9. One agent per checkout (incident 74d74e8). Serialized stages per worktree.
10. Atomic conventional commits, em-dash subjects, explicit-path staging, STAGED_COUNT guards.
11. `core/src/messages.ts` is generated — asyncapi.yaml is the source; never hand-edit.

---

## 3. Workstreams (the burn)

Three isolated worktrees off `war-room/v1`, one workflow each,
STRICTLY SERIALIZED agent stages inside each worktree:

| WS          | Worktree / branch                                 | Owns                                                                  | Must not touch                                   |
| ----------- | ------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| A face      | `../war-room-wt/v3-face` → `war-room/v3-face`     | `webview-v3/` (new workspace), root e2e additions for v3              | `server/`, `webview-ui/` (fallback stays frozen) |
| B assets    | `../war-room-wt/v3-assets` → `war-room/v3-assets` | `tools/asset-pipeline/`, `webview-v3-assets/` staging dir             | everything else                                  |
| C substrate | `../war-room-wt/v3-server` → `war-room/v3-server` | `core/asyncapi.yaml` + codegen, `server/src` new stores, server tests | `webview-ui/`, `webview-v3/`                     |

**WS-A face** — iso foundation (Milestone 1) then vertical slices:

1. `webview-v3/` workspace (Vite+TS+React, consumes `core/` generated types over the existing WS). Iso engine: 2:1 dimetric grid, painter's depth sort, **fit-to-view camera computed from canvas-vs-map size**, resolution ≤ 2, placeholder diamond tiles. **DPR-3 Playwright WebKit e2e in the FIRST commit.**
2. Triage board (DOM, inline ✓ APPROVE / ▸ DESK, one-tap + undo), HUD strip, tail sheet (DOM always), agent drawer port.
3. Panel ports: HELP, SHIFT, BRIEFING, Settings, Debug, STOP ALL, CALL modal, dispatch tray, chains/orders/contracts panels wired to existing + WS-C message types (graceful absence until merge).
4. Pinch/pan (clamped fit-to-view), ambient walker/calm channels on placeholder sprites, asset-manifest loader matching WS-B's manifest schema (lazy, chunked — no eager megapush).
5. Adversarial verify + full gate + screenshots (desktop AND 390px/DSF-3).

**WS-B assets** — the generated-asset pipeline:

1. `tools/asset-pipeline/blender/`: bpy scripts (Blender 4.2.19 at `/Applications/Blender.app/Contents/MacOS/Blender`, headless `-b -P`) — parametric office props (floor tile, wall segments, desk, chair, monitor, plant, shelf, sofa, coffee station, rework-bin crate, trophy shelf), orthographic 2:1 dimetric rig, 4 rotations, alpha PNGs → spritesheet + JSON manifest (schema agreed in this doc: `{name, size, anchor, rotations, frames}`).
2. Walker/character set: low-poly parametric person, 4 directions, walk + sit/type frames.
3. codex `$imagegen` lane (single-quoted heredoc, per Diablito memory): dossier portrait style set, office posters/signage (real text), floor/wall textures. Rectangular assets only (no alpha available on this lane).
4. QA harness: HTML sheet-viewer screenshot, anchor/alignment check, manifest schema validation.

**WS-C substrate** — Living Studio server systems (all real-signal-driven):

1. asyncapi additions + codegen + store skeletons: `contract` (vault todo ingest via WAR_ROOM_TODO_DIR), `dossier` (persistent per-(machine,project) staff identity: traits/history computed from real telemetry), `matchDay` (chain run → fixture: events from real tail/git/test outcomes), `reworkBin` (failed/killed dispatches + terminal crises; rework re-dispatch + dismiss verb; counted in SHIFT), `rivalry` (worktree/repo-overlap detection from live agent cwds).
2. Implementations + tests per store; REP receipts (cause line on every economy movement) and perfect-ops-day (real timestamps, server rule).
3. Revenue-ready CASH seam: a single `revenueProvider` interface stub with the synthetic source behind it (the future real-money ingest point).
4. Containment/adversarial verify: hard rules 2, 5, 8 explicitly; full server gate.

**Integration (orchestrator, this session):** merge order C → A → B
into integration branch `war-room/v3`; asyncapi codegen re-run resolves
`messages.ts`; full gate (check-types, lint, all suites, build) shown
in conversation before each merge; screenshots after A+B merge.

---

## 4. Gates

- **During burn (hard-rule-adjacent, Greg live):** anything touching economy rules, auto-ACK/sweep semantics, standing orders, real-money display, or the DPR/grayscale invariants stops and asks.
- **End of burn:** handoff (nexus-handoff skill), full gate output shown, desktop + DSF-3 screenshots, STATE updated.
- **Next session (Greg-only):** real-iPhone acceptance on the deployed build — emulation never counts (v2.0 rule, kept).

## 5. Ledger

Tracked in `.planning/v2/STATE-v2.0.md` (item 3 in-progress → this
sprint). Workstream evidence lands there at merge time.
