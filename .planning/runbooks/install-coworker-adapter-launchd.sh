#!/bin/bash
# =============================================================================
# install-coworker-adapter-launchd.sh — GATED RUNBOOK (human-run only)
#
# Installs the War Room coworker adapter (bin/coworker-adapter.mjs) as a
# per-machine launchd USER agent. The adapter tails Codex + Gemini CLI session
# files (read-only) and POSTs normalized activity to the War Room server,
# which renders them as COWORKERS (SQUARE badge + [CODEX] / DIAMOND + [GEMINI]
# — shape + text, colorblind rule). Parameterized by machine name:
#
#   bash install-coworker-adapter-launchd.sh MACBOOK
#   bash install-coworker-adapter-launchd.sh MINI
#
# Prereq: the hooks runbook (macbook-hooks-install.sh) already stored the
# ingest token in ~/.war-room/env on this machine (the adapter reuses it).
#
# NOTE — server version: the per-provider ingest (/api/hooks/codex, /gemini)
# ships in war-room v1. While NEXUS still runs v0 the adapter logs
# "⚠ codex: server 404 …" per event and keeps running — harmless; coworkers
# appear as soon as v1 is deployed. No reinstall needed.
#
# What it changes:
#   1. ~/Library/LaunchAgents/com.war-room.coworker-adapter.plist
#      (BACKED UP FIRST if it exists), loaded via launchctl bootstrap
#   2. ~/Library/Logs/war-room-coworker.log — adapter stdout/stderr
#
# Nothing here touches ~/.claude, ~/.codex, ~/.gemini contents, NEXUS, or any
# shared service. The adapter only READS session files and POSTs to the server.
#
# UNDO (inline, also printed at the end):
#   launchctl bootout gui/$UID/com.war-room.coworker-adapter
#   rm ~/Library/LaunchAgents/com.war-room.coworker-adapter.plist
#   (restore the .bak.<TS> plist if one was backed up)
# =============================================================================
set -euo pipefail

MACHINE="${1:-}"
SERVER_URL="${WAR_ROOM_URL:-https://nexus.tail722a2e.ts.net:8484}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADAPTER="${REPO_DIR}/bin/coworker-adapter.mjs"
ENV_FILE="${HOME}/.war-room/env"
LABEL="com.war-room.coworker-adapter"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG="${HOME}/Library/Logs/war-room-coworker.log"
TS="$(date +%Y%m%d-%H%M%S)"

ok()   { printf '[OK]   %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; exit 1; }

case "${MACHINE}" in
  [A-Z]*[A-Z0-9]) ;;
  *) fail "usage: bash $(basename "$0") <MACHINE-NAME>   (e.g. MACBOOK or MINI, uppercase)" ;;
esac
[ -f "${ADAPTER}" ] || fail "adapter not found at ${ADAPTER}"
[ -f "${REPO_DIR}/bin/lib/coworker-map.mjs" ] || fail "bin/lib/coworker-map.mjs missing next to the adapter — ship the full bin/ tree"
# Resolve node to a STABLE path. `command -v node` under fnm returns an
# ephemeral ~/.local/state/fnm_multishells/<pid>/bin path that dies with this
# shell — baking it into the plist gives launchd a dead binary on next boot.
NODE_BIN="$(command -v node)" || fail "node not found on PATH"
NODE_BIN="$(realpath "${NODE_BIN}")"
case "${NODE_BIN}" in
  *fnm_multishells*) fail "node still resolves to an ephemeral fnm multishell path (${NODE_BIN}) — install a stable node (brew install node) or fix fnm" ;;
esac
[ -x "${NODE_BIN}" ] || fail "resolved node is not executable: ${NODE_BIN}"
[ -f "${ENV_FILE}" ] && grep -q 'WAR_ROOM_TOKEN=' "${ENV_FILE}" \
  || fail "no token in ${ENV_FILE} — run macbook-hooks-install.sh first (it stores the token)"
TOKEN="$(sed -n 's/^export WAR_ROOM_TOKEN=//p' "${ENV_FILE}" | head -1)"
[ -n "${TOKEN}" ] || fail "could not parse WAR_ROOM_TOKEN from ${ENV_FILE}"
[ -d "${HOME}/.codex/sessions" ] || warn "~/.codex/sessions missing — codex tails start once codex runs here"
[ -d "${HOME}/.gemini/tmp" ] || warn "~/.gemini/tmp missing — gemini tails start once gemini runs here"

echo "=============================================================="
echo " War Room coworker adapter — launchd install"
echo "   machine : ${MACHINE}"
echo "   server  : ${SERVER_URL}/api/hooks/{codex,gemini}"
echo "   adapter : ${ADAPTER}"
echo "   node    : ${NODE_BIN}"
echo "   plist   : ${PLIST}"
echo "   log     : ${LOG}"
echo "   token   : from ${ENV_FILE} (not displayed)"
echo "=============================================================="
read -r -p "Type 'install' to proceed: " CONFIRM
[ "${CONFIRM}" = "install" ] || fail "aborted (no changes made)"

# ── 1. Backup + unload any existing agent ────────────────────────────────────
BACKUP=""
if [ -f "${PLIST}" ]; then
  BACKUP="${PLIST}.bak.${TS}"
  cp "${PLIST}" "${BACKUP}" && ok "existing plist backed up -> ${BACKUP}"
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null \
    && ok "existing agent unloaded" || warn "no loaded agent to unload (fine)"
fi

# ── 2. Write the plist (0600 — it contains the token) ────────────────────────
mkdir -p "${HOME}/Library/LaunchAgents"
umask 077
cat > "${PLIST}" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${ADAPTER}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WAR_ROOM_URL</key><string>${SERVER_URL}</string>
    <key>WAR_ROOM_TOKEN</key><string>${TOKEN}</string>
    <key>WAR_ROOM_MACHINE</key><string>${MACHINE}</string>
    <key>PATH</key><string>$(dirname "${NODE_BIN}"):${HOME}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
PLIST_EOF
chmod 600 "${PLIST}"
plutil -lint "${PLIST}" >/dev/null || { rm -f "${PLIST}"; fail "generated plist invalid — removed, nothing loaded"; }
ok "plist written (mode 600; adapter scans every 3s, KeepAlive restarts it if it dies)"

# ── 3. Load + verify ─────────────────────────────────────────────────────────
launchctl bootstrap "gui/$(id -u)" "${PLIST}" || fail "launchctl bootstrap failed — plist left at ${PLIST}, not loaded"
sleep 3
if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
  ok "agent loaded: ${LABEL}"
else
  fail "agent did not stay loaded — check ${LOG}"
fi
if [ -f "${LOG}" ] && grep -q '\[coworker-adapter\]' "${LOG}"; then
  ok "adapter is logging: $(grep '\[coworker-adapter\]' "${LOG}" | tail -1)"
else
  warn "no startup line yet — check 'tail -f ${LOG}'"
fi

echo
echo "=============================================================="
ok "INSTALL COMPLETE on ${MACHINE}"
echo "  Watch it:   tail -f ${LOG}"
echo "  Expect:     startup line, then silence until codex/gemini activity."
echo "  While NEXUS runs v0: '⚠ … server 404' per event is EXPECTED (v1 adds the ingest)."
echo
echo "  UNDO:"
echo "    launchctl bootout gui/$(id -u)/${LABEL}"
echo "    rm ${PLIST}"
[ -n "${BACKUP}" ] && echo "    cp ${BACKUP} ${PLIST}   # restore previous version"
echo "=============================================================="
