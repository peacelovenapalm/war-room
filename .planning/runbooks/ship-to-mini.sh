#!/bin/bash
# =============================================================================
# ship-to-mini.sh — GATED RUNBOOK (run on the MACBOOK)
#
# The war-room repo is local-only (unpushed), but MINI needs three things to
# join the telemetry mesh: bin/ (poller + coworker adapter), the install
# runbooks, and the ingest token. This runbook ships all three over Tailscale
# SSH, mirroring the repo layout at ~/code/war-room on MINI so the runbooks'
# relative paths (script → ../../bin) resolve unchanged.
#
#   bash ship-to-mini.sh
#
# Target: greg@100.121.189.6 (Tailscale). Override: WAR_ROOM_MINI_SSH=user@host
# NOTE: the `mini` alias in ~/.ssh/config points at a stale LAN IP
# (192.168.0.190, unreachable) — this runbook deliberately does not use it.
#
# What it changes ON MINI:
#   1. ~/code/war-room/bin/ + ~/code/war-room/.planning/runbooks/  (rsync)
#   2. ~/.war-room/env — copied from THIS machine's ~/.war-room/env with
#      WAR_ROOM_MACHINE rewritten to MINI (chmod 600; token never displayed;
#      an existing MINI env file is kept, not overwritten)
#
# It does NOT touch MINI's ~/.claude, launchd, or start anything. After
# shipping, run the three installers on MINI (printed at the end).
#
# UNDO (on MINI): rm -rf ~/code/war-room ~/.war-room
# =============================================================================
set -euo pipefail

MINI="${WAR_ROOM_MINI_SSH:-greg@100.121.189.6}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_ENV="${HOME}/.war-room/env"
SSH_OPTS=(-o ConnectTimeout=8)

ok()   { printf '[OK]   %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; exit 1; }

[ -f "${REPO_DIR}/bin/coworker-adapter.mjs" ] || fail "run this from the war-room repo (adapter not found under ${REPO_DIR}/bin)"
[ -f "${LOCAL_ENV}" ] && grep -q 'WAR_ROOM_TOKEN=' "${LOCAL_ENV}" \
  || fail "no token in ${LOCAL_ENV} on THIS machine — run macbook-hooks-install.sh here first"
ssh "${SSH_OPTS[@]}" "${MINI}" 'echo ok' >/dev/null 2>&1 || fail "cannot reach ${MINI} over SSH (Tailscale up on both ends?)"

echo "=============================================================="
echo " War Room — ship telemetry bundle to MINI"
echo "   target : ${MINI}"
echo "   source : ${REPO_DIR}/{bin,.planning/runbooks}"
echo "   dest   : ~/code/war-room/ (mirrored layout) + ~/.war-room/env"
echo "=============================================================="
read -r -p "Type 'ship' to proceed: " CONFIRM
[ "${CONFIRM}" = "ship" ] || fail "aborted (no changes made)"

# ── 1. Ship bin/ + runbooks (mirrored layout) ────────────────────────────────
ssh "${SSH_OPTS[@]}" "${MINI}" 'mkdir -p ~/code/war-room/.planning'
rsync -az -e "ssh ${SSH_OPTS[*]}" --delete "${REPO_DIR}/bin/" "${MINI}:code/war-room/bin/"
rsync -az -e "ssh ${SSH_OPTS[*]}" "${REPO_DIR}/.planning/runbooks/" "${MINI}:code/war-room/.planning/runbooks/"
ok "bin/ + runbooks shipped to ${MINI}:~/code/war-room/"

# ── 2. Seed ~/.war-room/env (keep an existing one) ───────────────────────────
if ssh "${SSH_OPTS[@]}" "${MINI}" 'grep -qs WAR_ROOM_TOKEN= ~/.war-room/env'; then
  ok "MINI already has ~/.war-room/env with a token — keeping it"
else
  # Rewrite the machine label in transit; token goes over SSH only, never a tty.
  sed 's/^export WAR_ROOM_MACHINE=.*/export WAR_ROOM_MACHINE=MINI/' "${LOCAL_ENV}" \
    | ssh "${SSH_OPTS[@]}" "${MINI}" 'umask 077; mkdir -p ~/.war-room; cat > ~/.war-room/env; chmod 600 ~/.war-room/env'
  ok "token env seeded on MINI (mode 600; machine label = MINI)"
fi

# ── 3. Remote sanity ─────────────────────────────────────────────────────────
ssh "${SSH_OPTS[@]}" "${MINI}" 'zsh -lc "command -v node >/dev/null"' \
  && ok "node available on MINI (login shell)" \
  || warn "node not found on MINI login shell — installers will fail until it is"

echo
echo "=============================================================="
ok "SHIP COMPLETE"
echo "  Now run the installers ON MINI (each prompts before changing anything):"
echo "    ssh -t ${MINI} 'zsh -lc \"bash ~/code/war-room/.planning/runbooks/macbook-hooks-install.sh MINI\"'"
echo "    ssh -t ${MINI} 'zsh -lc \"bash ~/code/war-room/.planning/runbooks/install-poller-launchd.sh MINI\"'"
echo "    ssh -t ${MINI} 'zsh -lc \"bash ~/code/war-room/.planning/runbooks/install-coworker-adapter-launchd.sh MINI\"'"
echo
echo "  UNDO (on MINI): rm -rf ~/code/war-room ~/.war-room"
echo "=============================================================="
