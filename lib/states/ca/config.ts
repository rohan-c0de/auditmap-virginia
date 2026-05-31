import type { StateConfig } from "../registry";

const caConfig: StateConfig = {
  slug: "ca",
  name: "California",
  systemName: "California CCs",
  systemFullName: "California Community Colleges",
  systemUrl: "https://www.cccco.edu/",
  collegeCount: 117,

  // California does not have a single statewide senior-waiver statute; many
  // districts offer their own audit / senior-adult policies under Education
  // Code §§ 76300, 84810.5. Leaving null until per-college policies are
  // surveyed.
  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "Cal. Ed. Code § 76300 (district-level authority)",
    description:
      "California has no statewide senior-tuition statute. The California Community Colleges enrollment fee is set under Ed. Code § 76300, and individual districts may waive or reduce it for residents 60+ — terms (age, fees, eligibility) vary by district.",
    bannerTitle: "California Senior Tuition Discounts (by district)",
    bannerSummary:
      "Over 60 in California? Most community college districts offer senior tuition waivers or discounts — terms vary by district.",
    bannerDetail:
      "California has no statewide senior-tuition statute. Cal. Ed. Code § 76300 sets the standard enrollment fee, and individual community college districts may waive or reduce it for residents 60+ on a space-available basis. Some districts cover only the enrollment fee; others include health, parking, and other fees. Contact the financial aid or registrar office at your college for the specific terms.",
  },

  transferSupported: true,
  popularCourses: ["ENGL C1000", "COMM C1000", "STAT C1000", "ENGL C1001", "PSYC C1000", "POLS C1000"],
  defaultZip: "90029",
  defaultZipCity: "Los Angeles",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.cccco.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.cccco.edu/",

  branding: {
    siteName: "Community College Path California",
    tagline: "Search California community college courses across all 117 colleges.",
    footerText: "Community College Path California — Find courses across all 117 California community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the California Community Colleges Chancellor's Office.",
    metaKeywords: [
      "California community college courses",
      "California community college course search",
      "California Community Colleges",
      "CCC course search",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/ca/scrape-banner-ssb.ts"], runner: "http" },
      { scripts: ["scripts/ca/scrape-colleague.ts"], runner: "playwright" },
      // LACCD cluster: one bespoke scraper covers all 9 Los Angeles CC District
      // colleges via shared PS Community Access (mycollege-guest.laccd.edu).
      { scripts: ["scripts/ca/scrape-laccd.ts"], runner: "playwright" },
      // De Anza College (Foothill-De Anza CCD). The combined FHDA portal is
      // SSO-gated, but each campus publishes a public schedule on its own
      // domain — De Anza at deanza.edu/schedule/listings.html.
      { scripts: ["scripts/ca/scrape-deanza.ts"], runner: "http" },
      // Los Rios CCD cluster: four colleges (ARC, CRC, SCC, FLC) share a
      // centralized API at hub.losrios.edu/classSearch. One scraper fetches all
      // four via per-college schedule page discovery.
      { scripts: ["scripts/ca/scrape-losrios.ts"], runner: "http" },
      // San Diego CCD cluster: three credit colleges (City, Mesa, Miramar)
      // share the public mws-api.sdccd.edu endpoint. One call per term
      // returns every section across the district; CAMPUS field routes the
      // row to its college. Continuing-ed (sdcce.edu, career=ce) excluded.
      { scripts: ["scripts/ca/scrape-sdccd.ts"], runner: "http" },
      // Peralta CCD cluster: four colleges (Berkeley City, Alameda, Laney,
      // Merritt) share a HubSpot HubDB-backed React class search. Public
      // GraphQL endpoint at <college>.edu/_hcms/api/searchFilterGraphql
      // returns the district's full classes collection; CAMPUS field routes
      // rows to their college. Peralta's PeopleSoft is SSO-gated (Oracle
      // Identity Cloud) so this is the only public source.
      { scripts: ["scripts/ca/scrape-peralta.ts"], runner: "http" },
      // Contra Costa CCD cluster: three colleges (Contra Costa, Diablo Valley,
      // Los Medanos) share the district's ASP.NET WebForms search at
      // webapps.4cd.edu/apps/courseschedulesearch/search-course.aspx. The
      // scraper paginates via __doPostBack + VIEWSTATE; one (college, term)
      // takes ~30s–5min depending on size.
      { scripts: ["scripts/ca/scrape-4cd.ts"], runner: "http" },
      // West Hills CCD cluster: two colleges (Coalinga, Lemoore) share a
      // single Colleague-powered schedule page at classweb.westhillscollege.com
      // /schedule/. One GET returns every section across both colleges in an
      // HTML table; the College column distinguishes campuses.
      { scripts: ["scripts/ca/scrape-westhills.ts"], runner: "http" },
    ],
    prereqs: { source: "aggregate-from-courses" },
    transfers: [
      // ASSIST.org — XSRF-protected REST API. v1 covers system-level UCTCA +
      // CSUTC transferability lists (~145K mappings across 114 CCs). Per-major
      // course-by-course articulation is a future v2 enhancement.
      { scripts: ["scripts/ca/scrape-transfer-assist.ts"], runner: "http" },
      // ASSIST.org per-receiver coverage map — Phase A only. Indexes which
      // major-level transfer agreements exist for each (CC × receiving
      // institution) pair across all 63 UC / CSU / independent receivers.
      // Output: data/ca/transfer-coverage.json. Phase B (per-major detail
      // fetch) is intentionally NOT wired here because the ASSIST
      // articulation-detail endpoint rate-limits aggressively (see
      // scrape-assist-receivers.ts:phaseB header note).
      // manual-only: monthly cadence; ~5 min runtime; coverage is stable
      // across an academic year (ID 76 = 2025-26).
      { scripts: ["scripts/ca/scrape-assist-receivers.ts"], runner: "http" },
    ],
    programs: [
      // 14 CCs across 4 template-based catalog platforms (CourseLeaf 14,
      // Acalog 2, SCIQ 2, Coursedog 3). Wrapped scrape-template-programs.ts
      // reuses scripts/lib/scrape-{platform}-programs.ts shared templates.
      // eLumen (30 CCs) and Curricunet (20 CCs) deferred to follow-up PRs
      // (both are SPAs requiring new Playwright-based templates).
      { scripts: ["scripts/ca/scrape-template-programs.ts"], runner: "playwright" },
    ],
  },
};

export default caConfig;
