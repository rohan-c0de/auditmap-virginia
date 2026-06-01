# Oklahoma (ok) — state goals

> **Current tier: F** · Rank **#19 of 40** · Tranche: **NEXT** · Impact 3/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=C` `prq=A` `trf=F` `sc=A` `cfg=A`
>
> _Implement the OCEP/VITA transfer scraper (currently a stub) to flip composite off F; courses 7/13 needs ~4 template scrapers as a follow-on._

## Diagnosis

- **Primary gap:** transfers = F (0 mappings, 0 universities, OCEP scraper is a stub) is the composite limiter; courses at C (7/13, ~4 missing colleges are buildable via existing Jenzabar/PeopleSoft templates)
- **Cheapest lever** (build-prereqs): Implement the OCEP/VITA articulation scraper (scripts/ok/scrape-transfer-ocep.ts) against vita.okhighered.org/CourseSearch — one scrape covers all 13 colleges × OK universities, flipping the composite limiter transfers F→ and declaring it in StateConfig.scrapers.transfers
- **Effort:** medium — Two medium tracks, no cheap wins. Transfers needs the OCEP/VITA ASP.NET MVC scraper actually implemented (scripts/ok/scrape-transfer-ocep.ts is a console.log stub) — one investigation+scraper. Courses needs ~4 bespoke scrapers but templates already exist (Jenzabar for northern-oklahoma/seminole, PeopleSoft Community Access for rose-state). No regex/config/wire-only quick wins; config and prereqs already A.
- **Course colleges:** 4 buildable / 2 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: leverCategory enum lacks "investigate-articulation"; chose build-prereqs as closest build-a-scraper bucket — actual work is building the OCEP transfer scraper. Missing 6 colleges: buildable=northern-oklahoma-college (Jenzabar template), seminole-state-college (Jenzabar), rose-state-college (PeopleSoft Community Access guest), northeastern-oklahoma-aandm-college (likely Colleague like sibling murray-state); blocked=eastern-oklahoma-state-college (manualOnly: no public guest course-search), college-of-the-muscogee-nation (tribal, no public DB). transfer-equiv.json is []. No programs dir. config/prereqs/scorecard all A.

## Goal checklist

### OK — current tier F (limited by transfers)

- [ ] **Implement OCEP transfer scraper** (`scripts/ok/scrape-transfer-ocep.ts`, currently a stub). Target the VITA tool at `vita.okhighered.org/CourseSearch/` (ASP.NET MVC, jQuery — try plain HTTP POST against its form action before Playwright). Write to `data/ok/transfer-equiv.json` in the shape from `scripts/nc/scrape-transfer-cns.ts`. One scrape covers all 13 colleges × OK universities → flips composite limiter.
- [ ] **Wire transfers to cron**: declare `transfers` in OK `StateConfig.scrapers` (`lib/states/ok/config.ts`) so `check:scrapers` passes and it runs scheduled.
- [ ] **Build 4 missing course scrapers** (templates exist): northern-oklahoma-college + seminole-state-college via `scripts/lib/scrape-jenzabar.ts`; rose-state-college via PeopleSoft Community Access (`scripts/nv/scrape-peoplesoft.ts` pattern); northeastern-oklahoma-aandm-college (probe Colleague like sibling murray-state in `scripts/ok/scrape-colleague.ts`). Lifts courses 7/13 C → 11/13 (85%, ~B+).
- [ ] **Document ceilings** for eastern-oklahoma-state-college (no public guest search) and college-of-the-muscogee-nation (tribal, no public DB) so they're excused from coverage %.
- [ ] Verify in local dev: `/ok/transfer` shows an equivalency; `/ok` course search renders new colleges.

Definition of done: transfers has real OCEP data + cron-wired (composite off F), courses ≥90% counting the 2 documented ceilings, all wired and verified in dev.
