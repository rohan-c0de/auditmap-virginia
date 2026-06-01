import type { StateConfig } from "../registry";

const neConfig: StateConfig = {
  slug: "ne",
  name: "Nebraska",
  systemName: "NCCA",
  systemFullName: "Nebraska Community College Association",
  systemUrl: "https://nebraskacommunitycolleges.org/",
  collegeCount: 9,

  // Nebraska has no statewide senior tuition-waiver statute. Individual
  // colleges set their own policy — e.g. Mid-Plains CC offers a 62+ rate
  // (institutional, not state-mandated). Leave null at the state level.
  seniorWaiver: null,

  transferSupported: false,
  // Top 8 by section count across all 7 scraped NE colleges (9,636 sections).
  // Computed once from data/ne/courses; refresh periodically as new colleges
  // come online. ACFS 1015 = Adult Coping & Family Skills (workforce);
  // ENGL 1010 dominates with 310 sections statewide.
  popularCourses: [
    "ENGL 1010",
    "MATH 1150",
    "PSYC 1810",
    "ENGL 1020",
    "SPCH 1110",
    "BIOS 1010",
    "SOCI 1010",
    "ACCT 1200",
  ],
  defaultZip: "68508",
  defaultZipCity: "Lincoln",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://nebraskacommunitycolleges.org/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://nebraskacommunitycolleges.org/",

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
      { scripts: ["scripts/ne/scrape-colleague.ts"], runner: "playwright" },
      { scripts: ["scripts/ne/scrape-banner-ssb.ts"], runner: "http" },
      { scripts: ["scripts/ne/scrape-nicc.ts"], runner: "http" },
      { scripts: ["scripts/ne/scrape-mpcc.ts"], runner: "http" },
      { scripts: ["scripts/ne/scrape-wncc.ts"], runner: "http" },
      { scripts: ["scripts/ne/scrape-lptc.ts"], runner: "http" },
    ],
    prereqs: { source: "aggregate-from-courses" as const },
    programs: [
      { scripts: ["scripts/ne/scrape-programs.ts"], runner: "http" },
    ],
    // manual-only: transfers — no articulation portal registered for NE.
  },
};

export default neConfig;
