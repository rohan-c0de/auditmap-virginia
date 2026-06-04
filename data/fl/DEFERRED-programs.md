# FL programs — coverage & deferred gaps (updated 2026-06-04)

Programs rollout for Florida (FCS, 28 colleges). Catalog platform per college is
fingerprinted by `scripts/fl/discover-catalogs.ts` → `data/fl/catalog-discovery.json`,
then scraped by the matching platform wrapper (cloned from the NC tooling).

## Shipped — 14 colleges scraped (~1,471 programs); **1,255 plannable across 14 colleges**

Verified via `countRealCourses >= PLAN_MIN_COURSES` on local JSON, plannable per college:
palmbeachstate 156, irsc 143, fscj 129, pensacolastate 112, daytonastate 108, **cf 85**,
polk 80, **tcc-fl 77**, **phsc 70**, sjrstate 65, scf 63, fsw 60, southflorida 54, fgc 53.

**Walker fix (2026-06-04):** phsc went 0 → 70 plannable. Its 17 category pages under
`/academic-programs/` link to programs in a SIBLING URL tree (`/prog-desc/{level}/{slug}`)
rather than as children — outside the walker's `startsWith(programsRoot)` filter.
The shared `scrape-smartcatalogiq-programs.ts` walker now falls back to a broader
BFS at the catalog root (one level above `programsPath`, page-capped at 500) when
the primary BFS finds zero program-detail pages. Working colleges' control flow is
unchanged by construction — verified empirically against daytonastate/irsc/bladen.

**Acalog parser fix (2026-06-04):** cf went 0 → 85 plannable and tcc-fl went 0 → 77
plannable after `scripts/lib/scrape-acalog-programs.ts` was broadened to accept
no-space course codes (`ACG2021`) and to parse adhoc-list-items as real courses
when the text starts with a code.

| Platform | Colleges scraped |
|---|---|
| Acalog | cf, fgc, fsw, polk, scf, sjrstate, southflorida, tcc-fl |
| SmartCatalogIQ | daytonastate, irsc, palmbeachstate, pensacolastate, phsc |
| Coursedog | fscj |

**Recovery log (2026-06-04):** palmbeachstate + pensacolastate (SmartCatalogIQ) were
re-run and landed since this note was first written. **fscj** was mis-fingerprinted as
Acalog — `catalog.fscj.edu` is actually Coursedog (tenant `fscj_peoplesoft`); correcting
the platform tag in `catalog-discovery.json` scraped 149 programs (129 plannable).
`discover-catalogs.ts` now checks Coursedog before the loose Acalog body-match so a
stray "Acalog" footer mention can't re-trip this.

## Deferred / incomplete this pass

- ~~phsc (SmartCatalogIQ) — 0; real blocker~~ **RESOLVED 2026-06-04** (walker fallback;
  see above). Catalog is at the 2023-2024 edition (no 2025-2026 published) but the
  data is current with what phsc publishes, and 70/86 programs now plan cleanly.
  Re-investigate when phsc publishes a newer edition.
- ~~cf, tcc-fl (Acalog) — 0 plannable~~ **RESOLVED 2026-06-04** (parser fix; see above).
- **CourseLeaf (easternflorida, lssc, valencia) — 0.** Their program index doesn't
  match the common CourseLeaf path conventions; needs per-college index discovery.
- **CourseDog (nwfsc) — 0.** `nwfsc_banner_sql` tenant variant returns 0 programs via
  the shared Coursedog lib. (fscj, a standard `fscj_peoplesoft` Coursedog tenant, works
  fine — the remaining gap is specifically the `*_banner_sql` variant.)
- **9 colleges fingerprinted `unknown`** (gulfcoast, hccfl, mdc, nfc, seminolestate,
  sfcollege, spcollege, + the 2 above): catalog not found via probed patterns.
  Second-pass discovery (more subdomain patterns, PDF catalogs) is the next lever.

## Known infra note
This rollout repeatedly hit a full shared disk (228 GB, ~16 worktrees). The FL
program writes initially landed in `data/nc/programs/` due to a path-swap bug in the
cloned scripts (fixed: output dir now `data/fl/programs/`); files were relocated.
