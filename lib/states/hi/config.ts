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

  // Transfer data: 15,649 in-state equivalencies across the 3 UH-system
  // 4-years (Hilo, Mānoa, West Oʻahu), scraped via scrape-transfer-uhdad.ts.
  transferSupported: true,
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
    // UH System publishes a statewide course-transfer database covering
    // all 10 UH campuses (6 CCs as senders × 3 four-years as receivers).
    //
    // The original Banner SSB form at sis.hawaii.edu/uhdad/CourseTransfer.home
    // was retired and now returns HTTP 502. UH replaced it with an
    // Ellucian-React SPA at sis.hawaii.edu:9350/crsetrns/ backed by a
    // JSON API (/transfer/x-transfer-equiv?institutionCode=&campusCode=).
    // The API requires an X-Recaptcha-Token header but only presence-
    // checks it. The scraper sends `cc-coursemap-scraper` as a clearly
    // attributed value.
    //
    // The scraper refuses to overwrite the existing transfer-equiv.json
    // with an empty array when all pairs fail, so a transient outage
    // leaves the last good snapshot in place rather than corrupting state.
    transfers: [
      { scripts: ["scripts/hi/scrape-transfer-uhdad.ts"], runner: "http" },
    ],
    // Prereqs aggregated from course-search prerequisite_text (data/hi/prereqs.json,
    // 418 parsed chains). No dedicated catalog scraper; refreshed from committed courses.
    prereqs: { source: "aggregate-from-courses" },
    // Programs: Kauai + Windward CC publish Clean Catalog (catalog.<campus>.hawaii.edu).
    // The other 4 UH CCs are platform ceilings — see documentedCeilings.programs.
    programs: [{ scripts: ["scripts/hi/scrape-programs.ts"], runner: "http" }],
  },

  documentedCeilings: {
    // Programs reach 2 of 6 colleges: only Kauai CC and Windward CC publish a
    // scrapeable online catalog (Clean Catalog, 98 programs — shipped). The other
    // four have no public program source (verified 2026-06): Hawaii CC and Leeward
    // CC run Kuali whose program/group API is auth-gated (401; only the catalog
    // list is public); Honolulu CC is a bespoke WordPress catalog; Kapiolani CC
    // publishes degree requirements as PDFs only.
    programs:
      "Only Kauai CC and Windward CC publish a scrapeable online catalog (Clean Catalog, 98 programs — shipped). Hawaii CC + Leeward CC run Kuali with an auth-gated program API (public catalog list only); Honolulu CC is bespoke WordPress; Kapiolani CC is PDF-only. No public program source for those four. Verified 2026-06.",
  },
};

export default hiConfig;
