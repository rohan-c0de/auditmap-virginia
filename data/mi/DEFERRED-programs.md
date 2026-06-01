# MI programs — coverage & deferred gaps (2026-06-01)

Programs rollout for Michigan. Catalog platform fingerprinted by
`scripts/mi/discover-catalogs.ts` → `data/mi/catalog-discovery.json`.

## Shipped — 9 colleges scraped (667 programs); **498 plannable across 7 colleges**
Live-planner verified: delta 134, schoolcraft 122, lansing 96, north-central 56,
montcalm 49, st-clair 37, oakland 4.

| Platform | Colleges |
|---|---|
| Acalog | delta-college, lansing, montcalm, mott-community-college, north-central-michigan, schoolcraft, st-clair-county |
| CourseLeaf | oakland-community-college |
| CourseDog | muskegon-community-college |

## Deferred / incomplete
- **mott-community-college (Acalog) — 0 plannable** despite 99 programs: links courses
  instead of inlining codes (same as NC gaston/guilford/surry; needs preview_course follow).
- **oakland (CourseLeaf, 8) / muskegon (CourseDog, 4)** — low yield; index/tenant variants.
- **glen-oaks, jackson (CourseDog) — 0** via shared lib.
- **5 unknown-platform** (macomb, mid-michigan, southwestern, washtenaw, + others):
  catalog not found via probed patterns; second-pass discovery is the next lever.
