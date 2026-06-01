# Vermont (vt) — state goals

> **Current tier: C** · Rank **#24 of 40** · Tranche: **NEXT** · Impact 1/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=A` `prq=A` `trf=C` `sc=A` `cfg=A`
>
> _Single college, every dim A except transfers thin (UVM only); add VTSU as 2nd receiver or accept ceiling -> C->B, otherwise maxed._

## Diagnosis

- **Primary gap:** Transfers are thin: 346 real mappings but only to 1 receiver (UVM). Every other dimension is A — courses 1/1, prereqs 759 clean+wired, config full, scorecard 1/1, programs present and aligned. The single-college state (CCV) is otherwise complete.
- **Cheapest lever** (investigate-articulation): Add Vermont State University (VTSU) as a 2nd transfer receiver for CCV — investigate VTSU's public articulation/transfer-credit source and add a scrape branch alongside the existing UVM Banner scraper in scripts/vt/scrape-transfer.ts.
- **Effort:** medium — Composite C is driven solely by the "1 university" transfer thinness. Lifting it to B requires adding a 2nd in-state receiver (Vermont State University / VTSU), which means locating and building one new articulation scrape — a single-source investigation + scraper, not a config flip. All other dims already A.
- **Course colleges:** 0 buildable / 0 blocked (of the missing set)
- **Programs / planner:** 1 program files · aligned ✅ · planner-ready: yes
- **Shippable (B+) bar met:** yes ✅

> Notes: 1-college state (CCV). data/vt/programs/ccv.json has 41 programs; filename matches institutions.json college_slug "ccv" → planner sees it. transfer-equiv.json = 346 mappings, all university "uvm". transfer-universities.json lists only uvm. Existing scraper scripts/vt/scrape-transfer.ts pulls UVM's public Banner form at aisweb1.uvm.edu. No course gaps, no prereq contamination, no config placeholders, no documented ceilings. Per strict rubric transfers already passes (>=1 uni + non-trivial 346 mappings + cron-wired); the C is the audit's thinness nuance. Real-world ceiling note: VTSU is the only other VT public 4-year and may not publish a clean public articulation table — verify before committing.

## Goal checklist

### VT — current tier C (composite), all dims A except transfers (thin: 1 university)

VT is a single-college state (CCV). Every dimension is A except transfers, which has 346 real mappings but to only 1 receiver (UVM). The composite is dragged to C by that thinness alone.

- [ ] Confirm shippability: courses 1/1 (A), prereqs 759 clean+wired (A), config full (A), scorecard 1/1 (A), programs data/vt/programs/ccv.json (41 programs) aligned to institutions.json slug "ccv" → planner-ready. No course/prereq/config work needed.
- [ ] (Composite C→B lever) Add a 2nd in-state receiver: investigate Vermont State University (VTSU — Castleton/NVU/Vermont Tech merger) for a public transfer-credit/articulation table. If found, add a scrapeVtsu branch in scripts/vt/scrape-transfer.ts mirroring the existing scrapeUvmBanner pattern, append university:"vtsu" mappings to data/vt/transfer-equiv.json, and add {slug:"vtsu",name:"Vermont State University"} to data/vt/transfer-universities.json.
- [ ] If VTSU has no public articulation source, record a documented ceiling (transfers) and accept C — UVM is the flagship and 346 mappings is non-trivial.
- [ ] Re-run state-audit vt to confirm new grade.

Definition of done: either a 2nd in-state receiver (VTSU) is scraped+wired lifting transfers off "thin", or a documented transfers ceiling is recorded and VT accepted as shippable at its current A-everywhere-else state.
