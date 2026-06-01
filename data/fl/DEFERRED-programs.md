# FL programs — coverage & deferred gaps (2026-05-31)

Programs rollout for Florida (FCS, 28 colleges). Catalog platform per college is
fingerprinted by `scripts/fl/discover-catalogs.ts` → `data/fl/catalog-discovery.json`,
then scraped by the matching platform wrapper (cloned from the NC tooling).

## Shipped — 10 colleges scraped (928 programs); **626 plannable across 8 colleges**

Verified with the live planner (`listPlannableProgramsForCollege`):
irsc 143, daytonastate 108, polk 80, sjrstate 65, scf 63, fsw 60, southflorida 54,
fgc 53. NC+FL together: 22 plannable colleges, ~2,100 plannable programs.

| Platform | Colleges scraped |
|---|---|
| Acalog | cf, fgc, fsw, polk, scf, sjrstate, southflorida, tcc-fl |
| SmartCatalogIQ | daytonastate, irsc |

## Deferred / incomplete this pass

- **Not finished (disk-full interrupted the run):** SmartCatalogIQ palmbeachstate,
  pensacolastate, phsc; Acalog fscj returned 0 (needs navoid/catoid re-check).
  Re-run `scripts/fl/scrape-{smartcatalogiq,acalog}-programs.ts` when disk allows.
- **cf, tcc-fl (Acalog) — 0 plannable.** Programs scraped but requirements link to
  course descriptions rather than inlining codes; planner gates them out. Needs the
  Acalog parser to follow `preview_course` links (also affects NC gaston/guilford/surry).
- **CourseLeaf (easternflorida, lssc, valencia) — 0.** Their program index doesn't
  match the common CourseLeaf path conventions; needs per-college index discovery.
- **CourseDog (nwfsc) — 0.** `nwfsc_banner_sql` tenant variant returns 0 programs via
  the shared Coursedog lib.
- **9 colleges fingerprinted `unknown`** (gulfcoast, hccfl, mdc, nfc, seminolestate,
  sfcollege, spcollege, + the 2 above): catalog not found via probed patterns.
  Second-pass discovery (more subdomain patterns, PDF catalogs) is the next lever.

## Known infra note
This rollout repeatedly hit a full shared disk (228 GB, ~16 worktrees). The FL
program writes initially landed in `data/nc/programs/` due to a path-swap bug in the
cloned scripts (fixed: output dir now `data/fl/programs/`); files were relocated.
