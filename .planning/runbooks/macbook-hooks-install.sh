#!/bin/bash
# =============================================================================
# macbook-hooks-install.sh — GATED RUNBOOK (human-run only, never automated)
#
# Installs Claude Code `type:"command"` hooks into ~/.claude/settings.json so
# THIS machine streams session events to the War Room server on NEXUS.
# Parameterized by machine name — the Mac-Mini variant is the same script:
#
#   bash macbook-hooks-install.sh MACBOOK
#   bash macbook-hooks-install.sh MINI
#
# Re-running this script is safe and idempotent — the existing token is kept
# (step 1) and the hook entries + forwarder script are replaced, not
# duplicated (steps 2/4). Re-run it any time to pick up forwarder changes
# (e.g. the X-Pid header added below) without re-pasting the token.
#
# PID telemetry (2026-07-08): the forwarder also sends an `X-Pid` header.
# Claude Code runs each command hook as a DIRECT CHILD of the claude
# process, so `$PPID` inside hook.sh (itself a fresh `/bin/sh` process) is
# the claude session's own OS pid. The server tags it onto the event as
# `__pid` (same boundary as the X-Machine -> `__machine` tagging below), so
# the agent-drawer FOCUS button has a real pid to front the terminal with
# (bin/dispatch-runner.mjs `focus` action). Best-effort: if `$PPID` is
# empty, the header is simply omitted and FOCUS stays honestly disabled for
# that session ("NO PID -- use COPY ID").
#
# SessionEnd client-side distill (2026-07-13): deploy #6 (c0cf0e3) shipped
# client-side transcript distillation, but ONLY inside the bundled Claude
# hook script (dist/hooks/claude-hook.js) -- the app's own hook installer
# target. THIS runbook's forwarder never ran that code: it's a plain shell
# script that curls the raw hook payload straight to the server. Result: on
# real machines running this runbook (Greg's Macs), every SessionEnd
# produced a `transcript-unavailable` receipt and zero notes -- 46/46
# failed receipts, caught during the V8 precondition check. This runbook
# now also installs ~/.war-room/war-room-distill.js (the standalone CLI
# built alongside the hook bundle, same distill core, zero copy-paste) and
# the forwarder pipes SessionEnd payloads through it before the POST. Every
# other event is untouched -- detection is a cheap shell pattern match, and
# `node` discovery only runs on the SessionEnd path so it adds zero latency
# to the other 13 events. If `node` isn't found or the script is missing,
# the payload goes out unenriched exactly as before, and the server's
# honest `transcript-unavailable` receipt stays the fallback -- this change
# can only add notes, never break delivery.
#
# WHY command hooks, not `type:"http"` (redesigned 2026-07-07):
#   Claude Code hard-blocks http hooks whose URL resolves to a private or
#   link-local address — Tailscale 100.x IPs included. The first install
#   attempt used http hooks and broke EVERY session on the machine with
#   "HTTP hook blocked" errors on every tool call. Command hooks are not
#   subject to that guard: each event runs ~/.war-room/hook.sh, which curls
#   the server in a detached background job and always exits 0.
#
# What it changes:
#   1. ~/.war-room/env                 — WAR_ROOM_TOKEN + WAR_ROOM_URL +
#                                         WAR_ROOM_MACHINE (chmod 600;
#                                         existing token is kept)
#   2. ~/.war-room/hook.sh             — the forwarder script (written by
#                                         this runbook)
#   2b. ~/.war-room/war-room-distill.js — standalone SessionEnd distill CLI,
#                                         copied from dist/hooks/ in THIS
#                                         checkout (npm run package builds
#                                         it). Non-fatal if missing/stale --
#                                         the forwarder just skips enrichment.
#   3. ~/.claude/settings.json — one command hook entry per event
#      (BACKED UP FIRST; idempotent; also REMOVES any legacy http entries
#       from the 2026-07-06 design and the legacy ~/.zshenv token line)
#
# Hook delivery is fire-and-forget: server down / non-2xx / timeout NEVER
# blocks Claude Code. The forwarder backgrounds curl and exits immediately.
#
# UNDO (inline, also printed at the end):
#   cp ~/.claude/settings.json.bak.war-room.<TS> ~/.claude/settings.json
#   rm -rf ~/.war-room
# =============================================================================
set -euo pipefail

