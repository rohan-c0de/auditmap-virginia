import type { StateConfig } from "../registry";

const wyConfig: StateConfig = {
  slug: "wy",
  name: "Wyoming",
  systemName: "WCCC",
  systemFullName: "Wyoming Community College Commission",
  systemUrl: "https://www.communitycolleges.wy.edu/",
  collegeCount: 7,

  // Wyoming has no statewide senior-tuition statute; each WCCC college sets
  // its own policy. Populated as a "varies by college" entry with the most
  // common threshold (60), per the AZ/CA pattern.
  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "No statewide statute; set by each community college",
    description:
      "Wyoming has no statewide senior-tuition statute. Each community college sets its own policy, typically for residents 60+ — from a full waiver on a few credits (e.g. Northwest College's Golden Age program) to a per-credit or percentage discount (e.g. Laramie County CC, Western Wyoming CC). Course/mandatory fees often still apply; confirm with the registrar.",
    bannerTitle: "Wyoming Senior Discounts (by college)",
    bannerSummary:
      "60+ in Wyoming? Most community colleges offer a senior tuition waiver or discount — terms vary by college.",
    bannerDetail:
      "Wyoming has no statewide senior-tuition statute; each community college sets its own policy, usually for residents aged 60 and older. Examples range from a full tuition waiver on a limited number of credits (Northwest College's Golden Age program) to a reduced per-credit rate or percentage discount (Laramie County Community College, Western Wyoming Community College). Course and mandatory fees often still apply, and seats are typically space-available. Contact your college's registrar for the specific terms.",
  },

  transferSupported: false,
  popularCourses: ["ENGL 1010", "MATH 1000", "BIOL 1010", "PSYC 1000", "HIST 1110"],
  defaultZip: "82001",
  defaultZipCity: "Cheyenne",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.communitycolleges.wy.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.communitycolleges.wy.edu/",

  branding: {
    siteName: "Community College Path Wyoming",
    tagline: "Search Wyoming community college courses across the state.",
    footerText: "Community College Path Wyoming — Find courses across Wyoming's community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Wyoming Community College Commission (WCCC).",
    metaKeywords: [
      "Wyoming community college courses",
      "WCCC course search",
      "Wyoming Community College Commission",
    ],
  },
  scrapers: {
    courses: [
      // 5 of 7 Wyoming colleges run Ellucian Colleague Self-Service, each on
      // a non-canonical subdomain (selfservice.*, www2.*, fremontpeak.*,
      // nwccdss.*). The fingerprinter missed all of them because it only
      // probes the standard selfservice./selfserv./ssb. patterns.
      {
        scripts: ["scripts/wy/scrape-colleague.ts"],
        runner: "http",
      },
      // Northwest College (Powell) — Colleague Self-Service is SSO-gated, but
      // the college runs a public JSON course API at area10.nwc.edu. Bespoke
      // scraper hits GetScheduleDownload?term=... — no auth.
      {
        scripts: ["scripts/wy/scrape-northwest-college.ts"],
        runner: "http",
      },
      // DEFERRED-scrapers: central-wyoming-college — Colleague host
      // central-ss.colleague.elluciancloud.com is 100% SAML-SSO-gated (tenant
      // domain central.edu); schedule data lives only in Google Docs
      // spreadsheets. No machine-readable public endpoint. Genuine gap.
    ],
    prereqs: { source: "aggregate-from-courses" },
    // All 7 Wyoming community colleges publish dense in-state equivalencies
    // (primarily → University of Wyoming, plus inter-CC articulation) in
    // CollegeTransfer.Net's public OData API. scrape-transfer.ts pages each
    // sender and keeps in-state targets only.
    transfers: [{ scripts: ["scripts/wy/scrape-transfer.ts"], runner: "http" }],
    // manual-only: programs — Phase 6 wrapper at scripts/wy/scrape-programs.ts
    // found no templated catalogs; needs per-college investigation.
  },
};

export default wyConfig;
