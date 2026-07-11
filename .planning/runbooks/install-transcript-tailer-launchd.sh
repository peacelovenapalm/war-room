#!/bin/bash
# =============================================================================
# install-transcript-tailer-launchd.sh — GATED RUNBOOK (human-run only, never automated)
#
# Installs the War Room remote transcript tailer (bin/transcript-tailer.mjs)
# as a per-machine launchd USER agent (T1 remote live-tail plane —
# .planning/v2/REMOTE-TAILER-DESIGN.md). The tailer polls
# POST /api/tailer/poll every ~5s, tails ONLY the sessions a webview client
# has actually subscribed to (server-driven tail-on/tail-off), and forwards
# assistant-only JSONL lines to POST /api/agents/output. Per-machine opt-in
# stays the posture: no tailer installed on a machine = no live tail for
# that machine's sessions, honestly absent — same as the needs-input
# poller and dispatch runner.
#
# Parameterized by machine name, same convention as install-poller-launchd.sh:
#
#   bash install-transcript-tailer-launchd.sh MACBOOK
#   bash install-transcript-tailer-launchd.sh MINI
#
# Prereq: the hooks runbook (macbook-hooks-install.sh) already stored the
# ingest token in ~/.war-room/env on this machine (the tailer reuses it).
#
# What it changes:
#   1. ~/Library/LaunchAgents/com.war-room.transcript-tailer.plist
#      (BACKED UP FIRST if it exists), loaded via launchctl bootstrap
#   2. ~/Library/Logs/war-room-transcript-tailer.log — tailer stdout/stderr
#
# Nothing here touches ~/.claude, NEXUS, or any shared service. The tailer
# itself only READS transcript files under its local allowlist (default
# ~/.claude/projects/ only — extend via WAR_ROOM_TAILER_ROOTS in
# ~/.war-room/env if this machine's sessions live elsewhere) and POSTs
# rendered lines to the server; it never spawns, signals, or steers any
# process (REMOTE-TAILER-DESIGN.md §Containment).
#
# UNDO (inline, also printed at the end):
#   launchctl bootout gui/$UID/com.war-room.transcript-tailer
#   rm ~/Library/LaunchAgents/com.war-room.transcript-tailer.plist
#   (restore the .bak.<TS> plist if one was backed up)
# =============================================================================
set -euo pipefail

MACHINE="${1:-}"
SERVER_URL="${WAR_ROOM_URL:-https://nexus.tail722a2e.ts.net:8484}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TAILER="${REPO_DIR}/bin/transcript-tailer.mjs"
ENV_FILE="${HOME}/.war-room/env"
LABEL="com.war-room.transcript-tailer"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG="${HOME}/Library/Logs/war-room-transcript-tailer.log"
TS="$(date +%Y%m%d-%H%M%S)"

ok()   { printf '[OK]   %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; exit 1; }

case "${MACHINE}" in
  [A-Z]*[A-Z0-9]) ;;
  *) fail "usage: bash $(basename "$0") <MACHINE-NAME>   (e.g. MACBOOK or MINI, uppercase)" ;;
esac
[ -f "${TAILER}" ] || fail "transcript tailer not found at ${TAILER}"
# Resolve node to a STABLE path. `command -v node` under fnm returns an
# ephemeral ~/.local/state/fnm_multishells/<pid>/bin path that dies with this
# shell — baking it into the plist gives launchd a dead binary on next boot.
# (Same hard-won fix as install-poller-launchd.sh / install-dispatch-runner-launchd.sh — keep all three in sync.)
NODE_BIN="$(command -v node)" || fail "node not found on PATH"
NODE_BIN="$(realpath "${NODE_BIN}")"
case "${NODE_BIN}" in
  *fnm_multishells*) fail "node still resolves to an ephemeral fnm multishell path (${NODE_BIN}) — install a stable node (brew install node) or fix fnm" ;;
esac
[ -x "${NODE_BIN}" ] || fail "resolved node is not executable: ${NODE_BIN}"
[ -f "${ENV_FILE}" ] && grep -q 'WAR_ROOM_TOKEN=' "${ENV_FILE}" \
  || fail "no token in ${ENV_FILE} — run macbook-hooks-install.sh first (it stores the token)"
# Extract the token value for the plist env block (launchd does not source shell files).
TOKEN="$(sed -n 's/^export WAR_ROOM_TOKEN=//p' "${ENV_FILE}" | head -1)"
[ -n "${TOKEN}" ] || fail "could not parse WAR_ROOM_TOKEN from ${ENV_FILE}"
# Optional additional allowlisted roots (path.delimiter-separated), same
# ~/.war-room/env file the token lives in — absent is fine, the tailer
# always includes the default ~/.claude/projects/ root regardless.
TAILER_ROOTS="$(sed -n 's/^export WAR_ROOM_TAILER_ROOTS=//p' "${ENV_FILE}" | head -1 || true)"

echo "=============================================================="
echo " War Room transcript tailer — launchd install"
echo "   machine : ${MACHINE}"
echo "   server  : ${SERVER_URL}/api/tailer/poll"
echo "   tailer  : ${TAILER}"
echo "   node    : ${NODE_BIN}"
echo "   plist   : ${PLIST}"
echo "   log     : ${LOG}"
echo "   roots   : ~/.claude/projects/ (default)$( [ -n "${TAILER_ROOTS}" ] && echo " + ${TAILER_ROOTS}" )"
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
    <string>${TAILER}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WAR_ROOM_URL</key><string>${SERVER_URL}</string>
    <key>WAR_ROOM_TOKEN</key><string>${TOKEN}</string>
    <key>WAR_ROOM_MACHINE</key><string>${MACHINE}</string>
$( [ -n "${TAILER_ROOTS}" ] && printf '    <key>WAR_ROOM_TAILER_ROOTS</key><string>%s</string>\n' "${TAILER_ROOTS}" )
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
ok "plist written (mode 600; tailer self-paces every ~5s, KeepAlive restarts it if it dies)"

# ── 3. Load + verify ─────────────────────────────────────────────────────────
launchctl bootstrap "gui/$(id -u)" "${PLIST}" || fail "launchctl bootstrap failed — plist left at ${PLIST}, not loaded"
sleep 3
if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
  ok "agent loaded: ${LABEL}"
else
  fail "agent did not stay loaded — check ${LOG}"
fi
if [ -f "${LOG}" ] && tail -5 "${LOG}" | grep -q 'transcript-tailer'; then
  ok "tailer is logging: $(tail -1 "${LOG}")"
else
  warn "no log lines yet — check 'tail -f ${LOG}' (first tick can take ~5s)"
fi

echo
echo "=============================================================="
ok "INSTALL COMPLETE on ${MACHINE}"
echo "  Watch it:   tail -f ${LOG}"
echo "  Expect:     silence until a webview client tailSubscribes one of this"
echo "              machine's remote sessions — then '✓ tail-on <sessionId> ...'"
echo "              followed by forwarded output; no demand = no log noise."
echo
echo "  UNDO:"
echo "    launchctl bootout gui/$(id -u)/${LABEL}"
echo "    rm ${PLIST}"
[ -n "${BACKUP}" ] && echo "    cp ${BACKUP} ${PLIST}   # restore previous version"
echo "=============================================================="
