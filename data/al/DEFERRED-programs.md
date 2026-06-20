# AL programs — coverage & deferred colleges

Programs are now scraped for **15 of 23** Alabama community colleges across
three platforms (see `scripts/al/scrape-programs.ts`):

- **CleanCatalog (12):** bevill, chattahoochee-valley, gadsden, wallace-dothan,
  wallace-hanceville, wallace-selma, calhoun, northwest-shoals, southern-union,
  coastal-alabama, h-councill-trenholm, central-alabama.
- **Acalog (1):** shelton-state (behind AWS WAF → Playwright, navoid 574).
- **SmartCatalogIQ (2):** j-f-drake-state, enterprise-state.

The 5 previously "platform detected, no parseable programs" colleges (coastal,
trenholm, central-alabama, drake-state, shelton-state) were all resolved in
2026-06 by generalizing the CleanCatalog parser (multi-shape URL support),
driving shelton's WAF-gated Acalog through Playwright, and pointing drake at
its SmartCatalogIQ catalog-root BFS.

## Remaining deferred (8)

### Buildable but blocked (1)

| College | Platform | Catalog URL | Blocker |
|---|---|---|---|
| bishop-state-community-college | Acalog | https://catalog.bishop.edu | Triple-blocked: catalog is behind AWS WAF (202), serves an **invalid TLS cert** (Playwright `ERR_CERT_AUTHORITY_INVALID`), and exposes no `catoid` on the public root, so auto-discovery can't seed the scrape. Needs a Playwright context with `ignoreHTTPSErrors` plus a manually-probed catoid. |

### No templated public catalog (7) — documented course/program ceilings

These expose no Acalog / CourseLeaf / SmartCatalogIQ / Coursedog / CleanCatalog
catalog. Each publishes requirements as PDF, a bespoke CMS page, or a JS SPA
with no server-rendered program list. Treat as program ceilings until a public
templated catalog appears.

| College | Finding |
|---|---|
| jefferson-state-community-college | No catalog link on homepage; no catalog subdomain. |
| lawson-state-community-college | Catalog is an ASPX page (`/learn_at_lawson/academic_catalog/default.aspx`), no templated platform. |
| lurleen-b-wallace-community-college | Catalog under `/current-students/college-catalog-student-handbook`, custom CMS. |
| marion-military-institute | `/academics/catalog/` is a custom HTML page, no platform markers. |
| northeast-alabama-community-college | `catalog.nacc.edu` is a JS SPA app-shell (meta-refresh, no server-rendered program list). |
| reid-state-technical-college | `/collegecatalog` custom page, no platform markers. |
| snead-state-community-college | No catalog link on homepage; no catalog subdomain. |