MACHINE="${1:-}"
SERVER_URL="${WAR_ROOM_URL:-https://nexus.tail722a2e.ts.net:8484}"
SETTINGS="${HOME}/.claude/settings.json"
ENV_DIR="${HOME}/.war-room"
ENV_FILE="${ENV_DIR}/env"
HOOK_SCRIPT="${ENV_DIR}/hook.sh"
DISTILL_CLI_DEST="${ENV_DIR}/war-room-distill.js"
# This script lives at <repo>/.planning/runbooks/ -- resolve the repo root
# so we can pick up the built dist/hooks/war-room-distill.js from THIS
# checkout (run `npm run package` first if it's missing/stale).
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DISTILL_CLI_SRC="${REPO_ROOT}/dist/hooks/war-room-distill.js"
TS="$(date +%Y%m%d-%H%M%S)"

ok()   { printf '[OK]   %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; exit 1; }

case "${MACHINE}" in
  [A-Z]*[A-Z0-9]) ;;
  *) fail "usage: bash $(basename "$0") <MACHINE-NAME>   (e.g. MACBOOK or MINI, uppercase)" ;;
esac
command -v jq >/dev/null || fail "jq is required (brew install jq)"
command -v curl >/dev/null || fail "curl is required"
[ -f "${SETTINGS}" ] || fail "${SETTINGS} not found — is Claude Code set up on this machine?"
jq empty "${SETTINGS}" 2>/dev/null || fail "${SETTINGS} is not valid JSON — fix it before running this"

echo "=============================================================="
echo " War Room hooks install (command-hook forwarder design)"
echo "   machine : ${MACHINE}"
echo "   server  : ${SERVER_URL}/api/hooks/claude"
echo "   forwarder: ${HOOK_SCRIPT}"
echo "   settings: ${SETTINGS} (will be backed up first)"
echo "=============================================================="
read -r -p "Type 'install' to proceed: " CONFIRM
[ "${CONFIRM}" = "install" ] || fail "aborted (no changes made)"

# ── 1. Token (existing token is kept; prompted silently otherwise) ───────────
EXISTING_TOKEN=""
if [ -f "${ENV_FILE}" ]; then
  EXISTING_TOKEN="$(sed -n 's/^export WAR_ROOM_TOKEN=//p' "${ENV_FILE}" | head -1)"
fi
if [ -n "${EXISTING_TOKEN}" ]; then
  TOKEN="${EXISTING_TOKEN}"
  ok "token already stored in ${ENV_FILE} — keeping it"
else
  printf 'Paste WAR_ROOM_TOKEN (from nexus ~/apps/war-room/war-room.env; input hidden): '
  read -r -s TOKEN; echo
  [ -n "${TOKEN}" ] || fail "empty token"
fi
mkdir -p "${ENV_DIR}"
umask 077
cat > "${ENV_FILE}" <<EOF
export WAR_ROOM_TOKEN=${TOKEN}
export WAR_ROOM_URL=${SERVER_URL}
export WAR_ROOM_MACHINE=${MACHINE}
EOF
chmod 600 "${ENV_FILE}"
ok "env written to ${ENV_FILE} (mode 600; token not displayed)"

