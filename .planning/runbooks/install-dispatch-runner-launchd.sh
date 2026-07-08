#!/bin/bash
# =============================================================================
# install-dispatch-runner-launchd.sh — GATED RUNBOOK (human-run only, never automated)
#
# Installs the War Room dispatch runner (bin/dispatch-runner.mjs) as a
# per-machine launchd USER agent (v1 mechanic #6b -- "call a coworker").
# The runner polls the server's dispatch queue over the authed channel and
# decides LOCALLY, against its own allowlist on THIS machine, whether to
# honor a dispatch (run a real CLI) or focus (front a terminal) request.
# The server can never override that decision -- see
# .planning/DISPATCH-6B-DESIGN.md for the full threat model.
#
# Parameterized by machine name, same convention as install-poller-launchd.sh:
#
#   bash install-dispatch-runner-launchd.sh MACBOOK
#   bash install-dispatch-runner-launchd.sh MINI
#
# Prereq: the hooks runbook (macbook-hooks-install.sh) already stored the
# ingest token in ~/.war-room/env on this machine (the runner reuses it).
#
# What it changes:
#   1. ~/.war-room/dispatch.json -- WRITTEN ONLY IF ABSENT, as a
#      deny-everything template {"providers":[],"roots":[],"focus":false}
#      (mode 0600). An EXISTING allowlist is never touched -- editing it to
#      actually allow anything is a separate, deliberate, human step.
#   2. ~/Library/LaunchAgents/com.war-room.dispatch-runner.plist
#      (BACKED UP FIRST if it exists), loaded via launchctl bootstrap
#   3. ~/Library/Logs/war-room-dispatch-runner.log -- runner stdout/stderr
#      (separate from the runner's own per-run CLI logs under
#      ~/Library/Logs/war-room-dispatch-runs/ and its audit log at
#      ~/Library/Logs/war-room-dispatch.log)
#
# Nothing here touches ~/.claude, NEXUS, or any shared service, and the
# freshly-written allowlist DENIES EVERYTHING until you edit it by hand.
#
# UNDO (inline, also printed at the end):
#   launchctl bootout gui/$UID/com.war-room.dispatch-runner
#   rm ~/Library/LaunchAgents/com.war-room.dispatch-runner.plist
#   (restore the .bak.<TS> plist if one was backed up)
#   rm ~/.war-room/dispatch.json   # only if you want to remove the allowlist too
# =============================================================================
set -euo pipefail

MACHINE="${1:-}"
SERVER_URL="${WAR_ROOM_URL:-https://nexus.tail722a2e.ts.net:8484}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="${REPO_DIR}/bin/dispatch-runner.mjs"
ENV_FILE="${HOME}/.war-room/env"
ALLOWLIST="${HOME}/.war-room/dispatch.json"
LABEL="com.war-room.dispatch-runner"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG="${HOME}/Library/Logs/war-room-dispatch-runner.log"
TS="$(date +%Y%m%d-%H%M%S)"

ok()   { printf '[OK]   %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; exit 1; }

case "${MACHINE}" in
  [A-Z]*[A-Z0-9]) ;;
  *) fail "usage: bash $(basename "$0") <MACHINE-NAME>   (e.g. MACBOOK or MINI, uppercase)" ;;
esac
[ -f "${RUNNER}" ] || fail "dispatch runner not found at ${RUNNER}"
command -v claude >/dev/null || command -v codex >/dev/null || command -v gemini >/dev/null \
  || warn "none of claude/codex/gemini found on PATH for this shell — dispatch will deny until at least one is installed"
# Resolve node to a STABLE path. `command -v node` under fnm returns an
# ephemeral ~/.local/state/fnm_multishells/<pid>/bin path that dies with this
# shell — baking it into the plist gives launchd a dead binary on next boot.
# (Same hard-won fix as install-poller-launchd.sh -- keep both in sync.)
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

