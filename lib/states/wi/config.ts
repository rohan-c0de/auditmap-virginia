import type { StateConfig } from "../registry";

const wiConfig: StateConfig = {
  slug: "wi",
  name: "Wisconsin",
  systemName: "WTCS",
  systemFullName: "Wisconsin Technical College System",
  systemUrl: "https://www.wtcsystem.edu/",
  collegeCount: 16,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation:
      "Wis. Stat. § 38.24(4m) (audit, 60+); § 38.24(1m)(b) (program-fee exemption, 62+)",
    description:
      "Wisconsin residents 60+ may audit technical college courses with no auditor's fee, space-available and with instructor approval (Wis. Stat. § 38.24(4m)); residents 62+ are exempt from program fees in vocational-adult programs (§ 38.24(1m)(b)). Material and special-course fees may still apply.",
    bannerTitle: "Wisconsin Senior Audit — free (60+)",
    bannerSummary:
      "60+ in Wisconsin? You can audit technical college courses with no auditor's fee under Wis. Stat. § 38.24.",
    bannerDetail:
      "Under Wis. Stat. § 38.24(4m), Wisconsin technical college district boards must let residents aged 60 and older audit a course without paying the auditor's fee, on a space-available basis and with instructor approval. Separately, § 38.24(1m)(b) exempts residents 62 and older from program fees in vocational-adult programs. Auditing means no credit or grade, and material or special-course fees may still apply. Contact your technical college's registrar about enrollment timing.",
  },

  transferSupported: true,
  // Top course codes by section count across the scraped WTCS colleges.
  // WTCS uses the statewide "DDD-DDD" course-number scheme (e.g. 801-136 =
  // English Composition I); computed from data/wi/courses.
  popularCourses: [
    "COMM 801-136",
    "MATH 804-134",
    "SCIL 806-177",
    "BSCE 809-198",
    "COMM 801-196",
  ],
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
      {
        scripts: ["scripts/wi/scrape-colleague.ts"],
        runner: "playwright",
      },
      {
        scripts: ["scripts/wi/scrape-ntc.ts"],
        runner: "http",
      },
      {
        scripts: ["scripts/wi/scrape-swtc.ts"],
        runner: "http",
      },
    ],
    // Wisconsin's statewide UW transfer system was retired in 2020 (moved to
    // login-gated Transferology) and WTCS colleges have no CollegeTransfer.Net
    // in-state data. UW-Milwaukee's Transfer Equivalency Database exposes a
    // public JSON API covering all 16 WTCS colleges → UW-Milwaukee.
    // COVERAGE GAP: UW-Milwaukee is the only receiver with a public API; other
    // UW campuses are Transferology-gated.
    transfers: [{ scripts: ["scripts/wi/scrape-transfer-uwm.ts"], runner: "http" }],
    // manual-only: prereqs — Coursedog catalog data for Nicolet Area TC at data/wi/coursedog-catalog/; aggregate into prereqs.json manually.
    // manual-only: programs — Phase 6 discovery found no matching catalog platforms; manual investigation needed.
  },
};

export default wiConfig;