# ── 2. Forwarder script (the command-hook target) ────────────────────────────
cat > "${HOOK_SCRIPT}" <<'HOOKEOF'
#!/bin/sh
# ~/.war-room/hook.sh — War Room event forwarder.
# Installed by macbook-hooks-install.sh; invoked by Claude Code command hooks.
# Reads the hook event JSON on stdin, POSTs it to the War Room server in a
# detached background job. ALWAYS exits 0 — a dead server never blocks Claude.
# Set WAR_ROOM_HOOK_SYNC=1 to run the POST in the foreground and print the
# HTTP status (used by the runbook smoke test).
ENV_FILE="${HOME}/.war-room/env"
[ -f "${ENV_FILE}" ] || exit 0
. "${ENV_FILE}"
[ -n "${WAR_ROOM_TOKEN:-}" ] || exit 0
[ -n "${WAR_ROOM_URL:-}" ] || exit 0
PAYLOAD="$(cat)"
[ -n "${PAYLOAD}" ] || exit 0
# SessionEnd client-side distill (2026-07-13): cheap shell pattern match --
# no grep/jq spawn -- so non-SessionEnd events (13 of 14) pay zero cost.
# Only on the SessionEnd path do we bother discovering `node`, since Claude
# Code hook shells don't reliably inherit a PATH that has it. On ANY miss
# (no node, no script, timeout, bad output) the ORIGINAL payload ships
# unenriched -- the server's honest transcript-unavailable receipt is the
# fallback; this can only add notes, never break or delay delivery.
case "${PAYLOAD}" in
  *'"hook_event_name":"SessionEnd"'*|*'"hook_event_name": "SessionEnd"'*)
    DISTILL_NODE=""
    if command -v node >/dev/null 2>&1; then
      DISTILL_NODE="$(command -v node)"
    elif [ -x /opt/homebrew/bin/node ]; then
      DISTILL_NODE=/opt/homebrew/bin/node
    elif [ -x /usr/local/bin/node ]; then
      DISTILL_NODE=/usr/local/bin/node
    fi
    DISTILL_SCRIPT="${HOME}/.war-room/war-room-distill.js"
    if [ -n "${DISTILL_NODE}" ] && [ -f "${DISTILL_SCRIPT}" ]; then
      DISTILL_TMP="$(mktemp "${TMPDIR:-/tmp}/warroom-distill.XXXXXX" 2>/dev/null || echo "")"
      if [ -n "${DISTILL_TMP}" ]; then
        printf '%s' "${PAYLOAD}" > "${DISTILL_TMP}" 2>/dev/null
        # Hard 5s timeout so a pathological hang in the CLI can never block
        # this forwarder: run it in the background, race it against a sleep
        # watchdog that kills it, then always continue.
        ENRICHED="$(
          "${DISTILL_NODE}" "${DISTILL_SCRIPT}" < "${DISTILL_TMP}" 2>/dev/null &
          DISTILL_PID=$!
          ( sleep 5; kill -9 "${DISTILL_PID}" 2>/dev/null ) &
          WATCH_PID=$!
          wait "${DISTILL_PID}" 2>/dev/null
          kill "${WATCH_PID}" 2>/dev/null
          wait "${WATCH_PID}" 2>/dev/null
        )"
        rm -f "${DISTILL_TMP}"
        # Cheap sanity check (no jq dependency in the runtime forwarder):
        # only adopt output that at least looks like a JSON object.
        case "${ENRICHED}" in
          '{'*'}') PAYLOAD="${ENRICHED}" ;;
          *) : ;;
        esac
      fi
    fi
    ;;
esac
# PID telemetry: Claude Code runs this hook as a direct child of the claude
# process, so $PPID here is the session's own OS pid -- forwarded as X-Pid
# for the agent-drawer FOCUS button. Omitted (not sent as "X-Pid:") when
# empty so the server never has to distinguish "absent" from "0".
set -- -s -X POST "${WAR_ROOM_URL}/api/hooks/claude" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${WAR_ROOM_TOKEN}" \
  -H "X-Machine: ${WAR_ROOM_MACHINE:-UNKNOWN}"
if [ -n "${PPID:-}" ]; then
  set -- "$@" -H "X-Pid: ${PPID}"
fi
if [ "${WAR_ROOM_HOOK_SYNC:-}" = "1" ]; then
  printf '%s' "${PAYLOAD}" | curl "$@" -o /dev/null -w '%{http_code}' -m 8 --data-binary @-
  exit 0
fi
(
  printf '%s' "${PAYLOAD}" | curl "$@" -o /dev/null -m 5 --data-binary @-
) </dev/null >/dev/null 2>&1 &
exit 0
HOOKEOF
chmod 700 "${HOOK_SCRIPT}"
ok "forwarder written to ${HOOK_SCRIPT} (mode 700)"

