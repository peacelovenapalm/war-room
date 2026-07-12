# ADVERSARIAL WORST-CASE AUDIT — War Room system — 2026-07-12

**Phase E / register Q43.** Read-only. Zero code, config, or remote state
changed. Auditor: scout lane (Fable 5 / Opus 4.8 [1m]). The question:
**what is the WORST the system can do with the access it already HAS, and is
each path receipted and undoable?**

Legend: ✓ yes/present · ✗ no/absent · ⚠ caution/partial · ◷ time-bounded ·
⊘ unknown-or-not-verified. Epistemics per finding: **verified** (probed/read
this session), **reported** (a doc/person said so), **inferred** (unchecked
deduction). Secrets masked throughout — no token value was read.

---

## 0. The one load-bearing assumption (read this first)

Every board-facing mutating verb — enqueue a dispatch (CALL), kill an agent,
answer a blocked session, STOP-ALL, spend the economy, edit the office — is
**unauthenticated at the application layer**. The sole boundary is the
network: the app binds `127.0.0.1:3141` and `tailscale serve` exposes it
**tailnet-only** on `:8484`. No Bearer token guards the player plane.

- **verified**: `server/src/httpServer.ts:1914-1927` — the standalone `/ws`
  handler _skips_ auth (`if (options.embedded)` only); comment: "The server
  binds to 127.0.0.1, so only local clients can connect." The board's CALL
  (`launchDispatch` → `clientMessageHandler.ts:141 dispatchStore.enqueue`)
  rides this unauthenticated socket.
- **verified**: the player POST routes — `/api/dispatch/:id/kill` (1093),
  `/api/agents/kill` (1259), `/api/agents/answer` (1322),
  `/api/automation/stop-all` (1786), `/api/building/*`, `/api/economy/*` —
  have **no `preHandler: bearerAuth`**. Only _runner-report_ ingress
  (decision/status/pid-kills/answers) and the hook POST carry `bearerAuth`
  (`httpServer.ts:2212`, `crypto.timingSafeEqual`).
- **verified (2026-07-12, live)**: `ssh nexus-ts tailscale serve status` →
  `:8484 (tailnet only) → 127.0.0.1:3141`; no funnel entry. Matches
  INFRA-AUDIT 1d. Funnel untouched.

