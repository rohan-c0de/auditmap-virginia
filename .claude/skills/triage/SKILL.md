# /triage — GitHub Issue Triage Skill

Audit all open GitHub issues against the codebase and recent activity, then propose a triage plan and wait for confirmation before executing any writes.

## Steps

### 1. Gather data (parallel)
- `mcp__github__list_issues` — all open issues, state=OPEN, limit 100
- `mcp__github__list_pull_requests` — recent merged PRs (state=closed, sort=updated, limit 100)
- `mcp__github__list_commits` — recent commits (since 60 days ago)

Parse large results via subagent (Bash python3 slicing in ~80,000-char spans).

### 2. Cross-reference each issue

For every open issue:

**Skip silently** if it carries any of these labels: `automated`, `scraper-health`, `config-health`, `triage`, `coverage-expansion`, `state-health-rollup`. These are intentionally long-lived monitors.

**Close as stale** if it is a one-time regression alert (title matches "Scheduled * scrape: * regression") AND it was filed more than 14 days ago. Ongoing health is tracked by the automated scraper-health monitor issues.

**Close as resolved** if a merged PR or commit message explicitly references this issue number (closes #N, fixes #N, resolves #N) OR if the codebase check (Glob/Grep/Read on relevant files) shows the problem is demonstrably gone.

**Comment (partial)** if part of the issue is done (e.g., some states added but not all) — note what's done and what remains.

**Skip silently** if the issue is still fully open with no codebase evidence of progress.

### 3. Produce a proposal table — STOP HERE, wait for confirmation

Print a markdown table:

| Issue | Title | Action | Reason |
|-------|-------|--------|--------|
| #NNN | … | CLOSE / COMMENT / SKIP | one-line evidence |

Then say: **"Ready to execute. Reply 'go' to apply these changes, or edit the table first."**

Do NOT call `mcp__github__issue_write` or `mcp__github__add_issue_comment` until the user confirms.

### 4. Execute (after confirmation only)

For each CLOSE:
1. `mcp__github__add_issue_comment` — explain what resolved it (cite PR # or commit SHA)
2. `mcp__github__issue_write` — state=closed, state_reason=completed (resolved) or not_planned (stale)

For each COMMENT:
1. `mcp__github__add_issue_comment` — summarize what's done and what remains

Run all actions in parallel where possible.

### 5. Print final summary

| Issue | Action taken | Comment posted |
|-------|-------------|----------------|

## Triage criteria reference

| Category | Rule |
|----------|------|
| Automated monitors | Always skip (#671, #595, #585, #474, #124, #123, #1037 and any with automated/scraper-health labels) |
| Stale regression alerts | Close if >14 days old — duplicates tracked by newer auto issues |
| Prod health incidents | Close if codebase/data shows the symptom is gone |
| Feature/enhancement | Close only if a merged PR explicitly resolves it AND codebase confirms |
| Partial progress | Comment with "X of Y done, Z remains" — never close partial |
| No evidence | Skip silently |
