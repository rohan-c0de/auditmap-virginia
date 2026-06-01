# Idaho (id) — state goals

> **Current tier: F** · Rank **#23 of 40** · Tranche: **NEXT** · Impact 2/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=C` `prq=A` `trf=F` `sc=A` `cfg=A`
>
> _Accept no-portal transfers ceiling (10-min, flips off F) then build/ceiling CSI's Campus-Management-Corp course gap to clear 90%._

## Diagnosis

- **Primary gap:** Composite is F, dragged entirely by transfers: Idaho has zero transfer/articulation data and no registered statewide articulation portal (manualOnly confirms). Courses are also sub-bar at 75% (3/4) — College of Southern Idaho missing on Campus Management Corp Portal. Prereqs (A), config (A), scorecard (A) all healthy.
- **Cheapest lever** (documented-ceiling-accept): Document the transfers dimension as a ceiling (Idaho has no public statewide articulation portal) so it's accepted-as-is rather than raw-F — this lifts the composite off F for ~10 min of work, the highest points-per-hour action.
- **Effort:** medium — Two real gaps. Transfers is hard from scratch (no public articulation portal), but can be turned cheap by documenting it as a ceiling — same accepted pattern used for VA/DC/NH — which lifts the composite off F immediately. The remaining true-build gap is one scraper (CSI on Campus Management Corp Portal, a custom non-templated platform with no fingerprint entry) which is 1-4hr and may be SSO-walled. So overall medium: one cheap ceiling-accept plus one bounded scraper investigation.
- **Course colleges:** 0 buildable / 1 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: CSI (college-of-southern-idaho) is the only missing course college: runs Campus Management Corp Portal, no fingerprint-baseline entry, explicitly deferred in scripts/id/scrape-colleague.ts header. Classified blocked (custom/unknown, likely SSO) — not a cheap public Banner/Colleague/CollegeScheduler endpoint. Other 3 colleges scraped via Colleague guest (398/1294/1006 sections). transfer-equiv.json is []. No data/id/programs/ dir at all. Prereqs 730 entries clean+wired; config + scorecard full A.

## Goal checklist

### Idaho (id) — current tier F (limited by transfers)

- [ ] **Accept transfers ceiling (cheapest).** Idaho has no public statewide articulation portal (manualOnly: "no registered articulation portal"). Add a documented-ceiling note for the `transfers` dimension in the audit/ceilings source so it's accepted-as-is. This alone lifts the composite off F. Confirm no public Idaho transfer-equivalency system exists before documenting.
- [ ] **Build CSI course scraper (medium).** `college-of-southern-idaho` is the only missing college (75% → bar is 90%). It runs Campus Management Corp Portal — no Colleague/Banner template. Investigate `csi.edu` for any public class-search endpoint; if found, add a bespoke scraper alongside `scripts/id/scrape-colleague.ts` and wire it into `StateConfig.scrapers`. If SSO/CAPTCHA-walled, document CSI as a course-college ceiling so courses reaches effective 100%.
- [ ] **Re-run state-audit** to confirm composite rises (target B+ once transfers ceiling + CSI resolved).
- [ ] *(GOLD, optional)* Build `data/id/programs/` (no programs exist; manualOnly: no catalog matched a template) with filenames aligned to institutions.json `college_slug` values for planner visibility.

Definition of done: transfers accepted as documented ceiling, courses at/above 90% (CSI built or documented), audit re-run shows composite B or better.
