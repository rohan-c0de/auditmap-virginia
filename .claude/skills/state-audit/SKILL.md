---
name: state-audit
description: Deep quality audit of state data completeness and correctness. Use when the user asks to audit states, check data quality, assess readiness, find gaps, or grade state completeness (e.g. "/state-audit", "/state-audit ny", "audit all states", "is Ohio ready?", "what's missing in TN?", "grade the states"). Also use proactively before adding a new state — audit the existing backlog first to ensure quality over quantity.
---

# state-audit

Performs a deep quality audit of one or all states in the registry. The key insight this skill encodes: **checking that a file exists with >0 entries is not an audit** — you must check data *quality* (HTML contamination in prereqs, transfer university breadth, term freshness, college coverage gaps, scraper automation).

## Workflow

### 1. Collect raw data

Run the bundled collector script. It reads every state's data files and config, outputting structured JSON with all 7 audit dimensions pre-computed:

```bash
npx tsx .claude/skills/state-audit/scripts/collect-audit-data.ts [state-slug]
```

- No argument → audits all states in the registry
- With argument → audits just that state (e.g. `ny`)

The script outputs JSON to stdout. Capture it for grading.

### 2. Grade each state

Apply these grading criteria to each state's collected data. The grades reflect how a real student would experience the state — not how the developer feels about it.

#### Grade A — Fully complete
All 7 dimensions green:
- Course coverage: `coveredColleges == collegeCount` (100%)
- Prereqs: exists, >0 entries, no HTML contamination, scraper wired
- Transfers: exists, >0 entries, `transferSupported: true`, scraper wired, university count appropriate for state size (1 is fine for single-university states like VT; not fine for states with 5+ public universities)
- Scorecard: files match `collegeCount`
- All scrapers declared (no `manual-only` for courses/prereqs/transfers)
- Config: `seniorWaiver` populated, `popularCourses` non-empty, branding complete
- Terms: current (within 2 semesters), no suspicious non-credit terms

#### Grade B — Nearly complete
One minor gap. Examples of "minor":
- `popularCourses` empty (config-only fix)
- 1 college missing out of many (>90% coverage)
- Stale term files lingering alongside current ones
- Scorecard missing for 1 college

#### Grade C — Functional but gaps
Structural gaps that affect the user experience:
- Transfers or prereqs missing/empty
- Multiple colleges without course data (but >50% covered)
- All scrapers `manual-only` (no automated freshness)
- `seniorWaiver: null` in a state that has a waiver program

#### Grade D — Skeleton
Bootstrap done but major data missing:
- Courses for <50% of colleges
- No transfers AND no prereqs
- Multiple config fields placeholder/null

#### Grade F — Broken
Nearly non-functional:
- <15% course coverage
- Empty prereqs file
- Core data files missing or broken

### 3. Format the report

Output one line per state, sorted by tier then alphabetically:

```
{state} [{tier}] — {one-sentence summary of what's missing or "all green"}
```

End with a summary table:

```
| Tier | Count | States |
|------|-------|--------|
| A    | 3     | de, ri, vt |
| B    | 7     | ct, ga, nc, nh, nv, ny, tn |
...
```

### 4. Cross-cutting issues

After the per-state report, call out patterns that affect multiple states:
- How many states have empty `popularCourses`?
- How many have `seniorWaiver: null`?
- How many have zero transfer data?
- How many have `manual-only` scrapers?
- Any missing scorecard directories?

These are the systemic issues worth batch-fixing.

## Quality checks the script performs

These are the specific checks that distinguish a deep audit from a surface-level one:

| Dimension | Surface check (bad) | Quality check (good) |
|-----------|-------------------|---------------------|
| Prereqs | File exists, >0 entries | Sample for `<` in text (HTML contamination), check `courses[]` populated |
| Transfers | File exists, >0 entries | Count distinct universities, flag 1-uni states that should have more |
| Courses | Directory exists | Compare vs `collegeCount`, check term freshness, flag `credits: 0` |
| Scrapers | Config has `scrapers` key | Check for `// manual-only` comments = no cron automation |
| Config | Fields exist | Check for null/placeholder values, empty arrays |
| Terms | Files exist | Flag >2 semesters old, flag >1 year future |

## Interpreting results

When presenting to the user, be specific about what's actionable:
- **Quick wins** (5-15 min): empty `popularCourses`, missing `defaultZip`
- **Medium effort** (1-2 hr): 1 missing college, HTML cleanup in prereqs, stale term purge
- **Heavy lift** (3+ hr): missing transfer scraper, multiple colleges need bespoke scrapers
- **Blocked**: auth-gated colleges, no public articulation portal

Suggest a prioritized fix order: quick wins first, then B→A transitions, then C→B.
