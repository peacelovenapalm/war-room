#!/bin/bash
# =============================================================================
# nexus-war-room-deploy.sh — GATED RUNBOOK (Greg-approved 2026-07-06)
#
# Deploys the War Room server to NEXUS:
#   1. refresh the half-baked tracker copy on nexus (/data/repos/completion-2026-07)
#   2. rsync the repo to nexus:~/apps/war-room-src
#   3. docker build (GIT_SHA/BUILT_AT baked in for /api/version) + run, bound to
#      127.0.0.1:3141 ON NEXUS (host loopback only), with read-only briefing
#      mounts (todo dir from the vault-notifier clone + the completion tracker)
#      and a PERSISTENT state volume (~/apps/war-room/state -> /root/.pixel-agents;
#      added 2026-07-10, KICKOFF-v2.0 0.2 — before this, every recreate wiped
#      the app's entire state. A one-time docker cp migration rescues the live
#      container's state into the host dir before the first volume-backed run.)
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
REMOTE_STATE_DIR="~/apps/war-room/state"   # persistent state volume (2026-07-10)
TS="$(date +%Y%m%d-%H%M%S)"
# Baked into the image for GET /api/version (KICKOFF-v2.0 0.4) — the rsync'd
# source has no .git, so the SHA must be computed here and passed as a build arg.
GIT_SHA="$(git -C "${REPO_DIR}" rev-parse HEAD 2>/dev/null || echo unknown)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Briefing data sources ON NEXUS (read-only binds into the container):
#  - todo dir: inside the vault-notifier Brain2 clone (hard-resets to origin/main
#    every 15 min via the notifier cron, so it stays fresh without new sync jobs)
#  - tracker: the same dir the projects-board container binds read-only
TODO_DIR_NEXUS="/data/repos/vault-notifier/vault/vault/_inbox/routines/todo"
TRACKER_DIR_NEXUS="/data/repos/completion-2026-07"
#  - graph (4C): the Phase-9 knowledge-graph store inside the same vault
#    clone — nodes.jsonl + edges.jsonl, git-tracked so the notifier cron's
#    hard-reset keeps it as fresh as the last committed graph_build run
GRAPH_DIR_NEXUS="/data/repos/vault-notifier/vault/vault/_meta/graph"
#  - routines (v4 T7): the whole `_inbox/routines/` root — one level above
#    TODO_DIR_NEXUS, same vault clone. Feeds the daily-digest fold in the
#    SHIFT panel (briefingProvider.ts) AND the routine inbox tray
#    (inboxProvider.ts, GET /api/inbox). Additive mount — TODO_DIR_NEXUS
#    stays its own mount so existing WAR_ROOM_TODO_DIR wiring is untouched.
ROUTINES_DIR_NEXUS="/data/repos/vault-notifier/vault/vault/_inbox/routines"
#  - districts (v5 Phase C, GET /api/districts): WIRED 2026-07-12. Fresh
#    read-only clones live under /data/repos/districts/<project>/ on nexus
#    (created from the local Gitea bare repos; auto-pulled every 15 min by
#    the `war-room-districts-pull` crontab entry). The whole root is
#    bind-mounted ro at /briefing/districts and the server scans immediate
#    subdirs for .planning/STATE.md (else STATE.md) — see
#    server/src/districtsProvider.ts (WAR_ROOM_DISTRICTS_DIR contract).
#    war-room's OWN state has no nexus git source (GitHub unreachable from
#    nexus), so it rides the same laptop-canonical rsync pattern as the
#    tracker: refreshed into the districts root on every deploy below.
#    UNDO: crontab -l | grep -v war-room-districts-pull | crontab -
#          rm -rf /data/repos/districts
DISTRICTS_DIR_NEXUS="/data/repos/districts"
WARROOM_STATE_LOCAL="${REPO_DIR}/.planning/v4/STATE-v4.md"
TRACKER_STATE_LOCAL="/Users/greg/code/completion-2026-07/STATE.md"
#  - morning (V6-1, GET /api/morning): nexus-notifier's own
#    `gen_morning_page.py` output dir (same clone the other briefing
#    sources already read from) — morning.json regenerates on the
#    notifier's existing 06:00 America/Denver cron gate, so this mount is
#    read-only and needs no refresh step of its own here.
MORNING_DIR_NEXUS="/data/repos/vault-notifier/public"
#  - morning spot-check spool (V6-5): a SEPARATE rw dir (never the ro
#    morning mount above) the server writes sampled spool files into and
#    an external `codex exec` runner reads from ON NEXUS — see
#    server/src/morningSpotCheck.ts's header for the documented
#    manual/runner path. Not the state volume: this is disposable spool
#    data, not app state worth migrating/backing up.
MORNING_SPOOL_DIR_NEXUS="/data/repos/war-room-morning-spool"

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
ssh "${NEXUS_HOST}" "test -f ${GRAPH_DIR_NEXUS}/nodes.jsonl" \
  && ok "graph store present: ${GRAPH_DIR_NEXUS}" || warn "graph store missing on nexus — graph search will report available:false"
