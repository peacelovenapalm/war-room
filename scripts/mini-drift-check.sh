#!/bin/bash
# =============================================================================
# mini-drift-check.sh — verify MINI's deployed war-room checkout matches
# the expected source, and FAIL LOUDLY on any mismatch.
#
# Context: MINI's ~/code/war-room used to be an rsynced copy with no git
# history (INFRA-AUDIT-2026-07-12.md finding 4 — "future deploys must
# remember to re-sync MINI or it drifts silently"). It is now a real git
# clone (Phase D / Q44, 2026-07-12). This script closes the silent-drift
# gap: run it after any deploy/ship step (or ad hoc) to prove MINI is at
# the sha you think it is.
#
#   bash scripts/mini-drift-check.sh [expected-sha]
#
# With no argument, "expected" is this machine's local HEAD. Exit 0 only
# when MINI reports the exact same sha AND a clean working tree. Any
# other outcome (unreachable, not a git repo, dirty tree, sha mismatch)
# exits non-zero with a clear message — never a silent pass.
#
# Companion to .planning/runbooks/ship-to-mini.sh (which ships bin/ +
# runbooks + the token env). This script does not ship anything; it only
# verifies.
# =============================================================================
set -euo pipefail

MINI="${WAR_ROOM_MINI_SSH:-greg@100.121.189.6}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SHA="${1:-}"
SSH_OPTS=(-o ConnectTimeout=8 -o BatchMode=yes)

fail() { printf '[DRIFT-CHECK FAIL] %s\n' "$1" >&2; exit 1; }
ok()   { printf '[DRIFT-CHECK OK]   %s\n' "$1"; }

if [ -z "${EXPECTED_SHA}" ]; then
  EXPECTED_SHA="$(git -C "${REPO_DIR}" rev-parse HEAD)"
fi
[ -n "${EXPECTED_SHA}" ] || fail "could not determine expected sha (pass it explicitly as \$1)"

ssh -n "${SSH_OPTS[@]}" -- "${MINI}" 'echo ok' >/dev/null 2>&1 \
  || fail "cannot reach ${MINI} over SSH — cannot verify, treat as UNKNOWN drift risk"

IS_GIT_REPO="$(ssh -n "${SSH_OPTS[@]}" -- "${MINI}" \
  'git -C ~/code/war-room rev-parse --is-inside-work-tree 2>/dev/null || echo no')"
[ "${IS_GIT_REPO}" = "true" ] \
  || fail "~/code/war-room on ${MINI} is not a git repo (rsync-copy regression?) — cannot verify sha, re-clone required"

MINI_SHA="$(ssh -n "${SSH_OPTS[@]}" -- "${MINI}" 'git -C ~/code/war-room rev-parse HEAD')" \
  || fail "could not read MINI HEAD over SSH (transient drop?) — cannot verify, treat as UNKNOWN drift risk"
MINI_DIRTY="$(ssh -n "${SSH_OPTS[@]}" -- "${MINI}" 'git -C ~/code/war-room status --porcelain')" \
  || fail "could not read MINI tree status over SSH (transient drop?) — cannot verify, treat as UNKNOWN drift risk"

[ "${MINI_SHA}" = "${EXPECTED_SHA}" ] \
  || fail "MINI HEAD (${MINI_SHA}) != expected (${EXPECTED_SHA}) — MINI has drifted, re-run ship-to-mini.sh or re-clone"

[ -z "${MINI_DIRTY}" ] \
  || fail "MINI's ~/code/war-room has uncommitted local changes — not a clean deploy, investigate before trusting it"

ok "MINI HEAD matches expected sha ${EXPECTED_SHA}, clean tree"
