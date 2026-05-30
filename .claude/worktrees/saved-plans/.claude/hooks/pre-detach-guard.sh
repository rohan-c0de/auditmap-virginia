#!/usr/bin/env bash
# PreToolUse hook: blocks Bash invocations of known long-running scripts
# (orchestrators, full-state scrapers) when run_in_background=true UNLESS
# the command is wrapped in the macOS double-fork detach pattern
# `( nohup ... & )` so the child reparents to init (PPID=1) and survives
# session archival.
#
# Why: Claude Code session archive kills child processes of the session
# shell. We have lost two multi-hour runs this way (LACCD scrape, AZ
# auto-add-state). The pattern is documented in memory
# `feedback_detach_long_running` but model self-discipline has not been
# enough. This hook makes it impossible to forget.
#
# Exit codes:
#   0 → allow
#   2 → block (stderr shown to the model)
#
# Reads JSON payload on stdin:
#   {"tool_name":"Bash",
#    "tool_input":{"command":"...","run_in_background":true,...}}

set -euo pipefail

PAYLOAD=$(cat)

# Extract command + run_in_background flag from the tool_input.
PARSED=$(echo "$PAYLOAD" | /usr/bin/python3 -c '
import sys, json
p = json.load(sys.stdin).get("tool_input", {})
cmd = (p.get("command", "") or "").replace("\n", " ")
rib = "true" if p.get("run_in_background") else "false"
print(cmd + "\t" + rib)
' 2>/dev/null || echo $'\tfalse')

# Tab-separated split — use IFS=tab so the command (which contains spaces)
# stays intact.
IFS=$'\t' read -r CMD RIB <<< "$PARSED"

# Only care about backgrounded commands.
[ "$RIB" = "true" ] || exit 0

# Patterns considered "long-running" — any match triggers the guard.
# Conservative on purpose: false positives just nudge me to detach, which
# is always safe. Update this list when adding new long-running scripts.
LONG_RUNNING_PATTERNS=(
  'scripts/lib/add-state\.ts'             # auto-add-state orchestrator
  'scripts/lib/scrape-banner-ssb\.ts'     # full-state Banner SSB scrape
  'scripts/lib/scrape-colleague\.ts'      # full-state Colleague scrape
  'scripts/lib/scrape-banner-8\.ts'       # full-state Banner 8 scrape
  'scripts/lib/scrape-jenzabar\.ts'       # full-state Jenzabar scrape
  'scripts/lib/scrape-coursedog\.ts'      # full-state Coursedog catalog scrape
  'scripts/ca/scrape-laccd\.ts'           # 9-college LACCD scrape (>1h)
  'scripts/[a-z]+/scrape-peoplesoft\.ts'  # any state's PeopleSoft scrape
  'scripts/[a-z]+/scrape-programs\.ts'    # state-wide programs scrape
  'scripts/[a-z]+/scrape-catalog-prereqs\.ts'  # state-wide catalog prereqs
  'scripts/[a-z]+/scrape-all'             # any per-state all-college runner
  'scripts/[a-z]+/scrape-mccs\.ts'        # MCCS multi-college Playwright run
  'scrape-transfer-all\.ts'               # multi-university transfer runs
)

is_long_running=false
for pat in "${LONG_RUNNING_PATTERNS[@]}"; do
  if echo "$CMD" | grep -qE "$pat"; then
    is_long_running=true
    matched_pattern="$pat"
    break
  fi
done

[ "$is_long_running" = "true" ] || exit 0

# Allow if the command is already wrapped in the double-fork detach
# pattern: `( nohup ... & )` (with optional whitespace). Also accept
# `setsid` (Linux equivalent) for forward-compat. The key signal is that
# the long-running invocation is inside a subshell with a trailing `&`.
if echo "$CMD" | grep -qE '\(\s*nohup .* & *\)' \
   || echo "$CMD" | grep -qE 'setsid '; then
  exit 0
fi

# Allow quick checks like `pgrep`, `tail`, `cat`, `ls` even if their
# argument string happens to contain a long-running script name.
if echo "$CMD" | grep -qE '^(pgrep|pkill|tail|head|cat|ls|wc|grep|stat|test|jq|md5)\b'; then
  exit 0
fi

cat >&2 <<EOF
BLOCKED — \`run_in_background: true\` on a long-running script ('$matched_pattern')
without the double-fork detach pattern.

Bash run_in_background is capped at 10 min and its children are killed
on session archive. The AZ auto-add-state run died this way at Phase 2a
on 2026-05-24 (memory: feedback_detach_long_running).

Re-issue the command in this exact form:

    ( nohup <your-command> > /tmp/<task>.log 2>&1 < /dev/null & )

…then verify PPID=1 with: ps -o pid,ppid -p <pid>

For checks/polls of the detached process (pgrep, tail, jq on the log),
use normal foreground Bash — those are not long-running.
EOF
exit 2
