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
    courses: [
      // Banner SSB 9 — Cochise, Pima, Coconino (3 colleges via shared template)
      { scripts: ["scripts/az/scrape-banner-ssb.ts"], runner: "http" },
      // Colleague Self-Service — Mohave (1 college via Ellucian Cloud)
      { scripts: ["scripts/az/scrape-colleague.ts"], runner: "playwright" },
    ],
    // Inline prereq text harvested from the scraped Banner SSB + Colleague
    // sections. The other 17 AZ colleges contribute nothing until their
    // scrapers ship (Maricopa cluster is the highest-value follow-up).
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: transfers — AZ has no entry in articulation-portals.json
    //   yet. AZ's state system is AZTransfer.com; needs one-time integration.
    // manual-only: programs — scripts/az/scrape-programs.ts wrapper exists
    //   but each of the 4 Acalog catalogs needs manual navoid identification
    //   (auto-discovery finds catoid but not navoids — same as NV/CSN).
  },
};

export default azConfig;
