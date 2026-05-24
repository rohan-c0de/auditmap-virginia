import type { StateConfig } from "../registry";

const inConfig: StateConfig = {
  slug: "in",
  name: "In",
  systemName: "Public 2-year",
  systemFullName: "In Public 2-year Colleges",
  systemUrl: "",
  collegeCount: 1,

  // TODO: research senior-waiver statute for In.
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
    siteName: "Community College Path In",
    tagline: "Search Public 2-year courses across all 1 colleges.",
    footerText: "Community College Path In — Find courses across all 1 Public 2-year colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by In Public 2-year Colleges.",
    metaKeywords: [
      "In community college courses",
      "Public 2-year course search",
      "In Public 2-year Colleges",
    ],
  },
  scrapers: {
    // manual-only: courses — Phase 2 (course scraper) not yet wired up.
    // manual-only: transfers — Phase 3 (transfer-equiv) not yet wired up.
    // manual-only: prereqs — Phase 4.
    // manual-only: programs — Phase 5+.
  },
};

export default inConfig;
