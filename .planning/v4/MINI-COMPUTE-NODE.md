# T8 — Mini as Non-LLM Compute Node (v4 companion, 2026-07-10)

Source: Sonnet design lane, live ssh inventory of the Mini + read of the
runner code. Register decision D-28: the Mini's M4 is the fleet's best
CPU — use it for python/data/media compute, NOT LLM sessions.

## Inventory (verified 2026-07-11T05:41Z unless noted)

- Apple M4, 10 cores, 16GB RAM, macOS 26.5. Disk: 34Gi free of 228Gi
  (84% used — watch for large media jobs).
- Reachable via tailscale `100.121.189.6` (gregs-mac-mini). The
  `~/.ssh/config` `mini` alias points at LAN `192.168.0.190` which was
  down at inventory time — use the tailscale IP or fix the alias.
- python3 = system 3.9.6 stub only (no uv/pyenv) — must install a real
  3.12+ before compute work. node via fnm v22.22.0 (plist-referenced) +
  brew 25.3.0. No docker. `claude` CLI NOT installed (consistent with
  non-LLM role); codex + gemini present.
- **War Room stack ALREADY installed**: com.war-room.dispatch-runner,
  coworker-adapter, needs-input-poller LaunchAgents + ~~/.war-room/
  {dispatch.json, env, hook.sh}. Current allowlist: providers
  [claude, codex], roots [~~/code, ~/Brain2], focus true.
- **LIVE BUG:** the runner log spams `skip tick — server responded 401`
  every 5s — the plist's WAR_ROOM_TOKEN predates the v2.0 rotation. The
  Mini's entire dispatch path is silently dead until the token is
  re-issued (runbook token step or hand-patch the plist, then
  `launchctl kickstart -k gui/$(id -u)/com.war-room.dispatch-runner`).
  This fix is INDEPENDENT of the compute work and should happen first.
- No DISPATCH-era zombies; crontab empty. Stale README-only checkout at
  ~/Code/arcade/war-room (ignore); live checkout /Users/greg/code/war-room.

## Design: extend the runner, don't duplicate it (D-26)

New dispatch provider value **`"shell"`** riding the existing
queue/allowlist/spawn(shell:false)/audit/output-forward pipeline.

**Trust boundary — the wire never carries a path or command.** The client
sends an opaque `scriptId`; only the machine-local dispatch.json resolves
it to {interpreter, path}. Same shape as providers/roots today: wire =
intent, local allowlist = capability. Missing/corrupt allowlist denies
everything (existing emptyAllowlist behavior extends).

Code touchpoints:

- `bin/lib/dispatch-rules.mjs`: DISPATCH_PROVIDERS += 'shell';
  validateRequest branch → `script-not-allowlisted` deny; buildArgv case
  resolves scriptId → `[interpreter, path, ...safeArgs]` (plain argv
  tokens only, control-char reject, per-script maxArgs cap, never a
  command string).
- `server/src/dispatchStore.ts`: provider const + isValidProvider +
  optional `scriptId`/`args` fields; `missing-scriptId` 2xx-deny mirrors
  the existing missing-prompt pattern (prompt required only for LLM
  providers).
- Machine advertisement (`GET /api/dispatch/machines`) also carries each
  machine's registered scriptId list → the CALL/DISPATCH tray renders a
  real script picker, no free-text.
- Lifecycle/visibility: zero new plumbing — runDispatch already streams
  any argv's output through outputChunk with queued/running/exit
  receipts; shell jobs appear in the tray like any run.

Resource guardrails (compute jobs are long/heavy, unlike bounded LLM
turns):

- `nice -n 10` wrapper by default; per-script optional `cpulimit` pct.
- Per-script `timeoutSec` → SIGTERM→SIGKILL via the existing stop
  machinery (a timeout is a self-issued stop).
- Concurrency cap (backpressure) so the queue can't stack simultaneous
  heavy jobs.
- Sleep policy: default NO caffeinate (Mini sleeps normally; jobs are
  interruptible) — pending Greg's answer to open question 3.

dispatch.json schema addition (local-only, human-edited):

```json
"compute": {
  "scripts": {
    "photo-batch-resize": {
      "interpreter": "/opt/homebrew/bin/python3.12",
      "path": "/Users/greg/scripts/compute/batch_resize.py",
      "maxArgs": 4,
      "timeoutSec": 7200,
      "cpulimit": 50
    }
  }
}
```

Example queue (real candidates): Immich batch transcode/hash work (M4 is
the fleet's fastest CPU), photo/video batch processing, vault
knowledge-graph rebuilds, AMC data transforms, CPU-bound builds offloaded
from the MacBook.

## Onboarding — 3 steps, each under 5 minutes

1. **Fix the token** (independent of v4): re-run the runbook token step
   or patch the plist's WAR_ROOM_TOKEN (source of truth: nexus
   `~/apps/war-room/war-room.env` — never echo it), kickstart the
   runner, confirm the 401 spam stops.
2. **Install python 3.12 + register one script**: `brew install
python@3.12`, drop a script at `~/scripts/compute/`, add its
   `compute.scripts` entry + `"shell"` to providers (after the code
   ships).
3. **Dispatch from the tray**: Mini + script from the picker →
   queue→run→exit with live output.

## Open questions for Greg

1. Fix the Mini's 401 token loop NOW as a standalone task (the existing
   claude/codex dispatch path is silently broken), or bundle with v4?
2. Script registration UX: hand-edit dispatch.json every time (safest,
   matches current philosophy) vs. a small `war-room-allow-script` CLI
   helper once this is frequent?
3. Sleep policy: may long batches hold the Mini awake (caffeinate,
   per-script opt-in), or always interruptible + resume-on-wake?
