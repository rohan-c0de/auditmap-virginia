# Virginia (va) — state goals

> **Current tier: D** · Rank **#1 of 40** · Tranche: **NOW** · Impact 5/5 · Effort: cheap · Value/effort: **H**
>
> Dimensions: `crs=A` `prq=A` `trf=D` `sc=A` `cfg=A`
>
> _Big state, all 5 dims A-grade data already on disk; D only because robust 8-univ/15,483-row transfer scrapers aren't declared in config — a one-edit cron wire flips D->A._

## Diagnosis

- **Primary gap:** Transfers (15,483 mappings across 8 in-state universities) exist but the scraper is not declared in StateConfig.scrapers, so the data will go stale. Courses (23/23 A), prereqs (374 entries A), config (A), scorecard (23/23 A), and programs (23 files, all aligned to college_slug) are all complete.
- **Cheapest lever** (wire-existing-scraper): Declare the existing independent VA transfer scrapers in lib/states/va/config.ts StateConfig.scrapers.transfers so cron keeps the 8-university, 15,483-row dataset fresh.
- **Effort:** cheap — The eight per-university transfer scrapers already exist in scripts/va/ (scrape-transfer-{uva,vcu,gmu,odu,umw,vsu,vwu}.ts) and read external university equivalency portals directly — they do NOT invoke the heavy 6h PeopleSoft course scrape they were lumped with. Wiring them is a config-only edit declaring StateConfig.scrapers.transfers, well under an hour.
- **Course colleges:** 0 buildable / 0 blocked (of the missing set)
- **Programs / planner:** 23 program files · aligned ✅ · planner-ready: yes
- **Shippable (B+) bar met:** no

> Notes: Transfer scrapers (scrape-transfer-uva/vcu/gmu/odu/umw/vsu/vwu.ts) hit external university transfer-credit analyzers (e.g. UVA AsEquivs server-rendered HTML), independent of the PeopleSoft course scrape. The config comment "transfers disabled alongside courses to avoid partial-refresh drift" applies the heavy-scrape rationale incorrectly — these are light and cron-safe. vt (Virginia Tech) is the 8th target despite no scrape-transfer-vt.ts visible; transfer-equiv has 1,412 vt rows, so a vt scraper or merge path exists. Verify each transfer scraper runs standalone before wiring; if scrape-transfer-vt source is the equiv.json merge, ensure cron covers it. Courses remain legitimately manual-only (6h PeopleSoft timeout).

## Goal checklist

### VA — current tier D (composite held down solely by unwired transfers)

- [ ] Verify each transfer scraper runs standalone (no PeopleSoft dependency): `npx tsx scripts/va/scrape-transfer-uva.ts` (and vcu/gmu/odu/umw/vsu/vwu). They hit external univ equivalency portals, so should finish in minutes.
- [ ] Confirm the vt (Virginia Tech) mapping source — 1,412 vt rows exist in data/va/transfer-equiv.json but no scrape-transfer-vt.ts is visible; locate its scraper/merge or note it as a static-merge target.
- [ ] Declare transfers in `lib/states/va/config.ts` → `StateConfig.scrapers.transfers` (schedule + the 7-8 scraper entries), removing the inaccurate "disabled alongside courses" comment for transfers (keep courses manual-only).
- [ ] Run `npm run check:scrapers` to confirm CI passes (no undeclared-scraper failure).
- [ ] Local feature check: load `/va/transfer`, pick a sending CC + course, confirm an equivalency resolves for at least 2 of the 8 universities.
- [ ] Build + open PR; post-merge, curl prod `/api/va/transfer` to confirm data ships.

Definition of done: transfers dimension flips D→A (data already robust: 15,483 rows × 8 universities), scraper cron-wired and CI-green, composite rises to A (all five dims A, programs aligned, planner-ready).
