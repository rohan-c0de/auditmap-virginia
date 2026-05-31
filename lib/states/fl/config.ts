import type { StateConfig } from "../registry";

const flConfig: StateConfig = {
  slug: "fl",
  name: "Florida",
  systemName: "FCS",
  systemFullName: "Florida College System",
  systemUrl: "https://www.fldoe.org/schools/higher-ed/fl-college-system/",
  collegeCount: 28,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "FL Stat. § 1009.26(4)",
    description:
      "Florida residents aged 60 and older may have tuition and fees waived at Florida College System institutions for credit courses on a space-available basis. Each college decides which fees to waive; credit earned this way does not count toward graduation.",
    bannerTitle: "Florida Senior Tuition Waiver",
    bannerSummary:
      "Over 60 in Florida? Tuition and fees may be waived at FCS colleges for space-available enrollment.",
    bannerDetail:
      "Florida law allows residents aged 60+ to attend Florida College System credit courses with tuition and fees waived on a space-available basis. Each college sets its own policy on which fees are waivable; credit earned this way generally does not apply toward graduation.",
  },

  // Florida transfers run on SCNS (Statewide Course Numbering System) —
  // courses with the same prefix + 3-digit number + lab code at any FL
  // public institution are equivalent by FL Stat. § 1007.24. Phase 3
  // scraper at scripts/fl/scrape-scns-flatfile.ts builds transfer-equiv
  // from SCNS's public flat-file dump.
  transferSupported: true,
  popularCourses: ["ENC 1101", "MAC 1105", "BSC 1010", "PSY 2012", "AMH 2010", "SYG 2000"],
  defaultZip: "33132",
  defaultZipCity: "Miami",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.fldoe.org/schools/higher-ed/fl-college-system/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.fldoe.org/schools/higher-ed/fl-college-system/",

  branding: {
    siteName: "Community College Path Florida",
    tagline:
      "Search Florida College System courses across all 28 state colleges.",
    footerText:
      "Community College Path Florida — Find courses across all 28 FCS colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Florida College System or the Florida Department of Education.",
    metaKeywords: [
      "Florida community college courses",
      "FCS course search",
      "Florida College System",
      "Florida community college schedule",
      "Florida senior tuition waiver",
    ],
  },
  universityAliases: [
    { slug: "uf", names: ["UF", "University of Florida", "Gators"] },
    { slug: "fsu", names: ["FSU", "Florida State", "Florida State University"] },
    { slug: "ucf", names: ["UCF", "Central Florida", "University of Central Florida"] },
    { slug: "usf", names: ["USF", "South Florida", "University of South Florida"] },
    { slug: "fiu", names: ["FIU", "Florida International", "Florida International University"] },
    { slug: "fau", names: ["FAU", "Florida Atlantic", "Florida Atlantic University"] },
    { slug: "famu", names: ["FAMU", "Florida A&M", "Florida A&M University"] },
    { slug: "fgcu", names: ["FGCU", "Florida Gulf Coast", "Florida Gulf Coast University"] },
    { slug: "unf", names: ["UNF", "North Florida", "University of North Florida"] },
    { slug: "uwf", names: ["UWF", "West Florida", "University of West Florida"] },
    { slug: "ncf", names: ["NCF", "New College", "New College of Florida"] },
    { slug: "flpoly", names: ["Florida Poly", "Florida Polytechnic", "Florida Polytechnic University"] },
    { slug: "miami", names: ["Miami", "University of Miami", "UM"] },
    { slug: "rollins", names: ["Rollins", "Rollins College"] },
  ],
  scrapers: {
    courses: [
      // Banner SSB 9 — 10 colleges (the largest cluster after the platform
      // survey in #270). The other 16 FCS colleges use Banner 8, Workday
      // (auth-gated), PeopleSoft, Coursedog, or custom apps; those will
      // land in separate scrapers as Phase 2 follow-up PRs.
      { scripts: ["scripts/fl/scrape-banner-ssb.ts"], runner: "http" },
      // Banner 8 (legacy) — fgc + cfk, the only two FCS colleges on
      // classic Banner. Uses the shared template at lib/scrape-banner-8.
      { scripts: ["scripts/fl/scrape-banner8.ts"], runner: "http" },
      // Coursedog catalog (FSCJ) — Workday-registered colleges that publish
      // a public Coursedog catalog. Sections are auth-gated but the catalog
      // gives course-level prereqs feeding into prereqs.json.
      { scripts: ["scripts/fl/scrape-coursedog.ts"], runner: "playwright" },
      // St. Petersburg College — custom paginated JSON API at
      // classes.spcollege.edu. ~4.7k sections per term plus prereq
      // text embedded in course descriptions (~60% coverage). See
      // scrape-spcollege.ts header for the API shape.
      { scripts: ["scripts/fl/scrape-spcollege.ts"], runner: "http" },
      // Eastern Florida State College — ColdFusion form at
      // webapps.easternflorida.edu/schedule_search/. Capped at 100
      // results per query so the scraper iterates over the 238
      // subject-prefix values from the search form's <select>.
      { scripts: ["scripts/fl/scrape-easternflorida.ts"], runner: "http" },
      // Broward College — FCCSC servlet at mybc.broward.edu. Requires
      // a JSESSIONID + F5/Volterra WAF cookie from a GET to the JSP,
      // then one POST per (term, subject prefix). 131 prefixes.
      { scripts: ["scripts/fl/scrape-broward.ts"], runner: "http" },
      // Miami Dade College — PeopleSoft "Community Access" class search
      // at findclasses.mdc.edu/psc/PMYM1J/CUSTOMER/SA/...
      // Playwright-driven because PS Class Search is a JS-heavy form
      // with a ">100 sections" confirmation modal. 198 subjects × 2
      // terms. ~50k students. ~25% of sections carry a campus
      // (Kendall/Wolfson/Hialeah/Medical/Padron/Homestead/North) derived
      // from the location prefix; the rest stay empty since the
      // result-DOM has no campus column. Required tricks documented in
      // the scraper:
      //   • use psc/ (not psp/) so the form isn't wrapped in an iframe
      //   • Course Number ≤ 9999 as a no-op 2nd criterion
      //   • set value FIRST then operator-by-label (reverse loses op)
      //   • fixed sleeps, not networkidle waits
      //   • recycle the page every 10 subjects (AJAX state degrades)
      { scripts: ["scripts/fl/scrape-mdc.ts"], runner: "playwright" },
      // Daytona State College — PeopleSoft "Community Access" at
      // csprd.daytonastate.edu (site DSCGUEST). Same quirks as MDC's
      // PS deployment; see scrape-daytonastate.ts header.
      { scripts: ["scripts/fl/scrape-daytonastate.ts"], runner: "playwright" },
      // Hillsborough Community College (Tampa) — simple public REST API
      // at classes.hccfl.edu/api/courseSection?term=26/FA. One JSON blob
      // per term, no auth, no pagination. ~5.9k sections across 2 terms.
      { scripts: ["scripts/fl/scrape-hccfl.ts"], runner: "http" },
      // Palm Beach State College — custom ASP.NET WebForms app at
      // studentcoursesearch.palmbeachstate.edu. One GET+POST per
      // (term wildcard, subject prefix). CRN extracted from detail
      // page link in each row. ~30k students, Palm Beach County.
      { scripts: ["scripts/fl/scrape-palmbeachstate.ts"], runner: "http" },
      // Tallahassee State College — public ASP.NET MVC SPA at
      // link.tsc.fl.edu/publicclasssearch with HTML-fragment endpoints.
      // GET search page for cookies; POST GetCourseResults for course
      // list per term; POST GetCourseSectionResults per course for
      // sections. ~10k students.
      { scripts: ["scripts/fl/scrape-tcc.ts"], runner: "http" },
      // North Florida College — Oracle APEX report at
      // infonetwork.nfc.edu/apex/r/nfcapi/nfc_schedule/course-schedule.
      // One HTTP GET returns the entire schedule (all terms) as a single
      // HTML table. Smallest scraper in the FL set. ~1.5k students.
      { scripts: ["scripts/fl/scrape-nfc.ts"], runner: "http" },
      // Chipola College — Jenzabar JICS Course_Schedule portlet at
      // my.chipola.edu. Uses the shared scripts/lib/scrape-jenzabar-webforms
      // template (template now falls back to domcontentloaded on
      // networkidle timeout — JICS keeps background AJAX alive).
      { scripts: ["scripts/fl/scrape-jenzabar-webforms.ts"], runner: "playwright" },
      // College of Central Florida (Ocala) — Jenzabar CX 1.10 public
      // CGI gateway at register.cf.edu:9040/cgi-bin/public/crscat.cgi.
      // Two-step flow: POST setopt.cgi to set (prog,sess,yr) into the
      // session cookie; POST crscat.cgi with department=<code> for
      // sections. ~16k students.
      { scripts: ["scripts/fl/scrape-cf.ts"], runner: "http" },
      // Seminole State College — public catalog drill-down at
      // www.seminolestate.edu/catalog/courses (A-Z → 3-letter prefix
      // → courseSlug). Each course page has one or more
      // <table class="course-listing"> tables (one per session)
      // with section rows. ~30k students.
      { scripts: ["scripts/fl/scrape-seminolestate.ts"], runner: "http" },
      // Santa Fe College (Gainesville) — Ellucian/SunGard eSfcc servlet
      // at epublic.sfcollege.edu. Stage-1 form (SR1098) is stateful JS,
      // but Stage-2 category pages (SR1099P) are plain GETs keyed by
      // ORG_CD. 87 category codes captured 2026-05-31; refresh from the
      // iframe category links if SF adds subjects. ~16k students.
      { scripts: ["scripts/fl/scrape-santafe.ts"], runner: "http" },
      // not-scrapable: fscj — PeopleSoft Campus Solutions at
      //   csprd.fscj.edu with no guest realm provisioned. Investigated
      //   2026-06: tried both `csprdguest` and `FSCJGUEST` site names —
      //   both return a 62-byte "Site name is not valid" body. The
      //   `COMMUNITY_ACCESS.CLASS_SEARCH.GBL` page on the main realm
      //   redirects to login (`cmd=login&errorPg=ckreq`). No Banner or
      //   alternate SIS subdomain exists at fscj.edu, and no PDF
      //   schedule on the academics page. Only the Coursedog course
      //   catalog (scrape-coursedog.ts above) yields public data; that
      //   gives course descriptions + prereqs but never sections.
      //   Revisit if FSCJ ever provisions csprd_guest.
      // not-scrapable: pensacolastate — migrated to Workday Student
      //   (wd501.myworkday.com/pensacolastate). Investigated 2026-06:
      //   Workday Student has no public guest class-search by design —
      //   this is an architectural property of the platform, not a
      //   config gap. The `pensacolastate.edu/course-search/` WordPress
      //   form POSTs to a JS widget that calls Workday client-side and
      //   returns nothing without auth. No Banner / Colleague endpoint
      //   exists anywhere on pensacolastate.edu. Revisit only if PSC
      //   enables Workday's public "find-courses" task (some Workday
      //   institutions do, this one does not).
    ],
    transfers: [
      // SCNS flat-file dump — single 80 MB download, no auth, covers all
      // 28 FCS × 12 public 4-year articulations in one run. Replaces the
      // per-receiver scraper pattern used in other states.
      { scripts: ["scripts/fl/scrape-scns-flatfile.ts"], runner: "http" },
    ],
    // Banner SSB 9 sections carry prereqs inline; Coursedog catalog data
    // contributes catalog-level prereqs for FSCJ. Aggregator walks both
    // data/fl/courses/*/* and data/fl/coursedog-catalog/*.json.
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — Phase 5+.
  },
};

export default flConfig;