ssh "${NEXUS_HOST}" "test -d ${ROUTINES_DIR_NEXUS}" \
  && ok "routines dir present: ${ROUTINES_DIR_NEXUS}" || warn "routines dir missing on nexus — digest fold + inbox tray will report no source"
ssh "${NEXUS_HOST}" "test -f ${MORNING_DIR_NEXUS}/morning.json" \
  && ok "morning.json present: ${MORNING_DIR_NEXUS}" || warn "morning.json missing on nexus — MORNING panel's morning.json section will report unavailable (honest ⊘, board state still composes)"
ssh "${NEXUS_HOST}" "mkdir -p ${MORNING_SPOOL_DIR_NEXUS}" \
  && ok "morning spot-check spool dir ready: ${MORNING_SPOOL_DIR_NEXUS}" || warn "could not create morning spool dir — V6-5 spot-check spool will be disabled"

# ── Refresh the tracker copy (laptop is canonical; also feeds projects-board) ─
if [ -f "${TRACKER_STATE_LOCAL}" ]; then
  rsync -a "${TRACKER_STATE_LOCAL}" "${NEXUS_HOST}:${TRACKER_DIR_NEXUS}/STATE.md" \
    && ok "tracker STATE.md refreshed on nexus (projects-board reads the same file)" \
    || warn "tracker refresh failed — nexus copy may be stale"
else
  warn "no local tracker at ${TRACKER_STATE_LOCAL} — skipping refresh"
fi

# ── Refresh war-room's own district state (laptop is canonical, v5 Phase C) ──
ssh "${NEXUS_HOST}" "mkdir -p ${DISTRICTS_DIR_NEXUS}/war-room"
if [ -f "${WARROOM_STATE_LOCAL}" ]; then
  rsync -a "${WARROOM_STATE_LOCAL}" "${NEXUS_HOST}:${DISTRICTS_DIR_NEXUS}/war-room/STATE.md" \
    && ok "war-room district STATE.md refreshed on nexus" \
    || warn "war-room district state refresh failed — district may render stale/unknown"
else
  warn "no local war-room state at ${WARROOM_STATE_LOCAL} — war-room district will render its last-shipped state"
fi
ssh "${NEXUS_HOST}" "test -d ${DISTRICTS_DIR_NEXUS}" \
  && ok "districts root present: ${DISTRICTS_DIR_NEXUS} ($(ssh "${NEXUS_HOST}" "ls ${DISTRICTS_DIR_NEXUS} | wc -l" | tr -d ' ') projects)" \
  || warn "districts root missing on nexus — districts will render NO DATA"

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

ssh "${NEXUS_HOST}" "docker build --build-arg GIT_SHA=${GIT_SHA} --build-arg BUILT_AT=${BUILT_AT} -t war-room:latest ${REMOTE_SRC}" \
  && ok "image war-room:latest built (GIT_SHA=${GIT_SHA})" || fail "docker build failed"

# ── One-time state migration (2026-07-10, KICKOFF-v2.0 0.2) ─────────────────
# Rescue the live container's state dir into the host volume path BEFORE the
# container is removed. Idempotent: once the host dir has state files (any
# .json), the volume is the source of truth and the copy is skipped — a stale
# container's files must never clobber newer volume-backed state.
ssh "${NEXUS_HOST}" "mkdir -p ${REMOTE_STATE_DIR}"
if ssh "${NEXUS_HOST}" "ls ${REMOTE_STATE_DIR}/*.json >/dev/null 2>&1"; then
  ok "state volume already populated — migration skipped (volume is source of truth)"
elif ssh "${NEXUS_HOST}" "docker ps -a --format '{{.Names}}' | grep -qx war-room"; then
  ssh "${NEXUS_HOST}" "docker cp war-room:/root/.pixel-agents/. ${REMOTE_STATE_DIR}/" \
    && ok "live container state migrated -> ${REMOTE_STATE_DIR}" \
    || fail "state migration (docker cp) failed — aborting BEFORE docker rm, live state intact"
else
  ok "no existing war-room container — starting with an empty state volume"
fi

