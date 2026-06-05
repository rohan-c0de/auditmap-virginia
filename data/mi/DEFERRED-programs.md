# MI programs — coverage & deferred gaps (2026-06-01)

Programs rollout for Michigan. Catalog platform fingerprinted by
`scripts/mi/discover-catalogs.ts` → `data/mi/catalog-discovery.json`.

## Shipped — 9 colleges scraped (667 programs); **590 plannable across 8 colleges**
Live-planner verified: delta 134, schoolcraft 122, mott 92, lansing 96, north-central 56,
montcalm 49, st-clair 37, oakland 4.

| Platform | Colleges |
|---|---|
| Acalog | delta-college, lansing, montcalm, mott-community-college, north-central-michigan, schoolcraft, st-clair-county |
| CourseLeaf | oakland-community-college |
| CourseDog | muskegon-community-college |

## Deferred / incomplete
- **mott-community-college (Acalog) — RESOLVED 2026-06-04 (0 → 92 plannable).** mott's
  codes are inline aria-labels with a hyphen-no-space separator (`ACCT-101`); the
  `parseCourseFromLabel` regex fix (optional hyphen between prefix and number) recovers
  them. The earlier "links courses / needs preview_course follow" diagnosis was wrong.
- **oakland (CourseLeaf, 8) / muskegon (CourseDog, 4)** — low yield; index/tenant variants.
- **glen-oaks, jackson (CourseDog) — 0** via shared lib.
- **5 unknown-platform** (macomb, mid-michigan, southwestern, washtenaw, + others):
  catalog not found via probed patterns; second-pass discovery is the next lever.
