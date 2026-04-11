import type { StateConfig } from "../registry";

// CUNY Global Class Search is a single public search endpoint that covers all
// 26 CUNY institutions (senior + community). v1 scrapes only the 7 community
// colleges; SUNY community colleges (30) remain a separate Phase 2 target and
// will be added to this same "ny" state slug when implemented.
//
// The scraper uses https://globalsearch.cuny.edu/CFGlobalSearchTool/ — a
// JSP/ColdFusion wrapper around CUNYfirst (PeopleSoft Campus Solutions) that
// returns HTML. Deep-linking to a specific section is supported via Base64-
// encoded query params on CFSearchToolController (CRN, term, institution).
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

// Institution display names used in the Global Search deep-link URL.
// Must match the exact strings CUNY uses (decoded from inst_searched param).
const CUNY_COLLEGE_NAMES: Record<string, string> = {
  "bmcc": "Borough of Manhattan CC",
  "bronx-cc": "Bronx CC",
  "guttman-cc": "Guttman CC",
  "hostos-cc": "Hostos CC",
  "kingsborough-cc": "Kingsborough CC",
  "laguardia-cc": "LaGuardia CC",
  "queensborough-cc": "Queensborough CC",
};

// Convert our standardized term (e.g. "2026SP") to CUNY PeopleSoft term code.
// Formula: "1" + last 2 digits of year + season (2=Spring, 6=Summer, 9=Fall).
function toCunyTermCode(term: string): string {
  const year = term.slice(2, 4);
  const season = term.slice(4);
  const seasonCode = season === "SP" ? "2" : season === "SU" ? "6" : "9";
  return `1${year}${seasonCode}`;
}

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

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string, term?: string) => {
    const collegeName = CUNY_COLLEGE_NAMES[collegeSlug];
    if (!collegeName || !term) return GLOBAL_SEARCH_URL;
    const instB64 = Buffer.from(collegeName).toString("base64");
    const termB64 = Buffer.from(toCunyTermCode(term)).toString("base64");
    // CRN is per-section — substituted client-side via __CRN_B64__ placeholder
    return `https://globalsearch.cuny.edu/CFGlobalSearchTool/CFSearchToolController?class_number_searched=__CRN_B64__&term_searched=${termB64}&inst_searched=${instB64}`;
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
