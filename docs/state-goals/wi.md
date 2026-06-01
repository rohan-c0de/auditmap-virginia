# Wisconsin (wi) — state goals

> **Current tier: F** · Rank **#40 of 40** · Tranche: **LATER** · Impact 4/5 · Effort: hard · Value/effort: **L**
>
> Dimensions: `crs=D` `prq=F` `trf=F` `sc=A` `cfg=A`
>
> _F from prereqs (cheap aggregate fix), but courses 25% with 12 WTCS singletons each on a distinct custom platform (0 clusters) = a ~12-scraper greenfield slog._

## Diagnosis

- **Primary gap:** 12 of 16 WTCS colleges have no course data (25% coverage, D); prereqs F (no file) and transfers F (no portal) compound it. Config + scorecard are A.
- **Cheapest lever** (build-prereqs): Aggregate prereqs.json from on-disk data: parse prerequisite_text/prerequisite_courses already present in data/wi/coursedog-catalog/nicolet-area-technical-college.json + the 4 scraped course files; flips prereqs F (the composite limiter) without any scraping.
- **Effort:** hard — The 12 missing colleges are WTCS singletons each on a distinct custom platform (Drupal, CMC Portal ASP.NET, PHP, Colleague cloud) — clusters.json found 0 clusters, so each needs its own bespoke scraper (>half-day for the set). Transfers need articulation from scratch (no WI portal). Only prereqs is cheap.
- **Course colleges:** 12 buildable / 0 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: WTCS = 16 colleges, shared statewide course numbering. Built bespoke so far: CVTC (PHP coursesearch), Western (Colleague elluciancloud guest), NTC (Drupal faceted search), SWTC (CMC Portal). All 4 wired in config courses[]. No fingerprint-baseline entries for WI colleges (grep empty); clusters.json reports 0 clusters/15 singletons — no shared-endpoint shortcut, each remaining college is its own scraper. Course files carry prerequisite_text/prerequisite_courses fields but sampled values are null, so prereq yield may be thin; the Nicolet coursedog dump (467KB) is the richest prereq source and also seeds Nicolet's course data. Transfers: no documented ceiling set, but no articulation portal exists. Programs: 0 files, Phase 6 found no catalog platform.

## Goal checklist

### WI — current tier F (limited by prereqs)

- [ ] Build `data/wi/prereqs.json`: extractor over existing on-disk data — `data/wi/coursedog-catalog/nicolet-area-technical-college.json` (`prerequisite_text`/`prerequisite_courses`) + the 4 scraped course dirs (`data/wi/courses/*/2026FA.json`). Flips prereqs F→D/C, the composite limiter. (cheap)
- [ ] Wire prereqs: add a `prereqs` aggregator script to `lib/states/wi/config.ts scrapers` and remove the `// manual-only: prereqs` marker. (cheap)
- [ ] Ingest Nicolet courses from the coursedog dump → `data/wi/courses/nicolet-area-technical-college/` (1 more college, no scrape). (cheap)
- [ ] Build bespoke course scrapers for remaining WTCS colleges (each public, distinct platform): madison-area (madisoncollege.edu), fox-valley (fvtc.edu), gateway (gtc.edu), milwaukee-area (matc.edu), waukesha-county (wctc.edu), moraine-park, blackhawk, lakeshore, mid-state, northeast-wisconsin (nwtc.edu), northwood. Adapt scrape-ntc/swtc/cvtc templates; wire each in config. Target >=90% coverage. (hard, ~1 scraper each)
- [ ] Transfers: no WI articulation portal — investigate UW System / WTCS articulation or document as a ceiling. (hard)
- [ ] Programs: Phase 6 found no platform — defer or investigate WTCS program catalogs.

Definition of done: >=90% of 16 colleges have course data, prereqs.json present+wired, transfers built-or-ceilinged, config/scorecard stay A.
