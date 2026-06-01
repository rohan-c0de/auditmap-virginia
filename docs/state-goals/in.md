# Indiana (in) — state goals

> **Current tier: F** · Rank **#17 of 40** · Tranche: **NEXT** · Impact 3/5 · Effort: medium · Value/effort: **H**
>
> Dimensions: `crs=A` `prq=A` `trf=F` `sc=A` `cfg=A`
>
> _Single-college (Ivy Tech), all dims A except empty transfers; build one TransferIN/Core Transfer Library scraper (portal exists) -> F->A._

## Diagnosis

- **Primary gap:** Transfers is the sole blocker (composite F): 0 mappings, 0 universities, not wired, no documented ceiling. Courses/prereqs/config/scorecard are all A. No programs dir → planner can't see IN.
- **Cheapest lever** (build-prereqs): Build a TransferIN / Core Transfer Library scraper (in.gov/che wpdatatables source) for Ivy Tech → 4-year equivalencies, write data/in/transfer-equiv.json, set transferSupported:true, and declare scrapers.transfers — lifts composite F→A.
- **Effort:** medium — One single-college state; everything is A except transfers. The lift is one new statewide articulation scraper for Indiana's Core Transfer Library / TransferIN (in.gov/che), delivered as an SPA / wpdatatables-backed table. No existing scraper to wire — must investigate the data endpoint and build it, but it's one source not 50 colleges. Squarely 1-4hr.
- **Course colleges:** 0 buildable / 0 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: leverCategory is the closest enum match ("build" a missing dataset = transfers here; no transfers-specific option exists). IN has 1 college (Ivy Tech, 22 campuses, one CollegeScheduler GraphQL scrape). transfer-equiv.json is literally []. Statewide articulation DOES exist (Core Transfer Library / TransferIN) so transfers is NOT a documented ceiling — it's buildable, just unbuilt. Existing transfer-scraper templates in scripts/al, scripts/az (aztransfer), scripts/ar (acalog/acts) are good adaptation references for a statewide-portal scrape. Config dim is A in the audit, though institutions.json audit_policy still has unverified placeholder text (separate, lower-priority cleanup).

## Goal checklist

### IN (Indiana) — current tier F (blocked solely by transfers)

Single-college state: Ivy Tech (22 campuses, one CollegeScheduler scrape). Courses/prereqs/config/scorecard already A. transfer-equiv.json is `[]`.

- [ ] Investigate Indiana's Core Transfer Library / TransferIN at in.gov/che — it's an SPA / wpdatatables-backed table. Find the underlying JSON/AJAX endpoint (wpdatatables typically exposes an `admin-ajax.php?action=get_wdtable` call) or a downloadable dataset. Confirm in-state targets only (IU, Purdue, Ball State, ISU, etc.).
- [ ] Build `scripts/in/scrape-transfer-ctl.ts`, adapting `scripts/az/scrape-transfer-aztransfer.ts` (statewide-portal pattern). Map Ivy Tech course → 4-year equivalency. Drop any out-of-state targets (in-state-transfers-only rule).
- [ ] Write `data/in/transfer-equiv.json` with non-trivial mappings across ≥1 (ideally several) Indiana universities.
- [ ] In `lib/states/in/config.ts`: set `transferSupported: true`, add `scrapers.transfers: [{ scripts: ["scripts/in/scrape-transfer-ctl.ts"], runner: "http" }]`, remove the `manual-only: transfers` marker.
- [ ] Verify locally: load `/in/transfer`, pick Ivy Tech + a course, confirm equivalency renders.
- [ ] (Optional A→GOLD) Add `data/in/programs/` from catalog.ivytech.edu (Acalog) for planner visibility.

Definition of done: `data/in/transfer-equiv.json` has ≥1 in-state university target with real mappings, transfers wired in config, `/in/transfer` renders an equivalency — composite F→A.
