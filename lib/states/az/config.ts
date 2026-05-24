import type { StateConfig } from "../registry";

const azConfig: StateConfig = {
  slug: "az",
  name: "Az",
  systemName: "Public 2-year",
  systemFullName: "Az Public 2-year Colleges",
  systemUrl: "",
  collegeCount: 21,

  // TODO: research senior-waiver statute for Az.
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
    siteName: "Community College Path Az",
    tagline: "Search Public 2-year courses across all 21 colleges.",
    footerText: "Community College Path Az — Find courses across all 21 Public 2-year colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by Az Public 2-year Colleges.",
    metaKeywords: [
      "Az community college courses",
      "Public 2-year course search",
      "Az Public 2-year Colleges",
    ],
  },
  scrapers: {
    // manual-only: courses — Phase 2 (course scraper) not yet wired up.
    // manual-only: transfers — Phase 3 (transfer-equiv) not yet wired up.
    // manual-only: prereqs — Phase 4.
    // manual-only: programs — Phase 5+.
  },
};

export default azConfig;
