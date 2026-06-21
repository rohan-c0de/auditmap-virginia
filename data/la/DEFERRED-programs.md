# LA programs — coverage & deferred colleges

Programs are scraped for the LCTCS colleges with public, parseable catalogs.
All six Acalog catalogs (Fletcher, SLCC, Delta, BRCC, Delgado, Bossier) sit
behind AWS WAF and are scraped through Playwright; a plain-fetch re-run would
return HTTP 202 + empty and silently zero the data.

Covered with data (`scripts/la/scrape-programs.ts`):

- **Acalog (6):** fletcher (83), south-louisiana (48), louisiana-delta (145),
  baton-rouge (60), bossier-parish (160), delgado (120).
- **CourseLeaf (1):** nunez (92, `/programs/`).

> Bossier and Delgado were the two largest WAF catalogs. Their detail-page
> scrape only completes when `playwrightFetch` uses `waitUntil: "networkidle"`
> (so the WAF JS-challenge solves before the HTML is read) **and** the box has
> disk headroom — under disk pressure the headless renderer crashes mid-fetch.
> See memory `feedback_disk_pressure_crashes_playwright`.

## Deferred (5)

| College | Platform | Finding / next step |
|---|---|---|
| northshore-technical-community-college | Coursedog | `catalog.northshorecollege.edu` (tenant `northshoretechcc_banner`) lists 29 programs but the Coursedog requirement parser extracts 0 usable course lists — the common Coursedog "parses 0" case. Needs a per-tenant parser pass. (Course sections are separately a LoLA-SSO ceiling.) |
| sowela-technical-community-college | SmartCatalogIQ? | `sowela.smartcatalogiq.com` responds but catalog-year auto-discovery fails ("Could not discover catalog year") — the catalog path/structure differs from the standard `/en/{year}/{catalog}/` layout. Needs an explicit catalogPath/catalogYear. |
| central-louisiana-technical-community-college | — | `catalog.cltcc.edu` returns HTTP 500; no alternate catalog host found. |
| northwest-louisiana-technical-community-college | — | `catalog.nltcc.edu` returns HTTP 500; no alternate catalog host found. |
| river-parishes-community-college | — | `catalog.rpcc.edu` returns HTTP 500; no alternate catalog host found. |
