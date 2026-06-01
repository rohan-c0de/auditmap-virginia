#!/usr/bin/env bash
# session-reclaim-worktrees.sh — SessionStart hook.
#
# Kicks off scripts/reclaim-merged-worktrees.sh in the BACKGROUND so that every
# new session triggers a sweep of .claude/worktrees/, removing any whose PR has
# already merged/closed (and whose tree is clean + pushed). Backgrounded so it
# never adds latency to session startup; the reclaim script is lock-guarded so
# 17 concurrent sessions starting at once don't collide.
#
# Always exits 0 — worktree cleanup must never block a session from starting.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECLAIM="$SCRIPT_DIR/../../scripts/reclaim-merged-worktrees.sh"

if [ -x "$RECLAIM" ]; then
  ( nohup bash "$RECLAIM" > "${TMPDIR:-/tmp}/cc-reclaim.log" 2>&1 < /dev/null & )
fi

exit 0
