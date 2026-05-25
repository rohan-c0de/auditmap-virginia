import type { StateConfig } from "../registry";

const ilConfig: StateConfig = {
  slug: "il",
  name: "Illinois",
  systemName: "Illinois Community Colleges",
  systemFullName: "Illinois Community College Board (ICCB)",
  systemUrl: "https://www.iccb.org/",
  collegeCount: 48,

  // TODO: research senior-waiver statute for Illinois.
  // Illinois Public Act 093-0228 waives tuition for seniors 65+ at public CCs,
  // but enrollment is space-available. Verify details before enabling.
  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "110 ILCS 990 (Senior Citizen Courses Act)",
    description:
      "Illinois residents aged 65 and older with prior year's federal adjusted gross income below the threshold set by the Senior Citizen Courses Act (currently around $34,000) may enroll in regular credit courses at any Illinois public community college tuition-free, on a space-available basis. Fees and books are not waived.",
    bannerTitle: "Illinois Senior Citizen Courses Act",
    bannerSummary:
      "Over 65 in Illinois with limited income? Tuition is free at community colleges on a space-available basis.",
    bannerDetail:
      "Under the Senior Citizen Courses Act (110 ILCS 990), Illinois residents aged 65+ whose prior-year federal adjusted gross income is below the statutory threshold (about $34,000) may enroll in regular credit courses at any public community college tuition-free, on a space-available basis. Fees and books are not waived. Bring your most recent federal tax return when you register.",
  },

  transferSupported: false,
  popularCourses: ["ENGLISH 101", "BIOLOGY 121", "CHEM 121", "ENG 101", "ENGLISH 102", "SPEECH 101-1"],
  defaultZip: "60601",
  defaultZipCity: "Chicago",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.iccb.org/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.iccb.org/",

  branding: {
    siteName: "Community College Path Illinois",
    tagline: "Search courses across all 48 Illinois community colleges.",
    footerText: "Community College Path Illinois — Find courses across all 48 Illinois community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Illinois Community College Board (ICCB).",
    metaKeywords: [
      "Illinois community college courses",
      "Illinois community college search",
      "ICCB course finder",
    ],
  },
  scrapers: {
    courses: [
      // CCC (City Colleges of Chicago) — 7 colleges, shared JSON API.
      // Single fetch returns all sections; no auth or pagination needed.
      { scripts: ["scripts/il/scrape-ccc.ts"], runner: "http" },
      // IECC (Illinois Eastern) — 4 colleges share one Banner SSB host,
      // split by campusDescription.
      { scripts: ["scripts/il/scrape-iecc.ts"], runner: "http" },
      // Colleague Self-Service — 3 colleges (kankakee, parkland, rock-valley).
      // Rock Valley currently returns no live terms but stays in the map
      // so cron picks up sections when they post.
      { scripts: ["scripts/il/scrape-colleague.ts"], runner: "playwright" },
      // manual-only: ~16 remaining custom-platform colleges. Notes:
      //   - 4 Jenzabar (john-a-logan, richland, southeastern-illinois, spoon-river)
      //     have Course Search behind auth ("you do not have permission" without login).
      //   - "Coursedog" fingerprints were false positives: clcillinois.edu is
      //     Sitefinity CMS, rendlake is a Coursedog *events* calendar (no courses).
      //   - Others are bespoke (PDF schedules / custom CMS / SSO-gated).
    ],
    // Prereqs are extracted inline by each course scraper (Banner SSB, CCC,
    // Colleague), then aggregated into data/il/prereqs.json by the unified
    // pipeline. Declaring this sentinel lights up the cron prereq job.
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: transfers — CollegeTransfer.Net has zero IL in-state targets
    // (only Indiana universities). Need iTransfer.org (login-gated) or
    // individual university articulation pages.
    // manual-only: programs — Phase 5+; no state has program scrapers yet.
  },
};

export default ilConfig;
