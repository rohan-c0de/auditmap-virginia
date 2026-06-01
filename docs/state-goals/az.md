# Arizona (az) — state goals

> **Current tier: C** · Rank **#4 of 40** · Tranche: **NOW** · Impact 5/5 · Effort: cheap · Value/effort: **H**
>
> Dimensions: `crs=C` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _Large state; AWC re-run (transient 502) + central-AZ coursedog lands courses ~95% with tohono-oodham as documented ceiling -> composite A-/A._

## Diagnosis

- **Primary gap:** Courses at 84% (16/19 system colleges); transfers (3 unis/31k mappings), prereqs (2788, clean), config, scorecard all A. 2 of 3 missing colleges are buildable, 1 is a documented ceiling.
- **Cheapest lever** (wire-existing-scraper): Re-run scripts/az/scrape-colleague.ts --college arizona-western-college (transient 502 at last run; scraper already wired) to land AWC course data, then add central-arizona-college via a coursedog course scrape.
- **Effort:** cheap — AWC already has a wired Colleague scraper (scripts/az/scrape-colleague.ts, host colss-prod.ec.azwestern.edu) that only failed on a transient 502 — re-run, no new code. central-arizona-college is public coursedog (catalog.centralaz.edu) with a reusable template (scripts/lib/scrape-coursedog.ts) and catalog data already on disk. Landing both takes courses to ~95%, clearing the 90% bar. No SSO/CAPTCHA blockers.
- **Course colleges:** 2 buildable / 1 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** yes ✅

> Notes: composite C, limitedBy courses only. tohono-oodham-community-college (jenzabar behind my.tocc.edu ICS login, tiny tribal college) is already in documentedCeilings.courseColleges — accept. No data/az/programs/ dir exists, so planner is not GOLD; that's the only thing between B+ and A-tier. central-az coursedog json on disk is catalog/program data (no sections), so a real course-section scrape is still needed for that college.

## Goal checklist

### AZ — current tier C (limited only by courses; transfers/prereqs/config/scorecard all A)

- [ ] Re-run the already-wired Colleague scraper for Arizona Western (transient 502 last time): `npx tsx scripts/az/scrape-colleague.ts --college arizona-western-college` (host colss-prod.ec.azwestern.edu). Confirm data lands in `data/az/courses/arizona-western-college/`.
- [ ] Add central-arizona-college course sections via coursedog: adapt `scripts/lib/scrape-coursedog.ts` for `catalog.centralaz.edu` (catalog data already at `data/az/coursedog-catalog/central-arizona-college.json`, 913/1412 have credits). Wire into a new `scripts/az/scrape-coursedog-courses.ts` and declare in `StateConfig.scrapers`.
- [ ] Verify courses coverage: 18/19 ≈ 95% (tohono-oodham excused as documented ceiling) → courses clears 90% → composite A-/A.
- [ ] Pre-PR check: load `/az`, search a course at AWC and Central AZ, confirm sections render.
- [ ] (A-tier extra, optional) Create `data/az/programs/` aligned to institutions.json college_slug values to unlock the degree-path planner — currently 0 program files.

Definition of done: AWC + Central AZ course data present and wired; courses ≥90% with tohono-oodham as documented ceiling; composite lifts to A-/A.
