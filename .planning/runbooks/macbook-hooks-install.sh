#!/bin/bash
# =============================================================================
# macbook-hooks-install.sh — GATED RUNBOOK (human-run only, never automated)
#
# Installs native Claude Code `type:"http"` hooks into ~/.claude/settings.json
# so THIS machine streams session events to the War Room server on NEXUS.
# Parameterized by machine name — the Mac-Mini variant is the same script:
#
#   bash macbook-hooks-install.sh MACBOOK
#   bash macbook-hooks-install.sh MINI
#
# What it changes:
#   1. ~/.war-room/env            — stores WAR_ROOM_TOKEN (chmod 600)
#   2. ~/.zshenv                  — one marked line sourcing that env file
#      (the token must be in Claude Code's environment for $WAR_ROOM_TOKEN
#       interpolation; `allowedEnvVars` whitelists it for hook headers)
#   3. ~/.claude/settings.json    — adds one http hook entry per event
#      (BACKED UP FIRST; entries are marked by the server URL, idempotent)
#
# Hook delivery is fire-and-forget: non-2xx / timeout NEVER blocks Claude Code.
#
# UNDO (inline, also printed at the end):
#   cp ~/.claude/settings.json.bak.war-room.<TS> ~/.claude/settings.json
#   sed -i '' '/war-room-token/d' ~/.zshenv
#   rm -rf ~/.war-room
# =============================================================================
set -euo pipefail

MACHINE="${1:-}"
SERVER_URL="${WAR_ROOM_URL:-https://nexus.tail722a2e.ts.net:8484}"
SETTINGS="${HOME}/.claude/settings.json"
ENV_DIR="${HOME}/.war-room"
ENV_FILE="${ENV_DIR}/env"
TS="$(date +%Y%m%d-%H%M%S)"

ok()   { printf '[OK]   %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; exit 1; }

case "${MACHINE}" in
  [A-Z]*[A-Z0-9]) ;;
  *) fail "usage: bash $(basename "$0") <MACHINE-NAME>   (e.g. MACBOOK or MINI, uppercase)" ;;
esac
command -v jq >/dev/null || fail "jq is required (brew install jq)"
[ -f "${SETTINGS}" ] || fail "${SETTINGS} not found — is Claude Code set up on this machine?"
jq empty "${SETTINGS}" 2>/dev/null || fail "${SETTINGS} is not valid JSON — fix it before running this"

echo "=============================================================="
echo " War Room hooks install"
echo "   machine : ${MACHINE}"
echo "   server  : ${SERVER_URL}/api/hooks/claude"
echo "   settings: ${SETTINGS} (will be backed up first)"
echo "=============================================================="
read -r -p "Type 'install' to proceed: " CONFIRM
[ "${CONFIRM}" = "install" ] || fail "aborted (no changes made)"

# ── 1. Token (prompted silently, never echoed) ───────────────────────────────
if [ -f "${ENV_FILE}" ] && grep -q 'WAR_ROOM_TOKEN=' "${ENV_FILE}"; then
  ok "token already stored in ${ENV_FILE} — keeping it"
else
  printf 'Paste WAR_ROOM_TOKEN (from nexus ~/apps/war-room/war-room.env; input hidden): '
  read -r -s TOKEN; echo
  [ -n "${TOKEN}" ] || fail "empty token"
  mkdir -p "${ENV_DIR}"; umask 077
  printf 'export WAR_ROOM_TOKEN=%s\n' "${TOKEN}" > "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  ok "token stored in ${ENV_FILE} (mode 600, not displayed)"
fi

# ── 2. Shell env sourcing (marked line, idempotent) ──────────────────────────
MARK='# war-room-token'
if grep -qs "${MARK}" "${HOME}/.zshenv"; then
  ok "~/.zshenv already sources the token env"
else
  printf '[ -f "%s" ] && source "%s"  %s\n' "${ENV_FILE}" "${ENV_FILE}" "${MARK}" >> "${HOME}/.zshenv"
  ok "added marked source line to ~/.zshenv (undo: sed -i '' '/war-room-token/d' ~/.zshenv)"
fi

# ── 3. Backup, then merge hook entries ───────────────────────────────────────
BACKUP="${SETTINGS}.bak.war-room.${TS}"
cp "${SETTINGS}" "${BACKUP}" && ok "backup -> ${BACKUP}"

# Same event set the app's own installer uses (server/src/providers/hook/claude/constants.ts).
EVENTS='["SessionStart","SessionEnd","Stop","PermissionRequest","Notification","UserPromptSubmit","PreToolUse","PostToolUse","PostToolUseFailure","SubagentStart","SubagentStop","TeammateIdle","TaskCreated","TaskCompleted"]'

# NOTE on allowedEnvVars: required for $WAR_ROOM_TOKEN interpolation in http
# hook headers (known trap, verified 2026-07-04). It is written per hook entry
# here; if your Claude Code version expects it at hooks-top-level instead,
# move it to .hooks.allowedEnvVars — first run will tell (fire-and-forget,
# failures are non-blocking; check the server log for 401s).
jq --arg url "${SERVER_URL}/api/hooks/claude" --arg machine "${MACHINE}" --argjson events "${EVENTS}" '
  .hooks = (.hooks // {}) |
  reduce $events[] as $ev (.;
    .hooks[$ev] = (
      ((.hooks[$ev] // []) | map(select((.hooks // []) | any(.url == $url) | not))) + [{
        matcher: "",
        hooks: [{
          type: "http",
          url: $url,
          method: "POST",
          headers: { "Authorization": "Bearer $WAR_ROOM_TOKEN", "X-Machine": $machine },
          allowedEnvVars: ["WAR_ROOM_TOKEN"],
          timeout: 5
        }]
      }]
    )
  )
' "${BACKUP}" > "${SETTINGS}.war-room-tmp"
jq empty "${SETTINGS}.war-room-tmp" || { rm -f "${SETTINGS}.war-room-tmp"; fail "generated settings invalid — original untouched"; }
mv "${SETTINGS}.war-room-tmp" "${SETTINGS}"
ok "http hooks installed for $(echo "${EVENTS}" | jq length) events (X-Machine: ${MACHINE})"

# ── 4. Smoke test the ingest path (does not involve Claude Code) ────────────
# shellcheck disable=SC1090
source "${ENV_FILE}"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 8 -X POST "${SERVER_URL}/api/hooks/claude" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${WAR_ROOM_TOKEN}" \
  -H "X-Machine: ${MACHINE}" \
  -d '{"hook_event_name":"Ping","session_id":"runbook-smoke-test"}' || true)"
if [ "${CODE}" = "200" ]; then
  ok "smoke test: server accepted an authenticated POST (200)"
elif [ "${CODE}" = "401" ]; then
  warn "smoke test: 401 — token mismatch with the server's WAR_ROOM_TOKEN"
else
  warn "smoke test: HTTP ${CODE:-none} — server unreachable? (hooks stay non-blocking either way)"
fi

echo
echo "=============================================================="
ok "INSTALL COMPLETE on ${MACHINE}"
echo "  Restart Claude Code sessions (new shells) to pick up the env + hooks."
echo
echo "  UNDO:"
echo "    cp ${BACKUP} ${SETTINGS}"
echo "    sed -i '' '/war-room-token/d' ~/.zshenv"
echo "    rm -rf ${ENV_DIR}"
echo "=============================================================="
