import type { StateConfig } from "../registry";

const orConfig: StateConfig = {
  slug: "or",
  name: "Oregon",
  systemName: "Oregon CCs",
  systemFullName: "Oregon Community Colleges",
  systemUrl: "https://www.occa17.com/",
  collegeCount: 17,

  seniorWaiver: null,

  transferSupported: false,
  popularCourses: [],
  defaultZip: "97201",
  defaultZipCity: "Portland",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.occa17.com/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.occa17.com/",

  branding: {
    siteName: "Community College Path Oregon",
    tagline: "Search Oregon community college courses across all 17 colleges.",
    footerText: "Community College Path Oregon — Find courses across all 17 Oregon community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by Oregon Community Colleges or OCCA.",
    metaKeywords: [
      "Oregon community college courses",
      "Oregon community college course search",
      "Oregon Community Colleges",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/or/scrape-banner-ssb.ts"], runner: "http" },
      { scripts: ["scripts/or/scrape-tvcc.ts"], runner: "http" },
    ],
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: transfers — Oregon uses CCN (Common Course Numbering) rather than a per-course equivalency portal.
    // manual-only: programs — Phase 5+.
  },
};

export default orConfig;
