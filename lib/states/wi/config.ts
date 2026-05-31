import type { StateConfig } from "../registry";

const wiConfig: StateConfig = {
  slug: "wi",
  name: "Wisconsin",
  systemName: "WTCS",
  systemFullName: "Wisconsin Technical College System",
  systemUrl: "https://www.wtcsystem.edu/",
  collegeCount: 16,

  // TODO: research WI senior-waiver statute.
  // Wisconsin does not have a statewide senior-audit waiver; each WTCS college
  // sets its own policy. Verify per-college before populating.
  seniorWaiver: null,

  transferSupported: false,
  popularCourses: [],
  // Madison Area Technical College ZIP
  defaultZip: "53704",
  defaultZipCity: "Madison",

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) => {
    if (collegeSlug === "chippewa-valley-technical-college") {
      return "https://coursesearch.cvtc.edu/";
    }
    return `https://www.wtcsystem.edu/`;
  },

  collegeCoursesUrl: (collegeSlug: string) => {
    if (collegeSlug === "chippewa-valley-technical-college") {
      return "https://coursesearch.cvtc.edu/";
    }
    return `https://www.wtcsystem.edu/`;
  },

  branding: {
    siteName: "Community College Path Wisconsin",
    tagline: "Search Wisconsin Technical College System courses across all 16 colleges.",
    footerText: "Community College Path Wisconsin — Find courses across all 16 WTCS colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Wisconsin Technical College System.",
    metaKeywords: [
      "Wisconsin technical college courses",
      "WTCS course search",
      "Wisconsin Technical College System",
      "Wisconsin community college",
    ],
  },
  scrapers: {
    courses: [
      {
        scripts: ["scripts/wi/scrape-cvtc.ts"],
        runner: "http",
      },
    ],
    // manual-only: transfers — No WI articulation portal registered. CollegeTransfer.Net fallback available.
    // manual-only: prereqs — Coursedog catalog data for Nicolet Area TC at data/wi/coursedog-catalog/; aggregate into prereqs.json manually.
    // manual-only: programs — Phase 6 discovery found no matching catalog platforms; manual investigation needed.
  },
};

export default wiConfig;
