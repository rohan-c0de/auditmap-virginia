import type { StateConfig } from "../registry";

const nvConfig: StateConfig = {
  slug: "nv",
  name: "Nevada",
  systemName: "NSHE",
  systemFullName: "Nevada System of Higher Education",
  systemUrl: "https://nshe.nevada.edu/",
  collegeCount: 4,

  seniorWaiver: {
    ageThreshold: 62,
    legalCitation: "NRS 396.540",
    description:
      "Nevada residents aged 62+ may register for classes at NSHE institutions on a space-available basis with fees waived.",
    bannerTitle: "Nevada Senior Citizens' Fee Waiver",
    bannerSummary:
      "Over 62 in Nevada? Registration fees may be waived at NSHE colleges.",
    bannerDetail:
      "Nevada law (NRS 396.540) allows residents aged 62+ to register for credit courses at NSHE institutions on a space-available basis with registration fees waived.",
  },

  transferSupported: false,
  popularCourses: [],
  defaultZip: "89101",
  defaultZipCity: "Las Vegas",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://mycolleges.shr.nevada.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://mycolleges.shr.nevada.edu/",

  branding: {
    siteName: "Community College Path Nevada",
    tagline: "Search NSHE courses across all 4 Nevada community colleges.",
    footerText: "Community College Path Nevada — Find courses across all 4 NSHE community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Nevada System of Higher Education.",
    metaKeywords: [
      "Nevada community college courses",
      "NSHE course search",
      "Nevada System of Higher Education",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/nv/scrape-peoplesoft.ts"], runner: "playwright" },
    ],
    // manual-only: transfers — no articulation portal registered for NV yet.
    prereqs: {
      source: "catalog-scrape",
      scripts: ["scripts/nv/scrape-catalog-prereqs.ts"],
    },
    // manual-only: programs — Phase 5+.
  },
};

export default nvConfig;
