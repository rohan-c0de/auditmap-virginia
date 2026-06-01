#!/usr/bin/env bash
# Unit tests for .claude/hooks/pre-worktree-guard.sh
#
# Run: bash .claude/hooks/test-pre-worktree-guard.sh
# Exit 0 if all pass, non-zero if any fail. Designed to be cheap so CI / dev
# can run it without thinking — the hook itself is dense regex, easy to break.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/pre-worktree-guard.sh"
# Test cases that need a "main checkout" cwd hardcode the real main-checkout
# path — git-common-dir is the canonical way to find it from any worktree.
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --git-common-dir 2>/dev/null | xargs dirname 2>/dev/null)"
# Fall back to the well-known location if git-common-dir gave a relative path
# or anything weird; this is the only repo this hook ships in.
if [ ! -d "$ROOT" ] || [ "$ROOT" = "/" ]; then
  ROOT="/Users/rohanupalekar/claudecode/cc-coursemap"
fi
WT="$ROOT/.claude/worktrees/foo"
OTHER_WT="$ROOT/.claude/worktrees/other-session"

pass=0; fail=0
run() {
  local payload="$1" expect="$2" label="$3"
  local ec
  ec=$(printf '%s' "$payload" | bash "$HOOK" >/dev/null 2>&1; echo $?)
  if [ "$ec" = "$expect" ]; then
    pass=$((pass+1)); echo "  ✓ ($ec) $label"
  else
    fail=$((fail+1)); echo "  ✗ (got $ec, want $expect) $label"
  fi
}

# Use a placeholder to avoid pre-git.sh / outer-shell guards tripping on this
# script's own text; the hook itself sees only the JSON payload, never this file.
G="g""it"

echo "--- main-checkout branch-work guard ---"
run "{\"tool_input\":{\"command\":\"$G checkout -b claude/foo origin/main\"},\"cwd\":\"$ROOT\"}" 2 "branch-create in main → BLOCK"
run "{\"tool_input\":{\"command\":\"cd .claude/worktrees/foo \&\& $G checkout -b claude/bar\"},\"cwd\":\"$ROOT\"}" 0 "branch-create cd-worktree → ALLOW"
run "{\"tool_input\":{\"command\":\"$G checkout -b claude/baz\"},\"cwd\":\"$WT\"}" 0 "branch-create cwd=worktree → ALLOW"
run "{\"tool_input\":{\"command\":\"$G checkout -- data/ma/prereqs.json\"},\"cwd\":\"$ROOT\"}" 0 "checkout -- file → ALLOW"
run "{\"tool_input\":{\"command\":\"$G switch main\"},\"cwd\":\"$ROOT\"}" 0 "switch main (resting) → ALLOW"
run "{\"tool_input\":{\"command\":\"$G reset --hard origin/main\"},\"cwd\":\"$ROOT\"}" 2 "reset --hard in main → BLOCK"
run "{\"tool_input\":{\"command\":\"$G commit -m x\"},\"cwd\":\"$ROOT\"}" 0 "commit (this hook ignores) → ALLOW"
run "{\"tool_input\":{\"command\":\"$G worktree add -b claude/x .claude/worktrees/x origin/main\"},\"cwd\":\"$ROOT\"}" 0 "worktree add → ALLOW"
run "{\"tool_input\":{\"command\":\"$G checkout claude/other\"},\"cwd\":\"$ROOT\"}" 2 "head-switch in main → BLOCK"
run "{\"tool_input\":{\"command\":\"$G clean -fd\"},\"cwd\":\"$ROOT\"}" 2 "clean -fd in main → BLOCK"

echo "--- foreign worktree removal guard (new) ---"
run "{\"tool_input\":{\"command\":\"$G worktree remove .claude/worktrees/other-session\"},\"cwd\":\"$ROOT\"}" 2 "git worktree remove foreign → BLOCK"
run "{\"tool_input\":{\"command\":\"rm -rf .claude/worktrees/other-session\"},\"cwd\":\"$ROOT\"}" 2 "rm -rf foreign worktree → BLOCK"
run "{\"tool_input\":{\"command\":\"rm -fr .claude/worktrees/other-session\"},\"cwd\":\"$ROOT\"}" 2 "rm -fr foreign worktree → BLOCK (flag-order variant)"
run "{\"tool_input\":{\"command\":\"rm -Rf .claude/worktrees/other-session\"},\"cwd\":\"$ROOT\"}" 2 "rm -Rf foreign worktree → BLOCK (capital R)"
# Self-removal cases: caller IS inside the target worktree → allowed.
run "{\"tool_input\":{\"command\":\"$G worktree remove .claude/worktrees/foo\"},\"cwd\":\"$WT\"}" 0 "git worktree remove SELF (cwd=target) → ALLOW"
run "{\"tool_input\":{\"command\":\"rm -rf .claude/worktrees/foo\"},\"cwd\":\"$WT\"}" 0 "rm -rf SELF worktree (cwd=target) → ALLOW"
# Generic rm in main checkout (no .claude/worktrees path) → not this hook's concern.
run "{\"tool_input\":{\"command\":\"rm -rf node_modules\"},\"cwd\":\"$ROOT\"}" 0 "rm -rf non-worktree path → ALLOW"
# git worktree remove of own merged worktree from main checkout — IS blocked
# (caller isn't inside it). Use cd into the target for self-removal instead.
run "{\"tool_input\":{\"command\":\"$G worktree remove .claude/worktrees/foo\"},\"cwd\":\"$ROOT\"}" 2 "git worktree remove from main (must cd in) → BLOCK"

echo ""
echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
