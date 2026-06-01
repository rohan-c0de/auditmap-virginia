# Minnesota (mn) — state goals

> **Current tier: B** · Rank **#7 of 40** · Tranche: **NOW** · Impact 3/5 · Effort: cheap · Value/effort: **H**
>
> Dimensions: `crs=B` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _26/28 courses, all else A, planner-ready; document the 2 independent tribal colleges as ceilings -> courses A, composite A. No scraping._

## Diagnosis

- **Primary gap:** 15 of 31 colleges have no course data; transfers/prereqs healthy
- **Cheapest lever** (documented-ceiling-accept): Mark leech-lake-tribal-college and red-lake-nation-college as documented course ceilings (independent tribal colleges, not in MinnState eservices ISRS, no public SIS) so the courses dimension is formally locked at A-equivalent.
- **Effort:** cheap — No scraping needed: courses already at 93% (>=90% bar), all other dimensions A. The only residual is formally documenting the 2 tribal colleges as ceilings so the courses dim is locked — a config/registry note edit, well under an hour. The scraper source already documents them as outside the central system.
- **Course colleges:** 0 buildable / 2 blocked (of the missing set)
- **Programs / planner:** 6 program files · aligned ✅ · planner-ready: yes
- **Shippable (B+) bar met:** yes ✅

> Notes: Tribal colleges have empty website fields in data/mn/institutions.json and no entry in data/state-health/fingerprint-baseline.json — no public course-search endpoint to scrape. scripts/mn/scrape-mn-eservices.ts header explicitly states "Tribal colleges (Leech Lake, Red Lake Nation) are NOT in this system." documentedCeilings.courseColleges is currently empty in the audit record, so the only action is to populate it. Note: ignore the schema's example primaryGap text ("15 of 31") — MN's real gap is 2 of 28.

## Goal checklist

### MN — current tier B (limited only by courses 93%, all other dims A)

MN is effectively at the finish line. 26/28 colleges have courses; the 2 gaps are independent tribal colleges with no public SIS.

- [ ] Document the 2 course ceilings: add `leech-lake-tribal-college` and `red-lake-nation-college` to MN's documented-ceiling list (the audit `documentedCeilings.courseColleges` is empty). Rationale: both are independent tribal colleges outside the MinnState eservices ISRS system (see header note in `scripts/mn/scrape-mn-eservices.ts`), have empty `website` fields in `data/mn/institutions.json`, and no entry in `data/state-health/fingerprint-baseline.json` — no public Banner/Colleague/CollegeScheduler endpoint exists to scrape.
- [ ] Re-run state-audit for mn to confirm courses promotes to A-equivalent once the 2 colleges are excused, lifting composite to A.
- [ ] (Optional, GOLD already met) Confirm planner: 6 programs in `data/mn/programs/` all filename-aligned to `college_slug`; prereqs 3313 clean — planner is ready, no action.

Definition of done: composite A with courses dimension passing on excused-ceiling basis; the 2 tribal colleges recorded as documented ceilings; no new scrapers required.
