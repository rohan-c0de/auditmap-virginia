# MD courses — deferred coverage gaps (2026-06-04)

After this PR, MD courses are at **16/16 (100%, grade A)**, up from 13/16
(81%, C). **All three previously-missing colleges — garrett, cecil, ccbc —
are unblocked and shipped here.** The 2026-06-01 audit's "just re-run the
wired scrapers; no new code" hint dramatically underestimated all three,
but each required a different fix and they all land now:

  - garrett (216 Fall 2026 sections) — 3 stacked JICS bugs
  - cecil (374 Spring 2026 sections) — 5 stacked fixes inc. REST-API short-circuit
  - **ccbc (2,851 Fall 2026 sections) — new bespoke scraper for the post-Banner-8
    static SPA at ccbcmd.edu/Programs-and-Courses-Finder/**

## Per-college blockers

### ccbc — RESOLVED in this PR ✅
- **Status:** 2,851 Fall 2026 sections written to `data/md/courses/ccbc/2026FA.json`,
  all schema-valid. Real curriculum: ENGL 245, MATH 203, BIOL 141, PSYC 140,
  CMNS 121, MUSA 106, CSIT 97, HUSC 94, ACDV 93, MNGT 88, plus 100+ smaller
  subjects.
- **What it took:** CCBC genuinely migrated off Banner 8 in 2026 —
  `simon.ccbcmd.edu/pls/PROD/bwck*` all 404 now. But the data isn't gone, just
  reorganized. The new public course finder at
  `ccbcmd.edu/Programs-and-Courses-Finder/index.html` is a 5.8 MB *static* HTML
  page that **embeds every course as a `<li class="...{term} pc--card--course"
  data-crns="...">` card** — one card per course, multiple CRNs per card, with
  the term encoded in the class list (`fall2026`, `summer2026`, etc.) and seat
  availability augmented from a separate JSON file
  (`cwcascadew1.ccbcmd.edu/bannerimport/ccbcVolatileCourseData.json`).
- **New scraper:** `scripts/md/scrape-ccbc.ts` (HTTP-runner, no Playwright
  needed). Fetches the index HTML, cheerios out the cards, expands each card
  into one section per CRN, joins the volatile-data file for seat counts. Wired
  into `lib/states/md/config.ts` `scrapers.courses` alongside the now-archival
  `scrape-banner8.ts` (left in place for documentation; doesn't conflict because
  banner8 produces 0 sections and the merge happens cleanly).
- **Honest data caveats:** the card UI doesn't carry days/times/instructor or
  credit count — those would require fetching each `course/{prefix}/{number}.html`
  detail page (1,608 extra fetches at full term coverage). Defaulted credits to
  3 (CCBC's standard for credit courses) and `instructor: "To be Announced"`.
  Days/start_time/end_time intentionally empty strings — schema accepts and the
  importer coerces. Students can search by code/title; the missing schedule
  details are a follow-up.

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

- **Garrett shipped** — 216 Fall 2026 sections.
- **Cecil shipped** — 374 Spring 2026 sections.
- **CCBC shipped** — 2,851 Fall 2026 sections via the new bespoke scraper.
- **MD course coverage: 13/16 → 16/16 (81% → 100%). Composite grade C → A.**
- **Three different fix shapes for three different problems**, each
  underestimated by the audit. The unifying lesson: "wired but produces
  nothing" sometimes means stale platform data, not term codes — always
  probe before re-running.
