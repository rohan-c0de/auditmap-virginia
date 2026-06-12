import type { StateConfig } from "../registry";

// Texas has no statewide SIS — every district runs its own class search. These
// are per-college public class-search / registration entry points, harvested
// from the working scrapers in scripts/tx/ and each probed 2026-06-12 (HTTP 200
// for curl with a browser UA, or verified rendering in real headless Chromium
// where a bot wall blocks curl — noted inline).
//
// Five Alamo Colleges share one public Banner SSB instance (same host the
// scraper uses; the student-facing aces.alamo.edu portal is login-walled).
const ALAMO_CLASS_SEARCH =
  "https://lum010.alamo.edu:8010/StudentRegistrationSsb/ssb/classSearch/classSearch";
// Howard College + SW College for the Deaf share one Concourse instance.
// The root redirects to /login but /search is public.
const HOWARD_CLASS_SEARCH = "https://howardcollege.campusconcourse.com/search";

const REGISTRATION_URLS: Record<string, string> = {
  // hccs.edu's own "class searcher" link — auto-establishes a PeopleSoft guest
  // session in the browser and lands on Class Search (curl sees ?cmd=login
  // because the guest auto-login is JS; verified in headless Chromium).
  "houston-community-college": "https://www.hccs.edu/class-searcher/",
  "san-antonio-college": ALAMO_CLASS_SEARCH,
  "st-philips-college": ALAMO_CLASS_SEARCH,
  "palo-alto-college": ALAMO_CLASS_SEARCH,
  "northwest-vista-college": ALAMO_CLASS_SEARCH,
  "northeast-lakeview-college": ALAMO_CLASS_SEARCH,
  // Colleague Self-Service guest course search (same hosts the scrapers use).
  "amarillo-college": "https://acselfservice.actx.edu/Student/Courses",
  "odessa-college": "https://sserv.odessa.edu/Student/Courses",
  "college-of-the-mainland": "https://selfserve.com.edu/Student/Courses",
  "mclennan-community-college": "https://mymcc.mclennan.edu/Student/Courses",
  "alvin-community-college":
    "https://self-service.alvincollege.edu/Student/Courses",
  "vernon-college":
    "https://vernon-ss.colleague.elluciancloud.com/Student/Courses",
  "del-mar-college": "https://colss-prod.ec.delmar.edu/Student/Courses",
  // Public, but Cloudflare Bot Management 403s curl — renders fine in a real
  // browser ("Search for Courses and Course Sections", verified in Chromium).
  "central-texas-college": "https://student.ctcd.org/Student/Courses",
  // Jenzabar ICS public course-search portlets.
  "kilgore-college":
    "https://accesskc.kilgore.edu/ICS/Current_Students/Academics/AddDrop_Courses.jnz",
  "panola-college":
    "https://pctportal.jenzabarcloud.com/ICS/Admin/Shared_Features/Everyone.jnz?portlet=Student_Registration&screen=StudentRegistrationPortlet_CourseSearchView&screenType=next",
  "paris-junior-college":
    "https://mypjc.parisjc.edu/ICS/Portal_Homepage.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search&screenType=next",
  "north-central-texas-college":
    "https://my.nctc.edu/ICS/Academics/Academics_Homepage.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search&screenType=next",
  "texarkana-college":
    "https://my.texarkanacollege.edu/ICS/Home.jnz?portlet=Course_Search&screen=Advanced+Course+Search&screenType=next",
  "midland-college":
    "https://mymcportal.midland.edu/ICS/Course_Search.jnz?portlet=Course_Search&screen=Advanced+Course+Search&screenType=next",
  "northeast-texas-community-college": "https://myeagle.ntcc.edu/ICS/Find_Courses/",
  // Banner SSB 9 class search.
  "victoria-college":
    "https://xe-stu.victoriacollege.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "laredo-college":
    "https://reg-prod.laredo.elluciancloud.com:8103/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "wharton-county-junior-college":
    "https://reg-prod.wcjc.elluciancloud.com:8103/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "san-jacinto-community-college":
    "https://reg-prod.ec.sanjac.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "lamar-institute-of-technology":
    "https://reg-prod.litsaas.elluciancloud.com:8103/StudentRegistrationSsb/ssb/classSearch/classSearch",
  // Banner 8 dynamic schedule.
  "tyler-junior-college": "https://ssbprod.tjc.edu:8100/prod/bwckschd.p_disp_dyn_sched",
  // Bespoke public schedule apps (same endpoints the scrapers read).
  "austin-community-college-district": "https://www6.austincc.edu/schedule/",
  "collin-county-community-college-district": "https://collin-coursebook.web.app/",
  "dallas-college": "https://schedule.dallascollege.edu/",
  "grayson-college": "https://planner.grayson.edu/Planner/CourseSearch",
  "brazosport-college":
    "https://mybcnext.brazosport.edu/CMCPortal/Common/CourseSchedule.aspx",
  "cisco-college": "https://admin.cisco.edu/cc4/web_course_avail.html",
  "clarendon-college": "https://ci.clarendoncollege.edu/",
  "lone-star-college-system": "https://campus.lonestar.edu/classsearch.htm",
  "howard-college": HOWARD_CLASS_SEARCH,
  "southwest-college-for-the-deaf": HOWARD_CLASS_SEARCH,
  // Per-term PDF schedules live on this page.
  "frank-phillips-college": "https://fpctx.edu/student-resources/",
  // Public schedule app; its search POST is Turnstile-walled for bots
  // (documentedCeilings) but the page renders fine for humans (verified in
  // Chromium: "TVCC Schedule Of Classes").
  "trinity-valley-community-college": "https://webapps.tvcc.edu/ClassSched2/",
};

