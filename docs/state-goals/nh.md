# New Hampshire (nh) — state goals

> **Current tier: B** · Rank **#15 of 40** · Tranche: **NOW** · Impact 2/5 · Effort: hard · Value/effort: **M**
>
> Dimensions: `crs=A` `prq=A` `trf=B` `sc=A` `cfg=A`
>
> _Already shippable; transfers a hard ceiling (UNH/Plymouth no public DB, Keene wired). Accept; optional nashuacc programs for 7/7 planner._

## Diagnosis

- **Primary gap:** Transfers capped at B by documented hard ceiling (only Keene reachable; UNH/Plymouth publish no public CC-to-4-year articulation DB). All other dims are A. Courses 7/7, prereqs 600 wired, config full. Programs 6/7 colleges, filenames aligned.
- **Cheapest lever** (documented-ceiling-accept): Accept the documented transfers ceiling — NH is already shippable at B. Optionally add a nashuacc programs scrape to complete planner coverage (6/7 → 7/7).
- **Effort:** hard — The sole composite limiter (transfers B) is a documented hard ceiling: UNH and Plymouth State have no public CC-to-4-year articulation database to scrape. Lifting it would require new articulation infra from scratch / non-public sources — more than half a day and likely not achievable from public data. Everything cheap is already done.
- **Course colleges:** 0 buildable / 0 blocked (of the missing set)
- **Programs / planner:** 6 program files · aligned ✅ · planner-ready: yes
- **Shippable (B+) bar met:** yes ✅

> Notes: No missing-course colleges (7/7 covered). Transfers limiter is a documented hard ceiling (UNH/Plymouth no public articulation DB); Keene scraper wired with 2,680 mappings. Programs aligned to college_slug; only nashuacc lacks a program file (6/7), purely a planner-completeness nicety, not a shippable-bar gap.

## Goal checklist

### NH — current tier B (shippable; documented transfers ceiling)

NH passes the B+ shippable bar already: courses A (7/7), prereqs A (600 entries, wired, clean), scorecard A (7/7), config A. Transfers is B only because of a documented hard ceiling.

- [ ] Accept transfers ceiling as-is. UNH and Plymouth State publish no public CC-to-4-year articulation database; `scripts/nh/scrape-transfer-keene.ts` already covers the one reachable receiver (Keene State, 2,680 mappings in `data/nh/transfer-equiv.json`, cron-wired). Do NOT re-pitch a 2nd university unless a public USNH articulation portal appears.
- [ ] (Optional, planner-completeness only) Add Nashua CC programs. `data/nh/programs/` has 6/7 colleges; only `nashuacc` (in `data/nh/institutions.json`) lacks a `nashuacc.json`. Extend `scripts/nh/scrape-programs.ts` to cover it. The 6 existing program filenames already align to `college_slug`, so the planner sees them.
- [ ] Confirm no regression: `data/nh/courses/`, `prereqs.json`, `transfer-universities.json` unchanged.

Definition of done: transfers ceiling formally accepted (no further articulation work expected) and, if pursued, nashuacc programs file added so planner coverage is 7/7. State stays B (A-ceiling-capped).
