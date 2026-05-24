#!/usr/bin/env bash
# PreToolUse hook: blocks Bash invocations of the auto-add-state
# orchestrator (scripts/lib/add-state.ts) when run from the main
# checkout. The orchestrator must run inside a dedicated git worktree so
# concurrent Claude sessions cannot race its in-flight bootstrap writes
# by checking out a different branch in the shared working tree.
#
# Why: on 2026-05-24 an AR auto-add-state run lost Phase 1 (institutions.json,
# zipcodes.json, registry edits) + Phase 5 (Scorecard ENOENT) because a
# concurrent claude/az-transfers session ran `git checkout` in the same
# main checkout mid-run. The orchestrator kept executing against its
# in-memory state and reported false success in its result JSON; the
# actual files were gone from disk. See the discussion that led to this
# hook for the full failure mode.
#
# Exit codes:
#   0 → allow
#   2 → block (stderr shown to the model)
#
# Reads JSON payload on stdin:
#   {"tool_name":"Bash",
#    "tool_input":{"command":"...", ...}}

set -euo pipefail

PAYLOAD=$(cat)

CMD=$(echo "$PAYLOAD" | /usr/bin/python3 -c '
import sys, json
p = json.load(sys.stdin).get("tool_input", {})
print((p.get("command", "") or "").replace("\n", " "))
' 2>/dev/null || echo "")

# Only guard the auto-add-state orchestrator. Other long-running scripts
# (full-state scrapers, catalog prereqs) are typically invoked from a
# state-specific branch and don't perform the cross-cutting bootstrap +
# registry edits that race.
echo "$CMD" | grep -qE 'scripts/lib/add-state\.ts' || exit 0

# Allow harmless read-only checks even if the script name appears in args.
if echo "$CMD" | grep -qE '^(pgrep|pkill|tail|head|cat|ls|wc|grep|stat|test|jq|md5|file)\b'; then
  exit 0
fi

# Determine the git common dir and whether CWD is the main checkout or a
# linked worktree. `git rev-parse --git-dir` returns ".git" in the main
# checkout and a path like ".git/worktrees/<name>" in a linked worktree.
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null || echo "")
if [ -z "$GIT_DIR" ]; then
  # Not in a git repo — let the script fail on its own merits.
  exit 0
fi

case "$GIT_DIR" in
  *worktrees/*)
    # Running from a linked worktree — exactly what we want.
    exit 0
    ;;
esac

# CWD is the main checkout. Derive a suggested worktree command from
# --state <slug> if present in CMD.
SLUG=$(echo "$CMD" | grep -oE '(--state|--state=)[[:space:]=]*[a-z]{2}' | grep -oE '[a-z]{2}$' || echo "STATE")
SUGGESTED_BRANCH="claude/${SLUG}-auto-add-state"
SUGGESTED_PATH=".claude/worktrees/${SLUG}-auto-add-state"

cat >&2 <<EOF
BLOCKED — scripts/lib/add-state.ts must run inside a git worktree, not
in the main checkout.

The orchestrator runs for 20–60+ minutes and performs cross-cutting
writes (data/{state}/institutions.json, lib/states/{state}/config.ts,
registry edits to lib/{geo,institutions,states/registry}.ts). If another
Claude session does a \`git checkout\` in this same working tree during
the run, those writes get silently clobbered while the orchestrator
keeps running against its in-memory state and reports false success.
The AR run on 2026-05-24 lost Phase 1 + Phase 5 this exact way.

Run from a fresh worktree instead:

    git fetch origin main
    git worktree add ${SUGGESTED_PATH} -b ${SUGGESTED_BRANCH} origin/main
    cd ${SUGGESTED_PATH}
    <re-issue your orchestrator command here, with the double-fork detach pattern>

Then continue the auto-add-state skill workflow from inside that
worktree. See .claude/skills/auto-add-state/SKILL.md step 2.
EOF
exit 2
