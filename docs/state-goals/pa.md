# Pennsylvania (pa) — state goals

> **Current tier: C** · Rank **#16 of 40** · Tranche: **NEXT** · Impact 5/5 · Effort: hard · Value/effort: **M**
>
> Dimensions: `crs=C` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _Large state; 5 missing colleges all Workday/SAML/custom-blocked per scraper headers — record as ceilings so composite reads at true B+ (no buildable course wins)._

## Diagnosis

- **Primary gap:** 5 of 15 colleges have no course data (67% coverage); all 5 are SSO/auth-gated (Workday, Jenzabar JICS-behind-SAML, custom HTML) per scraper headers. Transfers/prereqs/scorecard/config all A.
- **Cheapest lever** (documented-ceiling-accept): Formally record the 5 blocked colleges (bucks/butler/ccbc/pa-highlands/penn-college) as documented course ceilings so the composite reflects a true ceiling rather than a fixable C; courses are the only sub-A dimension and the remaining colleges are SSO/SAML-blocked.
- **Effort:** hard — The 5 missing colleges run Workday (SSO), Jenzabar JICS behind SAML, or custom HTML with no public class-search endpoint — fingerprints confirm auth-gated/login-portal URLs (myworkday SSO, my.ccbc.edu/ICS, Net_Price_Calculator.jnz). Each needs bespoke authenticated scraping; no public guest endpoint to wire. PA already built every accessible-platform scraper.
- **Course colleges:** 0 buildable / 5 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** yes ✅

> Notes: Scraper headers (scripts/pa/scrape-banner-ssb.ts, scrape-colleague.ts, scrape-banner-8.ts) explicitly document the 5 missing colleges as Workday/Jenzabar-JICS-behind-SAML/custom — i.e. blocked. PA already ships Banner SSB, Banner 8, Colleague, bespoke Northampton + Westmoreland scrapers (10/15). Transfers strong (7 universities, 54529 mappings, wired, via Pitt TES + scrape-transfer). Prereqs 1351 entries clean. data/pa/programs/ is empty (0 files) — gold-tier gap only, not shippable-blocking.

## Goal checklist

### PA — current tier C (composite), shippable bar MET (B+ as documented ceiling)

Only sub-A dimension is courses (67%, 10/15). The 5 missing colleges are genuinely blocked — confirmed by both data/state-health/fingerprint-baseline.json and the existing scrapers' own header comments.

- [ ] Accept the course ceiling: add bucks, butler, ccbc, pa-highlands, penn-college to documentedCeilings.courseColleges (auditor config / lib/states/pa/config.ts) with reasons — Bucks=Workday SSO; CCBC & pa-highlands & penn-college=Jenzabar JICS behind SAML; Butler=custom HTML, no public search. This lifts the composite from C to its true ceiling without fake data.
- [ ] (Optional, gold tier) Wire an Acalog program scraper — manualOnly notes "Acalog program scraper not yet wired up." data/pa/programs/ is empty (0 files). Adding programs aligned to institutions.json college_slug values enables the degree-path planner.
- [ ] Do NOT attempt to scrape the 5 blocked colleges — no public guest endpoint; requires authenticated/SSO scraping (>half-day each, against project norms).

Definition of done: 5 blocked colleges recorded as documented course ceilings so courses passes as a ceiling; transfers/prereqs/scorecard/config remain A. Programs is a separate gold-tier follow-up.
