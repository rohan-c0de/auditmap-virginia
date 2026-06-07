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

  transferSupported: true,
  universityAliases: [
    { slug: "oregon-state", names: ["OSU", "Oregon State University", "Oregon State"] },
  ],
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
    // Two receivers: Oregon State (scr1160 .inc files) + Eastern Oregon
    // University (public Banner Extensibility report). U Oregon, Portland State,
    // Western Oregon, Oregon Tech are CollegeSource TES / Transferology ceilings
    // — see documentedCeilings.transfers.
    transfers: [
      { scripts: ["scripts/or/scrape-transfer-osu.ts"], runner: "http" },
      { scripts: ["scripts/or/scrape-transfer-eou.ts"], runner: "http" },
    ],
    prereqs: { source: "aggregate-from-courses" },
    // Acalog (Chemeketa, Rogue, Klamath) via search_advanced + CourseLeaf
    // (Portland CC). Mt Hood/Clackamas/Central Oregon (CourseLeaf, non-default
    // program index) and the other ~9 colleges are deferred.
    programs: [
      { scripts: ["scripts/or/scrape-programs.ts"], runner: "http" },
    ],
  },

  documentedCeilings: {
    // Transfers: OSU and EOU are the only Oregon public universities with a
    // public, scrapeable course-to-course tool (both shipped). U Oregon, Portland
    // State, Western Oregon, and Oregon Tech publish only CollegeSource TES public
    // views (ImageMath CAPTCHA to non-browser clients) or route to login-gated
    // Transferology — no further public course-level source. Verified 2026-06.
    transfers:
      "OSU and EOU are the only OR public universities with a public, scrapeable course-to-course transfer tool (both shipped). U Oregon / Portland State / Western Oregon / Oregon Tech are CollegeSource TES (CAPTCHA) or login-gated Transferology. Verified 2026-06.",
  },
};

export default orConfig;
