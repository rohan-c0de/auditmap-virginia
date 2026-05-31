#!/usr/bin/env bash
# PreToolUse hook: prevent branch work in the SHARED MAIN CHECKOUT.
#
# The repo root is shared by many concurrent Claude sessions. Creating or
# switching a branch there races every other session: HEAD moves under you
# (commits dangle and need cherry-pick rescue), the shared .claude/branch-lock
# gets overwritten, and freshly scraped data files are reverted mid-run.
# (Lost 3,512 IA transfer rows to exactly this on 2026-05-30.)
#
# This hook BLOCKS, in the main checkout only:
#   - git checkout -b / git switch -c   (branch creation → use a worktree)
#   - git checkout <branch> / switch <branch>  (HEAD move → don't; work in worktree)
#   - git reset --hard / git clean -f   (nukes other sessions' uncommitted work)
#
# It ALLOWS everywhere:
#   - the same ops inside a worktree (cwd or `cd` target under /worktrees/)
#   - git checkout -- <file>, git checkout . , git restore  (file ops, not HEAD)
#   - returning the main checkout to its resting state: checkout/switch main
#   - git worktree add ...  (the correct way to start branch work)
#
# Exit 2 = block tool execution and surface the message to Claude.
#
# NOTE: deliberately NOT using `set -euo pipefail`. A hook must always reach
# its explicit exit code; a no-match grep or SIGPIPE in a detection pipeline
# must never abort the script early (that would yield exit 1 = non-blocking
# error instead of the intended exit 2 = block).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PAYLOAD=$(cat)
CMD=$(echo "$PAYLOAD" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null || true)
PAYLOAD_CWD=$(echo "$PAYLOAD" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null || true)

[ -z "$CMD" ] && exit 0

# --- Is this a guarded operation at all? -----------------------------------
# Branch creation, HEAD-switching, or tree-nuking. Exclude file-level checkout.
is_guarded=0

# git checkout -b / git switch -c  → branch creation
if echo "$CMD" | grep -Eq 'git[[:space:]]+(checkout[[:space:]]+-b|switch[[:space:]]+-c|switch[[:space:]]+--create)'; then
  is_guarded=1; op="branch-create"
fi

# git reset --hard / git clean -f(d)  → destroys uncommitted work
if echo "$CMD" | grep -Eq 'git[[:space:]]+reset[[:space:]]+(--hard|--mixed[[:space:]]+HEAD~|.*--hard)'; then
  is_guarded=1; op="reset-hard"
fi
if echo "$CMD" | grep -Eq 'git[[:space:]]+clean[[:space:]]+-[a-z]*f'; then
  is_guarded=1; op="clean"
fi

# git checkout <branch> / git switch <branch>  → HEAD move
# (exclude: checkout -- , checkout . , restore, and returning to main)
if echo "$CMD" | grep -Eq 'git[[:space:]]+(checkout|switch)[[:space:]]'; then
  if ! echo "$CMD" | grep -Eq 'git[[:space:]]+checkout[[:space:]]+(-b|--[[:space:]]|\.|-- )'; then
    if ! echo "$CMD" | grep -Eq 'git[[:space:]]+(checkout|switch)[[:space:]]+(-c|--create)'; then
      # allow switching to main/master (resting state) and detaching to origin/main
      if ! echo "$CMD" | grep -Eq 'git[[:space:]]+(checkout|switch)[[:space:]]+(main|master|origin/main)([[:space:]]|$)'; then
        is_guarded=1; op="head-switch"
      fi
    fi
  fi
fi

[ "$is_guarded" -eq 0 ] && exit 0

# Always allow the correct primitive.
echo "$CMD" | grep -Eq 'git[[:space:]]+worktree' && exit 0

# --- Determine the effective directory the command runs in -----------------
# 1. An explicit `cd <path>` in the command wins.
# 2. Else the payload cwd (persisted shell dir).
# 3. Else the repo root.
target_dir=""
cd_path=$(echo "$CMD" | grep -oE 'cd[[:space:]]+[^&|;]+' 2>/dev/null | head -1 | sed -E 's/^cd[[:space:]]+//' | sed -E 's/[[:space:]]+$//' | tr -d '"'"'"'' || true)
if [ -n "$cd_path" ]; then
  target_dir="$cd_path"
elif [ -n "$PAYLOAD_CWD" ]; then
  target_dir="$PAYLOAD_CWD"
else
  target_dir="$REPO_ROOT"
fi

# Fast path: anything under a worktrees/ directory is isolated → allow.
case "$target_dir" in
  *"/worktrees/"*|*"/worktrees") exit 0 ;;
esac

# Robust check: resolve the dir and ask git whether it's the main checkout.
resolved="$target_dir"
case "$resolved" in
  /*) : ;;                          # absolute
  *)  resolved="$REPO_ROOT/$resolved" ;;  # relative → anchor to repo root
esac
if [ -d "$resolved" ]; then
  gd=$(cd "$resolved" 2>/dev/null && git rev-parse --git-dir 2>/dev/null || echo "")
  gcd=$(cd "$resolved" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null || echo "")
  # In a worktree, git-dir != git-common-dir → allow.
  if [ -n "$gd" ] && [ "$gd" != "$gcd" ]; then
    exit 0
  fi
fi

# --- We're in the shared main checkout. Block. -----------------------------
cat >&2 <<EOF
╔══════════════════════════════════════════════════════════════════════════════
║  🛑 BRANCH WORK IN THE SHARED MAIN CHECKOUT — BLOCKED ($op)
║
║  Command: $CMD
║
║  The repo root is shared by ~17 concurrent sessions. Creating/switching a
║  branch or resetting here races all of them: your commits dangle, the shared
║  branch-lock gets overwritten, and your scraped data files get reverted
║  mid-run (this lost 3,512 IA transfer rows on 2026-05-30).
║
║  Do this PR's work in an ISOLATED worktree instead:
║
║      WT=\$(scripts/new-pr-worktree.sh <slug>)   # creates worktree + branch
║      cd "\$WT"                                    # then scrape / commit here
║
║  Inside the worktree, the same git commands are safe — other sessions cannot
║  touch your HEAD, index, or files. The main checkout stays on main.
║
║  If you are SURE you are already inside a worktree and this misfired, run the
║  git command with an explicit `cd` into the worktree path in the same line.
╚══════════════════════════════════════════════════════════════════════════════
EOF
exit 2