# ── 2b. Standalone SessionEnd distill CLI (copied from THIS checkout) ────────
if [ -f "${DISTILL_CLI_SRC}" ]; then
  cp "${DISTILL_CLI_SRC}" "${DISTILL_CLI_DEST}"
  chmod 700 "${DISTILL_CLI_DEST}"
  ok "distill CLI copied to ${DISTILL_CLI_DEST}"
else
  warn "dist/hooks/war-room-distill.js not found in ${REPO_ROOT} (run 'npm run package' first) — SessionEnd notes stay disabled until you re-run this script after building"
fi

# ── 3. Legacy cleanup: 2026-07-06 http-hook design leftovers ─────────────────
if grep -qs 'war-room-token' "${HOME}/.zshenv"; then
  sed -i '' '/war-room-token/d' "${HOME}/.zshenv"
  ok "removed legacy war-room-token line from ~/.zshenv (no longer needed)"
fi

# ── 4. Backup, then merge hook entries ───────────────────────────────────────
BACKUP="${SETTINGS}.bak.war-room.${TS}"
cp "${SETTINGS}" "${BACKUP}" && ok "backup -> ${BACKUP}"

# Same event set the app's own installer uses (server/src/providers/hook/claude/constants.ts).
EVENTS='["SessionStart","SessionEnd","Stop","PermissionRequest","Notification","UserPromptSubmit","PreToolUse","PostToolUse","PostToolUseFailure","SubagentStart","SubagentStop","TeammateIdle","TaskCreated","TaskCompleted"]'

# Idempotent merge: strip any prior war-room entry (this design's command hook
# OR the legacy 2026-07-06 http hook, matched by its ingest path), then append
# one fresh command entry per event.
jq --arg cmd "/bin/sh \"${HOOK_SCRIPT}\"" --arg script "${HOOK_SCRIPT}" --argjson events "${EVENTS}" '
  def is_war_room_entry:
    (.hooks // []) | any(
      (((.type // "") == "http") and ((.url // "") | contains("/api/hooks/claude")))
      or ((.command // "") | contains(".war-room/hook.sh"))
    );
  .hooks = (.hooks // {}) |
  reduce $events[] as $ev (.;
    .hooks[$ev] = (
      ((.hooks[$ev] // []) | map(select(is_war_room_entry | not))) + [{
        matcher: "",
        hooks: [{ type: "command", command: $cmd, timeout: 10 }]
      }]
    )
  ) |
  # Legacy http entries may exist on events outside $events too — sweep all.
  .hooks = (.hooks | with_entries(
    .value |= map(select(
      ((.hooks // []) | any(((.type // "") == "http") and ((.url // "") | contains("/api/hooks/claude")))) | not
    ))
  ) | with_entries(select(.value | length > 0)))
' "${BACKUP}" > "${SETTINGS}.war-room-tmp"
jq empty "${SETTINGS}.war-room-tmp" || { rm -f "${SETTINGS}.war-room-tmp"; fail "generated settings invalid — original untouched"; }
mv "${SETTINGS}.war-room-tmp" "${SETTINGS}"
ok "command hooks installed for $(echo "${EVENTS}" | jq length) events (machine: ${MACHINE})"

# ── 5. Smoke test: full path THROUGH the forwarder script ────────────────────
CODE="$(printf '{"hook_event_name":"Ping","session_id":"runbook-smoke-test"}' \
  | WAR_ROOM_HOOK_SYNC=1 sh "${HOOK_SCRIPT}" || true)"
if [ "${CODE}" = "200" ]; then
  ok "smoke test: forwarder POSTed an authenticated event, server said 200"
elif [ "${CODE}" = "401" ]; then
  warn "smoke test: 401 — token mismatch with the server's WAR_ROOM_TOKEN (rm ${ENV_FILE} and re-run to re-enter it)"
else
  warn "smoke test: HTTP ${CODE:-none} — server unreachable? (hooks stay non-blocking either way)"
fi

echo
echo "=============================================================="
ok "INSTALL COMPLETE on ${MACHINE}"
echo "  Restart open Claude Code sessions — hook config loads at session start."
echo
echo "  UNDO:"
echo "    cp ${BACKUP} ${SETTINGS}"
echo "    rm -rf ${ENV_DIR}"
echo "=============================================================="
