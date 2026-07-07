#!/bin/bash
# =============================================================================
# nexus-war-room-deploy.sh — GATED RUNBOOK (human-run only, never automated)
#
# Deploys the War Room server to NEXUS:
#   1. rsync the repo to nexus:~/apps/war-room-src
#   2. docker build + run, bound to 127.0.0.1:3141 ON NEXUS (host loopback only)
#   3. add a Caddy site on the TAILNET listener (nexus.tail722a2e.ts.net:8484,
#      bound to the Tailscale IP) — NEVER the public funnel
#
# Run from the MacBook:   bash .planning/runbooks/nexus-war-room-deploy.sh
#
# UNDO (inline, also printed at the end):
#   ssh nexus 'docker rm -f war-room'
#   ssh nexus 'sudo cp /etc/caddy/Caddyfile.bak.war-room.<TS> /etc/caddy/Caddyfile && sudo systemctl reload caddy'
#   (the token file ~/apps/war-room/war-room.env on nexus is left in place on
#    purpose — remove by hand only if you also reinstall the machine hooks)
# =============================================================================
set -euo pipefail

NEXUS_HOST="${NEXUS_HOST:-nexus}"                 # ssh alias
TAILNET_FQDN="nexus.tail722a2e.ts.net"
CADDY_PORT=8484
APP_PORT=3141
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTE_SRC="~/apps/war-room-src"
REMOTE_ENV_DIR="~/apps/war-room"
TS="$(date +%Y%m%d-%H%M%S)"

ok()   { printf '[OK]   %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; exit 1; }

echo "=============================================================="
echo " War Room -> NEXUS deploy (tailnet-only)"
echo "   source : ${REPO_DIR}"
echo "   target : ${NEXUS_HOST} -> docker 'war-room' on 127.0.0.1:${APP_PORT}"
echo "   ingress: https://${TAILNET_FQDN}:${CADDY_PORT} (Tailscale IP bind)"
echo "=============================================================="
read -r -p "Type 'deploy' to proceed: " CONFIRM
[ "${CONFIRM}" = "deploy" ] || fail "aborted (no changes made)"

# ── Preflight ────────────────────────────────────────────────────────────────
ssh -o ConnectTimeout=8 "${NEXUS_HOST}" true 2>/dev/null \
  && ok "ssh ${NEXUS_HOST} reachable" || fail "cannot ssh to ${NEXUS_HOST}"
ssh "${NEXUS_HOST}" 'command -v docker >/dev/null' \
  && ok "docker present on nexus" || fail "docker missing on nexus"
if ssh "${NEXUS_HOST}" 'test -f /etc/caddy/Caddyfile'; then
  ok "found /etc/caddy/Caddyfile"
else
  fail "/etc/caddy/Caddyfile not found — locate the Caddy config first (is Caddy dockerized?)"
fi
if ssh "${NEXUS_HOST}" "grep -q ':${CADDY_PORT}' /etc/caddy/Caddyfile"; then
  warn "port ${CADDY_PORT} already referenced in Caddyfile — will NOT add a duplicate block"
  SKIP_CADDY=1
else
  SKIP_CADDY=0
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

# ── Run container (host-loopback publish ONLY) ───────────────────────────────
ssh "${NEXUS_HOST}" "docker rm -f war-room >/dev/null 2>&1 || true"
ssh "${NEXUS_HOST}" "docker run -d --name war-room --restart unless-stopped \
  --env-file ${REMOTE_ENV_DIR}/war-room.env \
  -p 127.0.0.1:${APP_PORT}:3141 war-room:latest" >/dev/null \
  && ok "container war-room running (127.0.0.1:${APP_PORT} on nexus)" || fail "docker run failed"

sleep 4
ssh "${NEXUS_HOST}" "curl -sf http://127.0.0.1:${APP_PORT}/api/health" >/dev/null \
  && ok "health check passed on nexus loopback" || fail "health check failed — docker logs war-room"

# ── Caddy site on the tailnet listener (NEVER the funnel) ────────────────────
if [ "${SKIP_CADDY}" = "1" ]; then
  warn "skipped Caddyfile edit (port ${CADDY_PORT} already present) — verify routing manually"
else
  TS_IP="$(ssh "${NEXUS_HOST}" 'tailscale ip -4' | head -1)"
  [ -n "${TS_IP}" ] && ok "tailscale IP on nexus: ${TS_IP}" || fail "could not read tailscale ip on nexus"
  ssh "${NEXUS_HOST}" "sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.war-room.${TS}" \
    && ok "Caddyfile backed up -> /etc/caddy/Caddyfile.bak.war-room.${TS}" || fail "backup failed"
  ssh "${NEXUS_HOST}" "sudo tee -a /etc/caddy/Caddyfile >/dev/null" <<EOF

# war-room dashboard (added ${TS}) — TAILNET ONLY via bind, never the funnel
${TAILNET_FQDN}:${CADDY_PORT} {
	bind ${TS_IP}
	reverse_proxy 127.0.0.1:${APP_PORT}
}
EOF
  ok "Caddy site block appended (${TAILNET_FQDN}:${CADDY_PORT}, bind ${TS_IP})"
  if ssh "${NEXUS_HOST}" 'sudo caddy validate --config /etc/caddy/Caddyfile' >/dev/null 2>&1; then
    ok "caddy validate passed"
  else
    ssh "${NEXUS_HOST}" "sudo cp /etc/caddy/Caddyfile.bak.war-room.${TS} /etc/caddy/Caddyfile"
    fail "caddy validate FAILED — Caddyfile restored from backup, no reload done"
  fi
  ssh "${NEXUS_HOST}" 'sudo systemctl reload caddy' \
    && ok "caddy reloaded" || fail "caddy reload failed — restore backup and reload manually"
fi

echo
echo "=============================================================="
ok "DEPLOY COMPLETE"
echo "  Dashboard : https://${TAILNET_FQDN}:${CADDY_PORT}  (tailnet devices only)"
echo "  Ingest    : POST https://${TAILNET_FQDN}:${CADDY_PORT}/api/hooks/claude"
echo "              Authorization: Bearer <WAR_ROOM_TOKEN from nexus war-room.env>"
echo "              X-Machine: MACBOOK | MINI"
echo "  Next      : run macbook-hooks-install.sh on each Mac (also gated)"
echo
echo "  UNDO:"
echo "    ssh ${NEXUS_HOST} 'docker rm -f war-room'"
echo "    ssh ${NEXUS_HOST} 'sudo cp /etc/caddy/Caddyfile.bak.war-room.${TS} /etc/caddy/Caddyfile && sudo systemctl reload caddy'"
echo "=============================================================="
