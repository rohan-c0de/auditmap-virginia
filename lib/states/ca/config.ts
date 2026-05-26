import type { StateConfig } from "../registry";

const caConfig: StateConfig = {
  slug: "ca",
  name: "California",
  systemName: "California CCs",
  systemFullName: "California Community Colleges",
  systemUrl: "https://www.cccco.edu/",
  collegeCount: 117,

  // California does not have a single statewide senior-waiver statute; many
  // districts offer their own audit / senior-adult policies under Education
  // Code §§ 76300, 84810.5. Leaving null until per-college policies are
  // surveyed.
  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "Cal. Ed. Code § 76300 (district-level authority)",
    description:
      "California has no statewide senior-tuition statute. The California Community Colleges enrollment fee is set under Ed. Code § 76300, and individual districts may waive or reduce it for residents 60+ — terms (age, fees, eligibility) vary by district.",
    bannerTitle: "California Senior Tuition Discounts (by district)",
    bannerSummary:
      "Over 60 in California? Most community college districts offer senior tuition waivers or discounts — terms vary by district.",
    bannerDetail:
      "California has no statewide senior-tuition statute. Cal. Ed. Code § 76300 sets the standard enrollment fee, and individual community college districts may waive or reduce it for residents 60+ on a space-available basis. Some districts cover only the enrollment fee; others include health, parking, and other fees. Contact the financial aid or registrar office at your college for the specific terms.",
  },

  transferSupported: true,
  popularCourses: ["ENGL C1000", "COMM C1000", "STAT C1000", "ENGL C1001", "PSYC C1000", "POLS C1000"],
  defaultZip: "90029",
  defaultZipCity: "Los Angeles",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.cccco.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.cccco.edu/",

  branding: {
    siteName: "Community College Path California",
    tagline: "Search California community college courses across all 117 colleges.",
    footerText: "Community College Path California — Find courses across all 117 California community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the California Community Colleges Chancellor's Office.",
    metaKeywords: [
      "California community college courses",
      "California community college course search",
      "California Community Colleges",
      "CCC course search",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/ca/scrape-banner-ssb.ts"], runner: "http" },
      { scripts: ["scripts/ca/scrape-colleague.ts"], runner: "playwright" },
      // LACCD cluster: one bespoke scraper covers all 9 Los Angeles CC District
      // colleges via shared PS Community Access (mycollege-guest.laccd.edu).
      { scripts: ["scripts/ca/scrape-laccd.ts"], runner: "playwright" },
    ],
    prereqs: { source: "aggregate-from-courses" },
    transfers: [
      // ASSIST.org — XSRF-protected REST API. v1 covers system-level UCTCA +
      // CSUTC transferability lists (~145K mappings across 114 CCs). Per-major
      // course-by-course articulation is a future v2 enhancement.
      { scripts: ["scripts/ca/scrape-transfer-assist.ts"], runner: "http" },
    ],
    // manual-only: programs — Phase 5+.
  },
};

export default caConfig;
