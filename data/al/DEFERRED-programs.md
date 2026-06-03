# AL programs — deferred colleges

Programs were rolled out for **9 of 23** Alabama community colleges (all on
CleanCatalog). The remaining 14 are deferred below with the reason and the
next step, so a follow-up session can extend coverage without re-discovering.

Discovery method: `scripts/lib/discover-programs.ts` probed each college's
catalog domain (derived from the Scorecard `schoolUrl`).

## Platform detected, but no parseable programs (5)

| College | Platform | Catalog URL | Reason / next step |
|---|---|---|---|
| coastal-alabama-community-college | CleanCatalog | https://catalog.coastalalabama.edu | `/degrees` returns 200 but the crawl finds 0 program detail pages; programs sit under a `/catalog/...` structure. Inspect the DOM and set `indexPaths`. |
| h-councill-trenholm-state-community-college | CleanCatalog | https://catalog.trenholmstate.edu | `/degrees` and `/certificate` exist but parse to 0 programs. Inspect link structure; likely a custom template variant. |
| central-alabama-community-college | CleanCatalog | https://live-central-alabama.cleancatalog.io | Programs live under category pages (`/academic-transfer-programs`, `/career-technical-programs`) that link to intermediate pages, not program detail pages. Needs a deeper crawl depth. |
| j-f-drake-state-community-and-technical-college | SmartCatalogIQ | (body marker on https://drakestate.edu) | Discovery matched the SmartCatalogIQ marker on the main domain; the real `*.smartcatalogiq.com` catalog URL is unresolved (`Could not discover catalog year`). Find the actual catalog host and pass it as `baseUrl`. |
| shelton-state-community-college | Acalog | https://catalog.sheltonstate.edu | Acalog needs `programNavoids`; auto-discovery returned 0. Open the catalog, find the program-listing navoid(s), and fill them in. |

## No public catalog matched a known platform (9)

These returned no Acalog / CourseLeaf / SmartCatalogIQ / Coursedog /
CleanCatalog catalog on their primary domain (likely Modern Campus, custom
HTML, or PDF-only). Each needs manual investigation.

- bishop-state-community-college
- enterprise-state-community-college
- jefferson-state-community-college
- lawson-state-community-college
- lurleen-b-wallace-community-college
- marion-military-institute
- northeast-alabama-community-college
- reid-state-technical-college
- snead-state-community-college
