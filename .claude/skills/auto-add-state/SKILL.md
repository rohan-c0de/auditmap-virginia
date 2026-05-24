---
name: auto-add-state
description: Add a US state to Community College Path end-to-end — bootstrap files, fingerprint per-college SIS, scrape courses where templates exist, fetch transfers if a state portal is registered, aggregate prereqs, open a PR — autonomously via scripts/lib/add-state.ts. Use this when the user wants to add a new state (e.g. "/auto-add-state ohio", "add Kentucky", "spin up Iowa"). For phase-by-phase manual control over each step instead, use the older `add-new-state` skill.
---

# auto-add-state

Autonomous version of the manual `add-new-state` skill. The manual one walks
you through 5 phases over 5 PRs; this one runs the entire pipeline via
`scripts/lib/add-state.ts` and ships **one** PR. Designed for the user to
type the command, walk away, and come back to a PR ready to review.

The full pipeline (orchestrated by `scripts/lib/add-state.ts`):
- Phase 1 — bootstrap (`scripts/lib/bootstrap-state.ts`)
- Phase 2a — fingerprint per college (`scripts/lib/fingerprint-college.ts`)
- Phase 2b — course scraping via the right template
  (`scripts/lib/scrape-{banner-ssb,colleague,banner-8}.ts`)
- Phase 3 — articulation lookup (`data/articulation-portals.json`)
- Phase 4 — prereq aggregation (`scripts/lib/aggregate-prereqs.ts`),
  with catalog-prereq fallback if aggregation yields 0 entries.
  **Skip when `StateConfig.scrapers.prereqs` references a dedicated
  scraper script** (e.g. an Acalog catalog scraper like
  `scripts/me/scrape-catalog-prereqs.ts`) — running the aggregator
  against a section corpus with no inline prereq text writes an empty
  array and clobbers catalog-sourced prereqs (ME lost 948 entries
  this way in one botched run). The orchestrator should inspect the
  config shape before invoking the aggregator.
- Phase 5 — Scorecard ingest (`scripts/scorecard-map.ts` + `scripts/ingest-scorecard.ts`).
  Maps each new college to its IPEDS unitid then fetches federal cost / aid /
  completion data into `data/{slug}/scorecard/`. Auto-skips if
  `COLLEGE_SCORECARD_API_KEY` is unset.

## Workflow

1. **Parse the slug** from the user's invocation. Lowercase, 2-letter US
   state abbr (e.g. `oh`, `ky`, `ia`, `tx`). If they typed a full name
   ("ohio"), convert. Reject anything that isn't a known state.

2. **Create the branch.** Off `main`:
   ```
   git checkout main && git pull --ff-only
   git checkout -b claude/{slug}-auto-add-state
   ```

3. **Run the orchestrator.** This is the long-running step (typically
   20–60 minutes; OH took 7m for fingerprint + several minutes per scraper
   cohort). Use `Bash` with `run_in_background: true` so the conversation
   doesn't block, then poll for completion:
   ```
   npx tsx scripts/lib/add-state.ts --state {slug} --json
   ```
   Save the JSON output to `/tmp/add-state-{slug}-result.json`.

