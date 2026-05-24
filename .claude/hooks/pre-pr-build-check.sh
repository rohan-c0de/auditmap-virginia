#!/usr/bin/env bash
# PreToolUse hook: blocks `gh pr create` on auto-add-state branches when
# the orchestrator's result JSON shows custom-platform colleges with
# publicly-accessible course-search pages that don't have a corresponding
# scraper committed.
#
# Why: SKILL.md step 12 says "Build bespoke scrapers for non-auth-gated
# custom-platform colleges BEFORE opening the PR — this is a hard rule."
# I broke it on the AZ auto-add-state run (2026-05-24) by deferring the
# Maricopa cluster (10 colleges, public PS Community Access) and 3 custom
# HTML colleges as TODOs because "it's another 1-2 hours of work." The
# user shouldn't have to come back and re-investigate later. This hook
# makes the rule mechanically enforced.
#
# Heuristic:
#   1. Only fires on `gh pr create`.
#   2. Only fires when the current branch matches `claude/{state}-auto-add-state`.
#   3. Looks for /tmp/add-state-{state}-result.json from the orchestrator.
#   4. Counts buildable TODOs — entries starting with `[fingerprint]` that
#      describe custom HTML / SPA / SIS-without-template, EXCLUDING:
#        - auth-gated / SSO / login-only mentions
#        - acalog / courseleaf / smartcatalog / coursedog / cleancatalog
#          (catalog platforms, not course-search systems)
#        - PDF-only mentions
#   5. Counts new scraper files added on the branch under scripts/{state}/.
#   6. If buildable_count > new_scraper_count AND no commit message contains
#      `DEFERRED-scrapers:` justifying the gap, BLOCK with the list.
#
# Escape hatch: include a commit on the branch with subject prefix
# `DEFERRED-scrapers:` followed by a one-line reason. That records the
# deferral explicitly so future grep can find it.
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

