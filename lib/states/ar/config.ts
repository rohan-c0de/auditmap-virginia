import type { StateConfig } from "../registry";

const arConfig: StateConfig = {
  slug: "ar",
  name: "Ar",
  systemName: "Public 2-year",
  systemFullName: "Ar Public 2-year Colleges",
  systemUrl: "",
  collegeCount: 14,

  // TODO: research senior-waiver statute for Ar.
  // Set to null if no waiver exists, or fill in per the SeniorWaiverConfig shape.
  seniorWaiver: null,

  transferSupported: false,
  popularCourses: [],
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
    ],
    // manual-only: transfers — no statewide articulation portal registered yet (Arkansas's ACTS system).
    // manual-only: prereqs — aggregated from course-search data; no dedicated catalog scraper.
    // manual-only: programs — Phase 6 wrapper at scripts/ar/scrape-programs.ts needs per-college catalog discovery first.
  },
};

export default arConfig;
