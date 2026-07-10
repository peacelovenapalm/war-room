#!/bin/sh
# War Room container entrypoint: seed the app config guard, then start the server.
#
# The seeded config keeps standalone.hooksEnabled=false so the server NEVER
# writes hook entries into ~/.claude/settings.json (same guard as on the Mac —
# hook installation is always a human-run runbook). watchAllSessions=true and
# alwaysShowLabels=true match the War Room defaults.
set -eu

CONFIG_DIR="${HOME}/.pixel-agents"
CONFIG_FILE="${CONFIG_DIR}/config.json"

mkdir -p "${CONFIG_DIR}"
if [ ! -f "${CONFIG_FILE}" ]; then
  cat > "${CONFIG_FILE}" <<'EOF'
{
  "standalone": {
    "soundEnabled": false,
    "alwaysShowLabels": true,
    "watchAllSessions": true,
    "hooksEnabled": false,
    "hooksInfoShown": true
  },
  "externalAssetDirectories": []
}
EOF
  echo "[war-room] Seeded ${CONFIG_FILE} (hooksEnabled=false guard)"
fi

# server.json is per-boot coordination state (pid+port of the live listener),
# not persistent app state. With the state volume (2026-07-10) it now survives
# recreates — and inside a fresh container it is stale BY DEFINITION, and
# dangerously so: the old container's node also ran as PID 1, so the pid
# liveness check in server.ts would "reuse" a server that no longer exists and
# never bind a listener. Always clear it at boot.
rm -f "${CONFIG_DIR}/server.json"

# 0.0.0.0 INSIDE the container only; the host publish binds 127.0.0.1.
exec node /app/dist/cli.js --host 0.0.0.0 --port 3141
