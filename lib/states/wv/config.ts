import type { StateConfig } from "../registry";

const wvConfig: StateConfig = {
  slug: "wv",
  name: "West Virginia",
  systemName: "WVCTCS",
  systemFullName: "West Virginia Community and Technical College System",
  systemUrl: "https://wvctcs.edu",
  collegeCount: 9,

  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "WV Code §18B-10-7a",
    description:
      "West Virginia residents aged 65 and older may enroll in WVCTCS courses at a reduced tuition and fee rate on a space-available basis. Each governing board sets its own program specifics.",
    bannerTitle: "West Virginia Senior Tuition Reduction",
    bannerSummary:
      "Over 65 in West Virginia? You may be eligible for reduced tuition at WVCTCS colleges.",
    bannerDetail:
      "West Virginia law requires every public college to offer a reduced-rate program for state residents aged 65+. Coverage spans credit and non-credit courses, on-campus, distance, and online — on a space-available basis. Specific costs vary by institution.",
  },

  // No transfer data yet — Phase 3. WV does not appear to run a unified
  // state articulation portal; expect a per-receiving-university or
  // CollegeTransfer.Net approach.
  transferSupported: true,
  popularCourses: ["ENGL 101", "MATH 121", "BIOL 101", "PSYC 101", "HIST 101", "SOCI 101"],
  defaultZip: "25301",
  defaultZipCity: "Charleston",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://wvctcs.edu",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://wvctcs.edu",

  branding: {
    siteName: "Community College Path West Virginia",
    tagline:
      "Search West Virginia Community and Technical College System courses across all 9 colleges.",
    footerText:
      "Community College Path West Virginia — Find courses across all 9 WVCTCS colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the West Virginia Community and Technical College System (WVCTCS).",
    metaKeywords: [
      "West Virginia community college courses",
      "WVCTCS course search",
      "West Virginia Community and Technical College System",
      "West Virginia community college schedule",
    ],
  },
  universityAliases: [
    { slug: "wvu", names: ["WVU", "West Virginia University", "West Virginia"] },
    { slug: "marshall", names: ["Marshall", "Marshall University"] },
    { slug: "shepherd", names: ["Shepherd", "Shepherd University"] },
  ],
  scrapers: {
    courses: [
      // Eastern WV — WordPress + PDF schedule. PoC for issue #456 cluster #3.
      // Auto-discovers term PDFs from the WP listing page and parses each
      // via `pdftotext -layout` (poppler).
      { scripts: ["scripts/wv/scrape-eastern-wv.ts"], runner: "http" },
      // manual-only: 3 other WV colleges (blue-ridge, bridgevalley,
      // southern-wv) — each needs its own scraper. Eastern WV is the
      // cleanest WP+PDF example; replicate the pattern per-college.
    ],
    prereqs: [
      // Six WV Acalog catalogs — WAF bypass via Playwright. Covers Pierpont,
      // BridgeValley, Bluefield State, WV Northern, Southern WV, New River.
      { scripts: ["scripts/wv/scrape-catalog-prereqs.ts"], runner: "http" },
    ],
    transfers: [
      // No WV statewide articulation portal (HEPC's is outcomes-based, not
      // course-level). Marshall University publishes a public equivalency tool
      // (mubert.marshall.edu/transfer) covering 8 of WV's 9 CCs. Single
      // receiver for now — WVU's data is behind a DegreeWorks SPA and
      // Fairmont/Shepherd's CollegeSource TES public view 403s non-browser
      // clients; both are documented follow-ups.
      { scripts: ["scripts/wv/scrape-transfer-marshall.ts"], runner: "http" },
    ],
    // manual-only: programs — Phase 5+.
  },
};

export default wvConfig;
