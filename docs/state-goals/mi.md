# Michigan (mi) — state goals

> **Current tier: C** · Rank **#30 of 40** · Tranche: **NEXT** · Impact 5/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=C` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _Big state; build one Coursedog scraper (henry-ford+lake-michigan) + alpena re-run, then ceiling the 12 blocked — realistic cap ~61%, document the rest._

## Diagnosis

- **Primary gap:** 15 of 31 colleges have no course data (52% coverage); transfers (5 univ/152k mappings), prereqs (2317, clean), config, and scorecards are all A. Of the 15 gaps, ~3 are buildable (2 Coursedog + 1 declared-but-failing Colleague) and ~12 are SSO/CAPTCHA/custom-blocked.
- **Cheapest lever** (build-course-scrapers): Build a MI Coursedog course-section scraper by adapting scripts/lib/scrape-coursedog.ts for henry-ford-college (hfcc.edu/courses) and lake-michigan-college (lakemichigancollege.events.prod.coursedog.com), wire it into lib/states/mi/config.ts scrapers, then run it.
- **Effort:** medium — The only buildable course work is one new MI Coursedog scraper (adapt scripts/lib/scrape-coursedog.ts) covering henry-ford + lake-michigan, plus a rerun/fix of the already-declared Colleague target alpena. That is ~1-3hr. The remaining 12 gaps are genuinely blocked (Banner login/CAPTCHA on grcc/west-shore, Jenzabar SAML/guest-disabled on bay-de-noc/gogebic/kirtland/kbocc — already investigated, northwestern auth-gated, 4 custom with no public endpoint, wayne-county acalog catalog-only). 90% course bar is unreachable; ~58-61% is the realistic ceiling.
- **Course colleges:** 3 buildable / 12 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: Colleague scraper (scripts/mi/scrape-colleague.ts) declares alpena-community-college but no data/mi/courses/alpena-community-college dir exists — target is failing (auth or term-discovery); needs a rerun/log check, not guaranteed. Jenzabar candidates bay-de-noc/gogebic/kirtland/kbocc already documented as SAML/guest-disabled in scrape-jenzabar-webforms.ts header — do not re-investigate. grcc/west-shore Banner noted in scrape-banner-ssb.ts as login-redirect/CAPTCHA. No documentedCeilings recorded in audit despite a real ~58-61% course ceiling — worth adding courseColleges ceilings for the 12 blocked colleges so courses grades fairly.

## Goal checklist

### MI — current tier C (limited by courses, 52% / 16-of-31)

- [ ] Build MI Coursedog scraper: copy scripts/fl/scrape-coursedog.ts pattern using scripts/lib/scrape-coursedog.ts for henry-ford-college (hfcc.edu/courses) and lake-michigan-college (lakemichigancollege.events.prod.coursedog.com). Write to data/mi/courses/{slug}/.
- [ ] Wire the new scraper into lib/states/mi/config.ts `scrapers.courses[]` (CI check:scrapers requires it).
- [ ] Re-run scripts/mi/scrape-colleague.ts --college alpena-community-college; it is declared but produced no data/mi/courses/alpena dir. Capture the failure (auth vs term) and either fix or mark manual-only.
- [ ] Record documented course ceilings in the audit/config for the 12 blocked colleges (grand-rapids, west-shore = Banner login/CAPTCHA; bay-de-noc, gogebic, kirtland, keweenaw-bay-ojibwa = Jenzabar SAML/guest-disabled per scrape-jenzabar-webforms.ts; northwestern-michigan = auth-gated; bay-mills, kalamazoo-valley, monroe-county, saginaw-chippewa = custom/no public endpoint; wayne-county = acalog catalog-only) so courses grades against the ~58-61% ceiling.
- [ ] (Gold, optional) Add data/mi/programs/ via Coursedog programs template + align filenames to institutions.json college_slug for planner visibility.

Definition of done: HFC + LMC course sections live under data/mi/courses/ and wired to cron; alpena resolved or documented; the 12 blocked colleges recorded as documented ceilings so courses is no longer flagged as an open buildable gap (shippable B+).
