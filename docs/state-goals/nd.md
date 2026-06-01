# North Dakota (nd) — state goals

> **Current tier: C** · Rank **#32 of 40** · Tranche: **LATER** · Impact 1/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=C` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _Add CCCC+NHSC institution codes to the wired NDUS PS scraper (verified public) + ceiling Sitting Bull -> 7/7 courses, but PS endpoint is flaky._

## Diagnosis

- **Primary gap:** Courses at C (63%, 5/8). The 3 missing are all tribal colleges: CCCC and NHSC are VERIFIED on the public shared NDUS PeopleSoft NDCSPRD tenant (buildable — just not yet in scrape-ndus.ts INSTITUTIONS array); Sitting Bull is Jenzabar with uncertain guest access (blocked). Transfers/prereqs/config/scorecard all A.
- **Cheapest lever** (build-course-scrapers): Add CCCC and NHSC institution codes to the INSTITUTIONS array in scripts/nd/scrape-ndus.ts and rerun the scrape — both are verified on the public NDUS NDCSPRD PeopleSoft tenant. Lands 7/8 course coverage.
- **Effort:** medium — 2 buildable colleges (CCCC, NHSC) ride the existing scripts/nd/scrape-ndus.ts PeopleSoft scraper; need only their NDUS institution codes added to the INSTITUTIONS array, then a rerun. But the NDCSPRD PS Community Access endpoint has a documented stability blocker (Fall 2026 rerun failed mid-scrape per data/nd/DEFERRED.md), so it is a one-scraper-config + flaky-run task, not a trivial config edit. Sitting Bull (Jenzabar) needs separate guest-access investigation.
- **Course colleges:** 2 buildable / 1 blocked (of the missing set)
- **Programs / planner:** 2 program files · aligned ✅ · planner-ready: partial
- **Shippable (B+) bar met:** no

> Notes: Programs present for 2/8 colleges (bismarck-state-college.json, williston-state-college.json) — both filenames match institutions.json college_slug values, so planner-aligned, but coverage is thin. data/nd/DEFERRED.md is the authoritative blocker log: CCCC+NHSC verified public PS (buildable), Sitting Bull=Jenzabar (treat as documented ceiling). Prereqs 543 entries clean+wired; transfers 6 universities / 5694 GERTA mappings wired; config fully populated. Course scraper scripts/nd/scrape-ndus.ts is cron-wired in lib/states/nd/config.ts. Excusing Sitting Bull as a ceiling, landing the 2 buildable colleges yields 7/7 = 100% and flips courses C→A/B+.

## Goal checklist

### ND — current tier C (limited by courses, 63% / 5 of 8)

- [ ] Find NDUS institution codes for Cankdeska Cikana (CCCC) and Nueta Hidatsa Sahnish (NHSC) on the shared NDCSPRD PeopleSoft tenant (Community Access institution dropdown), then add two rows to the `INSTITUTIONS` array in `scripts/nd/scrape-ndus.ts` (matching slugs `cankdeska-cikana-community-college`, `nueta-hidatsa-sahnish-college` from `data/nd/institutions.json`). Both are VERIFIED public per `data/nd/DEFERRED.md`.
- [ ] Run `npx tsx scripts/nd/scrape-ndus.ts --term "Spring 2026" --slug cankdeska-cikana-community-college` then the same for nueta; detach if the PS endpoint shows the known instability (DEFERRED.md notes a Fall 2026 mid-scrape failure). Confirm `data/nd/courses/<slug>/` populated → 7/8 coverage.
- [ ] Treat Sitting Bull College (Jenzabar, uncertain guest access) as a documented ceiling: verify no public class-search guest path; if confirmed gated, add it to `documentedCeilings.courseColleges` so 7/7 non-blocked = 100%. Do NOT build an SSO-gated scraper.
- [ ] (GOLD, optional) Extend programs beyond bismarck/williston via the deferred catalog scrapes (WSC Acalog, Dakota/NDSCS Cleancatalog-via-Playwright, LRSC PDF) in DEFERRED.md.

Definition of done: courses ≥90% counting Sitting Bull as an excused ceiling (7/7), composite C→B+; transfers/prereqs/config/scorecard remain A.
