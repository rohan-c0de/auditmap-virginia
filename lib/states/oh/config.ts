import type { StateConfig } from "../registry";

const ohConfig: StateConfig = {
  slug: "oh",
  name: "Ohio",
  systemName: "OACC",
  systemFullName: "Ohio Association of Community Colleges",
  systemUrl: "https://www.ohiocommunitycolleges.org/",
  collegeCount: 22,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "Ohio Revised Code § 3345.27 (Program 60)",
    description:
      "Ohio residents 60 and older may audit courses at state-supported colleges tuition-free on a space-available basis. Regular fees may still apply and audited courses do not count for degree credit.",
    bannerTitle: "Ohio Program 60",
    bannerSummary:
      "Over 60 in Ohio? You can audit classes at state-supported colleges tuition-free.",
    bannerDetail:
      "Ohio Revised Code § 3345.27 (Program 60) lets Ohio residents 60+ audit courses at state-assisted institutions tuition-free on a space-available basis. Confirm with each college's registrar.",
  },

  transferSupported: false,
  popularCourses: ["ENG 1010", "MATH 1410", "ENG 1020", "PSY 1010", "GEN 1070", "COMM 1010"],
  defaultZip: "43215",
  defaultZipCity: "Columbus",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.ohiocommunitycolleges.org/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.ohiocommunitycolleges.org/",

  branding: {
    siteName: "Community College Path Ohio",
    tagline: "Search Ohio community college courses across all 22 colleges.",
    footerText:
      "Community College Path Ohio — Find courses across all 22 Ohio community colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Ohio Association of Community Colleges.",
    metaKeywords: [
      "Ohio community college courses",
      "Ohio community college class search",
      "Ohio Association of Community Colleges",
      "Ohio Program 60",
    ],
  },
  scrapers: {
    // Five of OH's eight scrapable colleges are wired across three
    // platforms. The other three (committed during auto-add-state but
    // not represented in data/oh/courses today) need re-fingerprint.
    courses: [
      { scripts: ["scripts/oh/scrape-banner-ssb.ts"], runner: "http" },
      { scripts: ["scripts/oh/scrape-colleague.ts"], runner: "playwright" },
      { scripts: ["scripts/oh/scrape-banner8.ts"], runner: "http" },
    ],
    // manual-only: transfers — CollegeTransfer.Net has zero OH in-state targets.
    // OhioTransfer.org / TAG (Transfer Assurance Guides) or individual
    // university articulation pages are the realistic path.
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — Phase 5+.
  },
};

export default ohConfig;
