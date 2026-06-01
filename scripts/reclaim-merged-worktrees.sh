#!/usr/bin/env bash
# reclaim-merged-worktrees.sh — remove worktrees whose PR has already landed.
#
# WHY: each of ~17 concurrent Claude sessions creates a worktree under
# .claude/worktrees/<slug> (≈3 GB each: full checkout + node_modules). They are
# NOT auto-removed when the PR merges, so they pile up and fill the disk. This
# sweep reclaims any worktree whose work is fully landed and pushed.
#
# SAFETY GATES (all must hold, or the worktree is kept):
#   1. Its branch's PR state is MERGED or CLOSED (work is on main / abandoned).
#   2. Working tree is clean — no uncommitted changes.
#   3. No unpushed commits (branch is not ahead of its upstream).
# A worktree failing any gate is left untouched — we never remove in-flight work.
#
# Concurrency-safe (lock), defensive (no gh / not authed -> no-op), idempotent.
#
# Usage:
#   scripts/reclaim-merged-worktrees.sh [--dry-run]

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve the MAIN checkout root, not the current worktree: this script is
# committed into every worktree, but .claude/worktrees/ lives only under the
# main checkout. `--git-common-dir` points at the shared .git regardless of
# which worktree we're invoked from; its parent is the main root.
COMMON_GIT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
if [ -n "$COMMON_GIT_DIR" ]; then
  REPO_ROOT="$(dirname "$COMMON_GIT_DIR")"
else
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd)"
fi
WT_DIR="$REPO_ROOT/.claude/worktrees"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

log() { echo "[reclaim] $*"; }

# Preconditions — fail soft (this runs unattended from a hook).
command -v gh  >/dev/null 2>&1 || { log "gh not installed — skip";  exit 0; }
command -v git >/dev/null 2>&1 || { log "git not installed — skip"; exit 0; }
gh auth status >/dev/null 2>&1 || { log "gh not authenticated — skip"; exit 0; }
[ -d "$WT_DIR" ] || { log "no worktrees dir — nothing to do"; exit 0; }

# Single-flight lock so 17 sessions firing at once don't collide.
LOCK="${TMPDIR:-/tmp}/cc-reclaim-worktrees.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  log "another sweep is running — skip"; exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

cd "$REPO_ROOT" || exit 0

removed=0; kept=0
for dir in "$WT_DIR"/*/; do
  [ -d "$dir" ] || continue
  dir="${dir%/}"
  slug="$(basename "$dir")"

  branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null)" || { log "keep $slug (not a git worktree)"; kept=$((kept+1)); continue; }
  if [ "$branch" = "HEAD" ] || [ -z "$branch" ]; then
    log "keep $slug (detached HEAD — can't resolve PR)"; kept=$((kept+1)); continue
  fi

  state="$(gh pr view "$branch" --json state --jq .state 2>/dev/null)"
  if [ -z "$state" ]; then
    log "keep $slug [$branch] (no PR found)"; kept=$((kept+1)); continue
  fi
  if [ "$state" != "MERGED" ] && [ "$state" != "CLOSED" ]; then
    log "keep $slug [$branch] (PR $state)"; kept=$((kept+1)); continue
  fi

  # Gate 2: clean working tree.
  if [ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]; then
    log "keep $slug [$branch] (PR $state but UNCOMMITTED changes — not safe)"; kept=$((kept+1)); continue
  fi
  # Gate 3: no unpushed commits (must have an upstream and be not-ahead).
  upstream="$(git -C "$dir" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)"
  if [ -z "$upstream" ]; then
    log "keep $slug [$branch] (PR $state but no upstream — not safe)"; kept=$((kept+1)); continue
  fi
  ahead="$(git -C "$dir" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 1)"
  if [ "$ahead" != "0" ]; then
    log "keep $slug [$branch] (PR $state but $ahead unpushed commit(s) — not safe)"; kept=$((kept+1)); continue
  fi

  # All gates pass — safe to reclaim.
  if [ "$DRY_RUN" = "1" ]; then
    log "WOULD REMOVE $slug [$branch] (PR $state, clean, pushed)"
    removed=$((removed+1)); continue
  fi
  if git worktree remove --force "$dir" 2>/dev/null; then
    git branch -D "$branch" >/dev/null 2>&1 || true
    log "removed $slug [$branch] (PR $state)"
    removed=$((removed+1))
  else
    log "FAILED to remove $slug [$branch] — left in place"; kept=$((kept+1))
  fi
done

git worktree prune 2>/dev/null || true
if [ "$DRY_RUN" = "1" ]; then
  log "dry-run: would reclaim $removed, keep $kept"
else
  log "reclaimed $removed, kept $kept"
fi
