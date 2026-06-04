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
