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

  // Idaho Code § 33-2110A allows residents 60+ to audit courses at state
  // institutions for $5/credit on a space-available basis — that's audit-only
  // pricing, not a meaningful tuition waiver, so left null until verified
  // college-by-college with each registrar.
  seniorWaiver: null,

  transferSupported: false,
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
    // manual-only: transfers — Idaho has no registered articulation portal. The
    // state's three public universities (Boise State, U of I, Idaho State)
    // publish individual equivalency tables but there is no consolidated
    // statewide source.
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — no college's catalog matched a templated
    // platform (acalog/courseleaf/smartcatalogiq/coursedog/cleancatalog).
  },
};

export default idConfig;
