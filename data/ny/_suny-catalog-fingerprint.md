# SUNY CC catalog platform fingerprint

Generated 2026-05-30 during NY programs+prereqs deepening (PR follow-up to #800).
Used to drive `scripts/ny/scrape-suny-*-programs.ts` wrapper selection.

## Per-college fingerprint

| slug | catalog URL | platform | prereqs inline | programs structured | notes |
|---|---|---|---|---|---|
| suny-adirondack | https://sunyacc.smartcatalogiq.com/en/25-26/college-catalog-2025-2026/ | SmartCatalogIQ | yes (JS) | yes | URL slug `25-26` not `2025-2026` |
| cayuga-cc | https://catalog.cayuga-cc.edu/2025-2026/ | T4 CMS | unknown | yes | Bespoke `Cayuga T4` generator; defer |
| clinton-cc | https://catalog.clinton.edu/ | Clean Catalog | yes | yes | Drupal 11 |
| columbia-greene-cc | https://catalog.columbiagreene.edu/ | Clean Catalog | yes | yes | Same Clean Catalog as clinton |
| corning-cc | https://corning.cleancatalog.net/ | Clean Catalog | yes | yes | Tenant URL pattern (`.cleancatalog.net`) |
| dutchess-cc | https://catalog.sunydutchess.edu/ | Acalog | yes | yes | catoid=1 |
| erie-cc | https://catalog.ecc.edu/ | Acalog | yes | yes | catoid=31 |
| fit | https://catalog.fitnyc.edu/ | CourseLeaf | yes (JS) | yes | Associate + bachelor's; CourseLeaf wrapper |
| finger-lakes-cc | https://flcc.smartcatalogiq.com/en/2025-2026/ | SmartCatalogIQ | yes (JS) | yes | Standard year slug |
| fmcc | (PDF only) | PDF only | no | no | Defer |
| genesee-cc | https://www.genesee.edu/wp-json/wp/v2/courses | Custom WP JSON API | yes | yes | Bespoke — easy WP JSON |
| herkimer-cc | https://catalog.herkimer.edu/ | Acalog | yes | yes | acalog-clients S3 confirmed |
| hudson-valley-cc | https://catalog.hvcc.edu/ | Acalog | yes | yes | acalog-clients S3 confirmed |
| jamestown-cc | (unreachable) | unknown | unknown | unknown | Defer; SCIQ tenant exists unpublished |
| jefferson-cc | https://www.sunyjefferson.edu/.../catalog/ | OmniUpdate | no | partial | No inline course pages; defer |
| monroe-cc | https://www.monroecc.edu/catalog/ | Lotus Notes NSF | yes | yes | Exotic; defer |
| mvcc | https://catalog.mvcc.edu/current/ | OmniUpdate | yes | yes | Custom bespoke scrape possible; defer this PR |
| nassau-cc | https://collegecatalog.ncc.edu/current/ | OmniUpdate | yes | yes | Per-subject HTML scrapable; defer |
| north-country-cc | https://www.nccc.edu/catalog/index.html | OmniUpdate | unknown | partial | Course HTML 404; defer |
| onondaga-cc | http://catalog.sunyocc.edu/ | Acalog | yes | yes | HTTP only (HTTPS 404s) |
| rockland-cc | https://sunyrockland.smartcatalogiq.com/en/2025-2026/ | SmartCatalogIQ | yes (JS) | yes | Standard |
| suny-schenectady | (PDF only) | PDF only | no | no | Defer |
| suffolk-cc | https://www.sunysuffolk.edu/.../catalog-master-final-web.html | Custom HTML | yes | no | Single-page; programs unstructured; defer |
| suny-broome-cc | https://catalog.sunybroome.edu/ | Acalog | yes | yes | catoid=25 |
| suny-niagara | http://catalog.niagaracc.suny.edu/index.php | Acalog | yes | yes | HTTP only; catoid=36 |
| suny-orange | https://sunyorange.catalog.acalog.com/ | Acalog | yes | yes | Non-canonical tenant URL; catoid=3 |
| suny-sullivan | (PDF only) | PDF only | no | no | Defer |
| suny-ulster | https://sunyulster.catalog.acalog.com/ | Acalog | yes | yes | Non-canonical tenant URL |
| tompkins-cortland-cc | (no public catalog) | none | no | partial | Drupal mapping only; defer |
| westchester-cc | https://catalog.sunywcc.edu/ | Acalog | yes | yes | catoid=57 |

## Summary by platform

| Platform | Count | Action in this PR |
|---|---:|---|
| **Acalog** | 10 | Programs + prereqs (highest-value tier) |
| **Clean Catalog** | 3 | Programs + prereqs |
| **SmartCatalogIQ** | 3 | Programs (prereqs JS-rendered, defer) |
| **CourseLeaf** | 1 (FIT) | Programs (prereqs JS-rendered, defer) |
| **WP JSON API** | 1 (Genesee) | Programs + prereqs (easy custom) |
| **OmniUpdate** | 4 | Defer — bespoke per-college |
| **Custom/Exotic** | 4 | Defer (Monroe/Suffolk/Cayuga T4/Tompkins) |
| **PDF only** | 3 | Defer (FMCC/Schenectady/Sullivan) |
| **Unknown/Unreachable** | 1 | Defer (Jamestown) |
| **Total** | **30** | **18 in this PR**, 12 deferred |

## Coverage forecast after this PR

- Programs: 7 CUNY + 18 SUNY = **25/37 CCs (68%)**
- Prereqs: 7 CUNY + 14 SUNY (Acalog 10 + Clean Catalog 3 + WP JSON 1) = **21/37 CCs (57%)**
- Up from 7/37 (19%) on both dimensions before this PR.
