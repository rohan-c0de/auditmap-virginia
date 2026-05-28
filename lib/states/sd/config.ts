import type { StateConfig } from "../registry";

const sdConfig: StateConfig = {
  slug: "sd",
  name: "South Dakota",
  systemName: "South Dakota Technical Colleges & Tribal Colleges",
  systemFullName: "South Dakota Technical Colleges & Tribal Colleges",
  systemUrl: "https://www.boardofregents.sd.gov/",
  collegeCount: 6,

  // South Dakota has no statewide senior tuition-waiver statute. Two of the
  // four state technical colleges (Southeast Tech, Western Dakota Tech) offer
  // local senior-citizen discounts at the registrar's discretion. Verify with
  // each college before relying on this entry.
  seniorWaiver: null,

  transferSupported: false,
  popularCourses: [
    "ENGL 101",
    "MATH 101",
    "BIOL 101",
    "PSYC 101",
    "HIST 121",
  ],
  defaultZip: "57104",
  defaultZipCity: "Sioux Falls",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.example.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.example.edu/",

  branding: {
    siteName: "Community College Path — South Dakota",
    tagline:
      "Search South Dakota technical college and tribal college courses across all 6 institutions.",
    footerText:
      "Community College Path — South Dakota. Find courses across the state's technical and tribal colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by any South Dakota technical or tribal college.",
    metaKeywords: [
      "South Dakota community college courses",
      "South Dakota technical college course search",
      "Oglala Lakota College courses",
      "Southeast Technical College courses",
      "Lake Area Technical College courses",
    ],
  },
  scrapers: {
    courses: [
      {
        scripts: ["scripts/sd/scrape-southeast-tech.ts"],
        runner: "playwright",
      },
      {
        scripts: ["scripts/sd/scrape-oglala-lakota.ts"],
        runner: "http",
      },
      // manual-only: lake-area-technical-college, western-dakota-technical-college,
      // sisseton-wahpeton-college — Jenzabar Course_Search.jnz returns
      // "Please login to view this page" without SSO credentials. No scraper
      // possible without credentials. mitchell-technical-college — Coursedog
      // catalog is ingested separately at data/sd/coursedog-catalog/; the
      // course-section schedule is also SSO-gated.
    ],
    // manual-only: transfers — no registered articulation portal for SD.
    // CollegeTransfer.Net was suggested as a fallback; needs per-college
    // SourceInstitutionIds.
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — Phase 6 discovered 2 catalog hits
    // (southeast-technical-college: acalog, western-dakota-technical-college:
    // courseleaf). Wrapper at scripts/sd/scrape-programs.ts; needs catalog
    // year + per-college config before it can run.
  },
};

export default sdConfig;
