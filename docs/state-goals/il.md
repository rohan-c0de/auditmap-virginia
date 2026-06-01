# Illinois (il) — state goals

> **Current tier: C** · Rank **#38 of 40** · Tranche: **LATER** · Impact 5/5 · Effort: hard · Value/effort: **L**
>
> Dimensions: `crs=C` `prq=A` `trf=B` `sc=B` `cfg=A`
>
> _Large state but most of 19 missing colleges are Jenzabar/SSO/custom-blocked; only elgin re-run is cheap — 90% unreachable, ceiling-document to ship at B._

## Diagnosis

- **Primary gap:** 19 of 48 colleges have no course data (60% coverage, grade C); prereqs (A, clean+wired), transfers (B, 2 universities/53,969 mappings/wired), config (A), scorecard (B) all healthy. Courses is the sole limiter.
- **Cheapest lever** (build-course-scrapers): Re-run scripts/il/scrape-colleague.ts to capture elgin-community-college (already in HOSTS) and probe Ellucian-Cloud/Banner subdomains for the missing singletons (per the colss-prod.ec.* / selfservice.* memory pattern) to convert "unknown" verdicts before accepting the ceiling.
- **Effort:** hard — Reaching 90% (44/48) needs ~15 more colleges. The config comment documents the remainder: 4 Jenzabar colleges (john-a-logan, richland, southeastern-illinois, spoon-river) are auth-gated; the Ellucian experience.elluciancloud.com cluster is SSO-gated; lake-county/rend-lake "Coursedog" hits were false positives (CMS/events calendar); rest are bespoke PDF/custom-CMS. Only elgin (and maybe rock-valley) are already wired in scrape-colleague.ts but produce no live data yet. Most missing colleges are blocked, so closing the gap is a multi-college bespoke-scraper effort, not a config flip.
- **Course colleges:** 2 buildable / 17 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: Fingerprint-baseline.json has no IL keys (sweep predates IL); clusters.json is the per-college SIS signal of record. elgin & rock-valley are wired in scrape-colleague.ts HOSTS but no course file exists (rock-valley noted "returns no live terms"). courseColleges ceiling list is empty in the audit, so courses gap is undocumented-as-ceiling despite the config comment investigating it — formalizing a documented ceiling for the ~15 blocked colleges would let the state ship at B.

## Goal checklist

### IL — current tier C (limited by courses; 29/48 = 60%)

- [ ] Re-run `scripts/il/scrape-colleague.ts` (elgin-community-college already in HOSTS; rock-valley too). Capture any sections into `data/il/courses/`. Cheap, no new code.
- [ ] Probe Ellucian-Cloud/Banner subdomains for missing singletons (swic, bhc, sandburg, icc, ivcc, jwcc, kaskaskia, clcillinois, lakeland, heartland, sauk/svcc): try `colss-prod.ec.<domain>`, `selfservice.<domain>`, `ss-prod-cloud.<domain>`, Banner SSB `…/StudentRegistrationSsb`. Add any guest-accessible host to `scrape-colleague.ts` or a new Banner scraper; wire in `lib/states/il/config.ts` scrapers.courses.
- [ ] For confirmed-blocked colleges (4 Jenzabar: john-a-logan, richland, southeastern-illinois, spoon-river — auth-gated; experience.elluciancloud.com SSO cluster; PDF/CMS singletons), record a documented ceiling: add slugs to the audit `courses.courseColleges`/ceiling so 90% bar excuses them and the state can ship at B.
- [ ] (GOLD, optional) No programs exist (`data/il/programs/` absent) — defer; no state has program scrapers yet.

Definition of done: course coverage ≥90% of non-ceiling colleges OR every still-missing college is recorded as a documented ceiling; courses dim reaches B and composite lifts to B.
