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

  transferSupported: true,
  popularCourses: ["ENG 101", "COM 101", "PSY 101", "ENG 100", "PSC 101", "ENG 102"],
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
      // termSystem: "banner" causes the cron to pass --term "Spring 2026,Summer 2026"
      // (or whatever the current+next semesters are) — required by scrape-peoplesoft.ts.
      { scripts: ["scripts/nv/scrape-peoplesoft.ts"], runner: "playwright", termSystem: "banner" },
    ],
    transfers: [
      { scripts: ["scripts/nv/scrape-nv-transfers.ts"], runner: "http" },
    ],
    prereqs: [
      { scripts: ["scripts/nv/scrape-catalog-prereqs.ts"], runner: "playwright" },
    ],
    programs: [
      { scripts: ["scripts/nv/scrape-programs.ts"], runner: "playwright" },
    ],
  },
  documentedCeilings: {
    programs:
      "GBC publishes degree requirements only as per-program PDFs (www.gbcnv.edu/catalog — no live HTML). TMCC's Courseleaf variant uses a degree-page layout the current template parser doesn't recognize (197 paths found, 0 awards extracted) — needs Courseleaf parser tuning.",
  },
};

export default nvConfig;
