# NC programs — coverage & deferred gaps (2026-05-31)

Programs rollout for North Carolina (NCCCS, 58 colleges). Catalog platform per
college is fingerprinted by `scripts/nc/discover-catalogs.ts` →
`data/nc/catalog-discovery.json`, then scraped by the matching platform wrapper.

## Shipped — 17 colleges, 2,380 programs scraped; **1,482 plannable across 14 colleges**

Verified with the live planner (`listPlannableProgramsForCollege` + `buildMajorPlan`):
NC went from 0 → 14 colleges with a renderable Degree-Path Planner.

| Platform | Colleges |
|---|---|
| Acalog (`scrape-acalog-programs.ts`) | alamance, beaufort-county, catawba-valley, gaston, guilford-technical, james-sprunt, robeson, south-piedmont, surry |
| SmartCatalogIQ (`scrape-smartcatalogiq-programs.ts`) | bladen, blue-ridge, cleveland, halifax, mcdowell-technical, mitchell, wayne |
| CourseLeaf (`scrape-misc-programs.ts`) | johnston |

**Programs present but 0 plannable — courses linked, not inlined (3 Acalog colleges):**
gaston, guilford-technical, surry. Their Acalog catalogs reference required courses
via `preview_course` links rather than inline course codes in the requirement HTML,
so `countRealCourses` sees 0 and the planner gates them out. Titles/credentials/credits
are captured (useful for program listings); extracting linked courses needs an Acalog
parser enhancement. The other 6 Acalog colleges inline codes and plan fine.

## Deferred gaps (real catalogs, but the generic scrapers don't yet handle them)

**CourseDog — Colleague-Ethos variant (cape-fear, central-carolina, isothermal).**
The catalog API returns programs (e.g. cape-fear: 200) but the shared
`scrape-coursedog-programs.ts` parses 0 — these instances use the
`*_colleague_ethos` tenant shape whose program-detail payload differs from the
CUNY-style Coursedog the lib was written for. Needs a parser branch.

**CleanCatalog (craven).** 116 program candidates found, only 1 parses — craven's
CleanCatalog template differs from the GA coastal-pines / Bristol shape the lib
targets. Needs a parser branch.

**CourseLeaf (central-piedmont).** Its program index isn't a flat list under the
usual paths; only 1 program resolved. johnston (same platform) works fine.

**SmartCatalogIQ stragglers.**
- caldwell — only a stale 2020-2021 edition is published (migrated off SCIQ); not
  imported to avoid shipping 5-year-old requirements.
- lenoir, mayland, western-piedmont — programs nest one level below the walker's
  depth (award-type category pages → programs), or split across award-type
  sibling sections whose children are categories, not program pages.
- rockingham, sampson — non-standard catalog URL structure; year auto-discovery
  finds no `/en/YYYY-YYYY/` editions at the root.

**29 colleges fingerprinted `unknown`.** `discover-catalogs.ts` did not find a
catalog via the probed patterns (asheville-buncombe, brunswick, carteret,
coastal-carolina, college-of-the-albemarle, davidson-davie, durham-technical,
edgecombe, fayetteville-technical, forsyth-technical, haywood, montgomery, nash,
pamlico, piedmont, randolph, richmond, roanoke-chowan, rowan-cabarrus, sandhills,
southeastern, southwestern, stanly, tri-county, vance-granville, wake-technical,
wilkes, wilson, + caldwell-as-stale). A second-pass discovery (more subdomain
patterns, PDF catalogs, Acalog `*.catalog.acalog.com`) is the next lever.
