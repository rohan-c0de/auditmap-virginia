#!/usr/bin/env bash
# PostToolUse hook: after a `git checkout -b NAME` Bash call completes
# successfully, write NAME into .claude/branch-lock — but only when it's
# SAFE to overwrite the previous lock. "Safe" means the working tree has
# no uncommitted changes to tracked files at the moment the hook runs.
#
# Why the safety check: parallel skills / sessions can run `git checkout
# -b OTHER_BRANCH` in this same workspace. Without the check, that
# parallel checkout would silently overwrite the lock with OTHER_BRANCH,
# and the subsequent commit (still on the *real* current branch, but
# guarded against the new lock) would pass the guard and land on the
# wrong branch. PR #469 (Alamo) hit exactly this and needed a
# cherry-pick rescue.
#
# With the check: if I have uncommitted Alamo work in the tree and some
# parallel session runs `git checkout -b foo`, this hook sees the dirty
# tree, refuses to overwrite the lock, and the next `git commit` aborts
# with the BRANCH GUARD banner — exactly the desired behavior.
#
# Notes:
#   - `git status --porcelain` excludes untracked (?? entries are reported
#     but we filter them out). We only care about M/A/D/R/C — actual
#     changes to tracked files. Untracked files (worktrees, scratch dirs)
#     are normal and shouldn't block.
#   - Only fires on `git checkout -b NAME` (new-branch creation), not on
#     regular `git checkout BRANCH`. The latter is often used to move
#     between branches the user has already chosen; auto-locking those
#     would fight that workflow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PAYLOAD=$(cat)
CMD=$(echo "$PAYLOAD" | /usr/bin/python3 -c "import sys, json; print(json.load(sys.stdin).get('tool_input', {}).get('command', ''))" 2>/dev/null || true)

# Match `git checkout -b <name>` (capture the branch name)
# Branch name chars per `git check-ref-format`: alnum + . _ / -
if [[ "$CMD" =~ git[[:space:]]+checkout[[:space:]]+-b[[:space:]]+([A-Za-z0-9._/-]+) ]]; then
  BRANCH="${BASH_REMATCH[1]}"
  cd "$REPO_ROOT" || exit 0

  # Count uncommitted changes to TRACKED files (exclude untracked '??').
  TRACKED_CHANGES=$(git status --porcelain 2>/dev/null | awk '/^[^?]/' | wc -l | tr -d '[:space:]')

  if [ "$TRACKED_CHANGES" -gt 0 ]; then
    echo "⚠️  branch-lock NOT updated to '$BRANCH' — working tree has $TRACKED_CHANGES uncommitted change(s)." >&2
    echo "    Existing lock kept: $(cat .claude/branch-lock 2>/dev/null || echo '(none)')" >&2
    echo "    This protects against parallel sessions overwriting the lock while I have in-flight work." >&2
    echo "    If you really mean to lock '$BRANCH', commit / stash first, then: echo $BRANCH > .claude/branch-lock" >&2
    exit 0
  fi

  # Second safety check (added 2026-05-24 after PR #524's branch-shift
  # rescue): don't overwrite a lock pointing to a branch with UNMERGED
  # commits. When my work is committed and pushed but not yet merged,
  # another session's `git checkout -b` would otherwise see a clean
  # tree and silently steal my lock — leading to my next `git commit`
  # landing on the wrong branch.
  if [ -f .claude/branch-lock ]; then
    EXISTING=$(cat .claude/branch-lock 2>/dev/null | tr -d '[:space:]')
    if [ -n "$EXISTING" ] && [ "$EXISTING" != "$BRANCH" ]; then
      # Does the locked branch still exist locally?
      if git rev-parse --verify --quiet "$EXISTING" > /dev/null 2>&1; then
        UNMERGED=$(git log --oneline "origin/main..$EXISTING" 2>/dev/null | wc -l | tr -d '[:space:]')
        if [ "$UNMERGED" -gt 0 ]; then
          echo "⚠️  branch-lock NOT updated to '$BRANCH' — existing lock '$EXISTING' has $UNMERGED unmerged commit(s)." >&2
          echo "    A parallel session's checkout would otherwise steal the lock and your next commit would land on the wrong branch." >&2
          echo "    Either:" >&2
          echo "      a) wait until $EXISTING is merged (auto-overwrite then becomes safe)," >&2
          echo "      b) finish + stash the work on $EXISTING before the new branch, or" >&2
          echo "      c) manually override: echo $BRANCH > .claude/branch-lock" >&2
          exit 0
        fi
      fi
    fi
  fi

  echo "$BRANCH" > .claude/branch-lock
  echo "🔒 branch-lock written: $BRANCH" >&2
fi

exit 0
