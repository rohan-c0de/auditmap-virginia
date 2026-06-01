# South Dakota (sd) — state goals

> **Current tier: D** · Rank **#33 of 40** · Tranche: **LATER** · Impact 1/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=D` `prq=B` `trf=C` `sc=A` `cfg=B`
>
> _seniorWaiver config fix + transform on-disk Mitchell coursedog dump + ceiling 3 PDF/no-catalog colleges; 2nd transfer receiver optional -> D->C/B._

## Diagnosis

- **Primary gap:** 4 of 6 colleges have no course data (coverage 33%); 1 (mitchell) is buildable from an on-disk Coursedog dump, the other 3 are PDF-only/no-public-catalog blocked. Transfers thin (1 university). Config missing seniorWaiver.
- **Cheapest lever** (build-course-scrapers): Transform the on-disk Coursedog dump at data/sd/coursedog-catalog/mitchell-technical-college.json (740 courses) into data/sd/courses/mitchell-technical-college/ — no scraping needed, lifts coverage 2/6 to 3/6.
- **Effort:** medium — Cheap wins exist (config seniorWaiver edit; transform the already-downloaded Mitchell Coursedog dump into courses). But hitting the 90% courses bar is structurally blocked — 3 of 4 missing colleges are PDF-only or have no public templated catalog. Adding a 2nd transfer receiver (SDBOR universities) is a medium scraper task. Net: medium.
- **Course colleges:** 1 buildable / 3 blocked (of the missing set)
- **Programs / planner:** 1 program files · aligned ✅ · planner-ready: partial
- **Shippable (B+) bar met:** no

> Notes: Mitchell Coursedog raw dump (384KB, 740-course list) already committed at data/sd/coursedog-catalog/mitchell-technical-college.json — buildable WITHOUT any web scrape; needs only a transform pass into the courses/ layout. Other 3 missing: lake-area (no public catalog), sisseton-wahpeton (no public catalog), western-dakota (PDF-only) — genuine ceilings, should be documented as such since 90% bar is unreachable. Programs filename already aligned to college_slug (southeast-technical-college). Transfers wired via USD calculator (public); SDBOR covers SDSU/SDSMT/BHSU/NSU/DSU for a 2nd receiver.

## Goal checklist

### SD — current tier D (limited by courses)

- [ ] Set `seniorWaiver` in `lib/states/sd/config.ts` (currently `null`) — add the SD senior-citizen tuition-waiver citation (SDCL 13-53-19). config B→A. (cheap)
- [ ] Write `scripts/sd/scrape-mitchell.ts` (or a transform) that reads the already-downloaded `data/sd/coursedog-catalog/mitchell-technical-college.json` (740-course list) and writes `data/sd/courses/mitchell-technical-college/`. No web scrape needed. Declare it in `StateConfig.scrapers`. Lifts course coverage 2/6→3/6. (cheap–medium)
- [ ] Document ceilings for `lake-area-technical-college`, `sisseton-wahpeton-college` (no public templated catalog) and `western-dakota-technical-college` (PDF-only) in the audit `documentedCeilings.courseColleges` — the 90% bar is unreachable without these, so excuse them. (cheap)
- [ ] (Optional, medium) Add a 2nd transfer receiver beyond USD: build an SDBOR transfer scraper covering SDSU/SDSMT/BHSU/NSU/DSU to move transfers C→B.

Definition of done: seniorWaiver populated, Mitchell courses ingested + wired to cron, 3 blocked colleges recorded as documented ceilings so courses passes on the excused-coverage basis (3 of 3 non-ceiling colleges covered), transfers either accepted thin or lifted with a 2nd receiver.
