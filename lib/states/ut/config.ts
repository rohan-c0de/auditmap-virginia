import type { StateConfig } from "../registry";

const utConfig: StateConfig = {
  slug: "ut",
  name: "Utah",
  // Utah has no single community-college system; both IPEDS-classified
  // 2-year colleges (Snow College, Salt Lake Community College) report
  // independently to the Utah Board of Higher Education (USHE). The
  // other former community colleges (Dixie, USU-Eastern, UVU, Weber)
  // were merged into the state's regional universities years ago and
  // are out of scope for this site.
  systemName: "USHE",
  systemFullName: "Utah System of Higher Education (community colleges)",
  systemUrl: "https://ushe.edu",
  collegeCount: 2,

  // Utah Code 53B-8-104: tuition waiver for residents aged 62+, on a
  // space-available basis. Applies to both Snow College and SLCC
  // (and to the state's universities).
  seniorWaiver: {
    ageThreshold: 62,
    legalCitation: "Utah Code 53B-8-104",
    description:
      "Utah residents aged 62 and older may enroll in courses at Utah's public colleges and universities tuition-free on a space-available basis (lab fees and other course fees still apply).",
    bannerTitle: "Utah Senior Tuition Waiver",
    bannerSummary:
      "62 or older in Utah? You may be eligible to enroll in Snow College or SLCC courses tuition-free.",
    bannerDetail:
      "Utah Code 53B-8-104 allows residents aged 62+ to enroll in credit courses at Utah's public colleges and universities tuition-free on a space-available basis. Lab fees and course fees still apply; confirm exact eligibility and registration timing with the campus registrar.",
  },

  transferSupported: false,
  popularCourses: ["ENGL 1010", "MATH 1010", "BIOL 1010", "PSY 1010", "HIST 1700", "COMM 1010"],
  defaultZip: "84130",
  defaultZipCity: "Salt Lake City",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://ushe.edu",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://ushe.edu",

  branding: {
    siteName: "Community College Path Utah",
    tagline: "Search Utah community college courses across Snow College and Salt Lake Community College.",
    footerText: "Community College Path Utah — Find courses at Snow College and Salt Lake Community College.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Utah System of Higher Education, Snow College, or Salt Lake Community College.",
    metaKeywords: [
      "Utah community college courses",
      "Salt Lake Community College schedule",
      "Snow College schedule",
      "SLCC course search",
      "Utah community college search",
    ],
  },
  scrapers: {
    courses: [{ scripts: ["scripts/ut/scrape-banner-ssb.ts"], runner: "http" }],
    // manual-only: transfers — no statewide articulation portal registered
    //   in data/articulation-portals.json. Utah does have USHE's transfer
    //   tools at transferut.com but they don't expose a public API; see
    //   the manual TODOs in the PR description for the fallback path.
    prereqs: { source: "aggregate-from-courses" },
    // programs — Snow College (CourseLeaf) + Salt Lake Community
    //   College (Acalog) both scraped via scripts/ut/scrape-programs.ts.
    //   119 Snow programs + 132 SLCC programs.
    programs: [{ scripts: ["scripts/ut/scrape-programs.ts"], runner: "http" }],
  },
  documentedCeilings: {
    transfers:
      "Utah's transfer portal (transferut.com) doesn't expose a public API. SLCC and Snow publish individual course-equivalency tables on their registrar sites but these are not machine-readable. Tracking as a known ceiling rather than substituting placeholder data.",
  },
};

export default utConfig;
