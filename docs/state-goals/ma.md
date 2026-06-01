# Massachusetts (ma) — state goals

> **Current tier: C** · Rank **#35 of 40** · Tranche: **LATER** · Impact 5/5 · Effort: hard · Value/effort: **M**
>
> Dimensions: `crs=C` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _Big state, programs 15/15 aligned; probe massbay PeopleSoft (1 win) then document 6 SAML/auth-gated colleges as ceilings -> courses no longer caps, composite B._

## Diagnosis

- **Primary gap:** 7 of 15 colleges have no course data (53% coverage, courses=C); transfers (13 univ/45.7k mappings), prereqs (1946, clean), config, scorecard all A. 6 of the 7 gaps are SSO/PDF/custom-blocked; only massbay (PeopleSoft) is a probe candidate.
- **Cheapest lever** (documented-ceiling-accept): Probe massbay PeopleSoft for a guest class-search / CollegeScheduler GraphQL endpoint and build that one scraper (8→9/15); then record the 6 blocked colleges as documented course ceilings so courses no longer caps the composite.
- **Effort:** hard — To clear the 90% courses bar genuinely, 6 of 7 missing colleges would need bespoke scrapers against auth-gated/custom/PDF SIS (qcc+rcc jenzabar are documented SAML/auth-blocked in scrape-jenzabar-webforms.ts; massasoit+northshore auth-gated; mwcc unknown; necc custom). That is >half-a-day of blocked-endpoint work. Only massbay (PeopleSoft) is a plausible 1-scraper win. Realistic path is documenting the 6 as ceilings (cheap) rather than building them.
- **Course colleges:** 1 buildable / 6 blocked (of the missing set)
- **Programs / planner:** 15 program files · aligned ✅ · planner-ready: yes
- **Shippable (B+) bar met:** no

> Notes: Programs perfectly aligned: 15 program JSONs match all 15 institutions.json college_slug values (berkshire,bristol,bhcc,capecod,gcc,hcc,massbay,massasoit,middlesex,mwcc,northshore,necc,qcc,rcc,stcc) — planner sees them. Existing course scrapers: banner-ssb, banner8, colleague, jenzabar-webforms (capecod only). scrape-jenzabar-webforms.ts header DOCUMENTS qcc=auth-gated and rcc=SAML-redirect blocked. massbay=peoplesoft (only probe candidate), massasoit+northshore=auth-gated, mwcc=unknown, necc=custom. documentedCeilings.courseColleges is currently empty — recording the 6 blocked colleges there is the cheap composite-unlock.

## Goal checklist

### MA — current tier C (limited by courses; coverage 8/15=53%)

- [ ] Probe massbay (PeopleSoft) for a public guest class-search or CollegeScheduler GraphQL endpoint (`api.collegescheduler.com/graphql`, `/psc/classsearchguest/...`). If reachable, build `scripts/ma/scrape-massbay-ps.ts` off the IN ivy-tech / CA laccd template, wire it in `lib/states/ma/config.ts` scrapers, import → 9/15.
- [ ] Record the 6 blocked colleges (qcc, rcc, massasoit, northshore, mwcc, necc) as documented course ceilings in the audit/ceilings config: qcc+rcc jenzabar are SAML/auth-blocked (see header of `scripts/ma/scrape-jenzabar-webforms.ts`), massasoit+northshore auth-gated, mwcc unknown-no-public-endpoint, necc custom-no-public-search. This excuses them so courses reads as covered and stops capping the composite.
- [ ] Re-run state-audit for ma; confirm courses dimension lifts (8 or 9 real + 6 ceiling = full) and composite moves C→B/A.
- [ ] (Optional, already done) Programs 15/15 aligned to institutions.json slugs; prereqs/transfers/config/scorecard all A — no action.

Definition of done: massbay either scraped or confirmed gated; all 6 remaining gaps recorded as documented ceilings; state-audit shows courses no longer the limiter and composite ≥ B.
