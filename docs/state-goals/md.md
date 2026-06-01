# Maryland (md) — state goals

> **Current tier: C** · Rank **#2 of 40** · Tranche: **NOW** · Impact 4/5 · Effort: cheap · Value/effort: **H**
>
> Dimensions: `crs=C` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _All dims A except courses 81%; the 3 missing colleges (ccbc/cecil/garrett) already have wired scrapers that just need a re-run -> 16/16, no new code._

## Diagnosis

- **Primary gap:** Courses at 81% (13/16): cecil, garrett, ccbc lack course data despite existing wired scrapers; all other dims A.
- **Cheapest lever** (wire-existing-scraper): Re-run the three existing wired scrapers (scrape-banner8.ts --college ccbc; scrape-jenzabar.ts --all) and import their output to data/md/courses/
- **Effort:** cheap — No new scrapers needed. scripts/md/scrape-jenzabar.ts already covers cecil+garrett and scripts/md/scrape-banner8.ts already covers ccbc, all declared in lib/states/md/config.ts. They just produce no output files — a re-run/debug + import pass. Landing any ONE of the three lifts 13/16→14/16 (88%); two reaches 94% (B+).
- **Course colleges:** 3 buildable / 0 blocked (of the missing set)
- **Programs / planner:** 3 program files · aligned ✅ · planner-ready: partial
- **Shippable (B+) bar met:** no

> Notes: cecil/garrett fingerprint=jenzabar (JICS course-search portlets, public, not SSO login pages); ccbc fingerprint=acalog BUT scrape-banner8.ts targets live Banner 8 at simon.ccbcmd.edu/pls/PROD — use that for sections, acalog is catalog-only. stale term 2025FA flagged across covered colleges → same re-run refreshes terms. Programs only 3/16 colleges (aacc/carroll/csm) but filenames align to college_slug; expanding programs is A-tier extra, not blocking shippable bar.

## Goal checklist

### MD — current tier C (limited by courses; all other dims A)

- [ ] Run `npx tsx scripts/md/scrape-banner8.ts --college ccbc` (Banner 8 at simon.ccbcmd.edu/pls/PROD). If it returns 0, inspect term codes (CCBC uses 202691=Fall) and the PROD path; write data/md/courses/ccbc/.
- [ ] Run `npx tsx scripts/md/scrape-jenzabar.ts --all` (cecil + garrett JICS portlets). These are public Course_Search.jnz / AddDrop_Courses portlets, not SSO — if empty, debug the Playwright portlet navigation, not access.
- [ ] Import results and confirm data/md/courses/{ccbc,cecil,garrett} populate; this lifts coverage 13/16→16/16 (clears 90% B+ bar; even 1 college → 88%).
- [ ] Re-run state-audit for md; confirm courses dim flips C→A/B and composite rises (stale 2025FA also refreshes).
- [ ] (A-tier extra, optional) Expand programs beyond aacc/carroll/csm via scrape-programs.ts for full planner coverage; filenames already align to college_slug so no rename needed.

Definition of done: data/md/courses/ holds ccbc, cecil, garrett with current-term sections, coverage ≥90%, courses dim ≥B, composite ≥B; no new scrapers authored (all three already exist and are wired in lib/states/md/config.ts).
