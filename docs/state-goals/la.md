# Louisiana (la) — state goals

> **Current tier: B** · Rank **#6 of 40** · Tranche: **NOW** · Impact 3/5 · Effort: cheap · Value/effort: **H**
>
> Dimensions: `crs=B` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _Everything built/wired incl 5 aligned programs; record northshore (LoLA SSO) as a courses ceiling and 92% becomes A -> composite A._

## Diagnosis

- **Primary gap:** 11 of 12 colleges have full section-level course data; the lone gap (northshore-technical-community-college) is SSO-blocked (LoLA) for class sections — only its Coursedog catalog descriptions/prereqs are harvestable, which are already merged. Transfers/prereqs/config/scorecard all A.
- **Cheapest lever** (documented-ceiling-accept): Record northshore-technical-community-college as a documented courses ceiling (no public section endpoint; registration behind LoLA SSO — Coursedog catalog already harvested for prereqs), so the 92% courses coverage is ceiling-excused and the composite reflects A-tier reality.
- **Effort:** cheap — Everything is already built and wired (Banner SSB scraper for 11 colleges, Coursedog scraper + config wiring for the 12th, transfers, prereqs, 5 aligned program files). The only remaining 'gap' is northshore's section data, which has no public endpoint (registration behind LoLA SSO) — not buildable without scraping. The cheap action is documenting it as a ceiling so the audit excuses it.
- **Course colleges:** 0 buildable / 1 blocked (of the missing set)
- **Programs / planner:** 5 program files · aligned ✅ · planner-ready: yes
- **Shippable (B+) bar met:** yes ✅

> Notes: scripts/la/ already contains scrape-lctcs-banner-ssb.ts (11 colleges via shared reg-prod.ec.lctcs.edu MEP host), scrape-coursedog.ts (northshore catalog, wired in lib/states/la/config.ts:61), scrape-regents-matrix.ts (transfers), scrape-programs.ts. Northshore's scraper header explicitly notes it has no public class-section endpoint (LoLA SSO) and contributes 653 catalog courses to prereqs only. data/la/courses/ has 11 college subdirs; northshore has only data/la/coursedog-catalog/northshore-technical-community-college.json (653 desc/prereqs, no sections). All 5 program filenames (baton-rouge, fletcher, louisiana-delta, nunez, south-louisiana) are valid college_slug values in institutions.json → planner-visible. Audit documentedCeilings.courseColleges is empty, so northshore is currently penalizing the courses dim despite being a true SSO ceiling.

## Goal checklist

### LA — current tier B (limited only by courses; one SSO-blocked college)

- [ ] Mark `northshore-technical-community-college` as a documented courses ceiling in the audit/ceiling config (e.g. add to `documentedCeilings.courseColleges` for la): rationale = no public class-section endpoint, registration behind LoLA SSO; Coursedog catalog (653 courses) already harvested into `data/la/prereqs.json`. Reference scraper note in `scripts/la/scrape-coursedog.ts`.
- [ ] Re-run state-audit for la so the 92% courses coverage is ceiling-excused → courses dim lifts to A, composite → A.
- [ ] (Optional, GOLD polish) Extend program coverage beyond the 5 current colleges (baton-rouge, fletcher, louisiana-delta, nunez, south-louisiana) via `scripts/la/scrape-programs.ts` to widen planner coverage to all 11 section-bearing colleges. Confirm any new filenames equal `college_slug` from `data/la/institutions.json`.

Definition of done: la composite reads A with courses ceiling-documented; transfers/prereqs/config/scorecard remain A; the 5 existing programs stay planner-visible (filenames aligned).