**Consequence:** the trust model is "membership in the tailnet == full board
authority." This is deliberate (D-43 single-user seam; RUN-MAP §3 "Funnel —
never. Tailnet-only serve, forever"). It is _sound_ as long as the tailnet
membership set is exactly {Greg's devices}. It is also the thing every
scenario below ultimately leans on. It is **not itself receipted** — the
board cannot tell two tailnet clients apart (single bearer identity by
design, REMOTE-ANSWER-DESIGN "multi-user attribution: out of scope").

---

## 1. Scenario — compromised phone / PWA session (a tailnet device)

**Worst case with current access:** the attacker has everything the board
grants. They can: queue dispatches to any allowlisted (machine, provider,
root) — i.e. spawn Claude/codex agents on MACBOOK/MINI within the allowlist;
`answer` any live _managed_ session (type keystrokes into a running agent —
see §4); `kill` observed sessions by pid; `stop-all` / `resume` automation;
drain the economy and rewrite the office layout. They **cannot** escape the
runner allowlist: provider/root containment and deny-by-default flags are
machine-local (`bin/lib/dispatch-rules.mjs:159 validateRequest`, realpath
containment `:197-208`) and the server cannot override them.

| Property     | State     | Evidence                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receipted    | ⚠ partial | Dispatch enqueue + lifecycle → `dispatchStore.getRecent()` (`/api/dispatch/recent`, httpServer.ts:1001) and the runner's append-only audit log (`~/Library/Logs/war-room-dispatch.log`, dispatch-runner.mjs:88). **verified.** But kill-outcome is **ephemeral in-memory only** ("no WS broadcast for this ephemeral… lifecycle", httpServer.ts:1276-1278) ✗ not durably receipted. **verified.** |
| Attributable | ✗ no      | Single bearer identity; the receipt records one identity, cannot distinguish phone-from-desk-from-attacker. **verified** (design, REMOTE-ANSWER-DESIGN).                                                                                                                                                                                                                                          |
| Undoable     | ⚠ mixed   | A spawned dispatch is `kill`-able and TTL-swept; economy/office edits are state-file mutations (restorable from the state volume / redeploy). A _delivered_ answer is ✗ not undoable (§4).                                                                                                                                                                                                        |

**Mitigation in place:** ✓ tailnet-only + 127.0.0.1 bind; ✓ runner allowlist
is the real containment (server "can only ask", httpServer.ts:1090-1092);
✓ deny-by-default for focus/sessions/shell.

**Maps to planned work:** partially C6 (per-machine tokens would not help a
stolen _phone_ session, but would scope blast radius if the board plane ever
gained a token). The ephemeral kill-ledger is **genuinely new** (minor).

---

## 2. Scenario — compromised bearer token (`WAR_ROOM_TOKEN`)

The token guards _runner-report ingress_ and _hook ingress_ — NOT the player
plane (§0). So stealing it grants **less** than a tailnet foothold on the
board, but it lets an attacker **forge runner telemetry**: fake dispatch
`decision`/`status` (spoof "accept"/"exited 0" → false economy/XP/contract
credit), fake pid-kill and answer outcomes, and inject arbitrary hook events
(fabricate agents/sessions on the board).

- **inferred (masked — values not read):** the estate uses a **single
  shared token**. The deploy mints one (`nexus-war-room-deploy.sh:116`,
  `openssl rand -hex 32` into `war-room.env`, 0600); MACBOOK/MINI runners
  authenticate against that same server token, so all machines carry the
  same secret. This is exactly why C6 (per-machine tokens) is on the
  register. One leak = whole-estate report-forgery until rotation.
- **verified:** token exposure surface is real — `launchctl print` on the
  MACBOOK dispatch-runner LaunchAgent dumps `WAR_ROOM_TOKEN` in plaintext
  (INFRA-AUDIT finding #3; Phase D moves it to a 0600 file). Local-user-
  readable only.

| Property  | State                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receipted | ⚠ Forged reports enter the same ledgers as real ones — indistinguishable, so the audit trail is _polluted_, not bypassed. Hook-forged agents are visible on the board (loud), which is a weak tripwire.                      |
| Undoable  | ⚠ Economy/state effects are restorable from the state volume; a rotated token (redeploy regenerates only if the env file is removed — runbook keeps it stable, line 112-113) closes ingress. Rotation is an attended action. |

**Mitigation in place:** ✓ `timingSafeEqual` constant-time compare;
✓ token never travels except to Bearer-authed runners; ✓ tailnet-only means
the token is only sniffable by a tailnet device already inside the trust set.

**Maps to planned work:** **C6 per-machine tokens** (scoping) + **Phase D**
(token out of the plist). Both already planned; not new.

---

## 3. Scenario — compromised runner machine (MACBOOK or MINI)

This is the **highest-privilege** compromise. The runner _is_ the containment
boundary — it holds the allowlist, spawns the children, and (MACBOOK) holds
ssh to nexus + the deploy path.

**Worst case:** with the machine, the attacker owns the allowlist file
(`~/.war-room/dispatch.json`) and can widen providers/roots/`sessions`/
`compute.scripts` to anything, then drive arbitrary local execution _through_
the board — laundering it as legitimate dispatch. On **MACBOOK** specifically:
ssh to nexus (INFRA-AUDIT 3a) + the deploy runbook = ability to rebuild and
replace the deployed container with an arbitrary image (§5). On **MINI**: the
`shell` provider (T8 compute) already runs registered scripts
(`dispatch-rules.mjs:180 validateComputeRequest`; INFRA-AUDIT 3d advertises
`providers:[claude,codex,shell]`, `scriptIds:['fleet-health']`).

| Property  | State                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receipted | ⚠ The runner's own audit log is append-only _on the compromised box_ — an attacker with the box can also edit it. Server-side, forged dispatches still appear in `/api/dispatch/recent`. So: receipted only to the extent the attacker doesn't also scrub local logs. ✗ not tamper-evident. |
| Undoable  | ✗ Local side-effects of executed scripts/agents are **not undoable**; deploy is undoable via rollback (§5).                                                                                                                                                                                 |

**Mitigation in place:** ✓ allowlist is machine-local and deny-by-default —
a _server_ compromise can't touch it; ✓ spawn discipline is `shell:false`,
argv-array, no shell-string interpolation (`dispatch-runner.mjs:523-525`;
`dispatch-rules.mjs` rejects shell metacharacters in tokens). These defend
the _server→runner_ direction, not an attacker _on_ the runner.

**Maps to planned work:** ⊘ largely **out of the current threat model** —
"compromised server" is modeled (REMOTE-ANSWER-DESIGN) but "compromised
runner" is treated as game-over by construction (the runner is trusted). This
is honest, but worth stating: **the runner boxes are the crown jewels; there
is no in-system mitigation for their compromise** beyond OS-level machine
security. Genuinely new framing; not a code gap.

---

## 4. Scenario — malicious / buggy agent output rendered on the board, and the ANSWER keystroke path

Two sub-cases.

**(a) Output rendered on the board.** Agent transcript/output flows to the
board (output ring → WS fan-out). Worst case: a malicious agent emits huge or
crafted output. **Mitigations:** ✓ output body cap
(`MAX_AGENT_OUTPUT_BODY_BYTES`, httpServer.ts:787); ✓ tail back-pressure
shedding (`OUTPUT_TAIL_MAX_BUFFERED_BYTES = 1 MiB`, dispatch-runner side
`isTailSocketBackpressured`, httpServer.ts:2230-2234). ✓ **verified
(orchestrator follow-up, same session):** no raw-HTML sinks in the v3 render
path — `grep -rn "dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document.write"
webview-v3/src` returns zero hits; agent text renders through React JSX
text nodes / canvas text, both of which escape by construction. The retiring
`webview-ui/` face was not swept (it is scheduled for C4 deletion).

**(b) The ANSWER path — the sharpest edge.** A board `answer {machine, pid,
text}` becomes **literal keystrokes typed into a live managed Claude
session** (`tmux send-keys -l` + separate Enter, `bin/lib/managed-sessions.mjs`).
Worst case: the typed text steers a running agent to do anything _that agent
is already permitted to do_ in its own session. The containment is real and
tight, but the residual is inherent:

| Property                      | State    | Evidence                                                                                                                                                                                                                                        |
| ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reaches only managed sessions | ✓        | manifest + `tmux has-session` liveness re-checked at delivery, deny-by-default `sessions:true` flag; unmanaged ptys unreachable _by construction_ (REMOTE-ANSWER-DESIGN "founding constraint"). **verified** in design + `validateRequest:170`. |
| Injection-safe                | ✓        | literal send-keys, argv-array, control-char reject + length cap (`validateAnswerText`, dispatch-runner.mjs:873). Text lands as keyboard input, never shell. **verified.**                                                                       |
| Replay-safe                   | ✓        | one-shot nonce (runner consumed-set) + server answered-state; at-most-once drain. **verified** (dispatch-runner.mjs:879 `nonce-replayed`).                                                                                                      |
| Receipted                     | ✓        | verbatim-text audit line per outcome (runner) + server answer receipts (`getAnswerReceipts`, `/api/agents/answers`). **verified.**                                                                                                              |
| **Undoable**                  | **✗ NO** | Once delivered, the keystrokes are typed and the agent may have already acted. There is no recall. **This is the one capability that is fully receipted but fundamentally NOT undoable.**                                                       |

**Assessment:** the ✗-undoable here is _acceptable by design_ — "the worst
case is a bad ANSWER to the agent's question, which is Greg's prerogative
anyway" (REMOTE-ANSWER-DESIGN threat table) — but combined with §0 (the
answer POST is unauthenticated/tailnet-only) and §1 (a stolen phone session),
**a tailnet foothold can type into a live agent, receipted but irreversible.**
This is the highest-consequence _receipted_ path and deserves its prominence.

**Maps to planned work:** **C8** (answer/kill/focus keyed on
(machine, pid, startTime) or sessionId — the pid-reuse fix) directly tightens
this: today `answer` targets by (machine, pid) (httpServer.ts:1324-1331) and
resolves to a managed ref runner-side, but pid-reuse between queue and
delivery is the C8 gap. **C9** (nonce/answerRequests LRU/TTL bounds) hardens
the replay/resource side. Both planned.

---

## 5. Scenario — the deploy path itself

`nexus-war-room-deploy.sh` runs **from MACBOOK**: rsync source → nexus,
`docker build`, `docker rm -f war-room` + `docker run`. Worst case: whoever
can run it (or has MACBOOK + ssh to nexus) replaces the live container with
an arbitrary image bound to the state volume and the `:ro` briefing mounts.

| Property         | State       | Evidence                                                                                                                                                                                                                                                                         |
| ---------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receipted        | ⚠           | `GIT_SHA`/`BUILT_AT` baked into the image → `/api/version` (runbook:37-39, 127). An attacker controlling the _source_ controls the reported sha too, so version is a **weak** receipt (honest-source assumption). ssh/docker leave host logs. ⊘ no tamper-evident deploy ledger. |
| Undoable         | ✓           | Rollback is explicit: redeploy `16d7eee`, verify old face returns (RUN-MAP §5). State migration is **abort-before-destroy**: `docker cp` state out _before_ `docker rm` (runbook:139-147, "aborting BEFORE docker rm, live state intact"). **verified** by read.                 |
| Blast on secrets | ✓ contained | `war-room.env` (token, 0600) is **kept in place** across redeploys (runbook:112-113) and never displayed; a redeploy does not rotate or echo it. **verified.**                                                                                                                   |

**Mitigations in place:** ✓ no `sudo`; ✓ never touches funnel; ✓ tailnet-only
serve reasserted each run; ✓ state-safe ordering; ✓ this run's deploy is
gated behind full-gate-green + codex review (RUN-MAP §2 Phase F, §5 "Never
deploy a red gate. Never deploy without the codex review").

**Maps to planned work:** ⊘ not a tracked item. The deploy path's safety
rests on MACBOOK integrity (→ §3) and the honest-source assumption. Genuinely
new observation: **`/api/version` is not a trustworthy receipt against a
malicious deployer** — it is a drift _detector_ for honest operators, not an
integrity control. Low priority (single-operator estate).

---

## 6. Scenario — the Bark notify path

The wrap-up notification (and server-side `notifyBark.ts`) POSTs to a Bark
endpoint that pushes to Greg's phone. Two surfaces: the server's own Bark
pushes, and the nexus notify wrapper (`http://localhost:8581/notify`,
RUN-MAP §7).

**Worst case:** an attacker who can reach the notify endpoint (localhost /
the `bark-dispatch` docker network the container joins, runbook:165) sends
**arbitrary push notifications to Greg's phone** — spam or a phishing message
("deploy failed, run this command…"). This is a **social-engineering /
annoyance** surface, not a system-integrity one.

| Property        | State       | Evidence                                                                                                                                                                                                           |
| --------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Receipted       | ⚠           | Delivery logged with a **masked** URL only (`maskUrlForLog`, notifyBark.ts:55, 118-120) — good secret hygiene, but the _content_ of an injected push is not audited on-device; a spoof push looks like a real one. |
| Undoable        | ✗ n/a       | A delivered notification cannot be recalled (inherent to push). Consequence is bounded to what Greg does in response.                                                                                              |
| Secret exposure | ✓ contained | Bark URL/key never printed in full (masked always; RUN-MAP §4 secrets-masked doctrine). **verified** in code.                                                                                                      |

**Mitigation in place:** ✓ URL/key masking; ✓ the notify endpoint is
localhost/docker-network-scoped on nexus (not tailnet-exposed) — reaching it
requires already being on nexus or its docker network (→ §3/§5). ✓ fire-and-
forget with bounded retry, no amplification.

**Maps to planned work:** ⊘ not tracked. New, low priority: **push content is
un-attributed on the device** — a phishing push is indistinguishable from a
real one. Realistic only after a nexus/docker-network compromise.

---

## Summary table — receipted × undoable

| #   | Scenario                               | Receipted?                            | Undoable?                 | New vs planned                                              |
| --- | -------------------------------------- | ------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| 1   | Compromised phone/PWA (tailnet device) | ⚠ partial (kill-outcome ✗ ephemeral)  | ⚠ mixed                   | ephemeral kill-ledger = new (minor); rest = C6-adjacent     |
| 2   | Compromised bearer token               | ⚠ pollutes ledger                     | ⚠ via restore + rotate    | **C6** + **Phase D** (planned)                              |
| 3   | Compromised runner machine             | ✗ not tamper-evident                  | ✗ local effects           | out-of-model by construction (new framing)                  |
| 4   | Buggy/malicious output · **ANSWER**    | ✓ (answer fully receipted)            | **✗ answer NOT undoable** | **C8/C9** tighten (planned); webview-v3 XSS ✓ checked clean |
| 5   | Deploy path                            | ⚠ weak (`/api/version` not integrity) | ✓ rollback + state-safe   | new low-pri observation                                     |
| 6   | Bark notify                            | ⚠ content un-audited                  | ✗ n/a (inherent)          | new low-pri observation                                     |

## Open checks I could NOT verify (honest ⊘)

- ✓ CLOSED (orchestrator follow-up, same session): webview-v3 render-time
  escaping of agent text (§4a) — zero raw-HTML sinks by grep; React/canvas
  escape by construction. Only the retiring `webview-ui/` face remains
  unswept (C4 deletes it).
- ⊘ Whether `WAR_ROOM_TOKEN` is byte-identical across MACBOOK/MINI/NEXUS —
  **inferred** from the single-server-token architecture; not confirmed by
  reading values (masked discipline held).
- ⊘ Tamper-evidence of the runner audit log and the deploy — neither has a
  signed/append-only-attested ledger; asserted absent by reading, not by
  attempting tamper.

## Bottom line

The system is **well-contained against its modeled adversary** (a compromised
_server_ / a hostile _agent_): deny-by-default allowlists, realpath
containment, `shell:false` argv spawning, one-shot nonces, and literal
send-keys mean neither the server nor an agent can escape the runner's
machine-local gates, and nearly every action lands in a receipt. The residual
risk is concentrated in three places the model deliberately trusts: **(1)**
the entire board plane is authenticated **only by tailnet membership** (no
app-layer token — §0); **(2)** the **runner machines are unconditionally
trusted** — their compromise is game-over with no in-system mitigation (§3);
and **(3)** the **ANSWER keystroke** is the one fully-receipted-but-
irreversible capability (§4). None of these is a defect against the stated
design; all three are the load-bearing trust assumptions, and they are worth
Greg seeing stated plainly.
