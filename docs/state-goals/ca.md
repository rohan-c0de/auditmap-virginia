# California (ca) — state goals

> **Current tier: C** · Rank **#29 of 40** · Tranche: **NEXT** · Impact 5/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=C` `prq=A` `trf=A` `sc=B` `cfg=A`
>
> _Highest student reach; ~9 detected colleges wire into existing templates (65%->85%) but the 90% bar needs ~27 custom re-fingerprints — biggest partial win, not a clean finish._

## Diagnosis

- **Primary gap:** 41 of 117 colleges have no course data (65% coverage, dim C); transfers/prereqs/config/scorecard all healthy (A/A/A/B). ~9 missing are buildable on existing generic templates; ~5 SSO-blocked; ~27 custom/unknown need re-fingerprint.
- **Cheapest lever** (wire-existing-scraper): Wire the ~9 already-detected buildable colleges into the existing generic templates: add Colleague HOSTS entries (modesto, mt-san-jacinto, las-positas) and Banner SSB targets (glendale, ohlone, california-indian-nations, chabot banner-8), plus miracosta PeopleSoft and one new courseleaf scraper for long-beach. Lifts 76→~85/117.
- **Effort:** medium — Generic scrape-banner-ssb.ts and scrape-colleague.ts templates already exist and are cron-wired; ~9 confirmed-buildable colleges have high-confidence guest courseSearchUrls in fingerprint-baseline.json and join via a HOSTS-map/target-list edit (cheap each). But reaching the 90% B+ bar requires the ~27 custom/unknown colleges too, which need re-fingerprinting (Ellucian-cloud subdomain probe) and likely several bespoke/cluster scrapers — a multi-hour body of work, not config-only.
- **Course colleges:** 9 buildable / 5 blocked (of the missing set)
- **Programs / planner:** 18 program files · aligned ✅ · planner-ready: yes
- **Shippable (B+) bar met:** no

> Notes: Fingerprint baseline (data/state-health/fingerprint-baseline.json, perCollege keyed {state}-{slug}) shows 115 ca colleges: 13 banner-ssb-9, 18 colleague, 1 banner-8, 1 courseleaf, 1 peoplesoft, 1 coursedog (all buildable), vs 52 custom + 23 unknown + 3 ellucian-experience + 2 auth-gated. Of the 41 missing: 9 buildable, 5 SSO-blocked (irvine-valley, mendocino, lake-tahoe, college-of-the-canyons + copper-mountain — last two flagged SAML/SSO inside scripts/ca/scrape-colleague.ts despite a Colleague detection), 27 custom/unknown. Many custom/unknown are district members (san-bernardino/crafton-hills, riverside/norco/moreno-valley) that may yield to re-fingerprint or cluster scrapers. Generic templates scrape-banner-ssb.ts/scrape-colleague.ts are cron-declared in lib/states/ca/config.ts; colleague template uses a HOSTS map so adding a college is a one-line edit. Programs (18 files in data/ca/programs) all align to college_slug — planner-visible. No documented course ceilings recorded.

## Goal checklist

### CA — current tier C (limited by courses, 65% / 76-117)

Wire/build course scrapers; transfers, prereqs, config, scorecard already A/A/A/B.

- [ ] Add Colleague HOSTS entries in `scripts/ca/scrape-colleague.ts` for `mt-san-jacinto-community-college-district` (msjc.edu/Student/Courses), `las-positas-college` (laspositascollege.edu/Student/Courses); run + import.
- [ ] Add Banner SSB targets to `scripts/ca/scrape-banner-ssb.ts` for `glendale-community-college` (portal.glendale.edu), `ohlone-college` (my.ohlone.edu), `california-indian-nations-college` (cincollege.org) — all have high-confidence guest URLs in `data/state-health/fingerprint-baseline.json`.
- [ ] Build small scrapers: `chabot-college` (Banner 8 bwckschd at chabotcollege.edu), `miracosta-college` (PeopleSoft surf.miracosta.edu), `long-beach-city-college` (CourseLeaf lbcc-public.courseleaf.com), `modesto-junior-college` (WebAdvisor piratesnet.mjc.edu). Declare each in `lib/states/ca/config.ts` scrapers.courses.
- [ ] Re-fingerprint the 27 custom/unknown (santa-monica, palomar, el-camino, riverside-city, cerritos, etc.) using Ellucian-cloud subdomain probe (colss-prod.ec/selfservice/reg-prod patterns) to convert to Colleague/Banner; build cluster scrapers (e.g. SBCCD: san-bernardino-valley+crafton-hills; RCCD: riverside-city+norco+moreno-valley).
- [ ] Accept 5 SSO-blocked (irvine-valley, mendocino, lake-tahoe, college-of-the-canyons, copper-mountain) as documented ceilings.
- [ ] Re-run state-audit; confirm coverage >=90% (>=105/117) for B+.

Definition of done: courses dim >=B+ (>=90% covered or remainder documented ceilings), all new scrapers cron-declared, audit re-run green.
