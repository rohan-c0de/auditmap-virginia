# Colorado (co) — state goals

> **Current tier: B** · Rank **#12 of 40** · Tranche: **NOW** · Impact 3/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=A` `prq=A` `trf=B` `sc=A` `cfg=A`
>
> _Shippable bar met (courses/prereqs/config/scorecard A, transfers documented ceiling); only GOLD programs remain (curate catalog configs) — accept as B or pursue planner._

## Diagnosis

- **Primary gap:** Programs absent (data/co/programs/ does not exist); the only non-A dimension is transfers, which is a verified documented ceiling. Courses 15/15, prereqs 868 clean, config + scorecard all A.
- **Cheapest lever** (build-programs): Curate scripts/co/scrape-programs.ts catalog configs (correct baseUrls + catoids per college), run it to emit data/co/programs/<slug>.json aligned to institutions.json slugs, unblocking the degree-path planner (GOLD).
- **Effort:** medium — Core B+ bar already met — courses/prereqs/config/scorecard all A, transfers a documented ceiling (accept). Remaining work is GOLD-only: scripts/co/scrape-programs.ts is an unvalidated auto-generated wrapper with wrong catalog baseUrls (catalog.colorado.edu/lamar.edu/northeastern.edu point at out-of-state schools) and catoid 0; curating correct per-college acalog/courseleaf configs and running it is a 1-4hr investigation, not a one-line wire.
- **Course colleges:** 0 buildable / 0 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** yes ✅

> Notes: No missing course colleges — courses dim is A (15/15). Transfers B but documentedCeilings.transfers=true (only Univ of Denver exposes public Banner bwcktart articulation; all other CO receivers SSO/Transferology-gated, verified 2026-05-31) so accept as-is. manualOnly lists only "programs — Phase 6 (catalog discovery emitted a wrapper". scripts/co/scrape-programs.ts exists but has placeholder/incorrect catalog baseUrls and catoidFallback:0 — must be curated before it yields real data.

## Goal checklist

### CO — current tier B (shippable bar met; transfers = documented ceiling, accept)

Core dimensions are all A (courses 15/15, prereqs 868 clean+wired, config, scorecard). Transfers (1 receiver, Univ of Denver) is a verified public-articulation ceiling — do NOT re-pitch. Remaining work is GOLD-tier programs only.

- [ ] Curate `scripts/co/scrape-programs.ts`: the auto-generated wrapper has wrong baseUrls — acalog colleges (aims/arapahoe/morgan) need real `catalog.*.edu` hosts + discovered catoids; courseleaf entries currently point at out-of-state schools (`catalog.colorado.edu` = CU Boulder, `catalog.lamar.edu` = Lamar TX, `catalog.northeastern.edu` = NEU Boston) — replace with the actual CCCS college catalog hosts or drop those colleges.
- [ ] Run `npx tsx scripts/co/scrape-programs.ts`; confirm it writes `data/co/programs/<slug>.json` with non-empty `programs[]`.
- [ ] Verify output filenames equal `college_slug` values in `data/co/institutions.json` (aims-community-college, arapahoe-community-college, etc.) so the planner sees them.
- [ ] Declare the programs scraper in `StateConfig.scrapers` (lib/states/co/config.ts) to wire cron.
- [ ] Local check: load the semester planner for a CO college, confirm a program's requirements resolve.

Definition of done: ≥1 aligned `data/co/programs/<slug>.json` with real program data, filenames match institution slugs, scraper cron-declared, planner shows CO programs.
