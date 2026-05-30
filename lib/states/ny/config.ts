import type { StateConfig } from "../registry";

// NY covers TWO community-college systems: CUNY (7 NYC institutions) and
// SUNY (30 statewide community colleges). Phase 1 scraped only the 7 CUNY
// CCs; Phase 2 (#794) adds 16 SUNY CCs across Banner SSB, Colleague
// Self-Service, and bespoke HTML platforms.
//
// CUNY course search runs through https://globalsearch.cuny.edu/CFGlobalSearchTool/
// — a JSP/ColdFusion wrapper around CUNYfirst (PeopleSoft Campus Solutions)
// that returns HTML. SUNY CCs each run their own SIS, so per-college URLs
// below point to each institution's actual class-search endpoint.
const COLLEGE_REGISTRAR_URLS: Record<string, string> = {
  // CUNY (Phase 1):
  "bmcc": "https://www.bmcc.cuny.edu/registrar/academics-classes-registration/class-search/",
  "bronx-cc": "https://www.bcc.cuny.edu/academics/registrar/",
  "guttman-cc": "https://guttman.cuny.edu/students/registrar/",
  "hostos-cc": "https://www.hostos.cuny.edu/Administrative-Offices/Office-of-the-Registrar",
  "kingsborough-cc": "https://www.kbcc.cuny.edu/registrar/",
  "laguardia-cc": "https://www.laguardia.edu/registrar/",
  "queensborough-cc": "https://www.qcc.cuny.edu/registrar/",
  // SUNY CCs — Banner SSB 9 (canonical banner.<domain>):
  "suny-adirondack": "https://banner.sunyacc.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search",
  "jefferson-cc": "https://banner.sunyjefferson.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search",
  "columbia-greene-cc": "https://banner.sunycgcc.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search",
  "dutchess-cc": "https://banner.sunydutchess.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search",
  "rockland-cc": "https://banner.sunyrockland.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search",
  "corning-cc": "https://banner.corning-cc.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search",
  "suny-broome-cc": "https://banner.sunybroome.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search",
  "suny-ulster": "https://banner.sunyulster.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search",
  // SUNY CCs — Banner SSB 9 (non-canonical subdomains):
  "monroe-cc": "https://bannerp.monroecc.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search",
  "nassau-cc": "https://banner.ncc.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search",
  "suffolk-cc": "https://lighthouse.sunysuffolk.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search",
  "suny-schenectady": "https://banprod.sunysccc.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search",
  // SUNY CCs — Colleague Self-Service:
  "finger-lakes-cc": "https://selfservice.flcc.edu/Student/Courses",
  "onondaga-cc": "https://colss-prod.ec.sunyocc.edu/Student/Courses",
  // SUNY CCs — bespoke HTML schedules:
  "cayuga-cc": "https://www.cayuga-cc.edu/academics/schedule-of-classes/",
  "herkimer-cc": "https://herkimer.edu/academics/course-schedule/fall/",
  // SUNY CCs — Phase 2b (course data not yet scraped; registrar links only):
  "clinton-cc": "https://web.clinton.edu/registrar/",
  "north-country-cc": "https://www.nccc.edu/registration/index.html",
  "hudson-valley-cc": "https://www.hvcc.edu/academics/catalog/",
  "suny-orange": "https://sunyorange.edu/registrar/",
  "fmcc": "https://fmcc.edu/programs-offerings-2/courses-class-schedules",
  "genesee-cc": "https://www.genesee.edu/academics/course-finder/",
  "mvcc": "https://www2.mvcc.edu/courses/",
  "tompkins-cortland-cc": "https://www.tompkinscortland.edu/students",
  "jamestown-cc": "https://www.sunyjcc.edu/courses",
  "erie-cc": "https://wd5-student.myworkdaysite.com/ecc/SUNYErie",
  "suny-niagara": "https://sunyniagara.edu/",
  "suny-sullivan": "https://sunysullivan.edu/",
  "westchester-cc": "https://www.sunywcc.edu/academics/",
  "fit": "https://www.fitnyc.edu/academics/",
};

const GLOBAL_SEARCH_URL = "https://globalsearch.cuny.edu/CFGlobalSearchTool/search.jsp";

