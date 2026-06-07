import type { StateConfig } from "../registry";

const inConfig: StateConfig = {
  slug: "in",
  name: "Indiana",
  systemName: "Ivy Tech",
  systemFullName: "Ivy Tech Community College of Indiana",
  systemUrl: "https://www.ivytech.edu",
  collegeCount: 1,

  // Ivy Tech "Senior Scholars" implements Indiana's statutory senior-citizen
  // tuition exemption (IC 21-14-5). Residents 60+, retired, with a HS
  // diploma/GED may take credit courses tuition-free, up to 9 credit hours
  // per semester; fees, books, and lab charges still apply.
  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "Indiana Code § 21-14-5 (Tuition Exemption for Senior Citizens)",
    description:
      "Indiana residents 60 and older who are retired and hold a high school diploma or GED may take Ivy Tech credit courses tuition-free under the Senior Scholars program, up to the equivalent of nine semester hours per semester on a space-available basis. Mandatory fees, books, and lab charges are not waived.",
    bannerTitle: "Ivy Tech Senior Scholars",
    bannerSummary:
      "Retired and 60+ in Indiana? You can take Ivy Tech credit classes tuition-free.",
    bannerDetail:
      "Indiana Code § 21-14-5 and Ivy Tech's Senior Scholars program let retired Indiana residents 60+ with a high school diploma or GED take credit courses tuition-free, up to nine credit hours per semester on a space-available basis. Fees, books, and lab charges still apply — confirm eligibility with the campus registrar.",
  },

  // Indiana's statewide Core Transfer Library / TransferIN equivalencies are
  // not yet ingested — see scrapers.transfers note below.
  transferSupported: true,
  popularCourses: ["ENGL 111", "MATH 123", "PSYC 101", "COMM 101", "APHY 101"],
  defaultZip: "46204",
  defaultZipCity: "Indianapolis",

  // Ivy Tech's public class search (CollegeScheduler SPA) isn't deep-linkable
  // per course, so both URLs point to the search entry point.
  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://ivytech.search.collegescheduler.com/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://ivytech.search.collegescheduler.com/",

  branding: {
    siteName: "Community College Path Indiana",
    tagline: "Search Ivy Tech Community College courses across all 22 Indiana campuses.",
    footerText:
      "Community College Path Indiana — Find Ivy Tech courses across all 22 campuses statewide.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by Ivy Tech Community College of Indiana.",
    metaKeywords: [
      "Indiana community college courses",
      "Ivy Tech course search",
      "Ivy Tech Community College",
      "Indiana class schedule",
    ],
  },

  scrapers: {
    // Ivy Tech is Indiana's entire public 2-year system: one Banner SIS,
    // ~22 campuses, scraped in a single run via its public CollegeScheduler
    // GraphQL API. The scraper auto-discovers current/future terms.
    courses: [{ scripts: ["scripts/in/scrape-ivy-tech.ts"], runner: "http" }],
    // Prereqs are flattened out of the course scrape (prerequisite_text on
    // each section, parsed from the CollegeScheduler course descriptions).
    prereqs: { source: "aggregate-from-courses" },
    // Ivy Tech → three in-state public universities, one per-receiver pass
    // (mergeTransferRows keeps them conflict-free):
    //   • USI    — CollegeTransfer.Net OData (scrape-transfer.ts)
    //   • Purdue — public Banner credit guide bzwtxcrd (scrape-transfer-purdue.ts)
    //   • IU Bloomington — public Credit Transfer Service JSON API
    //     components.cfc (scrape-transfer-iu.ts)
    // Ball State (DegreeWorks SPA) and Indiana State (redirects to login-gated
    // Transferology) expose no public course table; not scrapeable.
    transfers: [
      {
        scripts: [
          "scripts/in/scrape-transfer.ts",
          "scripts/in/scrape-transfer-purdue.ts",
          "scripts/in/scrape-transfer-iu.ts",
        ],
        runner: "http",
      },
    ],
    // Ivy Tech's full degree/certificate catalog (catalog.ivytech.edu, Acalog
    // catoid=13) scraped via the shared Acalog template — one statewide catalog
    // covers every campus. ~392 programs with requirement groups.
    programs: [{ scripts: ["scripts/in/scrape-programs.ts"], runner: "http" }],
  },
};

export default inConfig;
