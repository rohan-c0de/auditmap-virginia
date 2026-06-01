# Rhode Island (ri) — state goals

> **Current tier: B** · Rank **#10 of 40** · Tranche: **NOW** · Impact 1/5 · Effort: cheap · Value/effort: **H**
>
> Dimensions: `crs=A` `prq=A` `trf=B` `sc=A` `cfg=A`
>
> _Single-college state, fully built; transfers B is a hard ceiling (both RI public unis mapped) — annotate ceiling + re-run, done._

## Diagnosis

- **Primary gap:** No real gap: CCRI (1/1 college) has full courses, prereqs (507), config A, programs aligned. Transfers graded B but already cover BOTH RI public universities (URI 795 + RIC 496 mappings) — there is no 3rd public receiver, so B is a hard ceiling.
- **Cheapest lever** (documented-ceiling-accept): Annotate transfers B as a documented ceiling (both RI public universities URI+RIC already covered) so the composite isn't penalized, then rerun the scorecard.
- **Effort:** cheap — Every shippable dimension already passes the B+ bar. The only sub-A dim (transfers) is a documented ceiling: RI has exactly two public 4-year schools (URI, RIC) and both are mapped. No scraper, config, or prereq work remains; at most a rerun/ceiling-annotation is left.
- **Course colleges:** 0 buildable / 0 blocked (of the missing set)
- **Programs / planner:** 1 program files · aligned ✅ · planner-ready: yes
- **Shippable (B+) bar met:** yes ✅

> Notes: CCRI is RI's only public community college, so collegeCount 1 is correct (not a coverage gap). Transfers cover all in-state public 4-year targets (URI + RIC = the entire RI public university system); B is a true ceiling, not unwired/thin. Programs present + filename aligned to college_slug ccri, prereqs present → planner fully ready. No buildable or blocked missing colleges. Cheapest lever is purely annotating the transfers ceiling + rerunning the scorecard.

## Goal checklist

### RI — current tier B (effectively finished; transfers ceiling)

RI is single-college (CCRI). All dimensions pass the shippable bar; transfers B is a hard ceiling, not a gap.

- [ ] Record transfers ceiling: RI has only two public 4-year institutions — University of Rhode Island (uri) and Rhode Island College (ric) — and `data/ri/transfer-equiv.json` already maps both (uri 795, ric 496; 1291 total). Add to `documentedCeilings.transfers` so the audit stops penalizing it.
- [ ] Re-run `/state-audit ri` to confirm composite holds/lifts once the ceiling is applied.
- [ ] (Optional, no action) Verify in local dev: `/ri` course search renders, `/ri/transfer` shows URI+RIC equivalencies, semester planner resolves a CCRI prereq chain, and CCRI programs (`data/ri/programs/ccri.json`, filename aligned to college_slug `ccri`) surface in the degree-path planner.

Definition of done: transfers B documented as a ceiling (both RI public universities covered), scorecard re-run reflects it, and all four shippable dimensions (courses/prereqs/config/transfers-ceiling) plus aligned programs/planner remain green — no scraper or config work outstanding.
