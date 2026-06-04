# MD courses — deferred coverage gaps (2026-06-04)

MD currently has courses for 13/16 colleges (81%, grade C). The 3 missing colleges
all have wired scrapers in `lib/states/md/config.ts`, but live grounding today
showed each one is blocked by a *different* real problem — none is a simple re-run.
The 2026-06-01 state-audit's hint "just re-run the wired scrapers; no new code"
predates the platform changes documented below.

## Per-college blockers

### ccbc — Banner 8 platform migration (largest scope)
- **Configured target:** `scripts/md/scrape-banner8.ts` against
  `simon.ccbcmd.edu/pls/PROD/bwckschd.p_disp_dyn_sched` (Banner 8 schedule lookup).
- **Today (2026-06-04):** the entire `/pls/PROD/bwck*` endpoint set returns **HTTP
  404**. `simon.ccbcmd.edu/pls/PROD/homepage.htm` exists but serves a blank Oracle
  Apex shell — Banner 8 is gone.
- **Where the data is now:** `www.ccbcmd.edu/Programs-and-Courses-Finder/index.html`
  serves a 6 MB client-side single-page app (fuse.js + jQuery; no SIS endpoint
  references; no Banner/PeopleSoft/Destiny/Coursedog/CollegeScheduler markers).
  Course data is loaded after `DOMContentLoaded` via JS — needs Playwright or a
  static-data probe to locate.
- **Next action (separate PR):** identify the JS-fetched data source for the new
  course-finder app and build a bespoke `scrape-ccbc.ts`. Not a re-run.

### cecil — JICS portlet term selection is JS-rendered (medium)
- **Configured target:** `scripts/md/scrape-jenzabar.ts` against
  `my.cecil.edu/ICS/Course_Search.jnz`.
- **Today:** page is reachable (HTTP 200, IIS). Scraper navigates successfully.
  But the static HTML for `Course_Search.jnz` carries no `<select name="*term*">`
  options — the term dropdown is populated client-side by JICS JavaScript after
  `load`. The scraper assumes server-rendered options and submits the form with
  a hardcoded `2026FA` term, which produces zero results. The scraper's
  pagination logic then tries to click "next page" → 30s element-not-visible
  timeout.
- **Next action (separate PR):** in `scrape-jenzabar.ts`, wait for the term
  `<select>` to be populated (`page.waitForFunction(() => document.querySelector(...).options.length > 0)`)
  before reading available terms. Then guard the pagination loop: don't click
  next-page when page 1 returned 0 rows.

### garrett — JICS row-parser doesn't match garrett's table layout (medium)
- **Configured target:** `scripts/md/scrape-jenzabar.ts` against
  `my.garrettcollege.edu/ICS/Portal_Homepage.jnz?portlet=AddDrop_Courses`.
- **Today:** page is reachable (HTTP 200, IIS, Jenzabar JICS 2025.1.0). The
  original `waitUntil: "networkidle"` timed out because garrett's portal has
  persistent network activity that never quiesces. **This PR fixes that** —
  changing to `waitUntil: "load"` lets the scraper reach the page.
- **Remaining problem:** with the wait fix, the scraper now **extracts 4 raw
  rows** for `garrett/2026FA` — but every row is missing `course_title` and
  `crn`, so the row-level schema validator aborts (100% invalid > 5% threshold).
  Garrett's table structure differs from the layout the row parser expects.
- **Next action (separate PR):** dump garrett's rendered course-search HTML
  after a real search submission, compare to the row-parser selectors in
  `scrape-jenzabar.ts`, and add a garrett-specific extractor variant.

## Net effect of this PR

- **Scraper fix shipped:** `scripts/md/scrape-jenzabar.ts` no longer hangs on
  garrett's persistent-network page (`networkidle` → `load`). This is a generic
  JICS improvement; cecil and any future JICS college also benefits from a
  saner default wait.
- **No new data for any of the 3 colleges.** Each is blocked by a real issue
  the audit didn't anticipate; shipping the wait-strategy fix unblocks one
  step on garrett's path and shrinks the next person's grounding work.
- **MD coverage unchanged at 13/16 (C).** Lifting it requires the 3 follow-up
  PRs above.
