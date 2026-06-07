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

  transferSupported: true,
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
    // Nebraska has no CollegeTransfer.Net in-state data and the statewide
    // Transfer Nebraska portal funnels into login-gated Transferology. UNL's
    // public Transfer Course Equivalency tool (ASP.NET WebForms) lists all 9
    // NE community colleges' course-to-course equivalencies. scrape-transfer.ts
    // posts each institution id and parses the results table.
    // CEILING: UNL is the only NE public university with a public, scrapeable
    // course-to-course tool. UNO/UNK publish only CollegeSource TES public views
    // that serve an ImageMath human-verification CAPTCHA to non-browser clients
    // (verified 2026-06) — see documentedCeilings.transfers.
    transfers: [{ scripts: ["scripts/ne/scrape-transfer.ts"], runner: "http" }],
  },

  documentedCeilings: {
    // Transfers cap at B: UNL is the ONLY Nebraska public university with a
    // public, scrapeable course-to-course equivalency tool (its ASP.NET app,
    // ~2,000 CC→UNL pairs — shipped). Re-verified 2026-06 against every other
    // in-state receiver: UNO and UNK publish only CollegeSource TES public views
    // that serve an ImageMath "human verification" CAPTCHA to non-browser
    // clients (no automatable course table); the statewide Transfer Nebraska
    // portal funnels into login-gated Transferology; Nebraska State College
    // System sites (Wayne/Peru/Chadron) bot-block (HTTP 403). No second public
    // data source exists to scrape, so 1-receiver coverage is the structural
    // ceiling — not an open gap.
    transfers:
      "UNL is the only Nebraska public university with a public, scrapeable course-to-course equivalency tool (shipped, ~2,000 pairs). UNO/UNK publish only CollegeSource TES public views that serve an ImageMath human-verification CAPTCHA to non-browser clients; Transfer Nebraska funnels into login-gated Transferology; NSCS colleges (Wayne/Peru/Chadron) bot-block (403). No second public source to scrape. Verified 2026-06.",
  },
};

export default neConfig;
