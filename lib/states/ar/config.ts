import type { StateConfig } from "../registry";

const arConfig: StateConfig = {
  slug: "ar",
  name: "Ar",
  systemName: "Public 2-year",
  systemFullName: "Ar Public 2-year Colleges",
  systemUrl: "",
  collegeCount: 14,
  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "Ark. Code § 6-60-204",
    description:
      "Arkansas residents aged 60 and older may enroll in credit courses at any Arkansas state-supported institution of higher education, including community colleges, with tuition waived on a space-available basis. Fees may still apply.",
    bannerTitle: "Arkansas Senior Citizens' Tuition Waiver",
    bannerSummary:
      "Over 60 in Arkansas? Tuition is waived at state-supported colleges on a space-available basis.",
    bannerDetail:
      "Under Ark. Code § 6-60-204, Arkansas residents aged 60+ may enroll tuition-free in credit courses at any state-supported institution of higher education on a space-available basis. Fees, books, and other charges still apply. Contact the registrar at your college for the enrollment process.",
  },

  transferSupported: false,
  popularCourses: ["ENGL 1013", "PSYC 2003", "ENGL 1023", "MATH 1203", "BIOL 1544", "PLSC 2003"],
  defaultZip: "",
  defaultZipCity: "",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.example.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.example.edu/",

  branding: {
    siteName: "Community College Path Ar",
    tagline: "Search Public 2-year courses across all 14 colleges.",
    footerText: "Community College Path Ar — Find courses across all 14 Public 2-year colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by Ar Public 2-year Colleges.",
    metaKeywords: [
      "Ar community college courses",
      "Public 2-year course search",
      "Ar Public 2-year Colleges",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/ar/scrape-colleague.ts"], runner: "playwright" },
      { scripts: ["scripts/ar/scrape-nwacc.ts"], runner: "http" },
      { scripts: ["scripts/ar/scrape-eacc.ts"], runner: "playwright" },
      { scripts: ["scripts/ar/scrape-ozarka.ts"], runner: "http" },
    ],
    // manual-only: transfers — no statewide articulation portal registered yet (Arkansas's ACTS system).
    // manual-only: prereqs — aggregated from course-search data; no dedicated catalog scraper.
    // manual-only: programs — Phase 6 wrapper at scripts/ar/scrape-programs.ts needs per-college catalog discovery first.
  },
};

export default arConfig;
