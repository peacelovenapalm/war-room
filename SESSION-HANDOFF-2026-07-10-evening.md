# Session Handoff — 2026-07-10 (evening) — v3.1 closeout + v4 planned

## 1. Verified current state (live commands, this session's end)

- Branch `war-room/v3` @ `12804b2`, tree clean (one stray untracked
  `.planning/v2/LOOP-LOCK`, harmless), pushed to origin via ssh:443.
- **Deployed NEXUS**: `/api/version` = `645caf4` (drawer + TOKENS fixes
  LIVE), `/v3/` 200, state volume intact. Planning-doc commits `9788a84`/
  `12804b2` are docs-only — deployed code IS current product HEAD.
- **Real-device acceptance: PASSED** — iPhone + MacBook, Safari + Chrome,
  Greg-confirmed (drawer ✕ CLOSE verified after 645caf4 redeploy).
- `npm audit --omit=dev` = 0 vulnerabilities (was 1 high + 1 moderate).
- Mini (via tailscale 100.121.189.6): War Room stack installed but runner
  dead-looping 401s — stale WAR_ROOM_TOKEN plist, dispatch path silently
  broken (agent-verified from its log).
- FOCUS TCC consent: GRANTED (osascript diagnostic returned in 0.4s).
- NEXUS nightly backup includes `~/apps/war-room/state` (verified run,
  16 files; `server.json` excluded on purpose).

## 2. Accomplished this session

- All v3.1 Greg gates fired: TUNING ratifications (`a3da26d`), 3 deploys,
  real-device acceptance closed.
- `/v3/` deploy path wired (was never built into the image) — `95982ff`.
- Safari blank-page root-caused + fixed: old face's PWA SW hijacked /v3
  navigations → navigateFallbackDenylist — `b86c7ad`.
- Dependency audit (4 parallel Sonnet lanes) → plan `8246c3d` → security
  batch `5d44dcf` (fastify 5.10, vitest 3.2.7 critical CVE, vite 8.1.4)
  - hygiene batch `5d559a9` (react 19.2.7, eslint 9→10 drift fix).
- Real-device bug fixes `645caf4`: drawer ✕ CLOSE was buried under the
  z-60 HUD (moved into .surfaces + regression e2e); TOKENS fake-zero →
  honest NO DATA; e2e harness repointed off a stale bundle.
- 48-question debrief → `.planning/v4/DEBRIEF-REGISTER-2026-07-10.md`
  (`9788a84`); v4 contract drafted → `.planning/v4/KICKOFF-v4.md` +
  `.planning/v4/MINI-COMPUTE-NODE.md` (`12804b2`).
- NEXUS backup include + Brain2 `5eb6e85`; memory files updated.

## 3. In progress

- Nothing mid-flight in code. v4 is CONTRACT-DRAFT stage: pending Greg
  approval of `.planning/v4/KICKOFF-v4.md` (edit freely — it's a draft).

## 4. Deferred / gated

- **Mini 401 token fix** — unblocks: 5 min at a keyboard; token source =
  nexus `~/apps/war-room/war-room.env` (never echo), patch
  `~/Library/LaunchAgents/com.war-room.dispatch-runner.plist` on the
  Mini, kickstart, watch log. (MINI-COMPUTE-NODE.md open question 1.)
- **T2 remote-answer security design gate** — mid-sprint Greg approval of
  `.planning/v4/REMOTE-ANSWER-DESIGN.md` (not yet written; first Fable
  task of Phase 2).
- **Mini compute open questions 2–3** (registration UX, sleep policy) —
  answers fold into T8 before its build.
- Deps Batch 3 majors (node 24, vitest 4, lint-staged 17, TS 7 parked) —
  triggers documented in `.planning/v3/DEPS-UPGRADE-PLAN.md`.
- refresh-mocs + project-pulse routine re-pastes (vault fleet, unrelated
  to war-room; still pending per memory).

## 5. Decisions made (rationale one-liner each)

- v4 = console sprint, planned not burned — Greg: console gets him to
  USE it; aesthetics bring him back (D-20/D-24/D-45).
- Remote-answer plane FUNDED (supersedes same-day parked ratification) —
  console framing changed the calculus; security design gates the build.
- SaaS seams standing rule — sell-shovels ambition is real (Tbilisi
  support); cheap now, expensive to retrofit; multi-tenancy deferred.
- Mini = non-LLM compute node via a `"shell"` dispatch provider — wire
  carries scriptId only, local allowlist carries capability (D-26/D-28).
- Old face's SW must never own /v3 — denylist + autoUpdate heals clients.
- NO DATA over fake zeros wherever the measurement doesn't exist.

## 6. Next steps (max 3)

1. **(<5 min) Fix the Mini token** — at the Mini (or via ssh): re-issue
   WAR_ROOM_TOKEN in the dispatch-runner plist from the runbook, then
   `launchctl kickstart -k gui/$(id -u)/com.war-room.dispatch-runner`;
   confirm 401 spam stops in `~/Library/Logs/war-room-dispatch-runner.log`.
2. **Approve (or edit) KICKOFF-v4** — read `.planning/v4/KICKOFF-v4.md`;
   answer the 3 Mini open questions at the bottom of
   `MINI-COMPUTE-NODE.md` in the same breath.
3. **Kick off Phase 1 (T1 live tails)** — say go and the sprint starts
   with the per-machine tailer (Sonnet build lane, Fable verify).

## 7. Kickoff prompt (paste verbatim into a fresh session)

```
Working dir /Users/greg/code/war-room, branch war-room/v3 @ 12804b2
(deployed NEXUS = 645caf4, v3.1 accepted on real devices 2026-07-10).
Context: .planning/v4/KICKOFF-v4.md is the v4 "Console" sprint contract
(seeded by .planning/v4/DEBRIEF-REGISTER-2026-07-10.md, 48 decisions) +
.planning/v4/MINI-COMPUTE-NODE.md (T8 companion). I approve the KICKOFF-v4
contract [add edits here if any; answer MINI open questions 1-3 here].
Start Phase 1: T1 per-machine live tailer per the contract — delegate
implementation to Sonnet lanes, Fable orchestrates and adversarially
verifies, one agent per checkout, full gate re-derived by the orchestrator
before any deploy ask. Deploys stay Greg-executed via
`! cd /Users/greg/code/war-room && NEXUS_HOST=nexus-ts bash .planning/runbooks/nexus-war-room-deploy.sh -y`.
```