# ── Run container (host-loopback publish ONLY + ro briefing mounts + state vol) ─
ssh "${NEXUS_HOST}" "docker rm -f war-room >/dev/null 2>&1 || true"
ssh "${NEXUS_HOST}" "docker run -d --name war-room --restart unless-stopped \
  --env-file ${REMOTE_ENV_DIR}/war-room.env \
  -e WAR_ROOM_TODO_DIR=/briefing/todo \
  -e WAR_ROOM_TRACKER_STATE=/briefing/tracker/STATE.md \
  -e WAR_ROOM_GRAPH_DIR=/briefing/graph \
  -e WAR_ROOM_ROUTINES_DIR=/briefing/routines \
  -e WAR_ROOM_DISTRICTS_DIR=/briefing/districts \
  -e WAR_ROOM_MORNING_JSON=/briefing/morning/morning.json \
  -e WAR_ROOM_MORNING_SPOOL_DIR=/morning-spool \
  -e WAR_ROOM_MORNING_PUSH_HOUR=6 \
  -e WAR_ROOM_MORNING_TZ=America/Denver \
  -e WAR_ROOM_BOARD_URL=https://${TAILNET_FQDN}:${SERVE_PORT} \
  -v ${DISTRICTS_DIR_NEXUS}:/briefing/districts:ro \
  -v ${TODO_DIR_NEXUS}:/briefing/todo:ro \
  -v ${TRACKER_DIR_NEXUS}:/briefing/tracker:ro \
  -v ${GRAPH_DIR_NEXUS}:/briefing/graph:ro \
  -v ${ROUTINES_DIR_NEXUS}:/briefing/routines:ro \
  -v ${MORNING_DIR_NEXUS}:/briefing/morning:ro \
  -v ${MORNING_SPOOL_DIR_NEXUS}:/morning-spool \
  -v ${REMOTE_STATE_DIR}:/root/.pixel-agents \
  -p 127.0.0.1:${APP_PORT}:3141 war-room:latest" >/dev/null \
  && ok "container war-room running (127.0.0.1:${APP_PORT}, briefing ro, morning ro, spool rw, state vol rw)" || fail "docker run failed"

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
# (tailnet only)-annotated lines are NOT funnel exposure — the old bare grep
# false-positived on every deploy (TUNING.md [G2] BATCH-1 entry, fixed 2026-07-10).
ssh "${NEXUS_HOST}" "tailscale funnel status 2>/dev/null | grep -v '(tailnet only)' | grep -q ':${SERVE_PORT}'" \
  && fail "SAFETY: :${SERVE_PORT} appears in FUNNEL status — run 'tailscale funnel --https=${SERVE_PORT} off' NOW" \
  || ok "funnel check clean — :${SERVE_PORT} is tailnet-only"

# ── PWA manifest reachable over the real tailnet path (G6, BUILD-PLAN §G6 task 5) ──
# Post face-merge (FACE-MERGE-PLAN Tier 3) this is the V3 face's manifest —
# the old face's manifest lives under /v1/ during the grace release.
if curl -sf -m 8 "https://${TAILNET_FQDN}:${SERVE_PORT}/manifest.webmanifest" >/dev/null; then
  ok "manifest.webmanifest reachable over tailnet HTTPS"
else
  warn "manifest.webmanifest not reachable from this machine over tailnet HTTPS — check this Mac's tailscale connection, then verify by hand"
fi

# ── face-merge cutover checks (FACE-MERGE-PLAN Tier 3) ──────────────────────
# Root must serve the V3 face (its index title is "War Room V3"; the legacy
# face's is plain "War Room") and /v3 must 301 home with the query intact —
# a silent regression here strands every phone bookmark.
if ssh "${NEXUS_HOST}" "curl -sf -m 8 http://127.0.0.1:${APP_PORT}/ | grep -q 'War Room V3'"; then
  ok "root serves the V3 face"
else
  fail "root is NOT serving the V3 face — check dist/webview-v3 in the image"
fi
V3_REDIRECT=$(ssh "${NEXUS_HOST}" "curl -s -o /dev/null -m 8 -w '%{http_code} %{redirect_url}' 'http://127.0.0.1:${APP_PORT}/v3/?agentId=5'")
if printf '%s' "${V3_REDIRECT}" | grep -q '301 .*/?agentId=5'; then
  ok "/v3 301s to root with query preserved (${V3_REDIRECT})"
else
  fail "/v3 redirect broken (got: ${V3_REDIRECT}) — old bookmarks/deep links would strand"
fi

echo
echo "=============================================================="
ok "DEPLOY COMPLETE"
echo "  Dashboard : https://${TAILNET_FQDN}:${SERVE_PORT}  (tailnet devices only)"
echo "  Briefing  : https://${TAILNET_FQDN}:${SERVE_PORT}/api/briefing"
echo "  Inbox     : https://${TAILNET_FQDN}:${SERVE_PORT}/api/inbox"
echo "  Ingest    : POST https://${TAILNET_FQDN}:${SERVE_PORT}/api/hooks/claude"
echo "              Authorization: Bearer <WAR_ROOM_TOKEN from nexus war-room.env>"
echo "              X-Machine: MACBOOK | MINI"
echo "  Next      : run macbook-hooks-install.sh on each Mac (also gated)"
echo
echo "  UNDO:"
echo "    ssh ${NEXUS_HOST} 'docker rm -f war-room'"
echo "    ssh ${NEXUS_HOST} 'tailscale serve --https=${SERVE_PORT} off'"
echo "=============================================================="
