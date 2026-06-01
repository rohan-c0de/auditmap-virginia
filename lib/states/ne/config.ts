import type { StateConfig } from "../registry";

const neConfig: StateConfig = {
  slug: "ne",
  name: "Nebraska",
  systemName: "NCCA",
  systemFullName: "Nebraska Community College Association",
  systemUrl: "https://nebraskacommunitycolleges.org/",
  collegeCount: 9,

  // Nebraska has no statewide senior tuition-waiver statute; each community
  // college sets its own policy. Populated at state level as a "varies by
  // college" entry with the most common threshold (62), per the AZ/CA pattern.
  seniorWaiver: {
    ageThreshold: 62,
    legalCitation: "No statewide statute; set by each community college",
    description:
      "Nebraska has no statewide senior-tuition statute. Each community college sets its own policy — commonly a reduced senior rate for residents 62+ on credit courses (e.g. Metropolitan CC, Mid-Plains CC). Terms vary by college; confirm with the registrar.",
    bannerTitle: "Nebraska Senior Discounts (by college)",
    bannerSummary:
      "62+ in Nebraska? Many community colleges offer a reduced senior tuition rate — terms vary by college.",
    bannerDetail:
      "Nebraska has no statewide senior-tuition statute; each community college sets its own policy. A common pattern is a reduced (often ~50%) senior tuition rate for residents aged 62 and older on credit courses, sometimes excluding non-credit classes and third-party-paid tuition (e.g. Metropolitan Community College, Mid-Plains Community College). Contact your college's registrar or business office for the specific rate and eligibility.",
  },

  transferSupported: false,
  // Top 8 by section count across all 7 scraped NE colleges (9,636 sections).
  // Computed once from data/ne/courses; refresh periodically as new colleges
  // come online. ACFS 1015 = Adult Coping & Family Skills (workforce);
  // ENGL 1010 dominates with 310 sections statewide.
  popularCourses: [
    "ENGL 1010",
    "MATH 1150",
    "PSYC 1810",
    "ENGL 1020",
    "SPCH 1110",
    "BIOS 1010",
    "SOCI 1010",
    "ACCT 1200",
  ],
  defaultZip: "68508",
  defaultZipCity: "Lincoln",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://nebraskacommunitycolleges.org/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://nebraskacommunitycolleges.org/",

  branding: {
    siteName: "Community College Path Nebraska",
    tagline: "Search Nebraska community college courses across all 9 colleges.",
    footerText:
      "Community College Path Nebraska — Find courses across all 9 Nebraska community colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Nebraska Community College Association.",
    metaKeywords: [
      "Nebraska community college courses",
      "Nebraska community college class search",
      "Nebraska Community College Association",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/ne/scrape-colleague.ts"], runner: "playwright" },
      { scripts: ["scripts/ne/scrape-banner-ssb.ts"], runner: "http" },
      { scripts: ["scripts/ne/scrape-nicc.ts"], runner: "http" },
      { scripts: ["scripts/ne/scrape-mpcc.ts"], runner: "http" },
      { scripts: ["scripts/ne/scrape-wncc.ts"], runner: "http" },
      { scripts: ["scripts/ne/scrape-lptc.ts"], runner: "http" },
    ],
    prereqs: { source: "aggregate-from-courses" as const },
    programs: [
      { scripts: ["scripts/ne/scrape-programs.ts"], runner: "http" },
    ],
    // manual-only: transfers — no articulation portal registered for NE.
  },
};

export default neConfig;
