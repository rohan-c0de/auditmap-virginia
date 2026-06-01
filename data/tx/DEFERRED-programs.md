# TX programs — coverage & deferred gaps (2026-06-01)

Programs rollout for Texas (59 colleges; 37 with course data). Catalog platform
fingerprinted by `scripts/tx/discover-catalogs.ts` → `data/tx/catalog-discovery.json`.

## Shipped — 8 colleges scraped (1,036 programs); **834 plannable across 7 colleges**
Live-planner verified: collin 205, tarrant-county 174, amarillo 123, alvin 120,
houston(hccs) 97, vernon 59, weatherford 56.

| Platform | Colleges |
|---|---|
| Acalog | alvin, amarillo, blinn, collin-county, houston-community-college |
| SmartCatalogIQ | vernon-college |
| CourseDog | tarrant-county-college-district |
| CleanCatalog | weatherford-college |

## Deferred / incomplete
- **6 Acalog colleges return 0** (howard, kilgore, northeast-texas, odessa, south-plains,
  temple): their Acalog catalog dropdown doesn't expose a `selected` catoid in the
  standard `index.php` form, so catoid auto-discovery falls back to a wrong id with no
  programs. Needs per-college catoid pinning.
- **blinn — 100 programs, 0 plannable**: links courses instead of inlining codes.
- **Alamo Colleges District (san-antonio, northeast-lakeview, northwest-vista, palo-alto,
  st-philips, southwest-deaf) and Lone Star College System** publish ONE district-shared
  catalog, not per-college — needs a district splitter; only san-antonio (alamo.edu) was
  probed and came back unknown.
- **SmartCatalogIQ lamar-institute, lamar-state-pa, navarro — 0** (nested below walker depth).
- **CourseLeaf laredo, south-texas; CourseDog del-mar; CleanCatalog panola — 0** (variants).
- **Unknown-platform / not-probed** colleges remain; second-pass discovery + the 22
  course-less TX colleges are the next levers.
