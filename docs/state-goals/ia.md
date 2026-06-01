# Iowa (ia) — state goals

> **Current tier: D** · Rank **#39 of 40** · Tranche: **LATER** · Impact 2/5 · Effort: medium · Value/effort: **L**
>
> Dimensions: `crs=D` `prq=A` `trf=C` `sc=A` `cfg=A`
>
> _Courses 31%; 6 template-buildable (re-run colleague + wire Jenzabar/Banner) reaches ~69%, but 5 custom/unknown need fresh fingerprints to clear 90%._

## Diagnosis

- **Primary gap:** Courses at 31% (5/16); 6 missing colleges template-buildable (2 Colleague hosts already in scraper map, 3 Jenzabar, 1 Banner SSB 9), 5 custom/unknown. Transfers/prereqs/config/scorecard healthy.
- **Cheapest lever** (build-course-scrapers): Re-run scripts/ia/scrape-colleague.ts for indian-hills + iowa-central (hosts already in HOSTS map, zero new code); if 404, refingerprint the Self-Service subdomain.
- **Effort:** medium — Courses is the only weak dim. 6 of 11 missing colleges ride existing templates (Colleague/Jenzabar/Banner-SSB) — re-run plus per-college URL wiring, ~1-3hr. The 5 custom/unknown colleges (DMACC, NIACC, WITCC, Hawkeye, Iowa Lakes) need refingerprinting/bespoke work to clear 90%, but bulk lift is template wiring.
- **Course colleges:** 6 buildable / 5 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: scrape-colleague.ts HOSTS already includes indian-hills (ss.indianhills.edu) and iowa-central (selfservice.iowacentral.edu) but neither has output under data/ia/courses/ — re-run or fix host. Templates: scripts/lib/scrape-jenzabar.ts (ellsworth ecc.iavalley.edu, marshalltown mcc.iavalley.edu, southwestern swcciowa.edu — ellsworth+marshalltown share iavalley.edu Iowa Valley district), scripts/lib/scrape-banner-ssb.ts (northwest-iowa nwicc.edu, banner-ssb-9). Custom: des-moines-area (dmacc.edu, largest IA CC), north-iowa-area (niacc.edu), western-iowa-tech (witcc.edu). Unknown needing refingerprint: hawkeye, iowa-lakes. Transfers = ISU TRANSIT only (1 receiver, 3512 mappings, wired, http runner), not a documented ceiling; a 2nd receiver (UNI/Univ of Iowa) lifts transfers C→B (medium). No documentedCeilings. Config/prereqs/scorecard all A. No programs dir.

## Goal checklist

### IA — current tier D (limited by courses, 5/16 = 31%)

- [ ] Re-run `scripts/ia/scrape-colleague.ts --college=indian-hills-community-college` and `--college=iowa-central-community-college`. Hosts (ss.indianhills.edu, selfservice.iowacentral.edu) are already in the HOSTS map but produced no `data/ia/courses/` output. If 404, refingerprint the Self-Service subdomain (try ss-prod-cloud/selfservice/*.elluciancloud.com). +2 colleges, zero new code.
- [ ] Wire northwest-iowa (banner-ssb-9, nwicc.edu) via `scripts/lib/scrape-banner-ssb.ts` — add a per-state wrapper, declare in `StateConfig.scrapers.courses`. +1.
- [ ] Wire 3 Jenzabar colleges (ellsworth ecc.iavalley.edu, marshalltown mcc.iavalley.edu, southwestern swcciowa.edu) via `scripts/lib/scrape-jenzabar.ts` — find each public `Course_Search.jnz` portlet URL; ellsworth+marshalltown share the iavalley.edu district. +3, reaches 11/16 (69%).
- [ ] Investigate remaining 5: refingerprint hawkeye + iowa-lakes ("unknown"); build bespoke scrapers for custom des-moines-area (DMACC, largest), north-iowa-area, western-iowa-tech if public class-search exists. Needed to clear the 90% (15/16) bar.
- [ ] (Optional, transfers C→B) Add a 2nd receiver beyond ISU TRANSIT (UNI or Univ of Iowa) in `scripts/ia/scrape-transfer-transit.ts`.

Definition of done: courses ≥90% (15/16, any truly-unscrapeable custom college documented as a ceiling), all new scrapers declared in `lib/states/ia/config.ts` + cron-wired; composite ≥ B.