echo "=============================================================="
echo " War Room dispatch runner — launchd install"
echo "   machine   : ${MACHINE}"
echo "   server    : ${SERVER_URL}/api/dispatch/poll"
echo "   runner    : ${RUNNER}"
echo "   node      : ${NODE_BIN}"
echo "   plist     : ${PLIST}"
echo "   log       : ${LOG}"
echo "   allowlist : ${ALLOWLIST}"
echo "   token     : from ${ENV_FILE} (not displayed)"
echo "=============================================================="
read -r -p "Type 'install' to proceed: " CONFIRM
[ "${CONFIRM}" = "install" ] || fail "aborted (no changes made)"

# ── 1. Write the deny-everything allowlist template, ONLY if absent ──────────
if [ -f "${ALLOWLIST}" ]; then
  ok "allowlist already exists at ${ALLOWLIST} — left untouched"
else
  mkdir -p "$(dirname "${ALLOWLIST}")"
  umask 077
  cat > "${ALLOWLIST}" <<'ALLOWLIST_EOF'
{"providers":[],"roots":[],"focus":false}
ALLOWLIST_EOF
  chmod 600 "${ALLOWLIST}"
  ok "wrote a DENY-EVERYTHING allowlist template -> ${ALLOWLIST} (mode 600)"
  warn "dispatch/focus will deny everything until you edit this file to add providers/roots/focus"
fi

# ── 2. Backup + unload any existing agent ────────────────────────────────────
BACKUP=""
if [ -f "${PLIST}" ]; then
  BACKUP="${PLIST}.bak.${TS}"
  cp "${PLIST}" "${BACKUP}" && ok "existing plist backed up -> ${BACKUP}"
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null \
    && ok "existing agent unloaded" || warn "no loaded agent to unload (fine)"
fi

# ── 3. Write the plist (0600 — it contains the token) ────────────────────────
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
    <string>${RUNNER}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WAR_ROOM_URL</key><string>${SERVER_URL}</string>
    <key>WAR_ROOM_TOKEN</key><string>${TOKEN}</string>
    <key>WAR_ROOM_MACHINE</key><string>${MACHINE}</string>
    <key>WAR_ROOM_DISPATCH_ALLOWLIST</key><string>${ALLOWLIST}</string>
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
ok "plist written (mode 600; runner self-paces every 5s, KeepAlive restarts it if it dies)"

# ── 4. Load + verify ─────────────────────────────────────────────────────────
launchctl bootstrap "gui/$(id -u)" "${PLIST}" || fail "launchctl bootstrap failed — plist left at ${PLIST}, not loaded"
sleep 3
if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
  ok "agent loaded: ${LABEL}"
else
  fail "agent did not stay loaded — check ${LOG}"
fi
if [ -f "${LOG}" ] && tail -5 "${LOG}" | grep -q 'dispatch-runner'; then
  ok "runner is logging: $(tail -1 "${LOG}")"
else
  warn "no log lines yet — check 'tail -f ${LOG}' (first tick can take ~5s)"
fi

echo
echo "=============================================================="
ok "INSTALL COMPLETE on ${MACHINE}"
echo "  Watch it:     tail -f ${LOG}"
echo "  Expect:       '✓ tick — N pending, M newly handled' every ~5s"
echo "  Edit allow:   ${ALLOWLIST}  (currently denies everything — see above)"
echo "  Per-run logs: ~/Library/Logs/war-room-dispatch-runs/<request-id>.log"
echo "  Audit log:    ~/Library/Logs/war-room-dispatch.log"
echo
echo "  UNDO:"
echo "    launchctl bootout gui/$(id -u)/${LABEL}"
echo "    rm ${PLIST}"
[ -n "${BACKUP}" ] && echo "    cp ${BACKUP} ${PLIST}   # restore previous version"
echo "    rm ${ALLOWLIST}   # only if you also want to remove the allowlist"
echo "=============================================================="
