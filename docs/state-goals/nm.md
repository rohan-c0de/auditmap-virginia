# New Mexico (nm) — state goals

> **Current tier: C** · Rank **#31 of 40** · Tranche: **LATER** · Impact 2/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=C` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _All else A; wire ruidoso coursedog (on-disk) then re-fingerprint clovis/luna/nmmi/mesalands — needs investigation + 1-2 scrapers to clear 90%._

## Diagnosis

- **Primary gap:** 5 of 12 colleges have no course data (58% coverage); transfers/prereqs/scorecard/config all A. 1 missing college (eastern-nm-ruidoso) is Coursedog-buildable; the other 4 (clovis, luna, nmmi, mesalands) have no detected SIS platform and need re-fingerprinting.
- **Cheapest lever** (build-course-scrapers): Wire a Coursedog section scrape for eastern-nm-ruidoso (platform confirmed by data/nm/coursedog-catalog dump + existing scripts/lib/scrape-coursedog.ts template), lifting courses 7/12→8/12 (67%).
- **Effort:** medium — One cheap win exists (ruidoso Coursedog section scrape — platform confirmed by a 940-course catalog dump already on disk + reusable scripts/lib/scrape-coursedog.ts), but reaching the >=90% courses bar requires fingerprinting and likely 1-2 bespoke scrapers for clovis/luna/nmmi/mesalands, which have no platform detected in clusters.json/fingerprint-baseline.json and no public endpoint on record. That is a 1-4hr investigation-plus-scraper job, not a cheap wire-up nor a half-day SSO slog.
- **Course colleges:** 1 buildable / 4 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: Composite C, limited solely by courses. Transfers A (8,837 mappings / 6 universities via CCNS API, wired), prereqs A (255 clean entries, wired), scorecard 12/12, config all populated — these are finish-line already. Existing nm scrapers: banner8 (NNMC), campusnexus (SENMC), colleague (San Juan), sipi-pdf (SIPI), plus CNM/NMJC/Santa Fe = 7 covered. data/nm/coursedog-catalog/eastern-new-mexico-university-ruidoso-branch-community-college.json (940 courses) confirms ruidoso runs Coursedog → buildable. clovis/luna/nmmi/mesalands appear in clusters.json as singletons with primary URLs only (clovis.edu, luna.edu, nmmi.edu) and zero entries in fingerprint-baseline.json — platform unknown, must re-fingerprint before judging scrapeability. Separately, scripts/nm/scrape-programs.ts points at wrong catalog domains (catalog.northern.edu/southeast.edu/eastern.edu — these resolve to out-of-state schools), which is why programs yielded 0 files; programs is an A-tier extra, not on the B+ bar.

## Goal checklist

### NM — current tier C (limited by courses, 58% / 7-of-12)

- [ ] Wire Coursedog section scrape for `eastern-new-mexico-university-ruidoso-branch-community-college` using `scripts/lib/scrape-coursedog.ts` (platform confirmed by the 940-course dump at `data/nm/coursedog-catalog/eastern-...ruidoso-...json`); import to `data/nm/courses/`. → 8/12 (67%).
- [ ] Re-fingerprint the 4 unknown colleges — clovis (clovis.edu), luna (luna.edu), new-mexico-military-institute (nmmi.edu), mesalands — probe Banner SSB, Colleague Self-Service guest (try non-443 ports + ec.cloud subdomains per memory), CampusNexus/CMCPortal (reuse `scripts/nm/scrape-campusnexus.ts`), and CollegeScheduler GraphQL. Record findings in `data/state-health/fingerprint-baseline.json`.
- [ ] For each that surfaces a public endpoint, build a bespoke scraper in `scripts/nm/` and declare it in `lib/states/nm/config.ts` scrapers (CI `check:scrapers`). Target 11/12 (>=90%) → courses B+, composite B+.
- [ ] If any college is genuinely SSO/PDF-only with no public class search, add it to `documentedCeilings.courseColleges` so it's excused from the 90% bar.
- [ ] (A-tier, optional) Fix `scripts/nm/scrape-programs.ts` catalog domains (current catalog.northern/southeast/eastern.edu are wrong schools) and run it to populate `data/nm/programs/`, then verify filenames match `institutions.json` college_slug for planner visibility.

Definition of done: courses >=90% of system colleges have section data (or remainder documented as ceilings); composite reaches B+, all new scrapers cron-wired.
