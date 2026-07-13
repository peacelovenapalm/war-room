#!/bin/bash
# =============================================================================
# codex-hooks-install.sh — GATED RUNBOOK (human-run only, never automated)
#
# Installs all ten Codex command hooks into ~/.codex/hooks.json. The hooks call
# ~/.war-room/codex-hook.sh, a thin wrapper around War Room's bundled Node
# forwarder. Re-running is safe: the token is retained and prior War Room Codex
# entries are replaced rather than duplicated.
#
# Codex requires trust approval for non-managed hooks. On the first Codex TUI
# start after installation, open `/hooks`, then review and approve these hooks
# normally. This runbook never uses --dangerously-bypass-hook-trust.
#
# The existing `notify` key is owned by Computer Use and is never changed.
#
# Usage:
#   bash .planning/runbooks/codex-hooks-install.sh MACBOOK
#
# UNDO (the exact timestamped path is printed after installation):
#   cp ~/.codex/hooks.json.bak.war-room.<TS> ~/.codex/hooks.json
#   rm ~/.war-room/codex-hook.sh ~/.war-room/codex-hook.js
# =============================================================================
set -euo pipefail

MACHINE="${1:-}"
SERVER_URL="${WAR_ROOM_URL:-https://nexus.tail722a2e.ts.net:8484}"
HOOKS_FILE="${HOME}/.codex/hooks.json"
ENV_DIR="${HOME}/.war-room"
ENV_FILE="${ENV_DIR}/env"
HOOK_WRAPPER="${ENV_DIR}/codex-hook.sh"
HOOK_BUNDLE="${ENV_DIR}/codex-hook.js"
RUNBOOK_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${RUNBOOK_DIR}/../.." && pwd)"
SOURCE_BUNDLE="${REPO_ROOT}/dist/hooks/codex-hook.js"
TS="$(date +%Y%m%d-%H%M%S)"

ok()   { printf '[OK]   %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; exit 1; }

case "${MACHINE}" in
  [A-Z]*[A-Z0-9]) ;;
  *) fail "usage: bash $(basename "$0") <MACHINE-NAME>   (e.g. MACBOOK or MINI, uppercase)" ;;
esac
command -v jq >/dev/null || fail "jq is required (brew install jq)"
command -v node >/dev/null || fail "node is required"
[ -f "${SOURCE_BUNDLE}" ] || fail "${SOURCE_BUNDLE} not found — run node esbuild.js first"
if [ -f "${HOOKS_FILE}" ]; then
  jq empty "${HOOKS_FILE}" 2>/dev/null || fail "${HOOKS_FILE} is not valid JSON"
fi

echo "=============================================================="
echo " War Room Codex hooks install"
echo "   machine   : ${MACHINE}"
echo "   server    : ${SERVER_URL}/api/hooks/codex"
echo "   forwarder : ${HOOK_WRAPPER}"
echo "   config    : ${HOOKS_FILE} (backup first; notify preserved)"
echo "=============================================================="
warn "Codex will require normal hook review in the TUI; open /hooks to approve."
warn "Do not launch Codex with --dangerously-bypass-hook-trust."
read -r -p "Type 'install' to proceed: " CONFIRM
[ "${CONFIRM}" = "install" ] || fail "aborted (no changes made)"

# ── 1. Token and machine environment ─────────────────────────────────────────
EXISTING_TOKEN=""
if [ -f "${ENV_FILE}" ]; then
  EXISTING_TOKEN="$(sed -n 's/^export WAR_ROOM_TOKEN=//p' "${ENV_FILE}" | head -1)"
fi
if [ -n "${EXISTING_TOKEN}" ]; then
  TOKEN="${EXISTING_TOKEN}"
  ok "token already stored in ${ENV_FILE} — keeping it"
else
  printf 'Paste WAR_ROOM_TOKEN (input hidden): '
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

