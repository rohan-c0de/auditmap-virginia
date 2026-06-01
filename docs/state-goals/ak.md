# Alaska (ak) — state goals

> **Current tier: F** · Rank **#5 of 40** · Tranche: **NOW** · Impact 1/5 · Effort: cheap · Value/effort: **H**
>
> Dimensions: `crs=A` `prq=B` `trf=F` `sc=A` `cfg=B`
>
> _Single tribal college; F only because no-portal transfers isn't recorded as a ceiling — a metadata edit flips F->B+/A with everything else already A/B._

## Diagnosis

- **Primary gap:** Transfers F is the sole drag (composite F); but AK = 1 tribal college (Ilisagvik), no statewide articulation portal — a genuine documented ceiling not yet recorded in the audit. Courses A, prereqs B (clean), programs 24 + aligned + planner-ready.
- **Cheapest lever** (documented-ceiling-accept): Mark transfers as a documented ceiling (1 tribal college, no AK articulation portal; config already states transferSupported:false) so the audit excuses it — lifts composite from F to B+/A.
- **Effort:** cheap — No scraping needed. The only real work is recording the transfers documented-ceiling (config already has transferSupported:false + full rationale) and optionally a senior-waiver citation. Both are <1hr config/metadata edits; then re-run scorecard.
- **Course colleges:** 0 buildable / 0 blocked (of the missing set)
- **Programs / planner:** 1 program files · aligned ✅ · planner-ready: yes
- **Shippable (B+) bar met:** yes ✅

> Notes: courses A (1/1, clean terms); prereqs B (71 entries, 0 HTML tags, wired); scorecard A (1/1); config B only because seniorWaiver:null — but that null is intentional and documented (no AK statutory waiver binds tribally-controlled Ilisagvik; UA's AS 14.40.130 60+ reduction does not apply). transfer-equiv.json is [] and transferSupported:false in lib/states/ak/config.ts. Programs: data/ak/programs/ilisagvik-college.json (24 programs) filename == college_slug, catalog_year 2026-2027, planner-ready. Only F is transfers, a real ceiling for a single tribal college with no statewide articulation infra. manualOnly already says "Alaska has no registered articulation portal."

## Goal checklist

### AK — current tier F (transfers-limited; all other dims A/B and planner-ready)

Alaska = one college (Ilisagvik, tribally-controlled, Utqiagvik). Courses A, prereqs B (71 clean entries), scorecard A, programs aligned + planner-ready. Composite F is driven solely by transfers, which is a genuine ceiling — no statewide articulation portal exists.

- [ ] Record the transfers documented-ceiling so the audit excuses it. The justification already lives in `lib/states/ak/config.ts` (`transferSupported: false`, manual-only comment) and `data/ak/institutions.json`. Add `ak` transfers to the audit's documentedCeilings source so `documentedCeilings.transfers=true`.
- [ ] (Optional, A-tier config) In `lib/states/ak/config.ts` / `data/ak/institutions.json`, add a `source_url` for the senior-waiver note (cite AS 14.40.130 + a registrar/Ilisagvik policy page) — or leave `seniorWaiver: null` as the documented-correct value.
- [ ] Re-run the scorecard/state-audit for `ak`; confirm transfers no longer counts as an open F and composite lands B+/A.

Definition of done: audit shows `ak` transfers as a documented ceiling (not an open F), courses/prereqs/config/scorecard all green, composite ≥ B; no new scrapers required.
