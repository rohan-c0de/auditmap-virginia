import type { StateConfig } from "../registry";

// Per-college public class-search / schedule URLs. Harvested from the working
// scrapers in scripts/nm/ + data/state-health/fingerprint-baseline.json and
// probed 2026-06-17.
const REGISTRATION_URLS: Record<string, string> = {
  // Banner 8 dynamic schedule (same host the scraper uses).
  "northern-new-mexico-college":
    "https://prodssb1.nnmc.edu:4000/PRODODA/bwckschd.p_disp_dyn_sched",
  // Banner SSB 9 — fingerprint-baseline class search.
  "new-mexico-junior-college":
    "https://bss-prod-fin.nmjc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  // Ellucian Colleague Self-Service (non-standard port; same host the scraper
  // uses).
  "san-juan-college":
    "https://selfservice.sanjuancollege.edu:467/Student/Courses",
  // Anthology / CampusNexus Student portal (ASP.NET WebForms course schedule).
  "southeast-new-mexico-college":
    "https://lionsden.senmc.edu/CMCPortal/Common/CourseSchedule.aspx",
  // SIPI — homepage; the only public schedule is a per-term PDF linked from
  // the homepage.
  "southwestern-indian-polytechnic-institute": "https://www.sipi.edu/",
  // Santa Fe — Acalog catalog (no public live-sections endpoint).
  "santa-fe-community-college": "https://catalog.sfcc.edu/",
};

// Honest fallback for the 6 NM colleges with no scraper-backed public class
// search. CNM, NMMI, Mesalands, Luna, Clovis (Workday SSO), Ruidoso — all
// have auth-gated SIS. Sourced from data/nm/scorecard/*.json schoolUrl.
const COLLEGE_HOMEPAGES: Record<string, string> = {
  "central-new-mexico-community-college": "https://www.cnm.edu/",
  "clovis-community-college": "https://www.clovis.edu/",
  "eastern-new-mexico-university-ruidoso-branch-community-college":
    "https://www.ruidoso.enmu.edu/",
  "luna-community-college": "https://www.luna.edu/",
  "mesalands-community-college": "https://www.mesalands.edu/",
  "new-mexico-military-institute": "https://www.nmmi.edu/",
};

const nmCollegeUrl = (collegeSlug: string): string =>
  REGISTRATION_URLS[collegeSlug] ??
  COLLEGE_HOMEPAGES[collegeSlug] ??
  "https://hed.nm.gov/";

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
  popularCourses: ["ENGL 1110", "ENGL 1120", "MATH 1130", "MATH 1350", "PSYC 1110", "COMM 1130"],
  defaultZip: "87501",
  defaultZipCity: "Santa Fe",

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) =>
    nmCollegeUrl(collegeSlug),

  collegeCoursesUrl: (collegeSlug: string) => nmCollegeUrl(collegeSlug),

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
    // Prereqs aggregated from course-search prerequisite_text + coursedog-catalog
    // (data/nm/prereqs.json, 213 parsed chains). Refreshed from committed courses.
    prereqs: { source: "aggregate-from-courses" },
    // Acalog (CNM, San Juan, Santa Fe, Northern) via search_advanced discovery.
    // SENMC (Coursedog: 67 found / 0 parseable) + ENMU-Ruidoso (PDF-only) lack
    // parseable program data and are deferred.
    programs: [
      { scripts: ["scripts/nm/scrape-programs.ts"], runner: "http" },
    ],
  },
};

export default nmConfig;
