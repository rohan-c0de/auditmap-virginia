import type { StateConfig } from "../registry";

const ksConfig: StateConfig = {
  slug: "ks",
  name: "Kansas",
  systemName: "Kansas Board of Regents",
  systemFullName: "Kansas Community and Technical Colleges (Kansas Board of Regents)",
  systemUrl: "https://www.kansasregents.org/",
  collegeCount: 24,

  // TODO: verify senior-waiver statute for Kansas (K.S.A. 76-728 may apply for residents 65+).
  // Set to null if no waiver exists, or fill in per the SeniorWaiverConfig shape.
  seniorWaiver: null,

  transferSupported: false,
  popularCourses: [],
  defaultZip: "67202",
  defaultZipCity: "Wichita",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.example.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.example.edu/",

  branding: {
    siteName: "Community College Path Kansas",
    tagline: "Search Kansas community and technical college courses across all 24 colleges.",
    footerText: "Community College Path Kansas — Find courses across all 24 Kansas community and technical colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Kansas Board of Regents.",
    metaKeywords: [
      "Kansas community college courses",
      "Kansas community college class search",
      "Kansas Board of Regents",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/ks/scrape-banner-ssb.ts"], runner: "playwright" },
      { scripts: ["scripts/ks/scrape-colleague.ts"], runner: "playwright" },
      { scripts: ["scripts/ks/scrape-jenzabar-webforms.ts"], runner: "playwright" },
      { scripts: ["scripts/ks/scrape-fhnw-empower-xl.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-hutchinson.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-allen.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-manhattan-tech.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-colby.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-salina.ts"], runner: "http" },
    ],
    // manual-only: transfers — no statewide articulation portal registered for KS yet.
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — Phase 6 catalog discovery found no templated platforms; bespoke per-college needed.
  },
};

export default ksConfig;