// Honest fallback for colleges with no public class search (login-walled SIS —
// see documentedCeilings — or no scraper yet): the college's own homepage,
// from data/tx/scorecard schoolUrl. Never tacc.org per college — TACC is a
// trade association, useless to a student trying to register.
const COLLEGE_HOMEPAGES: Record<string, string> = {
  "angelina-college": "https://www.angelina.edu/",
  "blinn-college-district": "https://www.blinn.edu/",
  "coastal-bend-college": "https://www.coastalbend.edu/",
  "el-paso-community-college": "https://www.epcc.edu/",
  "galveston-college": "https://www.gc.edu/",
  "hill-college": "https://www.hillcollege.edu/",
  "lamar-state-college-orange": "https://www.lsco.edu/",
  "lamar-state-college-port-arthur": "https://www.lamarpa.edu/",
  "lee-college": "https://www.lee.edu/",
  "navarro-college": "https://www.navarrocollege.edu/",
  "ranger-college": "https://www.rangercollege.edu/",
  "south-plains-college": "https://www.southplainscollege.edu/",
  "south-texas-college": "https://www.southtexascollege.edu/",
  // Canonical domain; the whole swtjc.edu web presence was timing out at probe
  // time (2026-06-12) — kept anyway since it's still the college's only site.
  "southwest-texas-junior-college": "https://www.swtjc.edu/",
  "tarrant-county-college-district": "https://www.tccd.edu/",
  "temple-college": "https://www.templejc.edu/",
  "texas-southmost-college": "https://www.tsc.edu/",
  "texas-state-technical-college": "https://www.tstc.edu/",
  "weatherford-college": "https://www.wc.edu/",
  "western-texas-college": "https://www.wtc.edu/",
};

const collegeUrl = (collegeSlug: string): string =>
  REGISTRATION_URLS[collegeSlug] ??
  COLLEGE_HOMEPAGES[collegeSlug] ??
  "https://www.tacc.org/";