4. **While it runs**, give the user a single status sentence ("Orchestrator
   started for {slug}; I'll be back when it finishes."). Don't poll-narrate
   every minute — let it run.

5. **Read the result JSON** when the subprocess exits. Parse:
   - `bootstrap.collegesDiscovered`
   - `fingerprint.byPlatform` (counts per platform)
   - `courses.bannerSsb.grandTotal` + `courses.colleague.grandTotal` +
     `courses.banner8.grandTotal`
   - `transfers.portal` (or null + `fallbackSuggestion`)
   - `prereqs.aggregated`
   - `scorecard.mapped` / `scorecard.ingested` / `scorecard.ran`
   - `manualTodos[]`

6. **Sanity-check the result.** If `bootstrap.collegesDiscovered === 0`,
   abort: nothing to commit. Tell the user the state probably isn't
   supported by IPEDS sector ∈ {1,4} + cat ∈ {3,4} (rare; e.g. AK has
   only one CC and may need manual handling). Don't commit. Don't push.

6b. **Catalog-prereq fallback** — if `prereqs.aggregated === 0` (the course
    SIS doesn't expose prereqs), scrape prereqs from each college's catalog
    platform. This is mandatory, not optional — don't ship a state with
    empty prereqs if catalog data is available.

    Many SIS platforms (PeopleSoft Community Access, some Banner instances)
    don't include prerequisite data in course search results. But the same
    colleges almost always publish prereqs in a separate catalog system
    (Acalog, Courseleaf, Coursedog, or custom HTML).

    **Discovery per college:**
    1. Check common catalog URLs: `catalog.{domain}`, `{domain}/catalog`,
       `{domain}/academics/catalog`
    2. Identify the platform:
       - **Acalog**: page source contains "acalog", URLs like
         `preview_course_nopop.php?catoid=X&coid=Y`
       - **Courseleaf**: page source contains "courseleaf" or "leepfrog",
         URLs like `/coursesaz/{subject}/`
       - **Coursedog**: page source contains "coursedog" or
         `static.catalog.prod.coursedog.com`
       - **Custom HTML**: course descriptions with inline prereq text in
         `<strong>Prerequisite:</strong>` blocks
    3. Check whether individual course pages show "Prerequisite:" text

    **Building the scraper:**
    - Pattern-match against existing catalog prereq scrapers:
      - Acalog → `scripts/tn/scrape-catalog-prereqs.ts`
      - Courseleaf → parse `/coursesaz/{subject}/` pages for
        `Enrollment Requirements:` blocks
      - Custom HTML → parse subject pages for `<strong>Prerequisite:`
      - Coursedog SPA → use `scripts/lib/scrape-coursedog.ts` Playwright template
    - Output format: `{ "PREFIX NUMBER": { "text": "...", "courses": [...] } }`
    - Merge all colleges into one `data/{slug}/prereqs.json`
    - Update `StateConfig.scrapers.prereqs` from
      `{ source: "aggregate-from-courses" }` to
      `[{ scripts: ["scripts/{slug}/scrape-catalog-prereqs.ts"], runner: "playwright" }]`
      (the type is `ScrapeJob[] | { source: "aggregate-from-courses" }`)

    **When to skip:** Only skip a college's catalog if it's auth-gated (SSO
    login wall). Coursedog SPAs are handled via the Playwright template.
    Always note skipped colleges in the PR body.

7. **Pre-PR feature check** (per `CLAUDE.md`'s three-checks-in-order rule).
   Per Section "Verifying your work" item 1: load `/{slug}/colleges` in
   local dev. Use the preview tools:
   - `preview_start` (dev server reads from `.claude/launch.json`)
   - `preview_eval`: navigate to `http://localhost:3000/{slug}/colleges`
   - `preview_snapshot`: confirm all `bootstrap.collegesDiscovered`
     colleges render, not an empty grid
   - If empty grid: the registry edits didn't apply correctly — abort,
     tell the user, do not commit. Almost always means a regex in
     `bootstrap-state.ts`'s `applyRegistryEdit` matched in the wrong place.

   **Then run two data-quality spot checks before continuing.** Rendering
   isn't enough — bad dates and CE-laden term files ship cleanly through
   a grid render. For each of 3 sample colleges:

   - **Dates**: `jq '[.[].start_date] | group_by(.) | map({d: .[0], n: length}) | sort_by(.n) | reverse | .[:3]' data/{slug}/courses/{college}/{term}.json` — the dominant date must fall in the term's expected month range. If you see `2001-*` or `1970-*` for a 2026 term, the template's date parser is splitting on the wrong separator (this is exactly how SMCC shipped 1053 sections dated `2001-08-01`). Fix the template before commit.
   - **Credits**: `jq '[.[] | select(.credits == 0)] | length'` per college. If >50% of sections are 0-credit, the scraper is pulling in CE / non-credit / continuing-ed terms. Investigate the term-code filter (reject CE-coded values, not just CE-labeled ones) before commit.

8. **Commit in three logical chunks.** This makes the PR reviewable;
   reviewers can scan Phase 1 (~thousands of lines of generated data),
   Phase 2 (~tens of thousands of lines of scraped course data), and
   Phase 3-4 separately:

   ```
   # Phase 1
   git add data/{slug}/institutions.json data/{slug}/zipcodes.json \
           data/{slug}/transfer-equiv.json lib/states/{slug}/ \
           lib/states/registry.ts lib/institutions.ts lib/geo.ts
   git commit -m "feat: bootstrap {state} — {N} colleges, Phase 1 ($n PR1/8)"

   # Phase 2 (if any course data)
   git add data/{slug}/courses/
   git commit -m "feat: scrape {state} courses — {sections} sections across {N} colleges"

   # Phase 3 + 4 (if any transfer / prereq data)
   git add data/{slug}/prereqs.json scripts/{slug}/scrape-catalog-prereqs.ts
   git commit -m "feat: {state} prereqs — {N} courses (via {source})"
   # Use ScrapeJob[] when a dedicated catalog scraper exists

   # Phase 5 (if any scorecard data — only when COLLEGE_SCORECARD_API_KEY is set)
   git add data/{slug}/scorecard/ data/{slug}/institutions.json data/scorecard-mapping.json
   git commit -m "feat: ingest {state} College Scorecard data — {ingested} colleges"
   ```

   Skip a chunk if its files don't exist (e.g. if every college had a
   custom platform, there's no Phase 2 commit).

9. **Push:**
   ```
   git push -u origin claude/{slug}-auto-add-state
   ```

10. **Open the PR.** Title: `Add {Full State Name} to Community College
    Path (auto-add-state)`. Body: paste the orchestrator's text report
    plus the manual-TODO list. Use `gh pr create --body-file` so multi-
    line content survives shell escaping.

11. **Surface the TODO list** to the user in the conversation. Group by
    category (`[bootstrap]`, `[fingerprint]`, `[transfers]`, etc.) so the
    user can decide quickly which to address before merging vs which can
    wait. Don't merge for the user — they review and click Squash & merge.

12. **Build bespoke scrapers for non-auth-gated custom-platform colleges
    BEFORE opening the PR.** This is a hard rule: when `manualTodos[]`
    includes `[fingerprint]` entries like "custom HTML/SPA — bespoke
    scraper needed", investigate each before opening the PR. For every
    college whose course-search page is publicly accessible (no SSO,
    no login wall), build the scraper now in the same branch.

    **For `[fingerprint-cluster]` entries** (Phase 2a.5 grouped multiple
    colleges sharing infrastructure): treat the cluster as ONE bespoke-
    scraper target — but first **verify public guest access** via the
    cluster's shared host. A cluster signal proves shared infrastructure;
    it does NOT prove scrape-ability. Probes to run before authoring:

      curl -sIL --max-time 10 -A "Mozilla/5.0" \
        "https://{host}/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL"
      # ↑ PeopleSoft Community Access — LACCD / SD CCD / NV pattern
      curl -sIL ... "https://{host}/StudentRegistrationSsb/ssb/classSearch/classSearch"
      # ↑ Banner SSB 9 guest
      curl -sIL ... "https://{host}/Student/Courses"
      # ↑ Colleague Self-Service guest

    A 200 = green light, follow the LACCD/SD CCD template. A 302 to
    `login.microsoftonline.com` / ADFS / Shibboleth / Ellucian Experience
    SSO = the cluster is auth-gated; **drop it** (file the cluster name in
    the PR body under "auth-gated clusters" for transparency). Don't waste
    cycles trying to bypass SSO. See memory:
    `feedback_verify_public_access_before_cluster_scraper`.

    **Specifically watch out for `experience.elluciancloud.com`** — that's
    Ellucian's *portal aggregator* product, not a class-search system.
    Colleges using it have their class data either (a) behind SSO via
    Banner under the portal, or (b) on the college's own custom public
    schedule page (heterogeneous; not unifiable). Don't try to build a
    single scraper for an "Experience cluster."

    Why: Deferring custom-HTML scrapers as TODOs creates drag — the user
    has to come back, re-investigate each site, and ship per-college
    follow-ups. One comprehensive PR is preferable.

    Workflow per custom college:
    - Use the WebFetch/Agent tools to confirm the URL of the course search
    - Inspect raw HTML via `curl -sL <url>` to understand the table/JSON
      structure
    - Pattern-match against existing bespoke scrapers for templates:
      - WordPress/static HTML tables → `scripts/or/scrape-oregon-coast.ts`
      - ColdFusion form POST → `scripts/or/scrape-tvcc.ts`
      - ASP.NET WebForms (VIEWSTATE) → `scripts/or/scrape-columbia-gorge.ts`
      - JSON API endpoints → `scripts/or/scrape-klamath.ts`
    - Run the scraper, verify a sample record looks correct, drop past
      terms (`year < currentYear` filter), commit data + script + wire
      to `StateConfig.scrapers`.

    When to skip: auth-gated (any SSO/login wall), tiny colleges (<500
    students) where the scraper effort isn't justified, programs/catalog
    platforms (acalog, courseleaf — no course sections), or sites that
    require JavaScript-only interactions you can't reverse-engineer in
    under ~30 minutes.

    **Re-probe before trusting a "PDF-only" / "auth-gated" / "unavailable"
    comment in an existing scraper.** Findings rot — colleges deploy
    Banner SSB 9, swap into Colleague Self-Service, or replace their
    static PDFs with WordPress course-search widgets months after the
    original investigation. Before treating a stale skip note as
    authoritative, re-fetch the college's catalog/registration page and
    check for the patterns its in-state siblings use (WordPress
    year-term chooser, Banner SSB 9 endpoints, Colleague Self-Service
    subdomains). This session's KVCC gap survived because a "PDF only"
    comment in `scrape-mccs.ts` was never re-checked even after the WP
    site started serving the same chooser as the other 6 MCCS colleges.

    Common gotchas:
    - Old ASP.NET sites: require `Accept-Language` header (User-Agent
      alone often isn't enough)
    - JICS/Jenzabar Cloud sites: may use weak DH keys; need
      `ciphers: "DEFAULT@SECLEVEL=0"` via Node's `https.request`
      (Node 20+ fetch can't override)
    - WordPress schedule tables: skip subject-header rows (h4 in cell)
      and lab sub-rows (empty code cell with title like "FOO-Z1 Lab")

## Manual TODOs to expect

The orchestrator's `manualTodos[]` is the most important output. Categories:

- **`[bootstrap]`** — state-metadata.json doesn't have curated entries for
  the state's full name / system name / senior-waiver citation. The
  bootstrap proceeds with placeholder values; the user fills in the right
  values before merging. Always present for a never-before-added state.

- **`[fingerprint]`** — colleges whose SIS platform isn't in the
  banner-ssb-9 / colleague / banner-8 trio. Specifics:
  - `custom HTML/SPA` — **build the bespoke scraper now (step 12)** if
    publicly accessible; only defer if auth-gated
  - `auth-gated` — SSO-only; can't scrape without credentials; user accepts
    the gap or contacts the college
  - `jenzabar` / `peoplesoft` / `workday` / etc. — known platforms with no
    template yet; build inline if a public course-search URL exists,
    otherwise defer
  - `acalog` / `courseleaf` — programs/catalog platforms, not course-search;
    irrelevant for Phase 2
  - `unknown` — no SIS detected; **investigate before opening the PR** —
    often the registration system lives at a discoverable subdomain
    (e.g. `ss.college.edu`, `my.college.edu`, `selfservice.college.edu`)
    that the fingerprinter missed

- **`[transfers]`** — state has no entry in `data/articulation-portals.json`.
  Fallback to CollegeTransfer.Net is suggested but requires per-college
  SourceInstitutionIds (one-time research per college). Or the user adds a
  registry entry once they identify the state's articulation portal.

- **`[prereqs]`** — aggregation yielded 0 entries. This is expected when
  the course-search SIS (PeopleSoft, certain Banner instances) doesn't
  expose prerequisite data. **Do not leave prereqs empty** — proceed to
  the catalog-prereq fallback (step 6b).

## Failure modes

- **Bootstrap fails** (IPEDS API down, FIPS wrong, etc.): abort; tell the
  user to retry. No partial commit, no branch left behind.
  ```
  git checkout main && git branch -D claude/{slug}-auto-add-state
  ```

- **Bootstrap succeeds, every later phase fails**: commit Phase 1 only;
  open the PR with a clear "Phases 2–4 deferred" note. User merges Phase 1
  to unblock the registry, then runs the orchestrator again with
  `--skip-bootstrap` to retry the rest.

- **Some scraper cohort fails (e.g. Banner SSB) but Colleague succeeds**:
  the orchestrator records the failure in `manualTodos`; commit the data
  that did land. PR body explicitly lists which cohorts ran clean.

- **Pre-PR feature check shows empty `/colleges` grid**: don't commit.
  Means the registry edits got applied to the wrong place. Manually
  inspect `lib/institutions.ts`, `lib/geo.ts`, `lib/states/registry.ts`
  for the new state's import + entry. If the registry-edit regex
  appended to the wrong section, fix manually and re-run from step 7.

## What this skill does NOT do

- Refactor any existing scraper (additive-only invariant)
- Import scraped data to Supabase directly (the existing
  `import-on-merge.yml` workflow handles that when the PR lands)
- Phase 5 (programs) — left as a manual follow-up
- Custom-platform scrapers for auth-gated colleges — only public ones get
  built (per step 12 above; auth-gated stays a TODO)

## Adding new platform support later

If, after using this skill, you find that 5+ states keep flagging the
same untemplated platform (Jenzabar, Workday, etc.), that's the signal
to add a new template under `scripts/lib/scrape-{platform}.ts`, register
it in `add-state.ts`'s `TEMPLATED_COURSE_PLATFORMS` array, and ship as
its own PR (same shape as PRs 2–4 of this series).

## After-merge follow-ups (for the user, not the skill)

After the PR merges and Vercel redeploys (~3 minutes):
- Verify `/{slug}/colleges` renders all colleges on prod
- Verify `/{slug}` zip-code search returns at least one college
- Watch the Vercel build for any "statement_timeout" errors on
  `/colleges/page` — see `add-new-state` skill for the SQL fix

The TODO items in the PR body are the user's review checklist. Most can
be deferred (the state is functional without senior-waiver curation),
but a few (custom-portal colleges with high enrollment) are worth
addressing before the state launches publicly.
