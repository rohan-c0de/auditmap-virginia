#!/usr/bin/env bash
# Branch guard: aborts destructive git operations when the current branch
# doesn't match the expected branch declared in .claude/branch-lock.
#
# Why this exists: parallel skills (auto-add-state, blog-pipeline, the
# Hawaii v2 rebase, the IL Colleague work, …) can silently switch the
# working tree's branch out from under Claude — usually via EnterWorktree.
# Multiple PRs in this repo (#460, #462, #465) needed cherry-pick rescues
# because commits landed on the wrong branch and pushed mixed work.
#
# Mechanism:
#   - When Claude creates a branch with `git checkout -b NAME`, the
#     companion hook in .claude/settings.local.json writes NAME to
#     .claude/branch-lock.
#   - Before any `git commit` / `git push` / `git cherry-pick`, this
#     script runs. If branch-lock exists and disagrees with the current
#     branch, it aborts with a loud error so Claude must reconcile
#     explicitly before continuing.
#   - No lock file = soft warning, not abort (covers one-off ops on main
#     or other branches Claude didn't create this session).

set -euo pipefail

LOCK_FILE=".claude/branch-lock"
CURRENT=$(git branch --show-current 2>/dev/null || echo "")

if [ -z "$CURRENT" ]; then
  # Not in a branch state (detached HEAD, mid-rebase, …). Don't block.
  echo "⚠️  branch-guard: no current branch (detached/rebasing). Skipping check." >&2
  exit 0
fi

if [ ! -f "$LOCK_FILE" ]; then
  echo "ℹ️  branch-guard: no .claude/branch-lock set. Current branch: $CURRENT" >&2
  echo "    To lock this branch, run: echo $CURRENT > $LOCK_FILE" >&2
  exit 0
fi

EXPECTED=$(cat "$LOCK_FILE" | tr -d '[:space:]')

if [ "$CURRENT" != "$EXPECTED" ]; then
  cat >&2 <<EOF

╔══════════════════════════════════════════════════════════════════════════════
║  🛑 BRANCH GUARD ABORT
║
║  About to run a destructive git operation on the WRONG branch:
║
║    Current branch: $CURRENT
║    Expected (locked): $EXPECTED
║
║  This is the same mistake that produced cherry-pick rescues on PRs
║  #460, #462, and #465. A parallel skill probably switched branches
║  silently. Reconcile before continuing:
║
║    git checkout $EXPECTED      # if your work belongs on the locked branch
║    OR
║    echo $CURRENT > $LOCK_FILE  # if you've intentionally switched
║
╚══════════════════════════════════════════════════════════════════════════════
EOF
  exit 2
fi

echo "✓ branch-guard: $CURRENT matches $LOCK_FILE" >&2
exit 0
