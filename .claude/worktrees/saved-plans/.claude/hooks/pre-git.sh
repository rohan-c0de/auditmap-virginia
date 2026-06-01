#!/usr/bin/env bash
# PreToolUse hook: inspects the Bash tool_input on stdin and, if it's a
# destructive git operation, runs the branch guard before letting Claude
# execute. Claude sends a JSON payload like:
#   {"tool_name":"Bash","tool_input":{"command":"git commit -m '...'"}}
#
# We only block when the command contains one of:
#   git commit
#   git push
#   git cherry-pick
#
# All other Bash calls pass through silently.

set -euo pipefail

# Resolve repo root from the script's own location so this is portable
# across machines / clones — never hardcode paths here.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Read JSON payload from stdin
PAYLOAD=$(cat)
CMD=$(echo "$PAYLOAD" | /usr/bin/python3 -c "import sys, json; print(json.load(sys.stdin).get('tool_input', {}).get('command', ''))" 2>/dev/null || true)

# Only guard destructive git ops
case "$CMD" in
  *"git commit"*|*"git push"*|*"git cherry-pick"*)
    cd "$REPO_ROOT" || exit 0
    if ! ./.claude/git-branch-guard.sh; then
      # Tell Claude to abort: exit 2 = block tool execution
      exit 2
    fi
    ;;
esac

exit 0
