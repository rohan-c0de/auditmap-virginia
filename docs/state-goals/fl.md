# Florida (fl) — state goals

> **Current tier: B** · Rank **#13 of 40** · Tranche: **NOW** · Impact 5/5 · Effort: cheap · Value/effort: **H**
>
> Dimensions: `crs=B` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _Huge state already at 93%; wire fscj's on-disk 2,963-course catalog + document pensacolastate Workday ceiling -> courses A, composite A._

## Diagnosis

- **Primary gap:** 2 of 28 colleges lack section data (93% coverage); fscj has a 2,963-course Coursedog catalog already scraped to data/fl/coursedog-catalog/fscj.json but it's not wired as fscj's course source; pensacolastate is Workday-only (blocked). Transfers/prereqs/config/scorecard all A.
- **Cheapest lever** (wire-existing-scraper): Wire the already-scraped data/fl/coursedog-catalog/fscj.json as fscj's course source so it counts toward coverage (96%), and document pensacolastate (Workday) as a ceiling.
- **Effort:** cheap — FSCJ's full course catalog is already on disk (data/fl/coursedog-catalog/fscj.json, 2,963 courses scraped via existing scripts/fl/scrape-coursedog.ts). Surfacing it as fscj's per-college course list — exactly the "fallback course list" the scraper header documents — lifts coverage 26/28→27/28 (96%) with no new scraping. Pensacolastate (Workday SPA, no public guest endpoint) is a genuine ceiling, not worth chasing.
- **Course colleges:** 1 buildable / 1 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** yes ✅

> Notes: Composite already B; courses 93% already clears the >=90% B+ shippable bar. Transfers A (12 univ, 5240 mappings, wired), prereqs A (2225 entries, clean, wired), config A, scorecard 28/28. The only two missing colleges: fscj (coursedog, public catalog already on disk) and pensacolastate (workday, blocked). Programs absent (manualOnly: "programs — Phase 5+") so planner not reachable — GOLD-tier only, not a finish-line blocker.

## Goal checklist

### FL — current tier B (limited by courses, 93%)

FL already clears the B+ shippable bar (courses >=90%; transfers/prereqs/config/scorecard all A). These lift it toward A:

- [ ] Wire fscj's already-scraped catalog: `data/fl/coursedog-catalog/fscj.json` (2,963 courses, no sections) is the documented "fallback course list" from `scripts/fl/scrape-coursedog.ts`. Surface it as fscj's per-college course source so it counts toward coverage → 27/28 = 96%. No new scraping needed.
- [ ] Document pensacolastate as a ceiling: platform `workday` (`wd501.myworkday.com/pensacolastate/...`), SPA/SSO, no public guest course search. Add to documentedCeilings.courseColleges with reason "Workday Student, no public class search". This excuses it from coverage → effective 27/27 = 100%.
- [ ] (GOLD-tier, optional) Programs: none on disk (`data/fl/programs/` absent; manualOnly "programs — Phase 5+"). Scrape FL program/degree plans, name files to match `college_slug` in `data/fl/institutions.json`, to make the degree-path planner see FL. Medium effort; not required for A.

Definition of done: fscj catalog wired as a course source (coverage >=96%) and pensacolastate recorded as a documented Workday ceiling, lifting courses to A and the FL composite to A.
