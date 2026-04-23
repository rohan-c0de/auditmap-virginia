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
   - Banner 8 (flat table) — RI template
   - Colleague Self-Service — VT, NC, SC template
   - PeopleSoft Campus Solutions — NY (CUNY), VA (VCCS enrichment)
   - Jenzabar / custom — case-by-case
2. **Clone the nearest same-platform scraper** from an existing state as your starting point. SC was adapted from NC; TN was adapted from GA. This is the normal pattern — don't write from scratch.
3. Place at `scripts/{ST}/scrape-<platform>.ts`. Output to `data/{ST}/courses/{college-slug}/{term}.json`.
4. Terms follow the state's convention (VCCS: `2026FA`; TBR: `202680`; CUNY: `2026FA`). Encode in the scraper, don't try to normalize until import.

## Phase 3 — Transfer equivalencies

1. Find the transfer-data source: state-level portal (ARTSYS/MD, NJTransfer.org, CollegeTransfer.net), TES Public View, or per-receiving-university scrapers (VA's model).
2. Multi-university states get `scripts/{ST}/scrape-transfer-all.ts` orchestrator + per-university scripts (see VA: `scrape-transfer-vcu.ts`, `scrape-transfer-odu.ts`, etc.).
3. Output to `data/{ST}/transfer-equiv.json`.
4. **Flip `transferSupported: false → true`** in `lib/states/{ST}/config.ts` only after transfer data lands.

## Phase 4 — Prereqs

Prereq data is often a separate scrape path (catalog-driven or Banner `getSectionPrerequisites` endpoint). Output to `data/{ST}/prereqs.json`. Pattern reference: `d9e9a9a` (RI CCRI CourseLeaf), `5c45bce` (VT CCV catalog).

## Phase 5 — Supabase import

Run `scripts/import-courses.ts` and `scripts/import-transfers.ts` for the new state. These auto-derive the state list from the registry — no edits needed. Verify row counts before and after.

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

This skill is a **static markdown file** — it does NOT auto-update as new states are added. The state names and commit hashes below are snapshots from when this skill was written (April 2026, covering through CT/RI/VT/ME/NJ/PA). Treat them as examples, not the ground truth.

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
