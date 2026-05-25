import type { StateConfig } from "../registry";

const hiConfig: StateConfig = {
  slug: "hi",
  name: "Hawaii",
  systemName: "UHCC",
  systemFullName: "University of Hawaiʻi Community Colleges",
  systemUrl: "https://uhcc.hawaii.edu/",
  collegeCount: 6,

  // UH Board of Regents Policy 6.205 ("Tuition Reduction for Senior
  // Citizens") waives tuition for Hawaiʻi residents aged 60 and over in
  // regular credit courses at UH campuses, on a space-available basis.
  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "UH Board of Regents Policy 6.205",
    description:
      "Hawaiʻi residents aged 60 and older may enroll tuition-free in regular University of Hawaiʻi credit courses on a space-available basis. Some fees still apply; each campus sets registration timing for senior space-available seats.",
    bannerTitle: "Hawaiʻi Senior Tuition Waiver",
    bannerSummary:
      "Over 60 in Hawaiʻi? UH credit courses may be tuition-free on a space-available basis.",
    bannerDetail:
      "University of Hawaiʻi Board of Regents Policy 6.205 lets Hawaiʻi residents aged 60+ enroll in regular UH credit courses without paying tuition, on a space-available basis. Some fees still apply, and seats are allocated after regular registration — contact your campus registrar for the timing.",
  },

  transferSupported: false,
  popularCourses: ["ENG 1007", "ENG 1005", "ENG 1006", "PHYL 141L5", "PHYL 1415", "SP 1515"],
  defaultZip: "96813",
  defaultZipCity: "Honolulu",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://uhcc.hawaii.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://uhcc.hawaii.edu/",

  branding: {
    siteName: "Community College Path Hawaiʻi",
    tagline: "Search University of Hawaiʻi Community Colleges courses across all 6 campuses.",
    footerText: "Community College Path Hawaiʻi — Find courses across all 6 UH Community Colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the University of Hawaiʻi Community Colleges.",
    metaKeywords: [
      "Hawaii community college courses",
      "UHCC course search",
      "University of Hawaiʻi Community Colleges",
      "Hawaii senior tuition waiver",
    ],
  },
  scrapers: {
    courses: [
      // All 6 UHCC community colleges share a single Banner SSB instance at
      // www.sis.hawaii.edu:9234. scrape-uhcc.ts pulls every section, splits
      // by campusDescription, and drops UH 4-year campuses (Manoa, Hilo,
      // West Oahu, Maui) plus online-only "World Wide Web" sections that
      // can't be attributed to a specific community college.
      {
        scripts: ["scripts/hi/scrape-uhcc.ts"],
        runner: "http",
      },
    ],
    // manual-only: transfers — Phase 3 (transfer-equiv) not yet wired up.
    // manual-only: prereqs — Phase 4.
    // manual-only: programs — Phase 5+.
  },
};

export default hiConfig;
