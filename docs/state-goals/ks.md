# Kansas (ks) — state goals

> **Current tier: F** · Rank **#27 of 40** · Tranche: **NEXT** · Impact 3/5 · Effort: hard · Value/effort: **M**
>
> Dimensions: `crs=C` `prq=A` `trf=F` `sc=B` `cfg=C`
>
> _Cheap config + re-run 5 wired colleges lifts courses to ~75%, but F is binding transfers with no portal — hard investigation or ceiling needed to clear F._

## Diagnosis

- **Primary gap:** Composite F driven by transfers (0 mappings, no portal registered, unwired, no ceiling). Courses at 54% (13/24) is secondary; config has placeholders.
- **Cheapest lever** (wire-existing-scraper): Re-run the already-wired scripts/ks/scrape-jenzabar-webforms.ts (cloud, flint-hills, fort-scott, labette) and scrape-colleague.ts (coffeyville) to recover 5 missing colleges, lifting courses 54%→~75% (C→B).
- **Effort:** hard — The composite limiter is transfers, and KS has no statewide articulation portal registered (manualOnly confirms). Standing up KS transfers means investigating Kansas Board of Regents articulation infra from scratch — >half-day. Cheap wins (config, re-running existing course scrapers) raise individual dims but won't clear the F until transfers move off zero or get a documented ceiling.
- **Course colleges:** 5 buildable / 1 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: Key finding: 5 of 11 missing colleges already have wired, public-guest scrapers (Jenzabar/Colleague) that simply didn't produce data — cheapest course win is a re-run, not new code. 5 missing have no fingerprint on disk (need investigation; JCCC is the high-value one). seward is captcha-blocked (documented). Transfers is the binding F: zero mappings, no portal, no ceiling — composite cannot exceed F without addressing it. prereqs A (523, clean), scorecard B (22/24). No programs → planner not ready.

## Goal checklist

### KS — current tier F (limited by transfers)

- [ ] Config (cheap): in `lib/states/ks/config.ts` fill `seniorWaiver` per K.S.A. 76-728 (residents 65+; the TODO already cites it) and populate `popularCourses` from top-enrolled KS courses. Clears config C→A.
- [ ] Re-run existing course scrapers (cheap): execute `scripts/ks/scrape-jenzabar-webforms.ts` (recovers cloud, flint-hills, fort-scott, labette) and `scripts/ks/scrape-colleague.ts --college=coffeyville-community-college`. These hosts are already wired and confirmed public-guest; missing data = prior runtime failure, not a blocker. Lifts courses 54%→~75% (C→B).
- [ ] Investigate 5 un-scraped colleges (medium): johnson-county (jccc.edu — large, high value), garden-city (gcccks.edu), barton (bartonccc.edu), pratt (prattcc.edu), north-central (ncktc.edu). No fingerprint on disk; probe for Banner SSB / Colleague guest / Jenzabar portlet and add bespoke scrapers. Reaching ≥90% needs ~3 of these.
- [ ] seward-county: blocked (sgcaptcha/IPC bot challenge, documented in scrape-banner-ssb.ts) — leave or document ceiling.
- [ ] Transfers (hard, the real F): no Kansas Board of Regents articulation portal registered. Investigate kansasregents.org systemwide-transfer infra; if no machine-readable source exists, record a documented ceiling in the audit so transfers stop voiding the composite.

Definition of done: courses ≥90% (or documented ceilings for the holdouts), config placeholder-free, and transfers either wired with ≥1 KS university target or accepted as a documented ceiling.
