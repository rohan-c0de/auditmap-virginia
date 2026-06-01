# Texas (tx) — state goals

> **Current tier: C** · Rank **#21 of 40** · Tranche: **NEXT** · Impact 5/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=C` `prq=A` `trf=A` `sc=B` `cfg=A`
>
> _Largest state but courses 90% unreachable; re-run 3 wired colleges (galveston/southmost/north-central) then document the 19 SSO/custom as ceiling -> shippable B+._

## Diagnosis

- **Primary gap:** 22 of 59 colleges have no course data (63% coverage, grade C); transfers (43 univ / 187k mappings), prereqs (2511, clean), and config are all A. Most missing colleges are SSO/custom/catalog-only blocked — only 3 are already-wired-but-never-landed.
- **Cheapest lever** (wire-existing-scraper): Re-run the 3 already-wired course scrapers (galveston/texas-southmost via scrape-colleague.ts, north-central-texas via scrape-jenzabar-webforms.ts) and verify/repair the host endpoints so their data actually lands — nudges coverage 63%→68% with zero new scaffolding.
- **Effort:** medium — 3 missing colleges (galveston, texas-southmost, north-central-texas) are already in existing scraper HOSTS maps but never produced committed data — a verify/fix run, not net-new scaffolding (cheap, ~1hr). Beyond those, reaching the 90% courses bar is impossible: 4 are acalog/coursedog catalog-only (no live sections), 3 are jenzabar/colleague login-gated, and 12 are custom/unknown with no detected public endpoint — that's a documented ceiling, not a build task.
- **Course colleges:** 3 buildable / 19 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** yes ✅

> Notes: galveston-college + texas-southmost-college are in scripts/tx/scrape-colleague.ts HOSTS (added bulk in #550) but have no committed course file — never verified. north-central-texas-college is in scripts/tx/scrape-jenzabar-webforms.ts HOSTS (#708), also no data. These 3 are the only cheap course wins. austin-acc/hill/ranger are documented login-gated in scraper docstrings. brazosport/dallas/midland (acalog) + trinity-valley (coursedog) are catalog-only — no live section endpoint; trinity-valley already has a coursedog-catalog dump usable for prereqs only. Remaining 12 (grayson, san-jacinto, tyler-junior, angelina, central-texas, el-paso, lamar-state-orange, lee, southwest-texas-junior, western-texas, wharton-county, texas-state-technical) are custom/unknown with no public SIS detected. Even maxing every buildable college reaches only ~73% — courses is a documented structural ceiling, so composite C is near its realistic floor. shippableBarMet=true because transfers/prereqs/config pass and the courses shortfall is ceiling-bound, not a quality gap.

## Goal checklist

### TX — current tier C (limited by courses; transfers/prereqs/config all A)

Course coverage is 37/59 (63%). The 90% bar is unreachable (16+ colleges are SSO/custom/catalog-only). Goal: capture the cheap already-wired colleges, then document the ceiling.

- [ ] Re-run `npx tsx scripts/tx/scrape-colleague.ts --college=galveston-college` and `--college=texas-southmost-college` (hosts already in HOSTS map from #550). If endpoints 404/redirect-to-login, update the host in `scripts/tx/scrape-colleague.ts`; else commit the new `data/tx/courses/*` files. (+2 colleges)
- [ ] Re-run `npx tsx scripts/tx/scrape-jenzabar-webforms.ts --college=north-central-texas-college` (host in HOSTS from #708); verify data lands or repair the portlet URL. (+1 college → 40/59, 68%)
- [ ] For brazosport/dallas/midland (acalog) + trinity-valley (coursedog catalog-only): confirm no live section endpoint exists; if not, mark them documented course-ceiling colleges in the audit record rather than building.
- [ ] Record the remaining 12 custom/unknown + 3 login-gated (austin-acc, hill, ranger) colleges as a documented course ceiling so composite isn't penalized as a gap.

Definition of done: the 3 wired colleges either yield committed course data or are confirmed blocked, and the 19 unbuildable colleges are recorded as a documented courses ceiling — leaving TX shippable at B+ (transfers/prereqs/config A, courses ceiling-capped).
