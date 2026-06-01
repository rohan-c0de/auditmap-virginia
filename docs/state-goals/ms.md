# Mississippi (ms) — state goals

> **Current tier: F** · Rank **#9 of 40** · Tranche: **NOW** · Impact 3/5 · Effort: medium · Value/effort: **H**
>
> Dimensions: `crs=F` `prq=A` `trf=C` `sc=A` `cfg=A`
>
> _Re-land orphaned #964 (252 programs, pure rename) for an instant planner GOLD win; courses 7% is a separate medium slog, so do the cheap data fix now._

## Diagnosis

- **Primary gap:** 14 of 15 colleges have no course data (coverage 7%, only Meridian); transfers/prereqs/config/scorecard all healthy. Separately, the merged program-alignment fix #964 is an orphaned commit NOT on main, so 252 programs sit unplannable.
- **Cheapest lever** (build-course-scrapers): Re-land orphaned commit e4134a06 (#964): rename data/ms/programs/{hinds,jcjc,meridian,mgccc,northwest}.json to their institution college_slug names + fix internal college_slug field + scripts/ms/scrape-programs.ts — unlocks 252 programs / 4 colleges for the planner (pure data, no scrape).
- **Effort:** medium — 6 of 14 missing colleges expose public SIS endpoints (3 Colleague guest, 1 Banner SSB 9, 2 acalog/jenzabar catalogs) and shared templates already exist in scripts/lib/ — each is a thin per-host wrapper like scrape-banner8.ts, roughly 1-4hr to wire all six. The other 8 are custom/unknown with no public endpoint detected (re-probe needed). Reaching the 90% courses bar is not achievable cheaply; the realistic medium goal lifts coverage from 7% to ~47%.
- **Course colleges:** 6 buildable / 8 blocked (of the missing set)
- **Programs / planner:** 5 program files · MISALIGNED ⚠️ (hidden from planner) · planner-ready: partial
- **Shippable (B+) bar met:** no

> Notes: MAJOR: commit e4134a06 "fix(ms): align program filenames (#964)" is NOT an ancestor of HEAD — orphaned by a squash-merge race (the exact failure mode in CLAUDE.md/memory). Program files on main are still hinds.json/jcjc.json/meridian.json/mgccc.json/northwest.json (short slugs), so the planner resolves 0 plannable MS programs despite 252 on disk. Re-landing is a cheap data-only PR. Fingerprint buildables: east-mississippi (colleague colss-prod.ec.eastms.edu), hinds (colleague ryvws07.hindscc.edu), holmes (banner-ssb-9 api.holmescc.edu), east-central (jenzabar my.eccc.edu/ICS), jones-county + mississippi-gulf-coast (acalog catalogs). Blocked/custom-unknown (8): coahoma, copiah-lincoln, mississippi-delta, northwest-mississippi, southwest-mississippi, pearl-river, northeast-mississippi, itawamba — re-probe Ellucian-cloud/Colleague subdomains before accepting. Transfers thin (ole-miss only, 2109 mappings, wired) — medium upside to add a 2nd receiver (e.g. Mississippi State / USM).

## Goal checklist

### MS — current tier F (limited by courses, 7% coverage 1/15)

- [ ] **Re-land orphaned #964 (cheap, planner GOLD):** commit e4134a06 is NOT on main. Rename data/ms/programs/{hinds→hinds-community-college, jcjc→jones-county-junior-college, meridian→meridian-community-college, mgccc→mississippi-gulf-coast-community-college, northwest→northwest-mississippi-community-college}.json, fix each file's internal `college_slug`, and update slugs in scripts/ms/scrape-programs.ts. Unlocks 252 programs / 4 plannable colleges.
- [ ] **Build 6 buildable course scrapers (medium, moves composite):** add per-host wrappers like scripts/ms/scrape-banner8.ts using scripts/lib templates: Colleague (scrape-colleague.ts) for east-mississippi (colss-prod.ec.eastms.edu), hinds (ryvws07.hindscc.edu); Banner SSB 9 (scrape-banner-ssb.ts) for holmes (api.holmescc.edu); jenzabar (scrape-jenzabar.ts) for east-central (my.eccc.edu/ICS); acalog catalog for jones-county (catalog.jcjc.edu) + mississippi-gulf-coast (catalog.mgccc.edu). Declare each in lib/states/ms/config.ts scrapers.courses. Lifts coverage 7%→~47%.
- [ ] **Re-probe 8 custom/unknown colleges:** coahoma, copiah-lincoln, mississippi-delta, northwest-mississippi, southwest-mississippi, pearl-river, northeast-mississippi, itawamba — try Ellucian-cloud (colss-prod.ec.*, selfservice.*) + Colleague (ss-prod.cloud) subdomains per memory before accepting as ceiling.
- [ ] **(optional) Add 2nd transfer receiver** (Mississippi State / USM) to lift transfers C→B.

Definition of done: courses ≥90% (or documented ceiling for the 8 customs) AND program files aligned so planner shows MS programs.
