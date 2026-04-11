import type { StateConfig } from "../registry";

const riConfig: StateConfig = {
  slug: "ri",
  name: "Rhode Island",
  systemName: "CCRI",
  systemFullName: "Community College of Rhode Island",
  systemUrl: "https://www.ccri.edu",
  collegeCount: 1,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "RIGL \u00A716-57-4",
    description:
      "Rhode Island residents aged 60 and older may audit courses at CCRI tuition-free on a space-available basis. Fees may still apply.",
    bannerTitle: "Rhode Island Senior Audit Program",
    bannerSummary:
      "Over 60 in Rhode Island? You may be eligible to audit CCRI courses tuition-free.",
    bannerDetail:
      "Rhode Island General Law \u00A716-57-4 allows residents aged 60+ to audit credit courses at public institutions tuition-free on a space-available basis.",
  },

  transferSupported: true,
  popularCourses: ["ENGL 1010", "MATH 1000", "BIOL 1010", "PSYC 2010", "HIST 1010", "ECON 2010"],
  defaultZip: "02886",
  defaultZipCity: "Warwick",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://bannerweb.ccri.edu/pls/DORA/bwckschd.p_disp_dyn_sched",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://bannerweb.ccri.edu/pls/DORA/bwckschd.p_disp_dyn_sched",

  branding: {
    siteName: "Community College Path Rhode Island",
    tagline:
      "Search Community College of Rhode Island courses and build your schedule.",
    footerText:
      "Community College Path Rhode Island \u2014 Find courses across all CCRI campuses.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Community College of Rhode Island (CCRI).",
    metaKeywords: [
      "CCRI course search",
      "Rhode Island community college courses",
      "Community College of Rhode Island",
      "CCRI schedule builder",
      "Rhode Island community college schedule",
    ],
  },
};

export default riConfig;
