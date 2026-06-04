# FL programs — coverage & deferred gaps (updated 2026-06-04)

Programs rollout for Florida (FCS, 28 colleges). Catalog platform per college is
fingerprinted by `scripts/fl/discover-catalogs.ts` → `data/fl/catalog-discovery.json`,
then scraped by the matching platform wrapper (cloned from the NC tooling).

## Shipped — 13 colleges scraped (~1,385 programs); **1,185 plannable across 13 colleges**

Verified via `countRealCourses >= PLAN_MIN_COURSES` on local JSON, plannable per college:
palmbeachstate 156, irsc 143, fscj 129, pensacolastate 112, daytonastate 108, **cf 85**,
polk 80, **tcc-fl 77**, sjrstate 65, scf 63, fsw 60, southflorida 54, fgc 53.

**Parser fix (2026-06-04, PR #__):** cf went 0 → 85 plannable and tcc-fl went 0 → 77
plannable after `scripts/lib/scrape-acalog-programs.ts` was broadened to accept
no-space course codes (`ACG2021`) and to parse adhoc-list-items as real courses
when the text starts with a code. cf is FL's no-space-code case; tcc-fl is the same
pattern. See NC's parser commit for the full story (one shared lib, four states).

| Platform | Colleges scraped |
|---|---|
| Acalog | cf, fgc, fsw, polk, scf, sjrstate, southflorida, tcc-fl |
| SmartCatalogIQ | daytonastate, irsc, palmbeachstate, pensacolastate |
| Coursedog | fscj |

**Recovery log (2026-06-04):** palmbeachstate + pensacolastate (SmartCatalogIQ) were
re-run and landed since this note was first written. **fscj** was mis-fingerprinted as
Acalog — `catalog.fscj.edu` is actually Coursedog (tenant `fscj_peoplesoft`); correcting
the platform tag in `catalog-discovery.json` scraped 149 programs (129 plannable).
`discover-catalogs.ts` now checks Coursedog before the loose Acalog body-match so a
stray "Acalog" footer mention can't re-trip this.

## Deferred / incomplete this pass

- **phsc (SmartCatalogIQ) — 0; a real blocker, not a re-run.** Its SmartCatalogIQ
  instance is stale (latest published edition is 2023-2024, no 2025-2026) and its
  programs nest one level below the walker's depth: `…/academic-programs/` lists 17
  *category* pages (associate-in-science-degree, college-credit-certificate-programs, …)
  and the actual program pages live inside those. Needs the shared SmartCatalogIQ
  deeper-walk enhancement (also affects NC lenoir/mayland/western-piedmont, IL
  moraine-valley/triton) — tracked as a cross-state lever, not a FL-only fix.
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
