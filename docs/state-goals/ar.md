# Arkansas (ar) — state goals

> **Current tier: C** · Rank **#20 of 40** · Tranche: **NEXT** · Impact 2/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=C` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _All dims A except courses 12/14; build 2 bespoke scrapers (ANC, SouthArk) after a quick SIS probe, adapting existing AR colleague/Jenzabar templates -> A._

## Diagnosis

- **Primary gap:** 2 of 14 colleges (arkansas-northeastern-college, south-arkansas-college) have no course data and no detected SIS platform; transfers/prereqs/scorecard/config all A.
- **Cheapest lever** (build-course-scrapers): Build 2 bespoke course scrapers for Arkansas Northeastern College (anc.edu) and South Arkansas College (southark.edu) — probe each for a public SIS endpoint (Colleague Self-Service guest / Banner SSB / Jenzabar AddDrop like EACC / CollegeScheduler GraphQL) and adapt the closest existing AR template, lifting courses C→A.
- **Effort:** medium — Only 2 colleges remain (ANC, SouthArk). Neither has a scraper or a detected SIS platform — clusters.json shows 0 clusters / all singletons and no fingerprint baseline match, so each needs a fresh SIS probe before authoring. But AR already has rich reusable templates (scrape-colleague.ts multi-host, scrape-eacc.ts Jenzabar AddDrop), so once the platform is identified each scraper is a template adaptation, not greenfield. 1-4 hours total.
- **Course colleges:** 2 buildable / 0 blocked (of the missing set)
- **Programs / planner:** 3 program files · aligned ✅ · planner-ready: partial
- **Shippable (B+) bar met:** yes ✅

> Notes: The audit's courses ceiling (courseColleges = the 2 missing) appears not applied to the coverage denominator (reason still says "coverage 83% (10/12)" and composite stays C limited by courses), so these read as a real buildable gap, not an accepted ceiling. Transfers has a genuine documented ceiling (HSU Azure AD App Proxy, UAPB no public ACTS table) — accept as-is, 7 universities / 13440 mappings already wired. Fingerprint-baseline.json has no entry for these AR colleges (the "northeastern" hit is SC's Northeastern Technical College). All 3 program files have real data (97/90/43 entries) and filenames match institutions.json college_slug values — aligned, no hidden-program bug.

## Goal checklist

### AR — current tier C (limited by courses; all other dims A)

Courses is the only blocker: 12/14 colleges have data; ANC + SouthArk missing, no SIS platform detected (clusters.json = all singletons, 0 clusters).

- [ ] Probe **arkansas-northeastern-college** (anc.edu) for a public class-search endpoint: try Colleague Self-Service (`selfservice.*`, `ss-prod.*`), Banner SSB, Jenzabar JICS AddDrop_Courses (pattern in `scripts/ar/scrape-eacc.ts`), CollegeScheduler GraphQL. Author `scripts/ar/scrape-anc.ts` adapting the matching template; write to `data/ar/courses/arkansas-northeastern-college/`.
- [ ] Probe **south-arkansas-college** (southark.edu) the same way; author `scripts/ar/scrape-southark.ts`; write to `data/ar/courses/south-arkansas-college/`.
- [ ] If either is genuinely SSO/WAF/PDF-gated, add it to `documentedCeilings.courseColleges` with a one-line reason (mirrors the transfers ceiling pattern) instead of leaving it as a silent gap.
- [ ] Declare both new scrapers in `StateConfig.scrapers` (lib/states/ar/config.ts) so `check:scrapers` passes and they run on cron.
- [ ] Optional GOLD: expand programs beyond the 3 aligned files (national-park, north-arkansas, southeast-arkansas) to more colleges to lift planner from partial→full.

Definition of done: courses ≥90% (12/12 buildable or remaining colleges in courseColleges ceiling), new scrapers cron-wired, composite reaches A/B+.
