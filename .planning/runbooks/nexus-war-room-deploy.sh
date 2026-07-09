#!/bin/bash
# =============================================================================
# nexus-war-room-deploy.sh — GATED RUNBOOK (Greg-approved 2026-07-06)
#
# Deploys the War Room server to NEXUS:
#   1. refresh the half-baked tracker copy on nexus (/data/repos/completion-2026-07)
#   2. rsync the repo to nexus:~/apps/war-room-src
#   3. docker build + run, bound to 127.0.0.1:3141 ON NEXUS (host loopback only),
#      with read-only briefing mounts (todo dir from the vault-notifier clone +
#      the completion tracker)
#   4. tailscale serve --bg --https=8484 (TAILNET ONLY — same pattern as the
#      projects-board :10001 and amc :10000 serves; no sudo, NEVER the funnel)
#
# Run from the MacBook:   bash .planning/runbooks/nexus-war-room-deploy.sh [-y]
#
# UNDO (inline, also printed at the end):
#   ssh nexus 'docker rm -f war-room'
#   ssh nexus 'tailscale serve --https=8484 off'
#   (the token file ~/apps/war-room/war-room.env on nexus is left in place on
#    purpose — remove by hand only if you also reinstall the machine hooks)
# =============================================================================
set -euo pipefail

NEXUS_HOST="${NEXUS_HOST:-nexus}"                 # ssh alias
TAILNET_FQDN="nexus.tail722a2e.ts.net"
SERVE_PORT=8484
APP_PORT=3141
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTE_SRC="~/apps/war-room-src"
REMOTE_ENV_DIR="~/apps/war-room"
TS="$(date +%Y%m%d-%H%M%S)"
# Briefing data sources ON NEXUS (read-only binds into the container):
#  - todo dir: inside the vault-notifier Brain2 clone (hard-resets to origin/main
#    every 15 min via the notifier cron, so it stays fresh without new sync jobs)
#  - tracker: the same dir the projects-board container binds read-only
TODO_DIR_NEXUS="/data/repos/vault-notifier/vault/vault/_inbox/routines/todo"
TRACKER_DIR_NEXUS="/data/repos/completion-2026-07"
TRACKER_STATE_LOCAL="/Users/greg/code/completion-2026-07/STATE.md"

