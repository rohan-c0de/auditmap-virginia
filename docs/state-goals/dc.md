# DC (dc) — state goals

> **Current tier: B** · Rank **#11 of 40** · Tranche: **NOW** · Impact 1/5 · Effort: cheap · Value/effort: **H**
>
> Dimensions: `crs=A` `prq=A` `trf=B` `sc=A` `cfg=A`
>
> _Single college, all dims A except transfers which is an in-state-rule ceiling (no in-jurisdiction receiver) — already at finish line, just confirm ceiling._

## Diagnosis

- **Primary gap:** Transfers empty (B) by documented ceiling: UDC's 1,400+ CollegeTransfer.Net equivalencies all target out-of-state schools and are stripped by the in-state-only rule; DC has no in-state CC→4yr articulation pipeline. Courses/prereqs/scorecard/config all A. No programs dir (planner not gold-ready).
- **Cheapest lever** (documented-ceiling-accept): Accept transfers ceiling — state is already at its B finish line; optionally wire Acalog programs scraper for udc-cc for planner visibility (gold extra).
- **Effort:** cheap — The only B-dimension (transfers) is an accepted documented ceiling — no work moves it. The single shippable-affecting gap is closed. The lone optional lever is wiring an Acalog programs scraper for udc-cc (GOLD-tier extra), which is a medium one-scraper task but does not raise the composite past B's ceiling. Nothing cheap-or-otherwise lifts composite here.
- **Course colleges:** 0 buildable / 0 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** yes ✅

> Notes: DC has exactly 1 community college (udc-cc / UDC-CC). Composite B is structurally capped: the in-state-only transfer rule (a hard project invariant) zeroes out the only available articulation data because DC's lone university receiver is out-of-jurisdiction relative to the in-state filter. This is correctly recorded in ceilingsApplied and documentedCeilings. Do not attempt to re-add the stripped CollegeTransfer.Net rows. No course gaps (missing[]=[]). No programs directory exists.

## Goal checklist

### DC — current tier B (at documented ceiling, shippable)

DC is a single-college district (udc-cc). Courses A (1/1, terms clean), prereqs A (510 entries, wired, clean), scorecard A (1/1), config A (all fields populated). The only sub-A dimension is transfers, and it is a genuine ceiling — UDC's 1,400+ CollegeTransfer.Net equivalencies all target out-of-state receivers, which the in-state-only rule correctly strips to empty. There is no in-state CC→4yr articulation pipeline to wire.

- [x] Courses — udc-cc covered, terms clean (no action)
- [x] Prereqs — 510 entries wired and clean (no action)
- [x] Config — seniorWaiver/branding/popularCourses all populated (no action)
- [x] Transfers — accept documented ceiling; do NOT re-pitch (no in-state receiver exists; `transferSupported=false` comment in `lib/states/dc/config.ts` documents this)
- [ ] OPTIONAL (gold/planner extra, not required for shippable): wire an Acalog program scraper for udc-cc — create `data/dc/programs/`, write `scripts/dc/scrape-programs.ts`, name output file `udc-cc.json` to match `institutions.json` college_slug, declare in `StateConfig.scrapers`. Per audit manualOnly: "Acalog program scraper not yet wired up for this state."

Definition of done: B finish line is already met (courses+prereqs+config+scorecard all A, transfers accepted as documented ceiling). No further work needed to ship; programs scraper is the only path to A and is purely optional.