# Only care about gh pr create. Look at the first command word (skipping any
# leading `cd X && `) — must literally be `gh`. Avoids false-positives from
# commit-message heredocs that happen to mention "gh pr create" in the body.
FIRST_CMD=$(echo "$CMD" | /usr/bin/python3 -c '
import sys, re
cmd = sys.stdin.read().strip()
# Strip a leading "cd X && " or "cd X ; "
cmd = re.sub(r"^cd\s+\S+\s*(&&|;)\s*", "", cmd)
# Get the first word
m = re.match(r"\s*(\S+)", cmd)
print(m.group(1) if m else "")
' 2>/dev/null || echo "")

[ "$FIRST_CMD" = "gh" ] || exit 0
echo "$CMD" | grep -qE '^\s*(cd\s+\S+\s*(&&|;)\s*)?gh\s+pr\s+create\b' || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 0

BRANCH=$(git branch --show-current 2>/dev/null || echo "")
# Match claude/{state}-auto-add-state (state = 2-letter lowercase)
if [[ ! "$BRANCH" =~ ^claude/([a-z]{2})-auto-add-state$ ]]; then
  exit 0
fi
STATE="${BASH_REMATCH[1]}"

RESULT_JSON="/tmp/add-state-${STATE}-result.json"
if [ ! -f "$RESULT_JSON" ]; then
  # No orchestrator result on disk — model is opening a hand-crafted PR.
  # Don't block; this hook can't verify what it can't see.
  exit 0
fi

# The orchestrator's result file is JSON, but it's preceded by progress
# output. Find the first '{' line and parse from there.
JSON_START=$(grep -n '^{$' "$RESULT_JSON" | head -1 | cut -d: -f1)
if [ -z "$JSON_START" ]; then
  exit 0  # malformed; nothing to check
fi
CLEAN_JSON=$(tail -n +"$JSON_START" "$RESULT_JSON" 2>/dev/null)

# Pull buildable TODOs.
BUILDABLE_TODOS=$(echo "$CLEAN_JSON" | /usr/bin/python3 -c '
import sys, json, re
try:
    data = json.loads(sys.stdin.read())
except Exception:
    sys.exit(0)
todos = data.get("manualTodos", []) or []
out = []
for t in todos:
    # Only care about fingerprint TODOs (skipped colleges)
    if not t.startswith("[fingerprint"):
        continue
    lower = t.lower()
    # Skip catalog-only platforms — not course-search systems
    if any(x in lower for x in ["acalog", "courseleaf", "smartcatalog", "coursedog", "cleancatalog"]):
        continue
    # Skip auth-gated / login-wall (cannot scrape)
    if any(x in lower for x in ["auth-gated", "sso", "sso-gated", "login wall", "login-only", "credentials required"]):
        continue
    # Skip pdf-only mentions
    if "pdf" in lower:
        continue
    out.append(t)
print(json.dumps(out))
' 2>/dev/null || echo "[]")

BUILDABLE_COUNT=$(echo "$BUILDABLE_TODOS" | /usr/bin/python3 -c 'import sys, json; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)

if [ "$BUILDABLE_COUNT" -eq 0 ]; then
  exit 0  # nothing buildable was deferred
fi

# Count new per-college scraper files added to scripts/{state}/ on this
# branch (excluding scrape-programs.ts which is the Phase 6 wrapper, and
# scrape-catalog-prereqs.ts which is the prereq fallback — both are
# orchestrator-generated, not bespoke).
# Pipefail-safe: grep returns 1 when no matches, which kills `set -o pipefail`.
# Wrap in a subshell with explicit `|| true` per step.
SCRAPER_COUNT=$(
  added=$(git diff --name-only --diff-filter=A main...HEAD -- "scripts/${STATE}/" 2>/dev/null || true)
  bespoke=$(echo "$added" | grep -E "^scripts/${STATE}/scrape-.*\.ts$" 2>/dev/null || true)
  bespoke=$(echo "$bespoke" | grep -vE "scrape-programs\.ts$|scrape-catalog-prereqs\.ts$" 2>/dev/null || true)
  if [ -z "$bespoke" ]; then echo 0; else echo "$bespoke" | wc -l | tr -d ' '; fi
)

# Count any commits whose subject explicitly defers scraper work with
# a justification. Looking for `DEFERRED-scrapers:` in the subject.
# `grep -c` exits 1 when no matches and set -e would kill us; use || true.
DEFERRAL_COUNT=$(git log --pretty=format:"%s" main..HEAD 2>/dev/null \
  | grep -c '^DEFERRED-scrapers:' 2>/dev/null || echo 0)
DEFERRAL_COUNT=${DEFERRAL_COUNT//[^0-9]/}
DEFERRAL_COUNT=${DEFERRAL_COUNT:-0}

if [ "$BUILDABLE_COUNT" -gt "$SCRAPER_COUNT" ] && [ "$DEFERRAL_COUNT" -eq 0 ]; then
  GAP=$((BUILDABLE_COUNT - SCRAPER_COUNT))
  {
    echo "BLOCKED — auto-add-state PR for $STATE has $BUILDABLE_COUNT"
    echo "buildable-fingerprint TODOs but only $SCRAPER_COUNT new scraper(s)"
    echo "were committed on this branch."
    echo
    echo "Per .claude/skills/auto-add-state/SKILL.md step 12 (hard rule):"
    echo "build inline scrapers for every non-auth-gated custom-platform"
    echo "college BEFORE opening the PR. Deferring them creates drag —"
    echo "the user has to come back and re-investigate later."
    echo
    echo "Buildable TODOs from $RESULT_JSON:"
    echo "$BUILDABLE_TODOS" | /usr/bin/python3 -c 'import sys, json
for t in json.load(sys.stdin):
    print(f"  - {t}")'
    echo
    echo "Two ways to unblock:"
    echo "  1. Build the missing scrapers, commit them, retry gh pr create."
    echo "  2. If a TODO is genuinely deferred (e.g. takes >half a day, or"
    echo "     blocked by another investigation), add a commit with"
    echo "     subject 'DEFERRED-scrapers: <one-line reason>'. That"
    echo "     records the deferral explicitly in the commit log."
    echo
    echo "Do NOT bypass this hook. The whole point is preventing the"
    echo "exact failure mode of the 2026-05-24 AZ PR."
  } >&2
  exit 2
fi

exit 0
