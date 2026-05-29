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

  transferSupported: true,
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
      // Northshore Technical CC — the 12th LCTCS college, not on the
      // shared Banner SSB host. Coursedog catalog gives course metadata
      // + 23 prereqs; the aggregator merges into prereqs.json. No
      // section data is available publicly (LoLA SSO).
      {
        scripts: ["scripts/la/scrape-coursedog.ts"],
        runner: "playwright",
      },
    ],
    prereqs: { source: "aggregate-from-courses" },
    transfers: [
      // Louisiana Board of Regents publishes the statewide Master Course
      // Articulation Matrix as an annual Excel file at laregents.edu/matrix-
      // archive/. Most recent "Final Approved" version is AY 2021-2022.
      // Covers all 11 LCTCS senders × 16 LSU/UL/SU public-system receivers.
      { scripts: ["scripts/la/scrape-regents-matrix.ts"], runner: "http" },
    ],
    programs: [
      // 5 LA colleges have public catalogs (Fletcher/SLCC/Delta/BRCC = acalog,
      // Nunez = courseleaf). Currently only Fletcher's search-discovery path
      // yields parseable programs (83 programs, 33 matched). The other 4 are
      // wired but return 0: Nunez courseleaf needs a non-default URL pattern;
      // SLCC/Delta/BRCC need per-catalog programNavoids (search_advanced.php
      // returns empty for those instances). Follow-up to discover navoids.
      { scripts: ["scripts/la/scrape-programs.ts"], runner: "http" },
    ],
  },
};

export default laConfig;
