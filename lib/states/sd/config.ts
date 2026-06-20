import type { StateConfig } from "../registry";

// Per-college public class-search / schedule URLs. Harvested from the working
// scrapers in scripts/sd/ + data/state-health/fingerprint-baseline.json and
// probed 2026-06-17.
const REGISTRATION_URLS: Record<string, string> = {
  // Jenzabar JICS Course Schedule portlet (the only public source).
  "southeast-technical-college":
    "https://my.southeasttech.edu/ICS/Admissions/Course_Schedule.jnz",
  // Oglala Lakota — per-term PDFs linked from the homepage.
  "oglala-lakota-college": "https://www.olc.edu/",
  // Mitchell Tech — Coursedog catalog (no public live-sections endpoint).
  "mitchell-technical-college": "https://catalog.mitchelltech.edu/",
};

// Honest fallback for the 3 SD colleges whose Jenzabar Course_Search portlets
// require SSO login. Sourced from data/sd/scorecard/*.json schoolUrl.
const COLLEGE_HOMEPAGES: Record<string, string> = {
  "lake-area-technical-college": "https://www.lakeareatech.edu/",
  "western-dakota-technical-college": "https://www.wdt.edu/",
  "sisseton-wahpeton-college": "https://www.swcollege.edu/",
};

const sdCollegeUrl = (collegeSlug: string): string =>
  REGISTRATION_URLS[collegeSlug] ??
  COLLEGE_HOMEPAGES[collegeSlug] ??
  "https://www.boardofregents.sd.gov/";

const sdConfig: StateConfig = {
  slug: "sd",
  name: "South Dakota",
  systemName: "South Dakota Technical Colleges & Tribal Colleges",
  systemFullName: "South Dakota Technical Colleges & Tribal Colleges",
  systemUrl: "https://www.boardofregents.sd.gov/",
  collegeCount: 6,

  // VERIFIED: no senior waiver — South Dakota has no statewide senior
  // tuition-waiver statute. Verified 2026-05-29: Southeast Tech
  // (southeasttech.edu/costs-financial-aid) and Western Dakota Tech
  // (wdt.edu/paying-for-school/cost) publish full tuition schedules with no
  // senior-citizen discount, audit waiver, or age-based reduction. Lake Area
  // Tech and Mitchell Tech cost pages were unreachable for direct verification
  // but their published catalogs contain no such policy. The "VERIFIED:" marker
  // above signals to /state-audit that this null is by-verification, not a gap.
  seniorWaiver: null,

  transferSupported: true,
  popularCourses: [
    "ENGL 101",
    "MATH 101",
    "BIOL 101",
    "PSYC 101",
    "HIST 121",
  ],
  defaultZip: "57104",
  defaultZipCity: "Sioux Falls",

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) =>
    sdCollegeUrl(collegeSlug),

  collegeCoursesUrl: (collegeSlug: string) => sdCollegeUrl(collegeSlug),

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
    transfers: [
      {
        scripts: ["scripts/sd/scrape-transfer-usd.ts"],
        runner: "http",
      },
      // manual-only: SDSU, SDSMT, BHSU, NSU, DSU — the SD Board of Regents
      // partners with Transferology for these five, but Transferology blocks
      // unauthenticated access (HTTP 403 on system pages). USD runs its own
      // public calculator (scraped here) which covers all 6 SD CCs in one
      // place. Per-institution scrapers for the other 5 universities are
      // possible long-term but would each require bespoke work.
    ],
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
