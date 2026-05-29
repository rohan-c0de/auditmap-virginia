import type { StateConfig } from "../registry";

const sdConfig: StateConfig = {
  slug: "sd",
  name: "South Dakota",
  systemName: "South Dakota Technical Colleges & Tribal Colleges",
  systemFullName: "South Dakota Technical Colleges & Tribal Colleges",
  systemUrl: "https://www.boardofregents.sd.gov/",
  collegeCount: 6,

  // No statewide senior tuition-waiver statute in SD. Verified 2026-05-29:
  // Southeast Tech (southeasttech.edu/costs-financial-aid) and Western Dakota
  // Tech (wdt.edu/paying-for-school/cost) publish full tuition schedules with
  // no senior-citizen discount, audit waiver, or age-based reduction. Lake
  // Area Tech and Mitchell Tech cost pages were unreachable for direct
  // verification but their published catalogs contain no such policy.
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
    programs: [
      {
        scripts: ["scripts/sd/scrape-programs.ts"],
        runner: "http",
      },
      // manual-only: western-dakota-technical-college — catalog is PDF only.
      // manual-only: lake-area-technical-college, oglala-lakota-college,
      // sisseton-wahpeton-college — no public templated programs catalog.
      // manual-only: mitchell-technical-college — Coursedog course descriptions
      // ingested at data/sd/coursedog-catalog/ but no program-requirement data.
    ],
  },
};

export default sdConfig;
