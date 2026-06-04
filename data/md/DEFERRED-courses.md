# MD courses — deferred coverage gaps (2026-06-04)

After this PR, MD courses are at 14/16 (87.5%, still grade C but one closer).
**Garrett unblocked + shipped here (216 sections).** ccbc and cecil remain
deferred — the 2026-06-01 audit's "just re-run the wired scrapers; no new code"
hint underestimated all three. Per-college diagnoses below.

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

### cecil — ASP.NET WebForms postback semantics needed (medium-large)
- **What THIS PR did fix (genuine prep work, all backward-compatible with garrett):**
  - Discovered the actual public-guest search URL is
    `Course_Search.jnz?portlet=Student_Registration&screen=StudentRegistrationPortlet_CourseSearchView&screenType=next`,
    not the bare landing URL the audit pointed at. Updated the config.
  - Added an Osano cookie-banner dismiss step (cecil's form scripts don't
    run until cookies are dismissed; garrett is unaffected because it has
    no cookie banner).
  - Added cecil's `#stuRegTermSelect` to the term-selector probe list. The
    term dropdown does populate without `waitForFunction` — it just had a
    non-standard ID. The scraper now finds 2 available terms ("Spring
    Credit 2026", "Summer Credit 2026"; no Fall 2026 published yet) and
    selects Spring 2026 correctly.
  - Reordered the search-button selector list to try text-specific
    selectors first (`button:has-text("Search Courses")`) so the generic
    `button[type="submit"]` doesn't match cecil's Login button.
- **Final remaining blocker:** even after a successful search-button click,
  cecil's `<button type="submit">Search Courses</button>` doesn't trigger a
  visible page change. The URL stays the same; the only table on the page
  (the form-input table, 17 rows) doesn't update. Cecil's portlet is
  ASP.NET WebForms, and the button is likely wired to call
  `__doPostBack(...)` against the page's `__VIEWSTATE` to submit the search
  via ASP.NET's server-side postback mechanism. A plain Playwright `.click()`
  doesn't go through this code path.
- **Next action (separate PR):** instead of `.click()`, drive the search
  via `page.evaluate(() => __doPostBack('<eventTarget>', ''))` after
  inspecting the button's actual onclick handler to find the event target.
  Cecil's term dropdown may also need the same — the term-change might
  need a postback to populate department options. Once results land,
  garrett's header-aware row extractor (this PR) likely works for cecil
  too — but the table column headers should be verified.

### garrett — RESOLVED in this PR ✅
- **Status:** 216 sections written to `data/md/courses/garrett/2026FA.json`
  with all rows passing schema validation. Real curriculum coverage: ACC, ART,
  BIO, BUS, CIS, COM, ENG, MAT, PSY, SOC, etc.
- **What the audit missed (3 stacked bugs, each fixed):**
  1. `waitUntil: "networkidle"` timed out because garrett's portal has
     persistent analytics — changed to `"load"`.
  2. Term selection used substring match (`2026FA`) against option text like
     `"Fall 2026"` — never matched. Now parses the target term into year +
     semester word and matches semantically. Also skips Subterm A/B options
     in favor of the full-term parent.
  3. Garrett's results table is header-rowed (`Course code | Name | Faculty
     | Seats Open | Status | Schedule | Credits | Begin Date | End Date`)
     and has NO separate CRN column — section number is embedded in the
     course-code cell as `"ACC 210 01"`. Added a header-aware "Strategy 0"
     extractor that maps cells by column name and synthesizes CRN from the
     section number (matching the existing aacc/2026FA convention where
     `crn: "001"` is the section).
- **Why audit was misled:** the "Banner 8 term codes like 202691" hint
  applied to ccbc, not garrett. Garrett's JICS uses academic-year-end
  encoding (`2027;FA` = Fall 2026) which the audit didn't probe.

## Net effect of this PR

- **Garrett resolved (data shipped):** 216 sections at
  `data/md/courses/garrett/2026FA.json` covering 15+ subject prefixes. MD
  course coverage goes from **13/16 → 14/16 (87.5%)**. Still under the 90%
  B+ bar, but closes one of the three audited gaps with real student-facing
  schedule data.
- **Three real bugs in `scripts/md/scrape-jenzabar.ts` fixed in this PR:**
  (a) `networkidle` → `load` (garrett wait); (b) semantic term matching with
  subterm-skip (garrett, will also help cecil once cecil's term dropdown
  loads); (c) header-aware "Strategy 0" row extractor with section-as-CRN
  (garrett, generic for any JICS table with a header row). Used in BOTH the
  initial extraction and the pagination loop's secondary extraction —
  garrett has 11 result pages.
- **Cecil + ccbc still deferred** with sharper diagnoses. Each is a
  separate small-to-medium PR.