# ── 2. Bundled forwarder + thin wrapper ───────────────────────────────────────
cp "${SOURCE_BUNDLE}" "${HOOK_BUNDLE}"
chmod 700 "${HOOK_BUNDLE}"
cat > "${HOOK_WRAPPER}" <<'HOOKEOF'
#!/bin/sh
# Installed by codex-hooks-install.sh. The Node forwarder reads one JSON object
# from stdin, discovers the nearest Codex ancestor PID best-effort, and always
# exits 0 without stdout.
ENV_FILE="${HOME}/.war-room/env"
[ -f "${ENV_FILE}" ] || exit 0
. "${ENV_FILE}"
[ -n "${WAR_ROOM_TOKEN:-}" ] || exit 0
[ -n "${WAR_ROOM_URL:-}" ] || exit 0
exec node "${HOME}/.war-room/codex-hook.js"
HOOKEOF
chmod 700 "${HOOK_WRAPPER}"
ok "forwarder installed at ${HOOK_BUNDLE}; wrapper written to ${HOOK_WRAPPER}"

# ── 3. Backup first, then merge all ten registrations ────────────────────────
mkdir -p "$(dirname "${HOOKS_FILE}")"
BACKUP="${HOOKS_FILE}.bak.war-room.${TS}"
if [ -f "${HOOKS_FILE}" ]; then
  cp "${HOOKS_FILE}" "${BACKUP}"
else
  printf '{}\n' > "${BACKUP}"
fi
ok "backup -> ${BACKUP}"

EVENTS='["SessionStart","SubagentStart","PreToolUse","PermissionRequest","PostToolUse","PreCompact","PostCompact","UserPromptSubmit","SubagentStop","Stop"]'

# Idempotent merge: remove only earlier War Room Codex entries, then append one
# fresh command hook per event. Every unrelated key — especially `notify` — is
# preserved semantically by jq's object merge (values are not changed).
jq --arg cmd "/bin/sh \"${HOOK_WRAPPER}\"" --argjson events "${EVENTS}" '
  def is_war_room_codex:
    (.hooks // []) | any(
      ((.command // "") | contains(".war-room/codex-hook.sh"))
      or (((.type // "") == "http") and ((.url // "") | contains("/api/hooks/codex")))
    );
  .hooks = (.hooks // {}) |
  reduce $events[] as $event (.;
    .hooks[$event] = (
      ((.hooks[$event] // []) | map(select(is_war_room_codex | not))) + [{
        matcher: "",
        hooks: [{ type: "command", command: $cmd, timeout: 5 }]
      }]
    )
  )
' "${BACKUP}" > "${HOOKS_FILE}.war-room-tmp"
jq empty "${HOOKS_FILE}.war-room-tmp" || {
  rm -f "${HOOKS_FILE}.war-room-tmp"
  fail "generated hooks config invalid — original untouched"
}
mv "${HOOKS_FILE}.war-room-tmp" "${HOOKS_FILE}"
ok "installed $(printf '%s' "${EVENTS}" | jq length) Codex hook registrations"
ok "existing notify key preserved (runbook never reads or writes it)"

# ── 4. Foreground smoke POST through the installed forwarder ─────────────────
SMOKE_STATUS="$(mktemp "${TMPDIR:-/tmp}/war-room-codex-hook.XXXXXX")"
rm -f "${SMOKE_STATUS}"
printf '{"hook_event_name":"Stop","session_id":"runbook-smoke-test"}' \
  | WAR_ROOM_HOOK_SYNC=1 WAR_ROOM_HOOK_STATUS_FILE="${SMOKE_STATUS}" sh "${HOOK_WRAPPER}" || true
CODE="$(cat "${SMOKE_STATUS}" 2>/dev/null || true)"
rm -f "${SMOKE_STATUS}"
if [ "${CODE}" = "200" ]; then
  ok "smoke test: authenticated foreground POST through the forwarder returned 200"
elif [ "${CODE}" = "401" ]; then
  warn "smoke test: 401 — token mismatch (remove ${ENV_FILE} and re-run to re-enter it)"
else
  warn "smoke test: ${CODE:-no status} — server unreachable? Hooks remain fail-open"
fi

echo
echo "=============================================================="
ok "INSTALL COMPLETE on ${MACHINE}"
warn "Start Codex, open /hooks, and approve the hooks after reviewing them."
warn "Never use --dangerously-bypass-hook-trust for this installation."
echo
echo "  UNDO:"
echo "    cp ${BACKUP} ${HOOKS_FILE}"
echo "    rm -f ${HOOK_WRAPPER} ${HOOK_BUNDLE}"
echo "=============================================================="
