import type { StateConfig } from "../registry";

const ksConfig: StateConfig = {
  slug: "ks",
  name: "Kansas",
  systemName: "Kansas Board of Regents",
  systemFullName: "Kansas Community and Technical Colleges (Kansas Board of Regents)",
  systemUrl: "https://www.kansasregents.org/",
  collegeCount: 24,

  // Kansas has no statewide senior tuition-waiver statute for community/technical
  // colleges. K.S.A. 76-731a covers Board of Regents (state university) institutions,
  // not community colleges (governed under K.S.A. Chapter 71). Each college sets its
  // own policy; common threshold is 60–65. Populated as "varies by college" per the
  // NE/AZ/CA pattern.
  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "No statewide statute for community/technical colleges; set by each college",
    description:
      "Kansas has no statewide senior-tuition statute for its community and technical colleges. Each college sets its own policy — many offer a reduced senior rate or waived tuition for residents aged 60+ on credit courses, often on a space-available basis. Terms vary by college; confirm with the registrar.",
    bannerTitle: "Kansas Senior Discounts (by college)",
    bannerSummary:
      "60+ in Kansas? Many community and technical colleges offer a reduced senior tuition rate — terms vary by college.",
    bannerDetail:
      "Kansas has no statewide senior-tuition statute for community and technical colleges. K.S.A. 76-731a covers state universities under the Board of Regents but does not extend to the 24-college community/technical system. Each college sets its own policy — commonly a reduced or waived senior rate for residents 60 or 65+ on a space-available basis, sometimes excluding lab fees and non-credit classes. Contact your college's registrar for the specific rate and eligibility.",
  },

  transferSupported: true,
  // Top 8 by section count across all wired KS colleges. Different colleges use
  // different prefixes (EG/EN/ENG for English Composition); list reflects the
  // raw rank in scraped data.
  popularCourses: [
    "EG 101",
    "EN 101",
    "PS 100",
    "MA 106",
    "EN 102",
    "SH 101",
    "ENG 101",
    "PSY 101",
  ],
  defaultZip: "67202",
  defaultZipCity: "Wichita",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.example.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.example.edu/",

  branding: {
    siteName: "Community College Path Kansas",
    tagline: "Search Kansas community and technical college courses across all 24 colleges.",
    footerText: "Community College Path Kansas — Find courses across all 24 Kansas community and technical colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Kansas Board of Regents.",
    metaKeywords: [
      "Kansas community college courses",
      "Kansas community college class search",
      "Kansas Board of Regents",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/ks/scrape-banner-ssb.ts"], runner: "playwright" },
      { scripts: ["scripts/ks/scrape-colleague.ts"], runner: "playwright" },
      { scripts: ["scripts/ks/scrape-jenzabar-webforms.ts"], runner: "playwright" },
      { scripts: ["scripts/ks/scrape-fhnw-empower-xl.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-hutchinson.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-allen.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-manhattan-tech.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-colby.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-salina.ts"], runner: "http" },
    ],
    // Kansas has no CollegeTransfer.Net in-state data and the Board of Regents
    // systemwide portal is Cloudflare-walled. Wichita State's public GenEd
    // Transfer Equivalency web app (ASP.NET WebForms) lists all 24 KS
    // community/technical colleges' course-to-course equivalencies, including
    // the KS Systemwide Transfer (KRSN) flag. scrape-transfer.ts drives the
    // two-step institution→results postback and keeps the latest effective
    // term per course.
    // COVERAGE GAP: Wichita State is one receiver; KU and K-State have their
    // own public tools (follow-ups).
    transfers: [{ scripts: ["scripts/ks/scrape-transfer.ts"], runner: "http" }],
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — Phase 6 catalog discovery found no templated platforms; bespoke per-college needed.
  },
};

export default ksConfig;
