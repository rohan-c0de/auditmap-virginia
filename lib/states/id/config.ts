import type { StateConfig } from "../registry";

// Idaho has no unified community college system; the four colleges are
// independent two-year institutions overseen at a high level by the
// Idaho State Board of Education. Three of the four (NIC, CEI, CWI) run
// Ellucian Colleague Self-Service with publicly accessible guest endpoints;
// the fourth (CSI) runs Campus Management Corp Portal on a separate sidecar
// — not yet templated.
const SELF_SERVICE_URLS: Record<string, string> = {
  "north-idaho-college": "https://websvcfe.nic.edu",
  "college-of-eastern-idaho": "https://colss-prod.ec.cei.edu",
  "college-of-western-idaho": "https://selfservice.cwi.edu",
};

const idConfig: StateConfig = {
  slug: "id",
  name: "Idaho",
  systemName: "Idaho Community Colleges",
  systemFullName: "Idaho Community Colleges (overseen by the Idaho State Board of Education)",
  systemUrl: "https://boardofed.idaho.gov/",
  collegeCount: 4,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "Idaho Code § 33-2110A",
    description:
      "Idaho residents 60+ may audit courses at state-supported institutions for $5 per credit on a space-available basis (Idaho Code § 33-2110A). That's reduced-cost audit access (no credit/grade), not a full waiver; individual colleges may add their own senior discounts on credit courses — confirm with the registrar.",
    bannerTitle: "Idaho Senior Audit — $5/credit (60+)",
    bannerSummary:
      "60+ in Idaho? You can audit courses for $5 per credit, space-available, under Idaho Code § 33-2110A.",
    bannerDetail:
      "Under Idaho Code § 33-2110A, Idaho residents aged 60 and older may register to audit courses at state-supported institutions for $5 per credit hour on a space-available basis. Auditing means no credit or grade. Individual colleges (CSI, CWI, NIC, CEI) may offer their own additional senior discounts on for-credit courses; contact the registrar for specifics. Course and lab fees may still apply.",
  },

  transferSupported: true,
  popularCourses: ["ENGL 101", "ENGL 102", "MATH 143", "MATH 123", "PSYC 101", "COMM 101"],
  defaultZip: "83702",
  defaultZipCity: "Boise",

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) =>
    SELF_SERVICE_URLS[collegeSlug] ?? "https://boardofed.idaho.gov/",

  collegeCoursesUrl: (collegeSlug: string) =>
    `${SELF_SERVICE_URLS[collegeSlug] ?? "https://boardofed.idaho.gov"}/Student/Courses`,

  branding: {
    siteName: "Community College Path Idaho",
    tagline: "Search Idaho community college courses across all 4 colleges.",
    footerText: "Community College Path Idaho — Find courses across all 4 Idaho community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Idaho State Board of Education or any individual Idaho community college.",
    metaKeywords: [
      "Idaho community college courses",
      "Idaho community college search",
      "NIC course search",
      "CWI course search",
      "CEI course search",
      "College of Southern Idaho courses",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/id/scrape-colleague.ts"], runner: "playwright" },
      // manual-only: college-of-southern-idaho — uses Campus Management Corp Portal
      // (sidecar at https://sisportal.csi.edu/CMCPortal/Common/CourseSchedule.aspx).
      // Public-accessible but ASP.NET WebForms with VIEWSTATE; no template exists
      // yet for this platform.
    ],
    // Idaho's State Board of Education runs a consolidated statewide tool at
    // coursetransfer.idaho.gov covering all 8 public institutions (the 4
    // community colleges → BSU/ISU/UI/LCSC + inter-college). scrape-transfer.ts
    // enumerates each college's courses via the GetCourseTitles autocomplete
    // and parses the per-receiver equivalency results pages.
    transfers: [{ scripts: ["scripts/id/scrape-transfer.ts"], runner: "http" }],
    prereqs: { source: "aggregate-from-courses" },
    // Per-college program catalogs across 3 platforms: CEI (Acalog, via
    // Playwright for its TLS chain), CWI (CourseLeaf @ catalog.cwi.edu), CSI
    // (SmartCatalogIQ). North Idaho College (Coursedog) is deferred — see the
    // DEFERRED-scrapers note in scripts/id/scrape-programs.ts.
    programs: [{ scripts: ["scripts/id/scrape-programs.ts"], runner: "playwright" }],
  },
};

export default idConfig;
