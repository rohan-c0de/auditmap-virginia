import type { StateConfig } from "../registry";

const caConfig: StateConfig = {
  slug: "ca",
  name: "California",
  systemName: "California CCs",
  systemFullName: "California Community Colleges",
  systemUrl: "https://www.cccco.edu/",
  collegeCount: 117,

  // California does not have a single statewide senior-waiver statute; many
  // districts offer their own audit / senior-adult policies under Education
  // Code §§ 76300, 84810.5. Leaving null until per-college policies are
  // surveyed.
  seniorWaiver: null,

  transferSupported: false,
  popularCourses: [],
  defaultZip: "90029",
  defaultZipCity: "Los Angeles",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.cccco.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.cccco.edu/",

  branding: {
    siteName: "Community College Path California",
    tagline: "Search California community college courses across all 117 colleges.",
    footerText: "Community College Path California — Find courses across all 117 California community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the California Community Colleges Chancellor's Office.",
    metaKeywords: [
      "California community college courses",
      "California community college course search",
      "California Community Colleges",
      "CCC course search",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/ca/scrape-banner-ssb.ts"], runner: "http" },
      { scripts: ["scripts/ca/scrape-colleague.ts"], runner: "playwright" },
    ],
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: transfers — California has no equivalency portal registered
    //   in data/articulation-portals.json. ASSIST.org is the statewide
    //   articulation system but requires a bespoke scraper.
    // manual-only: programs — Phase 5+.
  },
};

export default caConfig;
