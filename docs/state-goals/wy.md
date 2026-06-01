# Wyoming (wy) — state goals

> **Current tier: F** · Rank **#22 of 40** · Tranche: **NEXT** · Impact 1/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=B` `prq=A` `trf=F` `sc=A` `cfg=A`
>
> _F is empty transfers; investigate WCCC matrix or accept no-portal ceiling (cheap) + record central-wyoming SAML course ceiling -> composite B._

## Diagnosis

- **Primary gap:** Composite F driven entirely by transfers: 0 mappings, 0 in-state university targets, no articulation portal registered. Courses/prereqs/config/scorecard are all A/B and healthy.
- **Cheapest lever** (investigate-articulation): Investigate Wyoming's statewide articulation source (WCCC transfer matrix to UW), register it in data/articulation-portals.json, scrape/import in-state mappings, and declare scrapers.transfers in lib/states/wy/config.ts — moves transfers F→passing and lifts composite off F.
- **Effort:** medium — The only F dimension (transfers) has no registered portal and no documented ceiling — it needs a 1-4hr investigation to find Wyoming's articulation source (statewide WCCC transfer matrix / WyoTransfer-style guide) and a scraper or static-import, then wire it. Everything else is already done or a hard blocker.
- **Course colleges:** 0 buildable / 1 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: central-wyoming-college (the only course gap) is a genuine documented blocker: Colleague host central-ss.colleague.elluciancloud.com is 100% SAML-SSO-gated (tenant central.edu), course-search behind Cloudflare WAF, schedule only in Google Docs — marked DEFERRED-scrapers in config. Courses sit at 86% (6/7) and cannot realistically reach 90%; recommend recording central-wyoming-college as a documented courseColleges ceiling so 86% is excused. Transfers is the true F: WY has no entry in data/articulation-portals.json. If transfers can be accepted as a documented ceiling (no statewide machine-readable matrix found), the state would be B-shippable immediately via a one-line config flag + audit ceiling.

## Goal checklist

### WY — current tier F (limited by transfers)

- [ ] Record course ceiling: add `central-wyoming-college` to WY's documentedCeilings.courseColleges (SAML-SSO + Cloudflare WAF, schedule only in Google Docs — see DEFERRED-scrapers note in `lib/states/wy/config.ts`). Excuses the 86% (6/7) coverage so courses passes at ceiling. (cheap)
- [ ] Investigate Wyoming articulation: confirm whether WCCC publishes a machine-readable CC→University of Wyoming transfer matrix (WyoTransfer / UW transfer guides). No portal is in `data/articulation-portals.json` today. (medium)
- [ ] If a source exists: register it in `data/articulation-portals.json`, write `scripts/wy/scrape-transfers.ts`, populate `data/wy/transfer-equiv.json` (in-state only, UW as receiver), then declare `scrapers.transfers` in `lib/states/wy/config.ts` and verify `/wy/transfer` renders an equivalency. (medium)
- [ ] If NO machine-readable source exists: set transfers as a documented ceiling (`documentedCeilings.transfers=true`) with rationale — this alone lifts composite off F to B. (cheap)
- [ ] (GOLD, optional) Fix `scripts/wy/scrape-programs.ts` catalog base URLs (currently western.edu/eastern.edu/northern.edu look wrong vs WY domains), run it, confirm `data/wy/programs/*.json` filenames match institutions.json college_slug values for planner visibility. (medium)

Definition of done: transfers either populated+wired OR a recorded documented ceiling, central-wyoming-college recorded as course ceiling → composite ≥ B, no placeholder data.
