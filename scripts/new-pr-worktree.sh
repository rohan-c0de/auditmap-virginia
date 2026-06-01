#!/usr/bin/env bash
# new-pr-worktree.sh — create an isolated worktree for one unit of PR work.
#
# WHY THIS EXISTS: the main checkout at the repo root is shared by many
# concurrent Claude sessions. Doing branch work (checkout -b, scrape, commit)
# there races every other session's git operations — HEAD moves under you
# (dangling commits), .claude/branch-lock gets overwritten, and freshly
# scraped data files get reverted to their committed state mid-run. A worktree
# has its own HEAD, index, and files, so it is immune to all of that.
#
# RULE: one PR = one worktree. The main checkout is read-only / coordination.
#
# Usage:
#   scripts/new-pr-worktree.sh <slug>            # branch claude/<slug>
#   scripts/new-pr-worktree.sh <slug> <branch>   # custom branch name
#
# Prints the `cd` command to run next. After cd-ing in, all git/scrape/commit
# work happens inside the worktree and cannot be clobbered by other sessions.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  echo "Usage: scripts/new-pr-worktree.sh <slug> [branch-name]" >&2
  echo "  e.g. scripts/new-pr-worktree.sh ia-transfers" >&2
  exit 1
fi

BRANCH="${2:-claude/$SLUG}"
WORKTREE=".claude/worktrees/$SLUG"
ABS_WORKTREE="$REPO_ROOT/$WORKTREE"

# Refuse to clobber an existing worktree.
if [ -e "$ABS_WORKTREE" ]; then
  echo "❌ $WORKTREE already exists. Pick a different slug or remove it first:" >&2
  echo "   git worktree remove $WORKTREE" >&2
  exit 1
fi

# Refuse if the branch is already checked out somewhere (git would error anyway,
# but give a clearer message).
if git worktree list --porcelain | grep -q "branch refs/heads/$BRANCH$"; then
  echo "❌ Branch $BRANCH is already checked out in another worktree:" >&2
  git worktree list | grep "\[$BRANCH\]" >&2 || true
  exit 1
fi

echo "Fetching origin/main…" >&2
git fetch origin main --quiet

echo "Creating worktree $WORKTREE on new branch $BRANCH (off origin/main)…" >&2
git worktree add -b "$BRANCH" "$ABS_WORKTREE" origin/main >&2

# Carry over the gitignored local env so scrapers/build can talk to Supabase.
if [ -f "$REPO_ROOT/.env.local" ]; then
  cp "$REPO_ROOT/.env.local" "$ABS_WORKTREE/.env.local"
  echo "Copied .env.local into the worktree." >&2
fi

# Seed the per-worktree branch lock so the branch guard is satisfied here.
printf '%s\n' "$BRANCH" > "$ABS_WORKTREE/.claude/branch-lock"

echo "" >&2
echo "✅ Worktree ready. Do ALL work for this PR inside it:" >&2
echo "" >&2
# The one line the caller should run next (printed to stdout so it's copyable).
echo "cd $ABS_WORKTREE"
