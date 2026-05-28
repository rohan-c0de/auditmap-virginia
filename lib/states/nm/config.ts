import type { StateConfig } from "../registry";

const nmConfig: StateConfig = {
  slug: "nm",
  name: "New Mexico",
  systemName: "Community Colleges",
  systemFullName: "New Mexico Community Colleges",
  systemUrl: "https://hed.nm.gov/",
  collegeCount: 12,

  // TODO: research senior-waiver statute for NM.
  // Set to null if no waiver exists, or fill in per the SeniorWaiverConfig shape.
  seniorWaiver: null,

  transferSupported: false,
  popularCourses: [],
  defaultZip: "87501",
  defaultZipCity: "Santa Fe",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.example.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.example.edu/",

  branding: {
    siteName: "Community College Path New Mexico",
    tagline: "Search community college courses across New Mexico.",
    footerText: "Community College Path New Mexico — Find courses across all 12 New Mexico community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by any New Mexico community college.",
    metaKeywords: [
      "New Mexico community college courses",
      "NM community college course search",
      "New Mexico Community Colleges",
    ],
  },
  scrapers: {
    courses: [
      {
        scripts: ["scripts/nm/scrape-banner8.ts"],
        runner: "http",
      },
    ],
    // manual-only: transfers — no NM state articulation portal registered yet.
    // manual-only: prereqs — Phase 4 catalog-prereq scrapers deferred.
    // manual-only: programs — Phase 6 catalog discovery yielded no templated catalogs.
  },
};

export default nmConfig;
