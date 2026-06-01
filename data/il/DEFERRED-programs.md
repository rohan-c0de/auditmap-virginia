# IL programs — coverage & deferred gaps (2026-06-01)

Programs rollout for Illinois (ICCB, 48 colleges; 29 with course data). Catalog
platform per college is fingerprinted by `scripts/il/discover-catalogs.ts` →
`data/il/catalog-discovery.json`, then scraped by the matching platform wrapper
(cloned from the NC/FL tooling).

## Shipped — 11 colleges scraped (1,338 programs); **1,066 plannable across 10 colleges**

Verified with the live planner: college-of-dupage 261, joliet 164, mchenry 153,
parkland 138, kankakee 119, kishwaukee 93, lincoln-land 60, lewis-and-clark 36,
danville 32, morton 10.

| Platform | Colleges |
|---|---|
| Acalog | joliet-junior-college, kishwaukee-college, lewis-and-clark, mchenry-county, parkland, prairie-state |
| SmartCatalogIQ | danville-area, kankakee, lincoln-land, morton |
| CourseLeaf | college-of-dupage |

## Deferred / incomplete

- **City Colleges of Chicago (7 colleges)** not attempted — CCC publishes one shared
  district catalog (catalog.ccc.edu) rather than per-college; needs a CCC-specific
  splitter so programs map to the right one of the 7 colleges.
- **CourseLeaf (oakton, william-rainey-harper) — 0.** Program index doesn't match the
  common CourseLeaf paths; cod (same platform) works. Needs per-college index discovery.
- **CourseDog (south-suburban) — 0.** Tenant variant returns 0 via the shared lib.
- **SmartCatalogIQ moraine-valley, triton — 0.** Programs nest below the walker's depth.
- **Domain list is partial** (18 of 29 course-having colleges): the others' `.edu`
  domains weren't confidently known, so they weren't probed. Adding them to
  `scripts/il/il-college-domains.json` and re-running discovery is the next lever.
