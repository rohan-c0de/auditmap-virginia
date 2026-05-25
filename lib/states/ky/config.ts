import type { StateConfig } from "../registry";

const kyConfig: StateConfig = {
  slug: "ky",
  name: "Kentucky",
  systemName: "KCTCS",
  systemFullName: "Kentucky Community and Technical College System",
  systemUrl: "https://kctcs.edu/",
  collegeCount: 16,

  // TODO: research senior-waiver statute for KY (KRS 164.284 — Senior
  // Citizens' Higher Education Program is the likely citation; verify
  // the current text and waiver scope before populating).
  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "KRS 164.284",
    description:
      "Kentucky residents aged 65 and older may enroll in credit courses at any state-supported postsecondary institution, including the Kentucky Community and Technical College System, with tuition waived on a space-available basis. Fees still apply.",
    bannerTitle: "Kentucky Senior Citizens' Tuition Waiver",
    bannerSummary:
      "Over 65 in Kentucky? Tuition is waived at KCTCS colleges on a space-available basis.",
    bannerDetail:
      "Under KRS 164.284, Kentucky residents aged 65+ may enroll in credit courses at any state-supported postsecondary institution (including the 16 KCTCS colleges) tuition-free on a space-available basis. Fees, books, and other charges still apply. Bring proof of age and residency when you register.",
  },

  transferSupported: false,
  popularCourses: ["NAA 100", "ENG 101", "BIO 137", "BIO 139", "MAT 150", "PSY 110"],
  defaultZip: "40202",
  defaultZipCity: "Louisville",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://students.kctcs.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://students.kctcs.edu/",

  branding: {
    siteName: "Community College Path Kentucky",
    tagline: "Search KCTCS courses across all 16 Kentucky community and technical colleges.",
    footerText: "Community College Path Kentucky — Find courses across all 16 KCTCS colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Kentucky Community and Technical College System (KCTCS).",
    metaKeywords: [
      "Kentucky community college courses",
      "KCTCS course search",
      "Kentucky Community and Technical College System",
    ],
  },
  scrapers: {
    // KCTCS exposes a public read-only class-search JSON API at
    // class-search.kctcsweb.com. One scraper covers all 16 colleges by
    // paginating through the system-wide search and partitioning results
    // by campus code (issue #289 build decision). The scraper auto-
    // discovers terms via /api/terms, so no termSystem registration is
    // needed.
    courses: [
      { scripts: ["scripts/ky/scrape-courses.ts"], runner: "http" },
    ],
    prereqs: [
      { scripts: ["scripts/ky/scrape-catalog-prereqs.ts"], runner: "http" },
    ],
    // manual-only: transfers — no entry in data/articulation-portals.json for KY.
    //   Fallback options: KYTransfer.org (transfer.ky.gov) state portal, or
    //   CollegeTransfer.Net per-college lookup.
    programs: [{ scripts: ["scripts/ky/scrape-programs.ts"], runner: "http" }],
  },
};

export default kyConfig;