ok()   { printf '[OK]   %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; exit 1; }

echo "=============================================================="
echo " War Room -> NEXUS deploy (tailnet-only)"
echo "   source : ${REPO_DIR}"
echo "   target : ${NEXUS_HOST} -> docker 'war-room' on 127.0.0.1:${APP_PORT}"
echo "   ingress: https://${TAILNET_FQDN}:${SERVE_PORT} (tailscale serve, no funnel)"
echo "=============================================================="
if [ "${1:-}" = "-y" ]; then
  ok "non-interactive (-y) — proceeding"
else
  read -r -p "Type 'deploy' to proceed: " CONFIRM
  [ "${CONFIRM}" = "deploy" ] || fail "aborted (no changes made)"
fi

# ── Preflight ────────────────────────────────────────────────────────────────
ssh -o ConnectTimeout=8 "${NEXUS_HOST}" true 2>/dev/null \
  && ok "ssh ${NEXUS_HOST} reachable" || fail "cannot ssh to ${NEXUS_HOST}"
ssh "${NEXUS_HOST}" 'command -v docker >/dev/null' \
  && ok "docker present on nexus" || fail "docker missing on nexus"
ssh "${NEXUS_HOST}" "test -d ${TODO_DIR_NEXUS}" \
  && ok "todo source present: ${TODO_DIR_NEXUS}" || warn "todo dir missing on nexus — briefing panel will show 'no todo source'"
ssh "${NEXUS_HOST}" "test -d ${TRACKER_DIR_NEXUS}" \
  && ok "tracker dir present: ${TRACKER_DIR_NEXUS}" || warn "tracker dir missing on nexus — briefing panel will show no gates"

# ── Refresh the tracker copy (laptop is canonical; also feeds projects-board) ─
if [ -f "${TRACKER_STATE_LOCAL}" ]; then
  rsync -a "${TRACKER_STATE_LOCAL}" "${NEXUS_HOST}:${TRACKER_DIR_NEXUS}/STATE.md" \
    && ok "tracker STATE.md refreshed on nexus (projects-board reads the same file)" \
    || warn "tracker refresh failed — nexus copy may be stale"
else
  warn "no local tracker at ${TRACKER_STATE_LOCAL} — skipping refresh"
fi

# ── Token env file (created once, kept stable across redeploys) ─────────────
ssh "${NEXUS_HOST}" "mkdir -p ${REMOTE_ENV_DIR}"
if ssh "${NEXUS_HOST}" "test -f ${REMOTE_ENV_DIR}/war-room.env"; then
  ok "war-room.env exists on nexus — keeping existing token (stable for remote hooks)"
else
  # Token generated ON nexus, written 0600, never printed anywhere.
  ssh "${NEXUS_HOST}" "umask 077 && printf 'WAR_ROOM_TOKEN=%s\nWAR_ROOM_MACHINE=NEXUS\n' \"\$(openssl rand -hex 32)\" > ${REMOTE_ENV_DIR}/war-room.env"
  ok "generated ${REMOTE_ENV_DIR}/war-room.env on nexus (mode 0600, token NOT displayed)"
fi

# ── Ship source + build image ────────────────────────────────────────────────
rsync -a --delete \
  --exclude node_modules --exclude '*/node_modules' --exclude dist \
  --exclude .git --exclude .planning --exclude allure-report --exclude allure-results \
  "${REPO_DIR}/" "${NEXUS_HOST}:${REMOTE_SRC}/" \
  && ok "source synced to ${NEXUS_HOST}:${REMOTE_SRC}" || fail "rsync failed"

ssh "${NEXUS_HOST}" "docker build -t war-room:latest ${REMOTE_SRC}" \
  && ok "image war-room:latest built" || fail "docker build failed"

# ── Run container (host-loopback publish ONLY + read-only briefing mounts) ───
ssh "${NEXUS_HOST}" "docker rm -f war-room >/dev/null 2>&1 || true"
ssh "${NEXUS_HOST}" "docker run -d --name war-room --restart unless-stopped \
  --env-file ${REMOTE_ENV_DIR}/war-room.env \
  -e WAR_ROOM_TODO_DIR=/briefing/todo \
  -e WAR_ROOM_TRACKER_STATE=/briefing/tracker/STATE.md \
  -v ${TODO_DIR_NEXUS}:/briefing/todo:ro \
  -v ${TRACKER_DIR_NEXUS}:/briefing/tracker:ro \
  -p 127.0.0.1:${APP_PORT}:3141 war-room:latest" >/dev/null \
  && ok "container war-room running (127.0.0.1:${APP_PORT} on nexus, briefing mounts ro)" || fail "docker run failed"

# ── Bark wrapper network (2026-07-09): WAR_ROOM_BARK_URL=http://notify:8581/notify
# resolves only on the notify container's compose network — rejoin after every
# recreate or Bark pushes silently die (notifyBark.ts is fire-and-forget).
ssh "${NEXUS_HOST}" "docker network connect bark-dispatch_default war-room 2>/dev/null || true"
ssh "${NEXUS_HOST}" "docker inspect war-room --format '{{json .NetworkSettings.Networks}}'" | grep -q bark-dispatch_default \
  && ok "war-room joined bark-dispatch_default (Bark wrapper reachable as http://notify:8581)" \
  || warn "war-room NOT on bark-dispatch_default — Bark pushes will fail silently"

sleep 4
ssh "${NEXUS_HOST}" "curl -sf http://127.0.0.1:${APP_PORT}/api/health" >/dev/null \
  && ok "health check passed on nexus loopback" || fail "health check failed — docker logs war-room"
ssh "${NEXUS_HOST}" "curl -sf http://127.0.0.1:${APP_PORT}/api/briefing" | head -c 200 >/dev/null \
  && ok "briefing endpoint responding" || warn "briefing endpoint not responding — check mounts/envs (docker logs war-room)"

# ── tailscale serve on the tailnet listener (no sudo, NEVER the funnel) ──────
if ssh "${NEXUS_HOST}" "tailscale serve status 2>/dev/null | grep -q ':${SERVE_PORT}'"; then
  warn "tailscale serve already has :${SERVE_PORT} — leaving it as-is"
else
  ssh "${NEXUS_HOST}" "tailscale serve --bg --https=${SERVE_PORT} http://127.0.0.1:${APP_PORT}" >/dev/null \
    && ok "tailscale serve :${SERVE_PORT} -> 127.0.0.1:${APP_PORT} (tailnet only)" \
    || fail "tailscale serve failed — check 'tailscale serve status' on nexus"
fi
ssh "${NEXUS_HOST}" "tailscale funnel status 2>/dev/null | grep -q ':${SERVE_PORT}'" \
  && fail "SAFETY: :${SERVE_PORT} appears in FUNNEL status — run 'tailscale funnel --https=${SERVE_PORT} off' NOW" \
  || ok "funnel check clean — :${SERVE_PORT} is tailnet-only"

# ── PWA manifest reachable over the real tailnet path (G6, BUILD-PLAN §G6 task 5) ──
if curl -sf -m 8 "https://${TAILNET_FQDN}:${SERVE_PORT}/manifest.webmanifest" >/dev/null; then
  ok "manifest.webmanifest reachable over tailnet HTTPS"
else
  warn "manifest.webmanifest not reachable from this machine over tailnet HTTPS — check this Mac's tailscale connection, then verify by hand"
fi

echo
echo "=============================================================="
ok "DEPLOY COMPLETE"
echo "  Dashboard : https://${TAILNET_FQDN}:${SERVE_PORT}  (tailnet devices only)"
echo "  Briefing  : https://${TAILNET_FQDN}:${SERVE_PORT}/api/briefing"
echo "  Ingest    : POST https://${TAILNET_FQDN}:${SERVE_PORT}/api/hooks/claude"
echo "              Authorization: Bearer <WAR_ROOM_TOKEN from nexus war-room.env>"
echo "              X-Machine: MACBOOK | MINI"
echo "  Next      : run macbook-hooks-install.sh on each Mac (also gated)"
echo
echo "  UNDO:"
echo "    ssh ${NEXUS_HOST} 'docker rm -f war-room'"
echo "    ssh ${NEXUS_HOST} 'tailscale serve --https=${SERVE_PORT} off'"
echo "=============================================================="
