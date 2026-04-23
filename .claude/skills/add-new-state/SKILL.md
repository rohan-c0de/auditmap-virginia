---
name: add-new-state
description: Walk through adding a new US state to Community College Path — bootstrap files, course scraper, transfer data, prereqs, Supabase import. Use when adding any new state (e.g. "add Ohio", "bootstrap Kentucky").
---
# Adding a new state

The project expands one state at a time. This is a **5-phase workflow**, each phase typically its own PR. Do not bundle phases — diff sizes get unreviewable (a single state's course data can be 300k+ lines of JSON).

## Phase 1 — Bootstrap (config only, no app/component edits)

Since commit `be494a7`, adding a state is config-driven. You should only need to touch these files:

- `data/{ST}/institutions.json` — colleges + campuses with `name`, `slug`, `address`, `lat`, `lng`, audit policy, senior-waiver law citation
- `data/{ST}/zipcodes.json` — from GeoNames US.zip, filtered to the state
- `data/{ST}/transfer-equiv.json` — start empty (`[]`) — transfer data lands in Phase 3
- `lib/states/{ST}/config.ts` — `StateConfig` including `defaultZip`, `defaultZipCity`, SIS platform URLs, senior-waiver statute, `transferSupported: false` initially
- `lib/states/registry.ts` — one-line registration
- **`lib/institutions.ts`** — two-line registration: one `import nhInstitutions from "@/data/nh/institutions.json"` and one line in the `REGISTRY` map.
- **`lib/geo.ts`** — same two-line pattern for `zipcodes.json` in the `ZIP_REGISTRY` map.

### Why `lib/institutions.ts` and `lib/geo.ts` are hardcoded

These two files look like they violate the "never hardcode state lists" invariant, but they can't be dynamic. Both are imported from code that may run on the **edge runtime** (middleware, some API routes), which cannot use `fs.readFileSync` or dynamic filesystem paths. The imports have to be static so the bundler knows at build time which JSON to include.

If you miss these two files, `/{state}/colleges` renders an empty grid (no colleges shown) and `/{state}` zip-code search silently returns nothing. There's no runtime error — it just looks like the state has no data. Ask how we know: NH shipped without these edits in April 2026 (PR #30) and the bug wasn't caught until a user opened `/nh/colleges` on prod.

**If you find yourself editing `components/SearchForm.tsx`, `components/blog/ProductCallout.tsx`, `app/page.tsx`, or `lib/blog.ts` to add a state — stop.** Those are registry-driven (see `getAllStates()` / `getStateConfig()`). Editing them re-introduces the exact coupling `be494a7` removed.

Pattern reference: commit `9fb92bc` (CT/RI/VT/ME bootstrap — four states in one commit, only these file types touched).

## Phase 2 — Course scraper

1. **Inspect the registration system** on one of the colleges' public course-search pages. Identify the platform:
   - Banner SSB 9 (modern REST) — TN, DC, GA template
   - Banner 8 classic (hierarchical `ddtitle` HTML) — MD, DE, SC, NH, MA (gcc/middlesex) template
   - Banner 8 flat-table — RI template (outlier; don't default to this)
   - Colleague Self-Service — VT, NC, SC, MA (bhcc/berkshire/stcc) template
   - PeopleSoft Campus Solutions — NY (CUNY), VA (VCCS enrichment)
   - Coursedog (API-backed catalog) — MA (gcc) template for prereqs
   - Jenzabar / Modern Campus / Acalog / Oracle APEX / custom — case-by-case
2. **Clone the nearest same-platform scraper** from an existing state as your starting point. SC was adapted from NC; TN was adapted from GA. This is the normal pattern — don't write from scratch.
3. Place at `scripts/{ST}/scrape-<platform>.ts`. Output to `data/{ST}/courses/{college-slug}/{term}.json`.
4. Terms follow the state's convention (VCCS: `2026FA`; TBR: `202680`; CUNY: `2026FA`). Encode in the scraper, don't try to normalize until import.

### Expect some colleges to be un-scrapable

In any given state, **a meaningful fraction of colleges won't have publicly scrapable course search** — they're behind SSO (SAML/OIDC) or serve only stale/archived terms in their public view. MA's 15 colleges broke down 6 scrapable / 9 not; of those 9, five required Microsoft SAML auth or had decommissioned their public Banner/Jenzabar endpoint in favor of Ellucian Experience cloud.

Signals the platform is auth-gated:
- Probe redirects to `login.microsoftonline.com`, a SAML `/Shibboleth.sso/`, or the school's SSO portal.
- The public course-search URL returns HTTP 200 but with an empty/stale term dropdown (e.g. no terms after 2023).
- The page loads a portlet (Jenzabar `.jnz`, PeopleSoft `.GBL`) that has zero form fields until you authenticate.

**What to do when a college is gated:** document it in the commit, move on, and don't try to work around auth. Don't log in with a student account; don't use cached credentials. Note these colleges as Phase 2 gaps — Phase 3 (state-level transfer portal, if one exists) frequently covers them anyway. MA Phase 2 shipped with 6 of 15 colleges' course data; Phase 3 via MassTransfer filled the gap with transfer data for all 15.

## Phase 3 — Transfer equivalencies

**Start here by asking "does the state run an official articulation system?"** A state-run portal — where every CC ↔ university mapping is already curated in one place — is by a wide margin the highest-leverage move in the whole 5-phase workflow. One scrape can yield transfer data for *every* college in the state, including the ones whose scheduling systems are gated and thus have zero Phase 2 data. MA's MassTransfer scrape delivered 45,764 mappings across all 15 colleges × 14 receivers in ~70 seconds; five of those 15 colleges had zero course data from Phase 2 but got full transfer coverage here.

Known state-run sources:
- **MA** — [MassTransfer](https://www.mass.edu/masstransfer/equivalencies/) (pattern: `scripts/ma/scrape-masstransfer.ts`)
- **MD** — ARTSYS
- **NJ** — NJTransfer.org
- **TN** — TNTransfers
- If the state has a **University System of X** (USNH, USG, etc.), check for a central portal before falling back to per-university scrapes.

### Fallback sources when no state portal exists
1. **CollegeTransfer.Net** — public OData v2 API. Each CC registers individually with a `SourceInstitutionId`. Pattern: `scripts/me/scrape-transfer.ts` (ME's 7 MCCS colleges), `scripts/nh/scrape-transfer.ts`. Note: free tier rate-limits after ~4–5 source institutions per run; scraper should merge-preserve prior runs.
2. **TES Public View** — some receiving universities publish their own TES-backed equivalency search.
3. **Per-receiving-university scrapers** — last resort. VA's model. Multi-university states get `scripts/{ST}/scrape-transfer-all.ts` orchestrator + per-university scripts (see VA: `scrape-transfer-vcu.ts`, `scrape-transfer-odu.ts`, etc.).

Output to `data/{ST}/transfer-equiv.json`.

**Flip `transferSupported: false → true`** in `lib/states/{ST}/config.ts` only after transfer data lands. Document any known gaps in the config comment (e.g. NH's in-state USNH transfers are absent because USNH doesn't publish to CollegeTransfer.Net).

## Phase 4 — Prereqs

Prereq data is often a separate scrape path (catalog-driven or Banner `getSectionPrerequisites` endpoint). Output to `data/{ST}/prereqs.json`. Pattern reference: `d9e9a9a` (RI CCRI CourseLeaf), `5c45bce` (VT CCV catalog).

### Skip what Phase 2 already got
Colleague Self-Service scrapes get prereq info inline via the `SectionDetails` API, and Banner SSB 9 via `getSectionPrerequisites`. If your Phase 2 scraper already populated `prerequisite_text` on sections, Phase 4 only needs to cover colleges Phase 2 missed. MA Phase 4 only ran against GCC + Middlesex (the two Banner 8 colleges); the other four had prereqs from Phase 2.

### Multi-college states: handle course-code collisions
When a state has multiple CCs whose course codes overlap — e.g. MA has "ART 123" at both GCC and Middlesex with different prereqs — merging into a single `prereqs.json` collapses them and silently loses data. Pattern reference: `scripts/ma/scrape-catalog-prereqs-gcc.ts` + `scripts/ma/scrape-catalog-prereqs-middlesex.ts` demonstrate the shared-file merge:

- Each scraper writes to the same `data/{ST}/prereqs.json` and tags every entry with `source: "<college-slug>"`.
- On merge, if a key already exists from a different source, the new one is stashed under a `"<source>:KEY"` prefix (e.g. `"middlesex:ART 123"`) instead of overwriting the bare key.
- Re-running one scraper replaces only that source's entries, leaving the other college's data intact.

Single-CC states and states where colleges use suffixed codes (NH's CCSNH: `ACCT113G` at GBCC, `ACCT113M` at MCC) don't need this — no collisions possible.

## Phase 5 — Supabase import

Run `scripts/import-courses.ts` and `scripts/import-transfers.ts` for the new state. These auto-derive the state list from the registry — no edits needed. Verify row counts before and after.

Imports run every row through schema validation (`lib/schemas.ts`). If your scraper's output fails validation, **fix the scraper** — don't bypass the check. When >5% of rows in a (college, term) combination fail, the import aborts that combination with cloud data unchanged; when <5% fail, bad rows are logged and skipped. Run `npx tsx scripts/check-scraper-output.ts --state <slug>` as a dry-run before the real import.

### After import: confirm the next prod build completes
Supabase imports add a lot of rows at once. The static-generation step for `/colleges` runs `buildTransferLookupForCourses` per college per state; this query scales with total transfer rows across all states and has a strict `service_role` statement timeout.

MA's Phase 5 import (45k+ transfer mappings) triggered exactly this failure — the next Vercel build failed with `canceling statement due to statement timeout` on `/colleges/page`. We bandaided by bumping `service_role statement_timeout` to 180s in Supabase; [issue #44](https://github.com/rohan-c0de/coursemap/issues/44) tracks the proper query optimization.

**After running the imports, watch the next Vercel deploy.** If it fails on `/colleges/page` with a timeout, run this once in Supabase SQL Editor:

```sql
ALTER ROLE service_role SET statement_timeout = '180s';
```

Then retry the deploy. If the symptom recurs at a larger ceiling, read issue #44 before raising the timeout further — the real fix is a query refactor, not more slack.

## Checklist before each PR

- [ ] Files touched match the phase's expected set (Phase 1 should not touch `app/` or `components/`)
- [ ] `transferSupported` flag reflects reality (false until Phase 3 completes)
- [ ] Senior-waiver law cited with statute reference in the config
- [ ] Scraper filename matches SIS platform (`scrape-banner-ssb.ts`, `scrape-colleague.ts`, etc.)
- [ ] No hardcoded state slugs introduced anywhere outside `data/{ST}/`, `scripts/{ST}/`, `lib/states/{ST}/`, `lib/institutions.ts`, `lib/geo.ts`
- [ ] **Phase 1 smoke test:** before opening the PR, hit `/{state}/colleges` in the local dev server. It should show all colleges, not an empty grid. An empty grid almost always means `lib/institutions.ts` wasn't updated.

## Commit message convention

Observed pattern: one-line summary → blank → bullet points of what's in the commit. Claude co-author footer is fine and standard here.

## Keeping this skill fresh

This skill is a **static markdown file** — it does NOT auto-update as new states are added. The state names and commit hashes below are snapshots from when this skill was last updated (April 2026, covering through CT/RI/VT/ME/NJ/PA/NH/MA). Treat them as examples, not the ground truth.

### Before using a cited state as a template
Don't blindly clone from a named state (NC, SC, TN, etc.). The cited state was the best same-platform exemplar *at the time this skill was written*. A newer state may now be a better template. Before cloning, verify:

```
# Find most recent scraper for your target SIS platform
git log --oneline -- 'scripts/**/scrape-banner-ssb.ts'
git log --oneline -- 'scripts/**/scrape-colleague.ts'
git log --oneline -- 'scripts/**/scrape-banner8.ts'
```

Clone from the most recent one, not from the one this skill names.

### After finishing a new state — update this skill
Each state addition teaches something. When you finish the 5 phases for a new state, spend 5 minutes updating this file:

- **Phase 2 template list:** if you used a new SIS platform or a significantly improved pattern, add it to the Phase 2 platform table and point future additions at your newer exemplar.
- **Phase 3 sources:** if you discovered a new transfer-data source (state portal, new API, new aggregator), add it.
- **New gotchas:** anything you had to learn the hard way that this skill didn't warn about.
- **Outdated claims:** if an invariant in this skill turned out to be wrong or incomplete, fix it.

The skill is only as useful as its most recent update. A stale skill actively misleads — worse than no skill at all.
