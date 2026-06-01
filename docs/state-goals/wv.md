# West Virginia (wv) — state goals

> **Current tier: D** · Rank **#36 of 40** · Tranche: **LATER** · Impact 2/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=D` `prq=A` `trf=C` `sc=A` `cfg=A`
>
> _Document 5 SSO/SAML/WAF colleges as ceilings + build 1 Colleague guest scraper (southern) -> 4/4 reachable covered, composite D->B._

## Diagnosis

- **Primary gap:** 6 of 9 colleges have no course data; 5 are SSO/CAPTCHA/SAML-blocked, only southern (Colleague guest) is buildable. Transfers thin (1 university). Prereqs/config/scorecard all A.
- **Cheapest lever** (documented-ceiling-accept): Document the 5 blocked colleges (newriver, pierpont, bridgevalley, wvncc, blueridge) as courseColleges ceilings, then re-run audit so courses coverage is excused (3-of-4 reachable = passing).
- **Effort:** medium — Courses is a near-hard ceiling: 5 of 6 missing colleges are blocked (newriver CAPTCHA/WAF, pierpont+bridgevalley Ellucian Experience SSO, wvncc Pathify SAML, blueridge JS-WP unknown). Only southern has a public Colleague Self-Service guest endpoint (/Student/Courses/Search) — one bespoke scraper (~2hr; eastern's HTML scraper is not reusable as a template). Even built, coverage hits only 4/9 (44%), so the real lever is documenting the 5 blocked colleges as ceilings to excuse them. Transfers 2nd-receiver is medium. No single cheap fix clears the bar.
- **Course colleges:** 1 buildable / 5 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: manualOnly reasons (probe-time truth) override the structural fingerprint: pierpont fingerprints banner-8/ords and southern fingerprints colleague-guest, but pierpont was found behind Ellucian Experience SSO. southern's /Student/Courses/Search is the standard Colleague guest endpoint and is the ONE buildable target. eastern's scraper (scrape-eastern-wv.ts) scrapes an HTML class-schedules page, NOT Colleague Self-Service — so it is not a reusable template for southern; southern needs a fresh Colleague SS scraper. Transfers wired to Marshall only (1604 mappings, scrape-transfer-marshall.ts); WVU is the obvious 2nd in-state receiver. documentedCeilings.courseColleges is currently empty — populating it is the unlock for the composite grade.

## Goal checklist

### WV — current tier D (limited by courses)

Reachable ceiling is B (courses excused). Programs/planner unreachable extra (no public program source surfaced).

- [ ] Confirm prereqs (A, 1602 entries) + config (A) + scorecard (A) need no work — they don't.
- [ ] Document 5 blocked course colleges as ceilings: add `newriver` (Banner SSB sgcaptcha WAF), `pierpont` + `bridgevalley` (Ellucian Experience SSO), `wvncc` (Pathify SAML), `blueridge` (JS-WP, source unknown) to `documentedCeilings.courseColleges` so audit excuses them. (~30 min)
- [ ] Build `scripts/wv/scrape-southern.ts` against the public Colleague Self-Service guest endpoint `https://southernwv.edu/Student/Courses/Search` (do NOT copy scrape-eastern-wv.ts — that scrapes an HTML schedule page, not Colleague SS). Wire into `StateConfig.scrapers.courses`. Lifts coverage 3/9→4/9 = all reachable colleges covered. (~2 hr)
- [ ] Re-run state-audit; courses should clear to B+ (4/4 reachable).
- [ ] (Optional, medium) Add a 2nd transfer receiver — scrape WVU articulation alongside existing Marshall, lifting transfers C→B.

Definition of done: courses passes via 4/4 reachable colleges covered + 5 documented ceilings; prereqs/config/scorecard remain A; composite ≥ B.
