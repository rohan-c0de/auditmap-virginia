import type { StateConfig } from "../registry";

const neConfig: StateConfig = {
  slug: "ne",
  name: "Nebraska",
  systemName: "NCCA",
  systemFullName: "Nebraska Community College Association",
  systemUrl: "https://ncca.ne.gov/",
  collegeCount: 9,

  seniorWaiver: null,

  transferSupported: false,
  popularCourses: [],
  defaultZip: "68508",
  defaultZipCity: "Lincoln",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://ncca.ne.gov/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://ncca.ne.gov/",

  branding: {
    siteName: "Community College Path Nebraska",
    tagline: "Search Nebraska community college courses across all 9 colleges.",
    footerText:
      "Community College Path Nebraska — Find courses across all 9 Nebraska community colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Nebraska Community College Association.",
    metaKeywords: [
      "Nebraska community college courses",
      "Nebraska community college class search",
      "Nebraska Community College Association",
    ],
  },
  scrapers: {
    courses: [
      {
        scripts: ["scripts/ne/scrape-colleague.ts"],
        runner: "node" as const,
      },
      {
        scripts: ["scripts/ne/scrape-banner-ssb.ts"],
        runner: "node" as const,
      },
      {
        scripts: ["scripts/ne/scrape-nicc.ts"],
        runner: "node" as const,
      },
      {
        scripts: ["scripts/ne/scrape-mpcc.ts"],
        runner: "node" as const,
      },
      {
        scripts: ["scripts/ne/scrape-wncc.ts"],
        runner: "node" as const,
      },
    ],
    prereqs: { source: "aggregate-from-courses" as const },
    // manual-only: transfers — no articulation portal registered for NE.
    // manual-only: programs — Phase 6 discovered catalogs but programs scrape not yet executed.
  },
};

export default neConfig;
