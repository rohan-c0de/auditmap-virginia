import type { StateConfig } from "../registry";

// All NDUS community colleges share one PeopleSoft Campus Solutions tenant
// ("NDCSPRD") at studentadmin.connectnd.us. Tribal colleges (Cankdeska
// Cikana, Nueta Hidatsa Sahnish, Sitting Bull) sit outside NDUS and use
// other platforms — courseDiscoveryUrl falls back to the college site for
// those.
const NDUS_PS_BASE =
  "https://studentadmin.connectnd.us/psc/NDCSPRD/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL";

const NDUS_CC_INSTITUTION_CODES: Record<string, string> = {
  "bismarck-state-college": "BSC01",
  "dakota-college-at-bottineau": "MISUB",
  "lake-region-state-college": "LRSC1",
  "north-dakota-state-college-of-science": "NDSCS",
  "williston-state-college": "WSC01",
};

const COLLEGE_HOMEPAGES: Record<string, string> = {
  "bismarck-state-college": "https://bismarckstate.edu/academics/academicresources/campusconnectionhelp/ScheduleofClasses/",
  "dakota-college-at-bottineau": "https://www.dakotacollege.edu/admissions/registration/",
  "lake-region-state-college": "https://www.lrsc.edu/students/registration",
  "north-dakota-state-college-of-science": "https://www.ndscs.edu/admissions/register/registration-resources",
  "williston-state-college": "https://www.willistonstate.edu/Students/Registrar/index.html",
  "cankdeska-cikana-community-college": "https://www.littlehoop.edu/",
  "nueta-hidatsa-sahnish-college": "https://www.nhsc.edu/",
  "sitting-bull-college": "https://sittingbull.edu/",
};

const ndConfig: StateConfig = {
  slug: "nd",
  name: "North Dakota",
  systemName: "NDUS",
  systemFullName: "North Dakota University System",
  systemUrl: "https://ndus.edu/",
  collegeCount: 8,

  // N.D.C.C. § 15-10-19.1 — tuition-free auditing for residents 65+ at NDUS
  // institutions on a space-available basis. Tribal colleges are outside
  // NDUS and set their own policies.
  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "N.D.C.C. § 15-10-19.1",
    description:
      "North Dakota law permits residents aged 65+ to audit courses at North Dakota University System institutions tuition-free on a space-available basis.",
    bannerTitle: "North Dakota Senior Audit Program",
    bannerSummary:
      "Over 65 in North Dakota? You may be eligible to audit NDUS courses tuition-free.",
    bannerDetail:
      "North Dakota law permits residents aged 65+ to audit courses at NDUS public colleges and universities tuition-free, space permitting. Contact the registrar at each college for application steps. Tribal colleges are outside NDUS and have their own tuition policies.",
  },

  transferSupported: false,
  popularCourses: ["ENGL 110", "MATH 103", "PSYC 111", "BIOL 150", "HIST 103", "COMM 110"],
  defaultZip: "58501",
  defaultZipCity: "Bismarck",

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) => {
    const instCode = NDUS_CC_INSTITUTION_CODES[collegeSlug];
    if (instCode) return NDUS_PS_BASE;
    return COLLEGE_HOMEPAGES[collegeSlug] ?? "https://ndus.edu/";
  },

  collegeCoursesUrl: (collegeSlug: string) => {
    const instCode = NDUS_CC_INSTITUTION_CODES[collegeSlug];
    if (instCode) return NDUS_PS_BASE;
    return COLLEGE_HOMEPAGES[collegeSlug] ?? "https://ndus.edu/";
  },

  branding: {
    siteName: "Community College Path North Dakota",
    tagline: "Search North Dakota community college courses across all 8 colleges.",
    footerText:
      "Community College Path North Dakota — Find courses across NDUS community colleges and tribal colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the North Dakota University System.",
    metaKeywords: [
      "North Dakota community college courses",
      "North Dakota community college class search",
      "NDUS course search",
      "Campus Connection class search",
    ],
  },
  scrapers: {
    courses: [
      // Single PeopleSoft cluster covers all 5 NDUS community colleges.
      { scripts: ["scripts/nd/scrape-ndus.ts"], runner: "playwright" },
    ],
    prereqs: [
      // BSC (CourseLeaf) + WSC (Acalog) — NDUS CCN means one prereq dict
      // covers all 5 NDUS CCs. DCB/NDSCS Cleancatalog deferred (WAF-blocked).
      { scripts: ["scripts/nd/scrape-catalog-prereqs.ts"], runner: "http" },
    ],
    // manual-only: transfers — no statewide articulation portal registered yet.
    //   Candidates to investigate: TransferND / Dakota Transfer (ndus.edu).
    // manual-only: programs — Phase 6 found no templated catalog on any college.
  },
};

export default ndConfig;
