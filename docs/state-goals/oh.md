# Ohio (oh) — state goals

> **Current tier: D** · Rank **#28 of 40** · Tranche: **NEXT** · Impact 5/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=D` `prq=A` `trf=C` `sc=B` `cfg=A`
>
> _Large state; re-run 2 wired hosts + 1 Jenzabar -> ~55%, add 2nd transfer receiver (OTM/TAG); 8 custom colleges + 90% bar make full A a hard tail._

## Diagnosis

- **Primary gap:** Courses: only 9/22 colleges have data (41%). columbus-state (Colleague) and zane-state (Banner SSB) are already in scraper host maps but no data landed — need a re-run. belmont (jenzabar) is template-buildable. 8 remaining colleges are custom/unknown with no public endpoint; eastern-gateway is a closed college. Prereqs A, config A, transfers thin (1 university/OSU, 5348 mappings, wired).
- **Cheapest lever** (wire-existing-scraper): Run the already-wired scrapers for columbus-state-community-college (Colleague host in scrape-colleague.ts) and zane-state-college (Banner SSB host in scrape-banner-ssb.ts) to land their course data — lifts coverage 41%→50% with zero new code.
- **Effort:** medium — Two missing colleges (columbus-state, zane-state) are already declared in scripts/oh/scrape-colleague.ts and scrape-banner-ssb.ts host maps but produced no course files — a cheap re-run lands them. belmont-college needs adding to a jenzabar wrapper (template scripts/lib/scrape-jenzabar.ts exists). But the 8 custom/unknown colleges have no public endpoint and would each be a bespoke build, so reaching the 90% course bar is hard — the cheap wins only reach ~55%.
- **Course colleges:** 3 buildable / 9 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: columbus-state and zane-state are listed in the host maps of scrape-colleague.ts / scrape-banner-ssb.ts but data/oh/courses/ has no dirs for them — scrapers wired, never landed. eastern-gateway-community-college closed in 2024 and has no fingerprint entry; exclude it from the gap count rather than chase. Transfers limiter = thin (only OSU receiver); Ohio has a statewide articulation system (OTM/TAG/Transferology) that could yield a 2nd receiver but no portal is wired. config + prereqs both A. No programs/ dir → planner cannot surface OH degree paths (GOLD-tier gap only).

## Goal checklist

### Ohio — current tier D (limited by courses, 41% coverage 9/22)

- [ ] Re-run already-wired scrapers and land their data: `npx tsx scripts/oh/scrape-colleague.ts --college=columbus-state-community-college` and `npx tsx scripts/oh/scrape-banner-ssb.ts --college zane-state-college` — both hosts are already in the host maps but `data/oh/courses/` has no dirs for them. Lifts 41%→~50%.
- [ ] Add belmont-college (jenzabar, courseSearchUrl mybelmont.belmontcollege.edu) to a new `scripts/oh/scrape-jenzabar.ts` wrapper around `scripts/lib/scrape-jenzabar.ts`; declare it in `StateConfig.scrapers.courses`. ~55%.
- [ ] (Medium) Add a 2nd transfer receiver beyond OSU: investigate Ohio OTM/TAG/Transferology articulation; current `data/oh/transfer-universities.json` has only `osu`. Lifts transfers C→B.
- [ ] (Hard tail, optional) 8 custom/unknown colleges (clark-state, marion-technical, lorain-county, edison-state, lakeland, northwest-state, owens, southern-state) have no public SIS endpoint per fingerprint-baseline.json — each needs bespoke investigation; 90% course bar is a documented ceiling without these. Mark eastern-gateway-community-college closed (no fingerprint, shut down 2024) and exclude from coverage denominator.
- [ ] (GOLD) Build `data/oh/programs/` (none exist) with filenames matching `college_slug` in institutions.json so the degree-path planner can see OH.

Definition of done: columbus-state, zane-state, belmont course data landed and imported (coverage ≥55%), scrapers cron-declared; eastern-gateway excluded as closed; remaining 8 custom colleges documented as a ceiling.
