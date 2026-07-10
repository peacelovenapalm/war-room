# War Room — Session Handoff, 2026-07-10 (Fable planning session)

## 1. Verified current state (checked this session — epistemics labeled)

- Branch `war-room/v1`, HEAD `7fdefcc` (docs-only commits after code
  HEAD `c369684`). Working tree was clean at session start; this session
  adds only planning docs (see §2). **Verified.**
- ⚠ `war-room/v1` and `war-room/v0` have **no remote tracking branch** —
  192 commits exist only on this laptop. **Verified** (`git branch -vv`,
  `git ls-remote`). Backup push = KICKOFF-v2.0 Phase 0.1, first act.
- Suite counts server 562/562, webview 289/289, poller 85/85 +
  clean check-types/lint/build: **reported** (STATE-v1.1, 2026-07-09) —
  this session's audit was read-only and did not re-run them. The
  **verified** layer is file:line code reads confirming every v1.1 item.
- Live NEXUS container healthy (`/api/economy`: cash 640, rep 27, 59
  ledger entries), created 2026-07-09T08:33:17Z, **predates every v1.1
  commit** (first: 09:06Z) — zero v1.1 work is deployed. Exactly 2
  read-only briefing mounts; **no state volume** — any redeploy wipes
  `~/.pixel-agents`. **Verified** (read-only curl + docker inspect).
- REFUTED this session: the 2026-07-08 handoff's "economy state survived
  across all 3 redeploys" — no revision of the deploy runbook ever had a
  state volume (git log -p across all 4 revisions), and the 07-09
  recreate demonstrably destroyed the prior save. The "survival" was
  gate contracts auto-re-completing against the read-only briefing
  mounts. Deploy-wipes-state stands unqualified.
- ⚠ WAR_ROOM_TOKEN (prefix 16e4…) leaked into an audit transcript this
  session. Tailnet-only blast radius. Rotation is coupled into the next
  deploy (KICKOFF-v2.0 Phase 0.2 step 3). **Verified** (the leak is in
  the transcript; the token matches the live container's).
- MacBook plane fully live: hook forwarder env targets the live
  instance with a matching token; needs-input-poller, dispatch-runner,
  coworker-adapter all RUNNING under launchd. **Verified.** Real Mac
  Mini onboarding never happened — production shows MACBOOK only.

## 2. Accomplished this session

1. **Six-agent read-only audit** (workflow wf_3001ff90-5cb: items
   verifier, original-plan mapper, backlog compiler, streaming scoper,
   deploy-facts, adversarial critic — ~641k subagent tokens). Verdict:
   the Sonnet-built v1.1 run is real — every spot-checked claim
   CONFIRMED at source level; the ledgers were honest about their own
   deviations. 26-item outstanding backlog compiled; critic added 6
   findings the ledgers missed (see §1 + KICKOFF-v2.0 Phase 0).
2. **Greg's sprint decisions captured live** (see KICKOFF-v2.0 header).
3. **Sprint contract authored:** `.planning/v2/KICKOFF-v2.0.md` —
   "new face, same plane": Phase 0 secure+close v1.1 (backup push,
   state-migrating deploy + token rotation, /api/version, GPT-5.6
   wiring, trivial riders), Phase 1 mobile forensics + Fable design
   panel ending at a hard GREG GATE, Phase 2 streaming plane
   (server-side, additive), Phase 3 new-face build (desktop-primary,
   mobile thoughtfully designed and implemented, streaming-native,
   parity gate), Phase 4 verify + ship + real-device acceptance.
4. **Design-panel seed authored:** `.planning/v2/DESIGN-BRIEF-V3.md`.
5. This handoff + a dated `.planning/STATE.md` entry.

## 3. In progress

Nothing mid-flight. This was a planning-only session by Greg's explicit
instruction; no code, no deploys, no pushes.

## 4. Deferred / gated — all require Greg or the execution session

- **Everything in KICKOFF-v2.0** — the execution session does the work.
- Greg-gated within it: deploy approval at kickoff (Phase 0.2, with him
  present), design-direction pick (Phase 1 gate), Mac Mini onboarding
  (after token rotation), FOCUS TCC consent click, NEXUS backup config
  for the new state volume, real-device iPhone acceptance (Phase 4).
- Backlog items deliberately NOT in this sprint: economy retune (frozen
  until the ~2026-07-16 soak checkpoint), Track 2 art gen, destination
  features (dispatch-as-first-action, command-surface unification),
  prestige/world-event variety, digest LLM narrator.

## 5. Next steps (max 3)

1. Launch the execution session with the kickoff prompt below — stay
   present for the first ~15 min (preflight + the state-migrating
   deploy + token rotation need your live approval).
2. At the Phase-1 gate: review the design mockups + mobile forensics +
   SaaS assessment, pick the direction in a live message.
3. At Phase-4: test the new face on your actual iPhone — that message
   is what settles the sprint's headline claim.

## 6. Kickoff for the execution session

Launch from a session rooted at `/Users/greg/code/war-room` with the
built-in **`/goal`** command (v2.1.139+; the CLI here is 2.1.206,
verified) — it
sets a session-scoped Stop-hook evaluator that keeps the session working
turn after turn until the condition holds, then auto-clears. Setting it
starts work immediately; the condition below doubles as the directive
and is safe on any turn, first or fiftieth. If the session dies while
you're away, `claude --continue` restores the goal; for fully unattended
multi-day spans prefer the `/loop` fallback (same text, prefixed `/loop`
instead of `/goal` — its scheduled wakeups survive a dead session).

```
/goal ultracode. Execute /Users/greg/code/war-room/.planning/v2/KICKOFF-v2.0.md
end-to-end. This goal is met when ONE of these two end states is shown in
this conversation: (A) .planning/v2/STATE-v2.0.md reads "status: RUN
COMPLETE" — which the run protocol permits only after the session handoff
is written, the completion Bark push is sent and logged, every item is
settled (done or review-on-return), and the full gate (check-types, lint,
all suites, build) has been run green as the final act with its output
shown here; or (B) every item executable without Greg's live input is
settled, the run is blocked on a Greg-only gate (Phase-1 design pick or
Phase-4 real-device acceptance), and STATE-v2.0.md's log records exactly
what awaits him — shown here. Working rules: read SESSION-HANDOFF-2026-07-10.md
and KICKOFF-v2.0.md in full first. Claim .planning/v2/LOOP-LOCK (exit
untouched if a live pid holds it). If STATE-v2.0.md does not exist,
create it from the KICKOFF template, commit it, and run the launch
preflight while Greg is present; otherwise resume at the first unsettled
item. Phase 0 in order — 0.1 backup push FIRST, then the state-migrating
deploy + token rotation (0.2) while Greg is present. Re-derive the
baseline yourself; suite counts in the handoff are reported, not
verified. Never manufacture Greg's gate approvals. One agent per
checkout. Show every gate result in conversation output (the goal
evaluator only sees the transcript). If ~/.pixel-agents/rate-limit-snapshot.json
shows the 5h window ≥90% used: finish the current atomic step, commit
STATE, and state the pause in output — do not burn the cap. Or stop
after 300 turns.
```
