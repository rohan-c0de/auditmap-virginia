# SC programs — coverage & deferred colleges

Programs are scraped for **10 of 16** South Carolina technical colleges
(`scripts/sc/scrape-programs.ts`):

- **Acalog (8):** central-carolina, spartanburg, trident, york (original 4) +
  florence-darlington, lowcountry, northeastern, tri-county (added 2026-06).
  Every SC Acalog catalog is behind AWS WAF (`content.php` → HTTP 202 + empty
  body on plain fetch), so all are scraped through headless Chromium
  (`usePlaywright`). Before this change a plain-fetch re-run would have silently
  zeroed the original 4 colleges' committed program data.
- **CourseLeaf (1):** piedmont (programs under `/academic-programs/`).
- **CleanCatalog (1):** orangeburg-calhoun.

## Remaining deferred (6)

### Blocked (2)

| College | Platform | Catalog URL | Blocker |
|---|---|---|---|
| york | Acalog | https://catalog.yorktech.edu | Catalog now returns **HTTP 403** on every path (root, content.php, search_advanced.php) — a hard IP/fingerprint block that the Playwright JS-challenge solver does not clear (unlike the 202 WAF on the other 7). The existing committed `york.json` is preserved (the scraper skips on 0 results). Revisit if the block lifts or a residential-IP runner is available. |
| greenville | CourseLeaf | https://catalog.gvltec.edu | Program detail pages live under `/school-{area}/{dept}/{program}-{cred}/` rather than the `/programs/`-prefixed tree the template walks. Needs a CourseLeaf variant that follows the `/school-*/` index links. |

### No templated public catalog (4) — documented program ceilings

| College | Finding |
|---|---|
| aiken | `/Study/Catalog` is a custom HTML page; no Acalog/CourseLeaf/SmartCatalogIQ/CleanCatalog/Coursedog markers. |
| denmark | `catalog.denmarktech.edu` is a WordPress site publishing the catalog as PDF (no machine-readable program structure). |
| horry-georgetown | `/academics/collegecatalog.html` custom page; no templated catalog host. |
| midlands | No academic catalog subdomain; only a continuing-ed class search exists. |
| williamsburg | No catalog link on homepage; no catalog subdomain. |
