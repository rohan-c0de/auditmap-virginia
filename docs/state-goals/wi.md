# Wisconsin (wi) — state goals

> **Current tier: F** (the registry's only F) · Limited by: **prereqs** · _Refreshed 2026-06-22_
>
> Dimensions: `crs=D` `prq=F` `trf=C` `sc=A` `cfg=A`
>
> _F solely because `data/wi/prereqs.json` doesn't exist. Aggregating prerequisite text already on disk (no scraping) clears the F → D. Courses 25% (12 WTCS singletons on distinct custom platforms) is a separate ~12-scraper slog, out of scope for the cheap fix._

## Diagnosis

- **Primary gap:** prereqs F (no file) is the composite limiter. Courses D (4/16), transfers C (1 uni). Config + scorecard A.
- **Cheapest lever** (aggregate prereqs from on-disk data): set `prereqs: { source: "aggregate-from-courses" }` in `lib/states/wi/config.ts` (replacing the `// manual-only: prereqs` marker, ~line 91), then run `npx tsx scripts/lib/aggregate-prereqs.ts wi`. The aggregator reads `data/wi/coursedog-catalog/nicolet-area-technical-college.json` (~11 courses carry prereq text) + the 4 scraped course dirs (whose prereq fields are null), sanitizes via `scripts/lib/prereq-sanitize.ts`, and writes `data/wi/prereqs.json`. Auto-included in the Sunday prereq cron via `scripts/lib/scraper-matrix.ts`.
- **Expected outcome (honest):** ~11 entries → prereqs F→B (≥10, wired, clean) → composite F→**D** (courses becomes the limiter). Coverage is thin (only Nicolet has prereq text) — name it. This clears the worst tier cheaply.
- **Effort:** cheap (one config line + an aggregator run). The courses slog (12 WTCS bespoke scrapers, 0 clusters) and transfers depth are separate, hard, deferred.
- **Course colleges:** 4 covered / 12 bespoke-buildable (each a distinct custom platform).
- **Programs / planner:** 0 program files (A-tier extra only).

## Goal checklist

### WI — current tier F (limited by prereqs; cheap aggregation fix)

- [ ] Pre-flight: `WT=$(scripts/new-pr-worktree.sh wi-prereqs); cd "$WT"`.
- [ ] In `lib/states/wi/config.ts`, replace the `// manual-only: prereqs` comment with `prereqs: { source: "aggregate-from-courses" },` inside `scrapers` (copy the VA pattern in `lib/states/va/config.ts`).
- [ ] Run `npx tsx scripts/lib/aggregate-prereqs.ts wi` → writes `data/wi/prereqs.json` (~11 entries).
- [ ] Verify: `jq 'length' data/wi/prereqs.json` (~11) and `grep -c '<' data/wi/prereqs.json` (expect 0 — no HTML). Re-run the collector for wi → prereqs B, composite D. State the thin-coverage caveat honestly; if <10 entries it stays C.
- [ ] `npm run build` (the JSON must load via `lib/prereqs.ts loadPrereqs`).
- [ ] PR (branch `claude/wi-prereqs`): plain-English first ("Wisconsin now has prerequisite data — ~11 courses from Nicolet's catalog — clearing it off the F tier; the remaining gap is course coverage"). Stage only `lib/states/wi/config.ts` + `data/wi/prereqs.json`. DO NOT MERGE — stop for review.
- [ ] (Separate, hard, deferred) The 12 missing WTCS colleges (madison-area, fox-valley, gateway, milwaukee-area, waukesha-county, …) each need a bespoke scraper — a multi-day greenfield effort, NOT this PR.

Definition of done: `data/wi/prereqs.json` present + wired + clean (~11 entries); composite F→D; courses slog explicitly deferred; no placeholder data.
