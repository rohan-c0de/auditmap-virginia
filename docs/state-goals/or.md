# Oregon (or) — state goals

> **Current tier: C** · Rank **#37 of 40** · Tranche: **LATER** · Impact 4/5 · Effort: medium · Value/effort: **L**
>
> Dimensions: `crs=C` `prq=A` `trf=C` `sc=A` `cfg=A`
>
> _Courses a hard ceiling (all 8 missing SSO/staff-portal); document them, then the real mover is adding a 2nd transfer receiver (PSU/UO) for C->B._

## Diagnosis

- **Primary gap:** 8 of 17 colleges (47%) have no course data; all 8 are blocked (Clackamas Banner→Colleague SSO, Portland/mt-hood/rogue/umpqua auth-gated/unknown, southwestern+tillamook Jenzabar ICS staff portals, blue-mountain acalog catalog-only). Transfers thin at 1 university (OSU, 11,479 mappings). Prereqs/config/scorecard all A.
- **Cheapest lever** (build-course-scrapers): Add a 2nd transfer receiver (e.g. Portland State University or University of Oregon articulation) to lift transfers C→B; courses is a documented hard ceiling.
- **Effort:** medium — Course ceiling is hard (all 8 missing colleges are SSO/auth-gated/staff-portal — no public class-search endpoint; ~6 bespoke SSO scrapers needed for 90%). The realistic composite mover is transfers: lifting "thin: 1 university" to B needs ONE new articulation scraper for a 2nd receiver (Portland State or U of Oregon) — 1-4hr.
- **Course colleges:** 0 buildable / 8 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: scripts/or/ already has banner-ssb, colleague, columbia-gorge, klamath, oregon-coast, tvcc scrapers (9 colleges covered) + scrape-transfer-osu.ts (16/17 CCs → OSU). Banner header explicitly excludes Clackamas: "fingerprinted as Banner SSB but redirects to Colleague SSO". Jenzabar courseSearchUrls (socc/tillamook) point to ICS staff directories, not class search. blue-mountain is acalog (catalog descriptions, not live sections). No data/or/programs/ dir. Transfer receiver = OSU only (transfer-universities.json). Missing-college course coverage is effectively a documented ceiling but not yet recorded in documentedCeilings — recording it would let courses be excused.

## Goal checklist

### Oregon (or) — current tier C (limited by courses; courses ceiling is hard, transfers is the mover)

- [ ] **Document the course ceiling.** Add the 8 missing colleges to `documentedCeilings.courseColleges` with reasons: clackamas (Banner→Colleague SSO, per scrape-banner-ssb.ts header), portland/mt-hood/rogue/umpqua (auth-gated/unknown, no public class search), southwestern-oregon + tillamook-bay (Jenzabar ICS staff portal only), blue-mountain (acalog catalog, no live sections). This excuses courses and reframes composite. (cheap)
- [ ] **Lift transfers C→B (highest composite lever):** build a 2nd receiver scraper in `scripts/or/` — Portland State University or University of Oregon articulation — modeled on `scrape-transfer-osu.ts`; add the university to `data/or/transfer-universities.json`, append to `data/or/transfer-equiv.json`, and declare it in `StateConfig.scrapers.transfers`. (medium, 1-4hr)
- [ ] **(GOLD, optional)** Add programs via `scripts/lib/scrape-acalog-programs.ts` against blue-mountain acalog (catalog.bluecc.edu, catoid=13) + other CC catalogs; write `data/or/programs/<college_slug>.json` with filenames matching institutions.json college_slug so the planner sees them. (medium)

Definition of done: course ceiling documented (courses excused), a 2nd transfer university wired + cron-declared (transfers ≥ B), composite lifts to B.
