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
      // Eastern WV — WordPress + PDF schedule.
      { scripts: ["scripts/wv/scrape-eastern-wv.ts"], runner: "http" },
      // WVCTCS Banner SSB 9 cluster — 6 colleges on shared WVNET hosts
      // (xe<code>prod.wvnet.edu): mountwest, blueridge, bridgevalley,
      // newriver, pierpont, southern. Each college's own *.edu front door is
      // SSO/WAF/JS-gated, but the WVNET Banner backend is public. Verified 2026-06.
      { scripts: ["scripts/wv/scrape-wvctcs-banner.ts"], runner: "http" },
      // WVU at Parkersburg — custom XML schedule at schedules.wvup.edu.
      { scripts: ["scripts/wv/scrape-wvup.ts"], runner: "http" },
      // wvncc — no public sections (WVNET host has no SSB/8 module; CollegeScheduler
      // stale to Fall 2023; Pathify SAML). Documented as a course ceiling below.
    ],
    prereqs: [
      // Six WV Acalog catalogs — WAF bypass via Playwright. Covers Pierpont,
      // BridgeValley, Bluefield State, WV Northern, Southern WV, New River.
      { scripts: ["scripts/wv/scrape-catalog-prereqs.ts"], runner: "http" },
    ],
    transfers: [
      // Two receivers, both public no-login sources: Marshall (equivalency tool
      // mubert.marshall.edu/transfer, all 9 CCs) and WVU (its public
      // transfer-credit-database.xlsx — WVU's DegreeWorks SPA is auth-gated, but
      // the same data is exported as a downloadable spreadsheet). Fairmont,
      // Shepherd, WV State, Concord are ceilings — see documentedCeilings.
      { scripts: ["scripts/wv/scrape-transfer-marshall.ts"], runner: "http" },
      { scripts: ["scripts/wv/scrape-transfer-wvu.ts"], runner: "http" },
    ],
    // manual-only: programs — Phase 5+.
  },

  documentedCeilings: {
    courses: [
      {
        collegeSlug: "wvncc",
        reason:
          "West Virginia Northern has no public course-section endpoint: its WVNET Banner host (xewvnprod.wvnet.edu) has neither SSB 9 nor Banner 8 deployed, its CollegeScheduler tenant is stale to Fall 2023, and its Pathify portal is SAML-gated. Verified 2026-06.",
      },
    ],
    // Transfers cap at B: Marshall and WVU are the only WV public universities
    // with a public, scrapeable course-to-course source (both shipped).
    // Re-verified 2026-06 — Fairmont State, Shepherd, WV State, and Concord
    // publish only CollegeSource TES public views (ImageMath CAPTCHA to
    // non-browser clients) or PDF agreements; the statewide HEPC/CFWV dashboard
    // is AWS-WAF-gated and gen-ed-only. No third public course-level source.
    transfers:
      "Marshall and WVU are the only WV public universities with a public, scrapeable course-to-course transfer source (both shipped). Fairmont/Shepherd/WV State/Concord publish only CollegeSource TES public views (CAPTCHA-gated) or PDFs; the statewide HEPC dashboard is AWS-WAF-gated + gen-ed-only. Verified 2026-06.",
  },
};

export default wvConfig;
