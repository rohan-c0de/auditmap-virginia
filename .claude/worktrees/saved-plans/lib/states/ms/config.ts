import type { StateConfig } from "../registry";

const msConfig: StateConfig = {
  slug: "ms",
  name: "Mississippi",
  systemName: "MCCB",
  systemFullName: "Mississippi Community College Board",
  systemUrl: "https://www.mccb.edu/",
  collegeCount: 15,

  // TODO: research senior-waiver statute for MS. Mississippi does not appear
  // to have a statewide senior tuition waiver statute for community colleges.
  // Individual colleges may offer senior discounts — verify before populating.
  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "Miss. Code § 37-29 (district-level authority)",
    description:
      "Mississippi has no statewide senior-tuition statute. The 15 community and junior colleges (organized under Miss. Code Title 37 Chapter 29) set their own tuition policies, and most offer reduced or waived tuition for residents 65+ on a space-available basis. Terms vary by college.",
    bannerTitle: "Mississippi Senior Tuition Discounts (by college)",
    bannerSummary:
      "Over 65 in Mississippi? Most community colleges offer senior tuition discounts — terms vary by college.",
    bannerDetail:
      "Mississippi has no statewide senior-tuition statute. The 15 community and junior colleges (organized under Miss. Code Title 37 Chapter 29) set their own tuition policies. Most offer reduced or waived tuition for residents 65+ on a space-available basis. Contact your college's registrar or financial aid office for the specific terms.",
  },

  transferSupported: true,
  popularCourses: ["SPT 1113", "ENG 1113", "HPR 2132", "HPR 1132", "BIO 2511", "PSY 1513"],
  defaultZip: "39201",
  defaultZipCity: "Jackson",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.mccb.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.mccb.edu/",

  branding: {
    siteName: "Community College Path Mississippi",
    tagline: "Search MCCB courses across all 15 Mississippi community colleges.",
    footerText: "Community College Path Mississippi — Find courses across all 15 MCCB colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Mississippi Community College Board (MCCB).",
    metaKeywords: [
      "Mississippi community college courses",
      "MCCB course search",
      "Mississippi Community College Board",
    ],
  },
  scrapers: {
    // Only Meridian CC is wired today (Banner 8). The other 14 MS colleges
    // remain fingerprinted but unscrapped pending wrapper work for the
    // mixed-platform mix (Colleague, Banner SSB 9, Jenzabar, custom).
    courses: [{ scripts: ["scripts/ms/scrape-banner8.ts"], runner: "http" }],
    transfers: [
      // University of Mississippi publishes public per-CC course-equivalency
      // tables (olemiss.edu/registrar/transfer-equivalencies) covering all 15
      // MS community colleges. One receiver for now — Mississippi State's data
      // is behind a Banner Extensibility XHR; USM/JSU publish nothing
      // course-level (they defer to MATT / transcript eval). Adding MSU is a
      // documented follow-up to lift MS above single-university coverage.
      { scripts: ["scripts/ms/scrape-transfer-olemiss.ts"], runner: "http" },
    ],
    prereqs: [{ scripts: ["scripts/ms/scrape-catalog-prereqs.ts"], runner: "playwright" }],
    programs: [{ scripts: ["scripts/ms/scrape-programs.ts"], runner: "http" }],
  },
};

export default msConfig;
