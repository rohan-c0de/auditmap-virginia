import type { StateConfig } from "../registry";

const orConfig: StateConfig = {
  slug: "or",
  name: "Oregon",
  systemName: "Oregon CCs",
  systemFullName: "Oregon Community Colleges",
  systemUrl: "https://www.occa17.com/",
  collegeCount: 17,
  seniorWaiver: {
    ageThreshold: 62,
    legalCitation: "ORS 341 (district-level authority)",
    description:
      "Oregon has no statewide senior-tuition statute. Oregon's 17 community college districts (organized under ORS Chapter 341) set their own tuition policies, and most offer reduced or waived tuition for residents 62+ on a space-available basis. Terms vary by college.",
    bannerTitle: "Oregon Senior Tuition Discounts (by college)",
    bannerSummary:
      "Over 62 in Oregon? Most community colleges offer senior tuition discounts — terms vary by college.",
    bannerDetail:
      "Oregon has no statewide senior-tuition statute. The 17 community college districts (organized under ORS Chapter 341) set their own tuition policies. Most offer reduced or waived tuition for residents 62+ on a space-available basis. Contact your college's registrar or financial aid office for the specific terms.",
  },

  transferSupported: false,
  popularCourses: ["WR 121Z", "MTH 111Z", "WR 227Z", "COMM 111Z", "PSY 201Z", "WR 115"],
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
      { scripts: ["scripts/or/scrape-klamath.ts"], runner: "http" },
      { scripts: ["scripts/or/scrape-oregon-coast.ts"], runner: "http" },
      { scripts: ["scripts/or/scrape-columbia-gorge.ts"], runner: "http" },
      { scripts: ["scripts/or/scrape-colleague.ts"], runner: "playwright" },
    ],
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: transfers — Oregon uses CCN (Common Course Numbering) rather than a per-course equivalency portal.
    // manual-only: programs — Phase 5+.
  },
};

export default orConfig;
