import type { StateConfig } from "../registry";

// CUNY Global Class Search is a single public search endpoint that covers all
// 26 CUNY institutions (senior + community). v1 scrapes only the 7 community
// colleges; SUNY community colleges (30) remain a separate Phase 2 target and
// will be added to this same "ny" state slug when implemented.
//
// The scraper uses https://globalsearch.cuny.edu/CFGlobalSearchTool/ — a
// JSP/ColdFusion wrapper around CUNYfirst (PeopleSoft Campus Solutions) that
// returns HTML. Per-college registrar pages below are fallbacks for linking
// users to official course listings. CFSearchToolController accepts Base64-
// encoded params (CRN, term, institution) but requires a server-side session
// (JSESSIONID cookie) — without it the params are ignored and the search form
// is returned. Deep-linking is therefore not possible via a static URL.
const COLLEGE_REGISTRAR_URLS: Record<string, string> = {
  "bmcc": "https://www.bmcc.cuny.edu/registrar/academics-classes-registration/class-search/",
  "bronx-cc": "https://www.bcc.cuny.edu/academics/registrar/",
  "guttman-cc": "https://guttman.cuny.edu/students/registrar/",
  "hostos-cc": "https://www.hostos.cuny.edu/Administrative-Offices/Office-of-the-Registrar",
  "kingsborough-cc": "https://www.kbcc.cuny.edu/registrar/",
  "laguardia-cc": "https://www.laguardia.edu/registrar/",
  "queensborough-cc": "https://www.qcc.cuny.edu/registrar/",
};

const GLOBAL_SEARCH_URL = "https://globalsearch.cuny.edu/CFGlobalSearchTool/search.jsp";

const nyConfig: StateConfig = {
  slug: "ny",
  name: "New York",
  systemName: "CUNY",
  systemFullName: "The City University of New York",
  systemUrl: "https://www.cuny.edu",
  collegeCount: 7,

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
  // Transfer data comes from CUNY Transfer Explorer (T-Rex) at
  // explorer.cuny.edu, scraped by scripts/ny/scrape-transfer-trex.ts. Covers
  // CC-to-senior-college mappings for the 11 CUNY senior colleges plus a
  // handful of specialized institutions (Graduate Center, SPS, SLU, Macaulay).
  // SUNY transfer pathway data (suny.edu/attend/apply-to-suny/transfer-students)
  // would also live here when SUNY colleges are added in a future phase.

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
      "Search CUNY community college courses across New York City and plan your schedule.",
    footerText:
      "Community College Path New York \u2014 Find courses across CUNY community colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by The City University of New York (CUNY).",
    metaKeywords: [
      "CUNY community college courses",
      "CUNY class search",
      "New York community college schedule",
      "NYC community college courses near me",
      "CUNY senior citizen tuition waiver",
      "City University of New York",
    ],
  },
};

export default nyConfig;