const txConfig: StateConfig = {
  slug: "tx",
  name: "Texas",
  systemName: "Texas Community Colleges",
  systemFullName: "Texas Public Community Colleges",
  // Texas has no single statewide CC system — 50 independent districts
  // overseen by the Texas Higher Education Coordinating Board. The Texas
  // Association of Community Colleges (TACC) is the closest thing to a
  // unified portal.
  systemUrl: "https://www.tacc.org/",
  collegeCount: 59,

  // Texas Education Code § 54.365 ("Tuition Exemption for Persons 65
  // Years of Age or Older") — Texas residents 65+ may take up to 6 credit
  // hours per semester at any state-funded institution tuition-free, on a
  // space-available basis. Each college applies the waiver on top of its
  // own registration timing.
  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "Tex. Educ. Code § 54.365",
    description:
      "Texas residents aged 65 and older may enroll in up to 6 credit hours per semester at any state-funded community college tuition-free, on a space-available basis. Fees may still apply; each college sets registration timing for senior space-available seats.",
    bannerTitle: "Texas Senior Tuition Exemption",
    bannerSummary:
      "Over 65 in Texas? Up to 6 credit hours per semester may be tuition-free at any state-funded college.",
    bannerDetail:
      "Texas Education Code § 54.365 lets Texas residents aged 65+ take up to 6 credit hours per semester at any state-funded community college without paying tuition, on a space-available basis. Fees still apply; seats are allocated after regular registration. Contact your college's registrar for the timing.",
  },

  transferSupported: true,
  popularCourses: ["ENGL 1301", "MATH 1314", "ENGL 1302", "HIST 1301", "GOVT 2305", "EDUC 1300"],
  defaultZip: "77002",
  defaultZipCity: "Houston",

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) =>
    collegeUrl(collegeSlug),

  collegeCoursesUrl: (collegeSlug: string) => collegeUrl(collegeSlug),

  branding: {
    siteName: "Community College Path Texas",
    tagline: "Search Texas community college courses across all 59 public colleges.",
    footerText: "Community College Path Texas — Find courses across all 59 Texas public community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Texas Higher Education Coordinating Board, the Texas Association of Community Colleges, or any Texas community college.",
    metaKeywords: [
      "Texas community college courses",
      "Texas community college schedule",
      "Texas community colleges",
      "Texas senior tuition exemption",
    ],
  },
  scrapers: {
    courses: [
      // Houston Community College runs PeopleSoft Fluid with an ICAJAX
      // class search behind a guest session. Driven by Playwright — sweeps
      // the keyword search to enumerate courses, then drills each course's
      // SSR_CS_WRAP_FL detail page to capture section rows (CRN, dates,
      // days/times, location, instructor, seats). Writes both the
      // section file (data/tx/courses/houston-community-college/{TERM}.json)
      // and a catalog dump (data/tx/coursedog-catalog/houston-community-college.json)
      // for prereq aggregation.
      {
        scripts: ["scripts/tx/scrape-hccs.ts"],
        runner: "playwright",
      },
      // Alamo Colleges District (San Antonio) — 5 colleges share one
      // public Banner SSB 9 instance at lum010.alamo.edu:8010 (the
      // aces.alamo.edu Banner is auth-gated; this lum010 host has guest
      // read-only access). Same pattern as IECC + UHCC: one Banner
      // session per term, split by campusDescription into 5 buckets.
      // Closes issue #456 cluster #2.
      {
        scripts: ["scripts/tx/scrape-alamo.ts"],
        runner: "http",
      },
      // Ellucian Colleague Self-Service — 2 colleges. The auto-add-state
      // fingerprinter only probed colleges' primary domains and missed
      // these subdomain SIS hosts:
      //   amarillo-college  → acselfservice.actx.edu
      //   odessa-college    → sserv.odessa.edu
      // Closes 2 of 3 remaining colleges from issue #456 cluster #8.
      // Kilgore (Jenzabar at accesskc.kilgore.edu) deferred to a
      // follow-up since its portlet URL isn't the standard
      // Course_Search.jnz pattern the template expects.
      {
        scripts: ["scripts/tx/scrape-colleague.ts"],
        runner: "playwright",
      },
      // Kilgore College — Jenzabar ICS Course Search portlet at
      // accesskc.kilgore.edu. Uses the ASP.NET WebForms variant
      // (pg0$V$ddlTerm, pg0$V$btnSearch) so the standard Jenzabar
      // template at scripts/lib/scrape-jenzabar.ts (which expects
      // #stuRegTermSelect) doesn't apply. Custom Playwright scraper
      // drives the form, paginates via the letter-chunk "Next page -->"
      // postback, and parses the results <table> directly.
      // Closes the final remaining college from issue #456 cluster #8.
      {
        scripts: ["scripts/tx/scrape-kilgore.ts"],
        runner: "playwright",
      },
      // Howard College + Southwest College for the Deaf share a single
      // Concourse Syllabus Management instance (Intellidemia) at
      // howardcollege.campusconcourse.com. One scraper covers both slugs;
      // the form's campus_id filter splits SW → swcd and BS/LA/SA/ON →
      // howard-college. HTTP-only — Concourse exposes paginated search
      // results as plain HTML, no auth, no JS required. Sparse data: no
      // CRN/seats/meeting times in the public listing (CRN synthesized
      // from Concourse's internal course_id; instructor IS available).
      {
        scripts: ["scripts/tx/scrape-howard.ts"],
        runner: "http",
      },
      // Vernon College + Victoria College — two standalone Banner SSB 9
      // instances with public guest access. Vernon serves SSB at the root
      // domain (www.vernoncollege.edu) rather than the usual subdomain.
      {
        scripts: ["scripts/tx/scrape-banner-ssb.ts"],
        runner: "http",
      },
      // Panola College — standard Jenzabar StudentRegistration portlet
      // (public Everyone.jnz path, uses #stuRegTermSelect). Driven by the
      // shared template at scripts/lib/scrape-jenzabar.ts.
      {
        scripts: ["scripts/tx/scrape-jenzabar.ts"],
        runner: "playwright",
      },
      // Paris Jr, NCTC, Texarkana — Jenzabar ASP.NET WebForms variant
      // (`pg0$V$ddlTerm` + `pg0$V$btnSearch`, letter-chunk pager). Driven
      // by a new shared template at scripts/lib/scrape-jenzabar-webforms.ts
      // that generalizes the existing bespoke Kilgore scraper.
      {
        scripts: ["scripts/tx/scrape-jenzabar-webforms.ts"],
        runner: "playwright",
      },
      // Collin County Community College District — a custom Azure App
      // Service REST API at coursebook-collin-api.azurewebsites.net/sections
      // powers the public class-schedule SPA. Workday-flavored JSON; no
      // auth, paginated 10 items/page (server caps explicit pageSize to
      // 0), ~195 pages, ~1,948 sections. 86% of sections expose a
      // prerequisite sentence in the Description field, so the scraper
      // captures prereq_text + prereq_courses inline.
      {
        scripts: ["scripts/tx/scrape-collin.ts"],
        runner: "http",
      },
      // Clarendon College — bespoke ASP.NET WebForms class search at
      // ci.clarendoncollege.edu. Sparse data: dept, course nbr, type,
      // section, title, credits, status, instructor — no CRN, no meeting
      // days/times, no seats. Course-identity + instructor data still has
      // planner value. ~205 sections per cron tick.
      {
        scripts: ["scripts/tx/scrape-clarendon.ts"],
        runner: "playwright",
      },
      // Lone Star College System (~93k students). Guest auto-POST to
      // PS Classic CommunityAccess CLASS_SEARCH. Per (campus, subject) loop;
      // PS Classic enforces a 250-section result cap so the scraper splits
      // over-limit queries by catalog-nbr halves (≤1999 / ≥2000). 8 campuses,
      // ~172 subjects → ~1,400 queries / term, ~8h headless run.
      {
        scripts: ["scripts/tx/scrape-lsc.ts"],
        runner: "playwright",
      },
      // Cisco College — Power Campus "CC4" widget at
      // admin.cisco.edu/cc4/web_course_avail.html. One PXwidget AJAX call
      // per term returns every section as a fixed-16-column HTML table
      // (Course ID, Term, Title, Days, Times, Dates, Location, Instructor,
      // Credits, Limit, Enrolled, Campus, Short ID, Notes). ~650 sections
      // / term, ~1 min per term × 5 terms = ~5 min total run.
      {
        scripts: ["scripts/tx/scrape-cisco.ts"],
        runner: "playwright",
      },
      // Northeast Texas Community College — Jenzabar JICS Simple_Query
      // "Find Courses" portlet at myeagle.ntcc.edu/ICS/Find_Courses/. Each
      // term has a hidden "Export to Excel" button whose response is
      // actually an HTML <table> (18 cols, no header) with full schedule
      // data. The export link returns "(cache empty)" cold — the term's
      // View Results postback must fire first to prime the server cache.
      // ~1,800 sections / 5 terms, ~30s per term.
      {
        scripts: ["scripts/tx/scrape-netcc.ts"],
        runner: "playwright",
      },
      // Frank Phillips College — per-term, per-campus PDF schedules from
      // fpctx.edu/student-resources/. Each PDF is text-extractable (no OCR
      // needed); pdftotext -layout preserves the 12-column schema (Course
      // Code, Section, Course Name, Credits, Days, Times, Building/Room,
      // Faculty Last+First, Dates). Summer PDFs use an 11-column variant
      // with merged Faculty Name. URLs are pinned per term in TERM_PDFS.
      {
        scripts: ["scripts/tx/scrape-frank-phillips.ts"],
        runner: "http",
      },
      // Tyler Junior College — Banner 8 (classic bwckschd dynamic schedule) on
      // a non-standard host+port: ssbprod.tjc.edu:8100/prod. Driven by the
      // shared Banner 8 template; ~2,700 sections across the live terms.
      {
        scripts: ["scripts/tx/scrape-banner8.ts"],
        runner: "http",
      },
      // Austin Community College District — the public ACC Online Course
      // Schedule PHP app at www6.austincc.edu/schedule (no auth; the Colleague
      // selfservice.austincc.edu is login-gated). Enumerates every credit term
      // × discipline and parses the section tables. ~23k sections / 5 terms.
      // (Largest TX district; credits aren't published in the schedule view.)
      {
        scripts: ["scripts/tx/scrape-austin.ts"],
        runner: "http",
      },
      // Grayson College — public custom .NET "Student Planner" at
      // planner.grayson.edu/Planner/CourseSearch/{termId}. Parses the per-term
      // HTML section table (no CRN — synthesized; credits not published).
      // ~2,700 sections / 5 terms.
      {
        scripts: ["scripts/tx/scrape-grayson.ts"],
        runner: "http",
      },
      // Brazosport College — public Campus Management Corp (CMC) ASP.NET
      // WebForms portal at mybcnext.brazosport.edu/CMCPortal. Session-warmup
      // GET then per-term postback returns the full section grid (client-side
      // DataTables, no server pagination). ~1,000 sections / 2 terms.
      {
        scripts: ["scripts/tx/scrape-brazosport.ts"],
        runner: "http",
      },
      // Central Texas College — Ellucian Colleague Self-Service at
      // student.ctcd.org. The ctcd.org domain is behind Cloudflare Bot
      // Management, so the shared colleague template (plain Playwright) can't
      // clear the managed challenge. This bespoke scraper drives a STEALTH
      // Chromium context (navigator.webdriver hidden, real Chrome UA) that
      // passes the challenge, then hands that context to the shared Colleague
      // section logic. ~1,800 sections / 2 terms, prereqs enriched.
      {
        scripts: ["scripts/tx/scrape-central-texas.ts"],
        runner: "playwright",
      },
      // Dallas College (former DCCCD, ~70k students — the largest TX district).
      // Credit registration is Workday (SSO), but the legacy eConnect credit
      // class schedule at schedule.dallascollege.edu is public — fronted by AWS
      // WAF, so a plain fetch is challenged. This bespoke scraper drives a
      // stealth Chromium that clears the WAF, walks term → subject → sections,
      // and parses the eConnect result tables. ~18k sections / 2 terms; long
      // rate-limited run (detach on cron).
      {
        scripts: ["scripts/tx/scrape-dallas.ts"],
        runner: "playwright",
      },
    ],
    transfers: [
      { scripts: ["scripts/tx/scrape-transfer-tccns.ts"], runner: "http" },
    ],
    prereqs: [
      // Six TX colleges publish their course catalog via Acalog but don't
      // expose a public class-section endpoint. The Acalog detail pages
      // embed a Prerequisites sentence — that's enough to enrich the
      // semester planner's prereq chain for these colleges' courses.
      // Brazosport, Dallas, Midland, Tyler Jr, Lamar State Orange,
      // Wharton County — all six are Imperva-gated; the scraper acquires
      // WAF cookies via headless Chromium once per base URL.
      { scripts: ["scripts/tx/scrape-acalog-prereqs.ts"], runner: "playwright" },
      // Two more TX colleges publish their catalog via CourseLeaf (not
      // Acalog). San Jacinto uses subject-roll-up pages with
      // <div class="courseblock"> blocks; Grayson uses per-course detail
      // pages. The scraper handles both layouts.
      { scripts: ["scripts/tx/scrape-courseleaf-prereqs.ts"], runner: "http" },
    ],
    programs: [
      {
        // discover-catalogs.ts fingerprints each TX college's catalog platform
        // → data/tx/catalog-discovery.json; the platform scrapers read it.
        // Keep ordered — discovery MUST run before the scrapers. Coverage:
        // 7 plannable colleges (834 programs). Gaps in data/tx/DEFERRED-programs.md
        // (6 Acalog colleges with non-standard catoid dropdowns, Alamo/Lone Star
        // district-shared catalogs, unknown-platform colleges).
        scripts: [
          "scripts/tx/discover-catalogs.ts",
          "scripts/tx/scrape-smartcatalogiq-programs.ts",
          "scripts/tx/scrape-acalog-programs.ts",
          "scripts/tx/scrape-misc-programs.ts",
        ],
        runner: "http",
      },
    ],
  },

  // Colleges with no public, scrapeable live-section source. Each was probed
  // live in 2026-06 (fingerprint + SIS-subdomain sweep + Playwright). The
  // /state-audit collector drops these from the course-coverage denominator so
  // the grade reflects what's actually reachable, not a permanent gap we can fix.
  documentedCeilings: {
    courses: [
      // Colleague Self-Service — section/term data behind login (catalog shell
      // may render publicly, but the schedule does not).
      {
        collegeSlug: "galveston-college",
        reason:
          "Colleague Self-Service (gcsis-ssprod.gc.edu) gates section/term data behind Account/Login; only the catalog shell is public.",
      },
      {
        collegeSlug: "texas-southmost-college",
        reason:
          "Colleague search page redirects to SSO login at colss-prod.tscsaas.elluciancloud.com — no public live-section data.",
      },
      {
        collegeSlug: "western-texas-college",
        reason:
          "Colleague Self-Service (wtc-ss.colleague.elluciancloud.com) sets logInUrl with no unauthenticated course-search path.",
      },
      {
        collegeSlug: "texas-state-technical-college",
        reason:
          "Colleague Self-Service (selfservice.tstc.edu) immediately SAML-redirects to tstc.auth.securid.com — no anonymous guest path.",
      },
      {
        collegeSlug: "southwest-texas-junior-college",
        reason:
          "Colleague SIS migrated — old colss-prod.ec.swtjc.edu is NXDOMAIN and current selfservice.swtjc.edu is unreachable (connection times out); no reachable public class search.",
      },
      // Jenzabar ICS — Course Search portlet / section REST is login-walled.
      {
        collegeSlug: "angelina-college",
        reason:
          "Jenzabar ICS (myac.angelina.edu) section REST endpoint returns 0 bytes without a login session; schedule is login-walled.",
      },
      {
        collegeSlug: "el-paso-community-college",
        reason:
          "Jenzabar ICS (my.epcc.edu) returns HTTP 401 on all class-search paths (incl. Before_you_start.jnz) — login required throughout.",
      },
      {
        collegeSlug: "hill-college",
        reason:
          "Jenzabar ICS (myhc.hillcollege.edu) Advanced Course Search portlet renders only a login form (no public ddlTerm).",
      },
      {
        collegeSlug: "ranger-college",
        reason:
          "Jenzabar ICS (rctportal.jenzabarcloud.com) Advanced Course Search portlet renders only a login form (no public ddlTerm).",
      },
      // PeopleSoft — class search behind the EMPLOYEE portal, no guest realm.
      {
        collegeSlug: "lee-college",
        reason:
          "PeopleSoft (mylccampus.lee.edu) CLASS_SEARCH 302-redirects to login; no classsearchguest / community-access portal is configured.",
      },
      // Cloudflare-protected POST — the public schedule app loads fine on GET
      // but the data only arrives via a postback that Cloudflare Turnstile
      // (Managed Challenge) blocks for automation (verified headless + headed
      // real Chrome). Same class of ceiling as CollegeSource TES.
      {
        collegeSlug: "trinity-valley-community-college",
        reason:
          "webapps.tvcc.edu/ClassSched2 renders on GET but its ASP.NET section-search POST hits a Cloudflare Turnstile managed challenge (403) for all automation incl. headed real Chrome; no public API and the catalog is also Cloudflare-walled.",
      },
      // No machine-readable SIS at all.
      {
        collegeSlug: "lamar-state-college-orange",
        reason:
          "No machine-readable SIS — the only public schedule is a hand-maintained HTML table (lsco.edu) with no CRN/section/instructor/seats; catalog is Acalog (descriptions only).",
      },
    ],
  },
};

export default txConfig;