const nyConfig: StateConfig = {
  slug: "ny",
  name: "New York",
  systemName: "CUNY + SUNY",
  systemFullName: "The City University of New York (CUNY) and State University of New York (SUNY) community-college systems",
  systemUrl: "https://www.suny.edu",
  collegeCount: 37,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "N.Y. Education Law \u00A7 6304(5)",
    description:
      "New York State residents aged 60 and older may audit undergraduate courses at CUNY community colleges on a space-available basis with tuition waived. Regular fees (student activity, technology, lab) may still apply, and audited courses do not count for degree credit.",
    bannerTitle: "CUNY Senior Citizen Tuition Waiver",
    bannerSummary:
      "Age 60 or older in New York? You can audit CUNY community college courses with tuition waived.",
    bannerDetail:
      "CUNY's Senior Citizen Audit Program (N.Y. Education Law \u00A7 6304(5)) allows New York State residents aged 60+ to audit undergraduate courses at CUNY community colleges tuition-free on a space-available basis. Regular student fees may still apply and audit registration typically opens after matriculated students register.",
  },

  transferSupported: true,
  // Transfer data from two systems:
  //   1. CUNY Transfer Explorer (T-Rex) — explorer.cuny.edu → 14 CUNY senior colleges
  //   2. SUNY STEP — step.transfer.suny.edu → ~28 SUNY 4-year campuses

  popularCourses: ["ENG 101", "MAT 150", "BIO 100", "HIS 101", "PSY 100", "SPE 100"],
  defaultZip: "10007",
  defaultZipCity: "New York",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) => {
    // CUNY Global Search requires a JSESSIONID cookie to process query params —
    // without server-side session state the params are silently ignored.
    return GLOBAL_SEARCH_URL;
  },

  collegeCoursesUrl: (collegeSlug: string) => {
    return COLLEGE_REGISTRAR_URLS[collegeSlug] || GLOBAL_SEARCH_URL;
  },

  branding: {
    siteName: "Community College Path New York",
    tagline:
      "Search CUNY and SUNY community college courses across New York and plan your schedule.",
    footerText:
      "Community College Path New York \u2014 Find courses across CUNY and SUNY community colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by The City University of New York (CUNY) or the State University of New York (SUNY).",
    metaKeywords: [
      "CUNY community college courses",
      "SUNY community college courses",
      "CUNY class search",
      "SUNY class search",
      "New York community college schedule",
      "NYC community college courses near me",
      "SUNY senior citizen tuition waiver",
      "CUNY senior citizen tuition waiver",
      "City University of New York",
      "State University of New York",
    ],
  },
  universityAliases: [
    { slug: "suny-albany", names: ["UAlbany", "SUNY Albany", "University at Albany"] },
    { slug: "suny-buffalo", names: ["UB", "University at Buffalo", "SUNY Buffalo", "Buffalo"] },
    { slug: "stony-brook", names: ["Stony Brook", "SBU", "SUNY Stony Brook"] },
    { slug: "binghamton", names: ["Binghamton", "Binghamton University", "SUNY Binghamton"] },
    { slug: "nyu", names: ["NYU", "New York University"] },
    { slug: "columbia", names: ["Columbia", "Columbia University"] },
    { slug: "fordham", names: ["Fordham", "Fordham University"] },
    { slug: "cuny-hunter", names: ["Hunter", "Hunter College"] },
    { slug: "cuny-baruch", names: ["Baruch", "Baruch College"] },
    { slug: "cuny-city", names: ["City College", "CCNY"] },
    { slug: "new-paltz", names: ["New Paltz", "SUNY New Paltz"] },
    { slug: "purchase", names: ["Purchase", "SUNY Purchase"] },
  ],
  scrapers: {
    courses: [
      // CUNY (Phase 1):
      { scripts: ["scripts/ny/scrape-cuny.ts"], runner: "http" },
      // SUNY CCs (Phase 2): 12 Banner SSB + 2 Colleague + 2 bespoke = 16 colleges
      { scripts: ["scripts/ny/scrape-suny-banner-ssb.ts"], runner: "http" },
      { scripts: ["scripts/ny/scrape-suny-colleague.ts"], runner: "playwright" },
      { scripts: ["scripts/ny/scrape-herkimer.ts"], runner: "http" },
      { scripts: ["scripts/ny/scrape-cayuga.ts"], runner: "http" },
    ],
    transfers: [
      { scripts: ["scripts/ny/scrape-transfer-trex.ts"], runner: "http" },
      { scripts: ["scripts/ny/scrape-transfer-step.ts"], runner: "http" },
    ],
    prereqs: [
      // CUNY (Coursedog):
      { scripts: ["scripts/ny/scrape-catalog-prereqs.ts"], runner: "playwright" },
      // SUNY Acalog (10 CCs):
      { scripts: ["scripts/ny/scrape-suny-acalog-prereqs.ts"], runner: "playwright" },
      // Nassau CC (OmniUpdate HTML):
      { scripts: ["scripts/ny/scrape-nassau-prereqs.ts"], runner: "http" },
      // FIT (CourseLeaf):
      { scripts: ["scripts/ny/scrape-fit-prereqs.ts"], runner: "http" },
      // FMCC + Sullivan + Schenectady (PDF catalogs):
      { scripts: ["scripts/ny/scrape-suny-pdf-prereqs.ts"], runner: "http" },
    ],
    programs: [
      // CUNY (Coursedog):
      { scripts: ["scripts/ny/scrape-programs.ts"], runner: "playwright" },
      // SUNY Acalog (10 CCs):
      { scripts: ["scripts/ny/scrape-suny-acalog-programs.ts"], runner: "playwright" },
      // SUNY Clean Catalog + SCIQ + CourseLeaf (partial coverage):
      { scripts: ["scripts/ny/scrape-suny-other-programs.ts"], runner: "http" },
      // MVCC (OmniUpdate):
      { scripts: ["scripts/ny/scrape-mvcc-programs.ts"], runner: "http" },
    ],
  },
};

export default nyConfig;
