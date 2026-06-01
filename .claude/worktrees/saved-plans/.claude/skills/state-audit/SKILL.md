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
npx tsx .claude/skills/state-audit/scripts/collect-audit-data.ts [state-slug] [--check-prod]
```

- No positional arg → audits all states in the registry
- With positional arg → audits just that state (e.g. `ny`)
- `--check-prod` → for each college with non-empty local data, hits the
  prod page at `communitycollegepath.com/{state}/college/{slug}` and
  counts unique course-code mentions in the rendered HTML. Pages with
  Supabase data have hundreds of matches; pages where the Supabase
  import skipped the college have 0. Populates `prodCoverage` on each
  state's result. **Slow** (~2s per college serial, polite to the CDN)
  — typical state takes 10–30s, NC's 58 colleges ~2 min, CA's 35
  ~70s. Skip the flag unless you're investigating an import gap.

The script outputs JSON to stdout. Capture it for grading.

**When to use `--check-prod`:** the default audit checks on-disk
data only. It will count SCKTC as "covered" if `data/ky/courses/
southcentral-kentucky-community-and-technical-college/*.json` files
exist, even if Supabase has zero rows and the prod page shows nothing.
If a user reports "this college page is empty on the live site" or
you're auditing the gap between "we shipped data" and "users can
see it", add `--check-prod` and inspect `prodCoverage.missingOnProd`
per state.

### 2. Grade each state

**Grades are computed by the collector, not by you.** Each state in the output JSON has a `grades` block with five per-dimension grades plus a composite. Your job in this phase is to *read* the grades and surface them clearly to the user — not to re-derive them from the raw counts.

Each state's `grades` block looks like:

```jsonc
"grades": {
  "courses":   { "grade": "A", "reason": "full coverage (23/23), terms clean" },
  "prereqs":   { "grade": "A", "reason": "374 entries, wired, clean" },
  "transfers": { "grade": "D", "reason": "data exists (15483) but scraper not wired — will go stale" },
  "scorecard": { "grade": "A", "reason": "23/23 scorecards" },
  "config":    { "grade": "A", "reason": "all config fields populated" },
  "composite": "D",
  "limitedBy": "transfers",
  "ceilingsApplied": []
}
```

**Composite = worst of the five dimensions.** `limitedBy` names the dimension that produced the composite, so the next fix is always obvious. A state can't earn an A composite while any single dimension is in the gutter.

**Per-dimension thresholds** (encoded in `collect-audit-data.ts`, summarized here):

| Dim | A | B | C | D | F |
|---|---|---|---|---|---|
| courses | ≥95% coverage, terms clean | ≥85% OR 1 minor issue | ≥50% | ≥15% | <15% |
| prereqs | ≥100 entries, no HTML, wired | ≥10 entries, no HTML | HTML contamination OR <10 entries | file empty | no file |
| transfers | ≥3 universities AND ≥1000 mappings AND wired | ≥2 universities AND ≥500 mappings AND wired | 1 university OR <500 mappings (wired) | data exists but not wired | no data, no ceiling |
| scorecard | full coverage | ≥80% | ≥50% | <50% | no directory |
| config | all fields populated | 1 gap | 2 gaps | seniorWaiver placeholder | 4+ gaps |

**Documented ceilings exempt up to B floor.** When a state declares `StateConfig.documentedCeilings.transfers` (e.g. NH: "UNH publishes no public articulation database"), the transfers dimension is capped at B — it can still earn an A on real merit, but it can't drop below B for the documented reason. Same rule for `scorecard`. For `courses`, the documented-college slugs are removed from the coverage denominator. The `ceilingsApplied` array records which exemptions were active.

When the data legitimately shifts a grade, update the expected values in `grade-snapshot.test.ts` in the same commit with a one-line justification.

### 3. Format the report

Output one line per state, sorted by composite tier then alphabetically:

```
{state} [{composite}] — limited by {limitedBy}: {reason}  | dims: crs={A} prq={A} trf={D} sc={A} cfg={A}
```

End with a tier-distribution table:

```
| Tier | Count | States |
|------|-------|--------|
| A    | 9     | ct, de, ga, ky, me, nc, nv, ny, tn |
| B    | 5     | al, dc, nh, ri, sc |
...
```

Call out any state where `ceilingsApplied` is non-empty so reviewers know which exemptions are active and *why*.

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

The composite + `limitedBy` tells you *what* to fix; effort estimation is your call. When presenting to the user, group findings by `limitedBy`:

- **`limitedBy: courses`** — usually heavy: a college needs a bespoke scraper, a Banner SSB host is down, or the SIS is auth-gated. Quick fixes are rare here.
- **`limitedBy: transfers`** — split by reason:
  - "not wired" → config-only edit (~5 min per state); wire the existing script to `scrapers.transfers`. Validate the script runs first.
  - "thin: 1 university" → medium-to-heavy: find a state portal or write a second university scraper.
  - "no transfer data" → heavy: investigate the state's articulation infrastructure from scratch.
- **`limitedBy: prereqs`** — usually HTML contamination (medium: regex cleanup pass) or empty file (heavy: need an extractor pass).
- **`limitedBy: scorecard`** — light: re-run the scorecard fetcher.
- **`limitedBy: config`** — quick wins: `popularCourses`, `defaultZip`, branding fields are all 1-5 min config edits.

Suggest a prioritized fix order by impact-per-hour: quick `config`/`scorecard` wins first if any, then validated `transfers` cron-wirings, then targeted `courses` gap-fills. Avoid bundling unrelated fixes across states into one PR — each state is its own change.

Ceiling exemptions (`ceilingsApplied`) are not bugs and shouldn't be presented as gaps to fix.
