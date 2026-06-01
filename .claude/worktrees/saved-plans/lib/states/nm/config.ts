import type { StateConfig } from "../registry";

const nmConfig: StateConfig = {
  slug: "nm",
  name: "New Mexico",
  systemName: "Community Colleges",
  systemFullName: "New Mexico Community Colleges",
  systemUrl: "https://hed.nm.gov/",
  collegeCount: 12,

  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "NMSA 1978 § 21-21D (Senior Citizens Reduced Tuition Act; impl. 5.7.19 NMAC)",
    description:
      "New Mexico residents aged 65+ pay $5.00 per credit hour for up to 10 credit hours per semester at NM post-secondary degree-granting institutions, on a space-available basis.",
    bannerTitle: "New Mexico Senior Citizens Reduced Tuition",
    bannerSummary: "Age 65+ in New Mexico? Pay $5 per credit hour, up to 10 credits per semester.",
    bannerDetail:
      "Under the Senior Citizens Reduced Tuition Act (NMSA 1978 § 21-21D, implemented by 5.7.19 NMAC), New Mexico residents who reach age 65 by the census date may register at the reduced rate of $5.00 per credit hour for up to 10 credit hours per semester, on a space-available basis.",
  },

  transferSupported: true,
  popularCourses: [],
  defaultZip: "87501",
  defaultZipCity: "Santa Fe",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.example.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.example.edu/",

  branding: {
    siteName: "Community College Path New Mexico",
    tagline: "Search community college courses across New Mexico.",
    footerText: "Community College Path New Mexico — Find courses across all 12 New Mexico community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by any New Mexico community college.",
    metaKeywords: [
      "New Mexico community college courses",
      "NM community college course search",
      "New Mexico Community Colleges",
    ],
  },
  scrapers: {
    courses: [
      {
        scripts: ["scripts/nm/scrape-banner8.ts"],
        runner: "http",
      },
      {
        // SENMC Anthology/CampusNexus Student portal.
        // Despite jQuery DataTables on the result page, the data is rendered
        // server-side via an ASP.NET WebForms postback (no AJAX endpoint), so
        // this scraper uses direct undici HTTP requests — no browser needed.
        scripts: ["scripts/nm/scrape-campusnexus.ts"],
        runner: "http",
      },
      {
        // SIPI publishes its term schedule as a PDF hosted on edl.io, linked
        // from the homepage. PDF download + `pdftotext -layout` parsing — no
        // browser needed. Requires poppler-utils on the runner (already
        // installed for SC PDF scrapers; see commit e83abf1).
        scripts: ["scripts/nm/scrape-sipi-pdf.ts"],
        runner: "http",
      },
    ],
    transfers: [
      // NM Higher Education Department's statewide Common Course Numbering
      // System (CCNS) exposes a public JSON API at ccns.nmhed.us covering all
      // public + tribal institutions. The scraper self-joins on the common
      // course number to emit CC→4-year equivalencies for the six public
      // universities (UNM, NMSU, NMHU, ENMU, NM Tech, WNMU). All in-state by
      // construction. ~8,800 mappings.
      { scripts: ["scripts/nm/scrape-transfer-ccns.ts"], runner: "http" },
    ],
    // manual-only: prereqs — Phase 4 catalog-prereq scrapers deferred.
    // manual-only: programs — Phase 6 catalog discovery yielded no templated catalogs.
  },
};

export default nmConfig;
