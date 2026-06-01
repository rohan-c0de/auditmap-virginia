# untouchable-investigator — evaluation set

Ground-truth classifications for the `untouchable-investigator` agent. Each case is a real college drawn from the `custom`/`unknown` set of `data/state-health/fingerprint-baseline.json` (post-PR #528). The agent is run against each case; if its classification matches the **Classification** below and its reasoning cites at least one of the **Key signals**, the case passes.

Target accuracy before shipping the agent: ≥80% match on Classification, ≥60% of cases with reasoning hitting ≥1 key signal.

---

## Classification taxonomy

The agent outputs exactly one of these labels per investigated college. Labels map to recommended actions; if two cases produce the same action they should share a label.

| Label | Definition | Recommended action |
|-------|------------|--------------------|
| `templated-actually` | Working public endpoint for a KNOWN SIS (Banner SSB 9 / Banner 8 / Colleague / PeopleSoft / Jenzabar / Coursedog), discovered on a non-canonical subdomain the fingerprinter missed | Wire to existing template; report the subdomain pattern so the fingerprinter can be extended |
| `bespoke-html-public` | Public course-search page, but custom HTML / not a known SIS (e.g. WordPress course pages, Acalog catalog, ColdFusion forms, Empower-XL, CampusCE) | Write a bespoke scraper — but check first if a sibling college needs the same scraper (often it does) |
| `pdf-catalog-only` | Course data only available as downloadable PDFs. No interactive search | Needs PDF extractor — group by whether the PDF format is common (institutional PDF schedules tend to follow a small set of templates) |
| `articulation-portal-covered` | A state articulation portal (AL STARS, OH TM, etc.) carries this college's courses | No direct scraper needed — extend the state-portal scraper if one exists; build it if not |
| `shared-cluster` | Part of a multi-college district whose other members are known templates (e.g. CCC's 7 Chicago colleges, Peralta CCD) | Build/extend the cluster scraper — one scraper, many colleges |
| `auth-only` | Genuinely requires login. No public catalog. Truly inaccessible | Document explicitly and remove from "needs investigation" |
| `investigate-further` | Promising signals but the investigation needed deeper tools (Playwright to bypass Cloudflare/Fastly bot challenges, manual exploration, etc.) | Re-run with Playwright-enabled investigator or human triage |

---

## Background context the agent is allowed to use

- `curl` against the college's primary URL and any plausible subdomain variants
- The fingerprinter's known URL patterns for each SIS
- Knowledge of common platforms (Acalog, CourseLeaf, Empower-XL, CampusCE, Lumens, DNN)
- The state's existing scraper directory (`scripts/{state}/`) to spot cluster scrapers
- Existing data files (`data/{state}/courses/{slug}/`) to detect "already scraped" cases
- The fingerprint baseline (`data/state-health/fingerprint-baseline.json`)

The agent must NOT write scrapers, modify files, or open PRs. Output is structured JSON the caller acts on.

---

## Cases

### Case 1 — VA / nova (Northern Virginia Community College)
**Classification:** `bespoke-html-public`

**Primary URL:** `nvcc.edu`

**Key signals:**
- `https://www.nvcc.edu/academics/schedule/crs2262/search` returns a working HTML form with `Subject`, `CatalogNbr`, `Session` selects
- Per-term `crs{NNNN}` directories follow a predictable pattern
- NOVA is part of VCCS — the my-portal (`nvcc.my.vccs.edu`) appears to be PeopleSoft Community Access style

**Reasoning:** Marketing site IS the SIS frontend — uncommon but real. Bespoke HTML form, public access, no auth. Note for builder: check VCCS-wide guest endpoint before writing per-college code.

---

### Case 2 — NC / martin (Martin Community College)
**Classification:** `bespoke-html-public`

**Primary URL:** `martincc.edu`

**Key signals:**
- `https://www.martincc.edu/courses/` exposes 408 public WordPress course pages with structured `.kenii-sidebar__fact` blocks (Credit Hours, Class Hours, Lab Hours, Prerequisites, Corequisites, Transfer CAA Approved)
- Live registration at `ss.martincc.edu` (Colleague Self-Service, likely login-gated) — but the catalog data we want is in the public WP site
- Each page also has a "Programs Using This Course" cross-link section

**Reasoning:** Catalog data is fully exposed via WordPress — separate from the SIS. Clean markup, no Cloudflare blocks with browser UA.

---

### Case 3 — NC / wilkes (Wilkes Community College)
**Classification:** `templated-actually`

**Primary URL:** `wilkescc.edu`

**Key signals:**
- Colleague Self-Service live at `https://selfservice.cloud.wilkescc.edu/Student/Courses` — HTTP 200, Ellucian CSS confirmed
- `?SearchResultsView=1&Terms=2026FA` returns 287 KB result HTML with `SectionListing`, `SectionDetails`, `courseId`
- Fingerprinter missed because host is `selfservice.cloud.wilkescc.edu`, not the canonical `selfservice.wilkescc.edu`

**Reasoning:** Wire to existing Colleague template. The agent should specifically flag the non-canonical subdomain pattern so the fingerprinter's `SUBDOMAIN_PREFIXES` list can be extended.

---

### Case 4 — GA / atlanta-tech (Atlanta Technical College)
**Classification:** `templated-actually`

**Primary URL:** `atlantatech.edu`

**Key signals:**
- Homepage links directly to `https://bannerss.atlantatech.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search` (HTTP 200)
- Banner getTerms API at `/StudentRegistrationSsb/ssb/classSearch/getTerms?...` returns JSON with terms (fully public guest)
- Plus a SmartCatalogIQ at `https://atlantatech.smartcatalogiq.com/...` listing every course by subject
- This is the **Georgia TCSG-wide pattern** — likely covers many other GA technical colleges; worth probing TCSG siblings for `bannerss.<host>.edu`

**Reasoning:** Wire to Banner SSB 9 template using `bannerss.atlantatech.edu`. State-system note matters: probing sister colleges is high-leverage follow-up.

---

### Case 5 — TN / chattanooga-state (Chattanooga State Community College)
**Classification:** `investigate-further`

**Primary URL:** `chattanoogastate.edu`

**Key signals:**
- Site behind aggressive Cloudflare "Just a moment…" challenge — blocks curl, WebFetch, even Googlebot UA (HTTP 403)
- DNS for common Banner/Colleague subdomains (`ssb`, `banner`, `selfservice`, `ssprod`, `registration`, `my`, `reg`) returns no record
- External evidence (YouTube tutorial title) suggests Banner Self-Service, but host name is unknown without rendering JS
- TBR (TN Board of Regents) system has 13 community colleges; one Playwright probe across all 13 would discover the pattern

**Reasoning:** Defer with a Playwright-based follow-up that executes the Cloudflare JS challenge.

---

### Case 6 — NY / hostos-cc (Eugenio María de Hostos Community College)
**Classification:** `templated-actually`

**Primary URL:** `hostos.cuny.edu`

**Key signals:**
- Already wired: `scripts/ny/scrape-cuny.ts` has `"hostos-cc": { code: "HOS01" }` via `globalsearch.cuny.edu/CFGlobalSearchTool/search.jsp`
- Data file exists at `data/ny/programs/hostos-cc.json`
- This was a false-positive in the fingerprint sweep because CUNY Global Search lives on a system-wide host, not `hostos.cuny.edu`

**Reasoning:** No new work — verify the scraper still runs; fingerprint baseline is stale on this entry.

---

### Case 7 — PA / butler (Butler County Community College)
**Classification:** `bespoke-html-public`

**Primary URL:** `bc3.edu`

**Key signals:**
- Acalog catalog at `https://academic-catalog.bc3.edu/` returns AWS WAF challenge page (Acalog hallmark)
- Course-schedule landing page at `bc3.edu/credit-schedule/index.html` confirms public schedule
- Also has Ellucian Experience SSO portal at `experience.elluciancloud.com/bccc564/` (auth-only, skip)

**Reasoning:** Write a Playwright-based Acalog scraper that clears the AWS WAF JS challenge once, then iterates `content.php?catoid=27&navoid=<id>` pages. Reusable across many Acalog-using colleges.

---

### Case 8 — MA / hcc (Holyoke Community College)
**Classification:** `bespoke-html-public`

**Primary URL:** `hcc.edu`

**Key signals:**
- Acalog catalog at `https://catalog.hcc.edu/` (AWS WAF challenge, Acalog signature)
- Course finder page at `hcc.edu/courses-and-programs/course-finder` links to `catalog.hcc.edu/content.php?catoid=13&navoid=562`

**Reasoning:** Same Acalog Playwright scraper as Butler. **Build the Acalog template once → unlocks multiple colleges.** Sibling clue: at least 3 of these 20 cases (Butler, HCC, CF) share the Acalog pattern.

---

### Case 9 — FL / cf (College of Central Florida)
**Classification:** `bespoke-html-public`

**Primary URL:** `cf.edu`

**Key signals:**
- Acalog at `https://catalog.cf.edu/` (AWS WAF challenge)
- Also publishes full PDF catalog at `pr.cf.edu/files/college-catalog/CF-2025-2026-College-Catalog.pdf` as fallback

**Reasoning:** Same Acalog template; PDF is a backup if WAF gets in the way.

---

### Case 10 — AL / marion-military-institute (Marion Military Institute)
**Classification:** `pdf-catalog-only`

**Primary URL:** `marionmilitary.edu`

**Key signals:**
- Only academic content is PDF catalogs: `marionmilitary.edu/core/uploads/2025/10/CatalogSY2526-PDF-Version.pdf` (current) plus archive 2014-2025
- No SIS subdomains reachable (sonisweb/jicsweb/my/portal all 000)
- Registrar page links only to PDFs

**Reasoning:** Try AL STARS articulation portal first (per `reference_al_stars_graphql.md`) — if MMI courses are in STARS, use that. Otherwise PDF extractor needed.

---

### Case 11 — MS / mississippi-delta-community-college
**Classification:** `templated-actually`

**Primary URL:** `msdelta.edu`

**Key signals:**
- Banner 8 guest live at `https://mybanner.msdelta.edu/PROD/bwckschd.p_disp_dyn_sched` — `<title>Dynamic Schedule</title>`, classic Banner 8 markup
- Linked from `/programs/register/course-information.php`
- Fingerprinter missed because host is `mybanner.<domain>` (not in `SUBDOMAIN_PREFIXES`)

**Reasoning:** Wire to existing Banner 8 template; report `mybanner` as a new SUBDOMAIN_PREFIX to add.

---

### Case 12 — MS / itawamba-community-college
**Classification:** `bespoke-html-public`

**Primary URL:** `iccms.edu`

**Key signals:**
- Custom DNN module "ICC_Live_Class_Schedule" at `https://www.iccms.edu/CourseSchedule` (200, linked from homepage as "Live Course Schedule")
- ASP.NET WebForms postbacks (`__EVENTTARGET`, `__VIEWSTATE`); no Banner/Colleague markers
- Term dropdown drives postback flow; results render in `DesktopModules/ICC_Live_Class_Schedule`

**Reasoning:** Build bespoke Playwright scraper that drives the term dropdown + postback flow.

---

### Case 13 — MI / saginaw-chippewa-tribal-college
**Classification:** `bespoke-html-public`

**Primary URL:** `sagchip.edu`

**Key signals:**
- Jenzabar Empower-XL SIS at `https://sctc.empower-xl.com/fusebox.cfm?fuseaction=CourseCatalog` (181 KB public "Query Course Schedule" page)
- ColdFusion `fusebox.cfm?fuseaction=CourseCatalog&rpt=1` flow
- Marketing site is Wix; SIS is on its own host
- No login required for the catalog query

**Reasoning:** Build bespoke Empower-XL scraper. Likely reusable for other Empower-XL schools (small market, but template-able).

---

### Case 14 — IA / iowa-lakes-community-college
**Classification:** `templated-actually`

**Primary URL:** `iowalakes.edu`

**Key signals:**
- Colleague Self-Service confirmed at `https://myselfservice.iowalakes.edu/Student/Courses` (200, 189 KB, DOMPurify + `subjectSelectCaption` strings)
- Linked from homepage as `myselfservice.iowalakes.edu/Student/Student/Courses`
- Fingerprinter missed because host is `myselfservice.<domain>` (not in `SUBDOMAIN_PREFIXES`)

**Reasoning:** Wire to existing Colleague template; add `myselfservice` to subdomain prefixes.

---

### Case 15 — TX / angelina-college
**Classification:** `templated-actually`

**Primary URL:** `angelina.edu`

**Key signals:**
- Jenzabar JICS Find_Classes portlet at `https://myac.angelina.edu/ICS/Find_Classes/Before_you_start.jnz?portlet=Student_Registration&screen=StudentRegistrationPortlet_CourseSearchView` (200, 38 KB, `jenzabar.userSettings`)
- Identical pattern to the Montcalm example in `scripts/lib/scrape-jenzabar.ts`
- Bonus: Acalog at `catalog.ac.angelina.edu` and Campus Concourse syllabi at `angelina.campusconcourse.com/search?timeframe=current_future` also public
- Fingerprinter missed because host is `myac.<domain>` (college-specific prefix)

**Reasoning:** Wire to Jenzabar template with the Course_Search portlet URL. Custom `myac` subdomain — fingerprinter needs general improvement to follow homepage links to non-canonical hosts (already partly there via the harvest phase; needs investigation why it missed this case).

---

### Case 16 — TX / southwest-college-for-the-deaf
**Classification:** `bespoke-html-public`

**Primary URL:** `howardcollege.edu/swcd`

**Key signals:**
- Public course schedule at `https://students.howardcollege.edu/cePortalOffering_pub.asp?term=494` (CampusCE/Lumens portal, 88 KB HTML)
- Separate Acalog catalog at `catalog.howardcollege.edu` is WAF-challenged (HTTP 202)
- SWCD is a satellite of Howard College — all sections live in same portal

**Reasoning:** Write bespoke scraper against `students.howardcollege.edu/cePortalOffering_pub.asp`; filter to SWCD location code. CampusCE/Lumens is a known platform — template-able.

---

### Case 17 — IL / city-colleges-of-chicago-harry-s-truman-college
**Classification:** `shared-cluster`

**Primary URL:** `ccc.edu/colleges/truman/pages/default.aspx`

**Key signals:**
- CourseLeaf catalog at `https://catalog.ccc.edu/courses-az/<subject>/` (e.g. `/afro_am/`)
- Course blocks contain credits, prereqs, AND per-campus offer codes: `Offered At: DA, HW, KK, MX, OH, TR, WR`
- Truman = `TR` campus code
- This is the CCC (City Colleges of Chicago) cluster — 7 colleges share one catalog

**Reasoning:** Build a single CCC CourseLeaf scraper that produces all 7 colleges' data by filtering on the `Offered At` codes. One scraper unlocks 7 colleges. The agent should flag this cluster pattern explicitly so the user doesn't write 7 separate scrapers.

---

### Case 18 — IL / kishwaukee-college
**Classification:** `templated-actually`

**Primary URL:** `kish.edu`

**Key signals:**
- Colleague Self-Service guest endpoint live at `https://kish-ss.colleague.elluciancloud.com/Student/Courses/Search` (200, 278 KB, title "Kishwaukee College Self-Service")
- Homepage "Search for Courses" button points there
- This is Ellucian Cloud-hosted Colleague — fingerprinter missed because the host is `<slug>.colleague.elluciancloud.com` rather than a college-domain subdomain

**Reasoning:** Wire to Colleague template. Fingerprinter improvement: recognize the `*.colleague.elluciancloud.com` pattern as a valid Colleague host (already partly handled by URL patterns; the missed case suggests homepage didn't link directly to this URL).

---

### Case 19 — MT / stone-child-college
**Classification:** `investigate-further`

**Primary URL:** `stonechild.edu`

**Key signals:**
- Behind Fastly JS bot challenge (CSP-locked SPA, `_fs-ch-` path, "Client Challenge" title)
- Only 3 KB shell returned to curl
- Alt domain `stonechildcollege.edu` errors
- Tribal college — likely small catalog
- Probably becomes `pdf-catalog-only` once accessible

**Reasoning:** Needs Playwright headless fetch to bypass the challenge, then look for catalog/PDF.

---

### Case 20 — OR / columbia-gorge-community-college
**Classification:** `pdf-catalog-only`

**Primary URL:** `cgcc.edu`

**Key signals:**
- `cgcc.edu/catalog` lists only `25-26-catalog-web_1.pdf` (current) + historical PDF catalogs back to 2015
- `/schedule` page links to per-term Google Sheets (e.g. `docs.google.com/spreadsheets/d/...`)
- No SIS guest URL found in HTML
- MyCGCC student portal is auth-only

**Reasoning:** Needs PDF extractor for catalog course descriptions. Optionally a Google Sheets scraper for current-term sections — but PDF is the canonical data.

---

## How to use this file

1. **Grading the agent**: feed each Case's Primary URL + slug + state to the agent (without classification or reasoning). Capture the agent's output. Compare classification to ground truth; check whether the agent's reasoning cites at least one Key signal.
2. **Pass criteria**:
   - Classification matches exactly
   - Reasoning mentions ≥1 listed Key signal (paraphrased is fine; exact match not required)
3. **Target**: ≥80% classification, ≥60% with reasoning hitting ≥1 key signal.
4. **Iteration order**: focus first on classification mismatches; then on weak reasoning. Don't try to fix everything at once.

## Distribution

Of the 20 cases:
- 7× `templated-actually` (35%) — fingerprinter false-negatives on non-canonical subdomains
- 7× `bespoke-html-public` (35%) — varied platforms (WordPress, Acalog, DNN, Empower-XL, CampusCE)
- 2× `pdf-catalog-only` (10%)
- 2× `investigate-further` (10%) — Cloudflare/Fastly bot challenges
- 1× `shared-cluster` (5%) — CCC's 7 Chicago colleges
- 0× `auth-only`
- 0× `articulation-portal-covered` (none surfaced in this random sample; coverage gap to fill in future expansions)

The 0× on `auth-only` is the most important finding from this set: **across 20 random "custom/unknown" colleges, zero are truly inaccessible**. Combined with the earlier 10-college spot-check (also 0/10 auth-only), the evidence strongly suggests `auth-only` is rare in the 207-college "needs investigation" set. The agent's job is mostly disambiguation: which of the OTHER categories does each fall into?

## Coverage gaps for future expansion

- 0× `articulation-portal-covered` in this sample. AL STARS, OH TM, etc. carry significant data for some colleges — should be in the eval set.
- 0× `auth-only` — if any genuinely-locked colleges exist in the 207, an eval case for them would teach the agent to recognize and stop investigating.
- Only 1× `shared-cluster` — the CCC pattern is common (Peralta CCD, Maricopa CCD, Alamo Colleges, Los Rios) and the agent should reliably identify it.
