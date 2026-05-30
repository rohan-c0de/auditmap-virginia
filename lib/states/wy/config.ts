import type { StateConfig } from "../registry";

const wyConfig: StateConfig = {
  slug: "wy",
  name: "Wyoming",
  systemName: "WCCC",
  systemFullName: "Wyoming Community College Commission",
  systemUrl: "https://www.communitycolleges.wy.edu/",
  collegeCount: 7,

  // No statewide senior-tuition-waiver statute confirmed for Wyoming
  // community colleges. Each WCCC college sets its own senior-discount
  // policy; verify with the registrar before relying on any single
  // citation. Leave null until a system-wide statute is found.
  seniorWaiver: null,

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
    // manual-only: transfers — Wyoming has no registered articulation portal
    // in data/articulation-portals.json yet. Add once the state's transfer
    // matrix source is identified.
    // manual-only: programs — Phase 6 wrapper at scripts/wy/scrape-programs.ts
    // found no templated catalogs; needs per-college investigation.
  },
};

export default wyConfig;
