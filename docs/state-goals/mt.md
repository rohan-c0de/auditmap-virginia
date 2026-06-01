# Montana (mt) — state goals

> **Current tier: C** · Rank **#8 of 40** · Tranche: **NOW** · Impact 2/5 · Effort: cheap · Value/effort: **H**
>
> Dimensions: `crs=C` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _All dims A except courses 60%; the 4 missing are tribal/auth-gated ceilings — recording them lifts courses 60%->effective 100%, composite C->A._

## Diagnosis

- **Primary gap:** 4 of 10 colleges have no course data (60% coverage); all 4 are tribal/auth-gated colleges with no public course-search. Transfers (6 universities, 1309 mappings, wired), prereqs (119, clean), scorecard (10/10), config all A. No programs dir.
- **Cheapest lever** (documented-ceiling-accept): Document the 4 missing tribal/auth-gated colleges (aaniiih-nakoda, stone-child, highlands-college-of-montana-tech, fort-peck) as course-data ceilings so the audit excuses them — lifts courses 60%→effective 100% and composite C→A with no scraping.
- **Effort:** cheap — The composite is C limited ONLY by courses at 60%. The 4 missing colleges are not buildable: Aaniiih Nakoda + Stone Child are custom tribal-college sites with no courseSearchUrl, Highlands College of Montana Tech is auth-gated (high-confidence SSO), and Fort Peck's only Jenzabar URL is an Admissions/Apply portlet, not class search. These are a documented ceiling. Recording them as course-ceiling colleges (no scraping) excuses them, making 6/6 reachable = 100% and lifting courses C→A and composite to A. <1hr config/audit edit.
- **Course colleges:** 0 buildable / 4 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** yes ✅

> Notes: scripts/mt/ already has scrapers for the 6 covered colleges (banner8 for dawson+miles, cdkc, fvcc, lbhc, skc, transfer-ccn). dawson + chief-dull-knife are in lowSection (thin but present, not missing). Transfers via CCN are strong (A). Term 2025FA flagged stale — a cron rerun would refresh to current term but is not gating. Programs are manualOnly ("Phase 5+") — building them is a separate A-tier extra, not needed for a B+ finish. The 4 missing are classic tribal-college / SSO ceilings: no public Banner SSB / Colleague guest / CollegeScheduler endpoint detected.

## Goal checklist

### MT — current tier C (courses-limited; prereqs/transfers/scorecard/config all A)

The only gap is course coverage 60% (6/10). The 4 missing are not buildable — they are tribal/auth-gated colleges with no public class search. Accept them as a documented ceiling.

- [ ] In the state-audit ceiling config (the source feeding `documentedCeilings.courseColleges` / `ceilingsApplied`), add the 4 missing slugs as course-data ceilings: `aaniiih-nakoda-college` (custom, no courseSearchUrl), `stone-child-college` (custom, no courseSearchUrl), `highlands-college-of-montana-tech` (auth-gated/SSO, high confidence), `fort-peck-community-college` (Jenzabar URL is an Admissions/Apply portlet, not class search). Cite the fingerprint-baseline.json platform verdicts as rationale.
- [ ] Re-run `state-audit mt` — with 6/6 reachable colleges covered, courses should hit ~100% → A, lifting composite to A/B+.
- [ ] (Optional, non-gating) Rerun cron `scripts/mt/scrape-banner8.ts` etc. to refresh the stale `2025FA` term to current.
- [ ] (A-tier extra, defer) Build `data/mt/programs/` + planner alignment — currently manualOnly "Phase 5+", not required for B+.

Definition of done: composite >= B with courses A/B after the 4 unbuildable tribal/auth-gated colleges are recorded as documented ceilings; transfers/prereqs/scorecard/config remain A.
