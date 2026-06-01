import type { StateConfig } from "../registry";

const coConfig: StateConfig = {
  slug: "co",
  name: "Colorado",
  systemName: "CCCS",
  systemFullName: "Colorado Community College System",
  systemUrl: "https://cccs.edu/",
  collegeCount: 15,

  // TODO: research statewide senior-tuition policy. CCCS does not have a
  // single uniform statute equivalent to AL's § 16-60-114; each college
  // sets its own senior-discount policy. Leave null until verified.
  seniorWaiver: null,

  transferSupported: false,
  popularCourses: ["ENG 121", "MAT 121", "BIO 111", "PSY 101", "HIS 121", "ECO 201"],
  defaultZip: "80202",
  defaultZipCity: "Denver",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://cccs.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://cccs.edu/",

  branding: {
    siteName: "Community College Path Colorado",
    tagline: "Search CCCS courses across all 15 Colorado community colleges.",
    footerText: "Community College Path Colorado — Find courses across all 15 CCCS colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Colorado Community College System (CCCS).",
    metaKeywords: [
      "Colorado community college courses",
      "CCCS course search",
      "Colorado Community College System",
    ],
  },
  scrapers: {
    courses: [
      // 13 CCCS colleges share a single Banner 8 host at
      // erpdnssb.cccs.edu/<CODE>/bwckschd.p_disp_dyn_sched (one path per
      // college, e.g. PRODACC for Arapahoe, PRODCCD for CCD). One scraper
      // covers the entire CCCS cluster.
      {
        scripts: ["scripts/co/scrape-cccs-banner8.ts"],
        runner: "http",
      },
      // Colorado Mountain College is the only standalone CO community
      // college outside CCCS; it runs Ellucian Colleague Self-Service at
      // selfservice.coloradomtn.edu with public guest access.
      {
        scripts: ["scripts/co/scrape-colleague.ts"],
        runner: "playwright",
      },
    ],
    // manual-only: transfers — hard ceiling. Investigated 2026-05-30 as part
    // of the transfer cold-start sweep (issue #804). All high-enrollment CO
    // receivers are login-gated:
    //   CU Boulder / CU System → transferology.com (login wall, no bulk export)
    //   Colorado State → transferweb.colostate.edu (login / CAS)
    //   UCCS, MSU Denver, UNC, Fort Lewis → same Transferology or no public tool
    // CDHE's GT Pathways (Guaranteed Transfer) framework at highered.colorado.gov
    // maps gen-ed CATEGORY guarantees (GT-CO1, GT-MA1, etc.), NOT course-to-course
    // equivalencies — useless for our model. Colorado Mesa (DegreeWorks SPA) and
    // CSU Global (CollegeSource TES) are public but give thin, lopsided coverage
    // with no statewide signal. Documenting as a ceiling rather than shipping
    // weak one-receiver data. Revisit if CDHE ever publishes a public API or
    // CU/CSU opens guest access to their equivalency tools.
    // CCCS Banner 8 section descriptions do not include prerequisite text,
    // so the aggregator will yield 0 entries. Catalog-based prereq sources
    // (Acalog at catalog.cncc.edu / catalog.pueblocc.edu, SmartCatalogIQ
    // at rrcc.smartcatalogiq.com / frontrange.smartcatalogiq.com,
    // CourseLeaf at catalog.ccd.edu, CleanCatalog at catalog.morgancc.edu)
    // are tracked as a follow-up.
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — Phase 6 (catalog discovery emitted a wrapper
    // at scripts/co/scrape-programs.ts but no catalogs matched a templated
    // platform; will be picked up when one of the CCCS Acalog/SmartCatalogIQ
    // / CleanCatalog catalogs gets a scraper).
  },
  documentedCeilings: {
    courses: [
      {
        collegeSlug: "aims-community-college",
        reason: "Aims runs only an Acalog course catalog (catalog/programs platform, not live section search). The college's homepage does not expose a Banner / Colleague / Workday endpoint. Verified 2026-05-28.",
      },
    ],
  },
};

export default coConfig;
