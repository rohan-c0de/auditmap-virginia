# NC programs — coverage & deferred gaps (updated 2026-06-04)

Programs rollout for North Carolina (NCCCS, 58 colleges). Catalog platform per
college is fingerprinted by `scripts/nc/discover-catalogs.ts` →
`data/nc/catalog-discovery.json`, then scraped by the matching platform wrapper.

## Shipped — 17 colleges, 2,520 programs scraped; **1,910 plannable across 16 colleges**

Verified via `countRealCourses >= PLAN_MIN_COURSES`. The Acalog parser fix on
2026-06-04 unlocked **gaston (0 → 96)** and **guilford-technical (0 → 224)**; a
follow-up regex fix (optional hyphen between prefix and number) then unlocked
**surry (1 → 108)** — see "Deferred" below.

| Platform | Colleges |
|---|---|
| Acalog (`scrape-acalog-programs.ts`) | alamance, beaufort-county, catawba-valley, gaston, guilford-technical, james-sprunt, robeson, south-piedmont, surry |
| SmartCatalogIQ (`scrape-smartcatalogiq-programs.ts`) | bladen, blue-ridge, cleveland, halifax, mcdowell-technical, mitchell, wayne |
| CourseLeaf (`scrape-misc-programs.ts`) | johnston |

**Acalog parser fix (2026-06-04):** the prior note blamed "preview_course links" for
gaston/guilford/surry's 0-plannable state. Grounding showed it was actually two
distinct parser misses: (1) cf-style codes written without a space between prefix
and number (`ACG2021`) that the old `\s+` regex couldn't match, and (2) gaston-style
aria-labels with no `-`/`:` separator between code and title (`ACA 122 Transfer & Career
Success (1 Credit Hour)`). The fix relaxes the regex and also tries `parseCourseFromLabel`
on `acalog-adhoc-list-item` text before falling back to ELEC. gaston (0 → 96) and
guilford-technical (0 → 224) now plan cleanly.

**surry — RESOLVED 2026-06-04 (1 → 108 plannable).** surry's course codes are inline in
`aria-label`s but use a nbsp-hyphen-nbsp separator between prefix and number (`WBL - 110`);
`parseCourseFromLabel` in `scripts/lib/scrape-acalog-programs.ts` now accepts an optional
hyphen there. The earlier "third structure / preview_course follow" diagnosis was wrong —
the codes were never behind links.

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
