import type { StateConfig } from "../registry";

const laConfig: StateConfig = {
  slug: "la",
  name: "Louisiana",
  systemName: "LCTCS",
  systemFullName: "Louisiana Community and Technical College System",
  systemUrl: "https://www.lctcs.edu/",
  collegeCount: 12,

  // No statewide senior-tuition-waiver statute confirmed for Louisiana
  // community colleges. Each LCTCS institution may offer its own
  // senior-discount policy; verify with the registrar before relying on
  // any single citation. Leave null until a system-wide statute is found.
  seniorWaiver: null,

  transferSupported: false,
  popularCourses: ["ENGL 1010", "MATH 1100", "BIOL 1010", "PSYC 2000", "HIST 1010"],
  defaultZip: "70806",
  defaultZipCity: "Baton Rouge",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.lctcs.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.lctcs.edu/",

  branding: {
    siteName: "Community College Path Louisiana",
    tagline: "Search LCTCS courses across all 12 Louisiana community and technical colleges.",
    footerText: "Community College Path Louisiana — Find courses across all 12 LCTCS colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Louisiana Community and Technical College System (LCTCS).",
    metaKeywords: [
      "Louisiana community college courses",
      "LCTCS course search",
      "Louisiana Community and Technical College System",
    ],
  },
  scrapers: {
    courses: [
      // 11 of 12 LCTCS colleges expose course data on a shared Banner SSB 9
      // host at reg-prod.ec.lctcs.edu, distinguished by a mepCode query
      // param. Same Ellucian MEP pattern as Alabama's OneACCS. The 12th
      // member (Northshore Technical CC) uses Coursedog instead and is
      // deferred — see DEFERRED-scrapers commit on this branch.
      {
        scripts: ["scripts/la/scrape-lctcs-banner-ssb.ts"],
        runner: "http",
      },
    ],
    // manual-only: transfers — Louisiana Board of Regents publishes annual
    // articulation PDFs at laregents.edu but no registered API portal yet.
    // Add to data/articulation-portals.json once researched.
    // manual-only: prereqs — aggregated inline from Banner SSB course data
    // by scripts/lib/aggregate-prereqs.ts (no separate catalog scrape).
    // manual-only: programs — Phase 6 wrapper at scripts/la/scrape-programs.ts
    // discovered 4 catalogs (Nunez courseleaf; Fletcher/SLCC/Delta acalog).
    // Operator must validate URLs + fill per-college config before running.
  },
};

export default laConfig;
