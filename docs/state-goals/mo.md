# Missouri (mo) — state goals

> **Current tier: C** · Rank **#34 of 40** · Tranche: **LATER** · Impact 3/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=C` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _Fingerprint + build SLCC (largest, un-probed) + 2 others, ceiling 2 SSO colleges -> 11/11 buildable clears 90%; investigation-gated._

## Diagnosis

- **Primary gap:** 5 of 13 colleges lack course data (62%). 2 are SSO-gated ceilings (Moberly, State Tech); 3 (Saint Louis CC, Three Rivers, North Central Missouri) were never fingerprinted/probed. Transfers/prereqs/config/scorecard all A.
- **Cheapest lever** (build-course-scrapers): Fingerprint Saint Louis Community College (stlcc.edu, largest MO 2-year, multi-campus) for a public SIS endpoint and build its scraper — biggest single coverage gain.
- **Effort:** medium — Reaching ~90% courses needs fingerprinting + building 1-3 new scrapers for un-probed colleges (no scripts/data exist for SLCC/Three-Rivers/NCMC); jenzabar header confirms Moberly + State Tech are login-gated and can be accepted as documented ceilings. One investigation + one or two scrapers = 1-4hr.
- **Course colleges:** 3 buildable / 2 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: Programs absent (Phase 5+, manualOnly) — GOLD-tier only, not part of B+ bar. Fingerprint-baseline has no mo- entries, so the 3 un-probed colleges have never been investigated; SLCC almost certainly has a public SIS. The 2 SSO-gated colleges should be logged as documented ceilings — once they are, MO clears the 90% bar at 11/11 buildable and shippableBarMet flips true.

## Goal checklist

### MO — current tier C (limited by courses, 8/13 = 62%)

Transfers (A: 13 univ, 8874 Core-42 mappings, wired), prereqs (A: 645, clean, wired), config (A), scorecard (A) are all done. Only courses block B+.

- [ ] Fingerprint **saint-louis-community-college** (stlcc.edu, multi-campus, largest MO 2-year). Probe Banner SSB 9 / Colleague Self-Service guest (`selfservice.*`, `ss-prod.*`) / CollegeScheduler GraphQL. Build scraper under `scripts/mo/` (reuse an existing `scripts/mo/scrape-*.ts` template) → `data/mo/courses/saint-louis-community-college/`.
- [ ] Fingerprint **three-rivers-college** and **north-central-missouri-college** (no scraper or baseline entry exists). Probe same patterns; build scrapers or fold into the matching existing template (colleague/banner8/jenzabar).
- [ ] For **moberly-area-community-college** (my.macc.edu) and **state-technical-college-of-missouri** (mytech.statetechmo.edu): jenzabar header confirms both are login/SSO-gated. Record as documentedCeilings.courseColleges in the audit so coverage is computed over buildable colleges (11/11 → passes 90%).
- [ ] Declare any new scrapers in `lib/states/mo/config.ts` `scrapers` block (cron-wire) per the same-PR rule.

Definition of done: courses >=90% of non-ceiling colleges have data (target SLCC + Three Rivers + NCMC scraped; Moberly + State Tech documented as SSO ceilings), new scrapers cron-wired → composite B+.
