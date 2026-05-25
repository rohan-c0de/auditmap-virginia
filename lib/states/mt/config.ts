import type { StateConfig } from "../registry";

const mtConfig: StateConfig = {
  slug: "mt",
  name: "Montana",
  systemName: "Montana University System",
  systemFullName: "Montana University System Community Colleges",
  systemUrl: "https://mus.edu",
  collegeCount: 10,

  // TODO: research senior-waiver statute for Mt.
  // Set to null if no waiver exists, or fill in per the SeniorWaiverConfig shape.
  seniorWaiver: null,

  transferSupported: false,
  popularCourses: ["COLS 111", "ENGL 101", "NASD 101", "ENGL 306", "ENGL 202", "WRIT 101"],
  defaultZip: "59601",
  defaultZipCity: "Helena",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.example.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.example.edu/",

  branding: {
    siteName: "Community College Path Montana",
    tagline: "Search community college courses across all 10 Montana colleges.",
    footerText: "Community College Path Montana — Find courses across all 10 Montana community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Montana University System.",
    metaKeywords: [
      "Montana community college courses",
      "Montana community college course search",
      "Montana University System community colleges",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/mt/scrape-banner8.ts"], runner: "http" },
      { scripts: ["scripts/mt/scrape-skc.ts"], runner: "http" },
      { scripts: ["scripts/mt/scrape-cdkc.ts"], runner: "http" },
    ],
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: transfers — no articulation portal identified.
    // manual-only: programs — Phase 5+.
  },
};

export default mtConfig;
