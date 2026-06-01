#!/usr/bin/env bash
# PreToolUse hook: blocks `git push` when the current branch's PR is already
# MERGED or CLOSED on GitHub. Commits pushed after squash-merge become
# orphaned dead commits on the remote branch — they never reach main and
# are silently lost.
#
# Why: this has happened three times now — PRs #37 and #41 (lost edits the
# user only noticed in prod), and PR #947 (Nebraska auto-add-state) where
# a follow-up LPTC scraper commit was pushed seconds after the PR squash-
# merged. CLAUDE.md has the rule ("Don't push to a PR branch after you've
# told the user to merge") but guidance has now failed three times. This
# hook makes it mechanically enforced.
#
# Heuristic:
#   1. Only fires on `git push` (any form: bare, --set-upstream, with refs).
#   2. Resolves the current branch via `git symbolic-ref`.
#   3. Asks `gh pr list --head <branch> --state all` for the PR's state.
#   4. If state is MERGED or CLOSED, BLOCK with a recovery hint.
#
# Pass-through cases (exit 0):
#   - No `gh` CLI available (offline / unauthenticated)
#   - Not in a git repo
#   - Detached HEAD (no branch to look up)
#   - No PR found for the branch (first push of a new branch)
#   - PR state is OPEN or DRAFT (normal flow)
#   - Push targets a different remote/ref than the branch's PR (e.g.
#     pushing a local-only ref); err on the side of allowing.
#
# Exit codes:
#   0 → allow
#   2 → block (stderr shown to the model)

set -euo pipefail

PAYLOAD=$(cat)

CMD=$(echo "$PAYLOAD" | /usr/bin/python3 -c '
import sys, json
p = json.load(sys.stdin).get("tool_input", {})
print((p.get("command", "") or "").replace("\n", " "))
' 2>/dev/null || echo "")

# Only care about `git push`. Strip any leading `cd X && ` so we see the
# real first command word. Avoids false-positives from commit-message
# heredocs that mention "git push" in the body.
FIRST_CMD=$(echo "$CMD" | /usr/bin/python3 -c '
import sys, re
cmd = sys.stdin.read().strip()
cmd = re.sub(r"^cd\s+\S+\s*(&&|;)\s*", "", cmd)
m = re.match(r"\s*(\S+)", cmd)
print(m.group(1) if m else "")
' 2>/dev/null || echo "")

[ "$FIRST_CMD" = "git" ] || exit 0
echo "$CMD" | grep -qE '^\s*(cd\s+\S+\s*(&&|;)\s*)?git\s+push\b' || exit 0

# Need gh CLI.
command -v gh >/dev/null 2>&1 || exit 0

BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
[ -n "$BRANCH" ] || exit 0  # detached HEAD or not in a repo

# Skip protected branch names — never block pushes to main/master/develop;
# those are unusual and the user knows what they're doing.
case "$BRANCH" in
  main|master|develop) exit 0 ;;
esac

# Query GitHub. --state all so we see MERGED/CLOSED PRs, not just OPEN.
# `-q '.[0].state'` returns empty when no PR exists.
STATE=$(gh pr list --head "$BRANCH" --state all --json state -q '.[0].state' 2>/dev/null || echo "")

case "$STATE" in
  MERGED|CLOSED)
    PR_NUM=$(gh pr list --head "$BRANCH" --state all --json number -q '.[0].number' 2>/dev/null || echo "?")
    cat >&2 <<EOF
❌ pre-push-merged-pr-guard: PR #${PR_NUM} for branch '${BRANCH}' is ${STATE}.

Pushing more commits to a merged/closed PR branch creates orphaned dead
commits — they live on the remote branch but never reach main, and are
silently lost. This has happened on PRs #37, #41, and #947.

To ship this work as a follow-up:
  cd \$(git rev-parse --show-toplevel)/../..   # back to main checkout
  WT=\$(scripts/new-pr-worktree.sh <slug>-followup)
  cd "\$WT"
  git cherry-pick <commit-sha>
  git push -u origin claude/<slug>-followup
  gh pr create ...

If you genuinely need to push to this branch (rare — e.g. fixing a tag),
bypass with: \`git -c core.hooksPath=/dev/null push\`
EOF
    exit 2
    ;;
esac

exit 0
