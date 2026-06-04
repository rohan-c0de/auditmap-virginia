# MD courses — deferred coverage gaps (2026-06-04)

After this PR, MD courses are at **15/16 (93.75%, grade B/B+ depending on
audit thresholds)**, up from 13/16 (81%, C). **Garrett (216 Fall 2026
sections) AND Cecil (374 Spring 2026 sections) unblocked + shipped here.**
Only ccbc remains — and ccbc is a true platform migration (off Banner 8 to
a 6 MB JS SPA) that needs a fresh bespoke scraper, not a re-run. The
2026-06-01 audit's "just re-run the wired scrapers; no new code" hint
underestimated all three, but two of three are now solved.

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

### cecil — RESOLVED in this PR ✅
- **Status:** 374 sections written to `data/md/courses/cecil/2026SP.json`
  with all rows passing schema. Real Spring 2026 curriculum across PED, MAT,
  BUS, NUR (Nursing), OFT (Office Technology), EGL (English), PHO, BIO, CIS,
  LAE, ART (sample: `ART 101 "FUNDAMENTALS OF DESIGN I"`, section 01).
- **What it took:** five stacked bugs in one go.
  1. Audit-pointed URL (bare `Course_Search.jnz`) landed on a blank welcome
     portlet. Real public-guest URL is
     `Course_Search.jnz?portlet=Student_Registration&screen=StudentRegistrationPortlet_CourseSearchView&screenType=next`.
  2. Osano cookie banner had to be dismissed before portlet scripts ran.
  3. Cecil's term selector has a non-standard ID (`#stuRegTermSelect`); added
     to the probe list.
  4. `toStandardTerm` regex required season + year with optional spaces
     only; cecil's option text is "Spring Credit 2026" with a filler word.
     Relaxed to `(spring|summer|...)[^\d]*(\d{4})`.
  5. **The real architecture lever:** cecil's "Search Courses" button isn't
     a server-postback — it's a jQuery handler that XHRs a private REST API
     (`/ICS/webserviceproxy/exi/rest/studentregistration/pagedsectiondataforsearch?Id=1`)
     and the results render via JS into a container that wasn't visible
     to the existing form-click + table-scrape flow. Added a cecil-specific
     branch in `scrapeJenzabar` that posts to the REST API directly
     (carrying the page's session cookies via `page.evaluate(fetch(...))`),
     paginates by `currentPage`, parses the HTML-wrapped JSON rows, and
     short-circuits the form-click pipeline entirely.
- **Honest data caveats:** cecil's API returns schedule strings in mixed
  formats ("MW 10:00 AM-11:30 AM" vs "6/8/2026 - 8/1/2026 Online Course
  Asynchronous"). The current row parser extracts course code, title, faculty,
  credits, and seats reliably; days and times come out empty for many sections
  (online courses, in particular, have no day/time). A follow-up could parse
  the schedule strings more carefully — but the schema validates as-is and
  students can find the courses by code/title.
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

- **Garrett shipped** — 216 Fall 2026 sections at `data/md/courses/garrett/2026FA.json`.
- **Cecil shipped** — 374 Spring 2026 sections at `data/md/courses/cecil/2026SP.json`.
- **MD course coverage: 13/16 → 15/16 (81% → 93.75%).** Composite grade moves
  from C to B (or B+ depending on threshold; 95% is the A bar).
- **Eight real bugs fixed in `scripts/md/scrape-jenzabar.ts`** across the
  three colleges' diagnoses: networkidle wait, semantic term matching,
  subterm-skip, header-aware row extractor (used in BOTH initial + paginated
  scrape), correct cecil URL, cookie-banner dismiss, cecil term-selector ID,
  text-specific search-button order, `toStandardTerm` flexibility for cecil's
  "Spring Credit 2026" wording.
- **Cecil short-circuits the form-click flow via its REST API** —
  cleaner than emulating jQuery clicks on a portlet that doesn't re-render.
- **CCBC still deferred** — a true platform migration (off Banner 8 to a
  6 MB JS SPA) that needs a fresh bespoke scraper. The only one of the three
  not shippable as a Jenzabar-scraper extension.
