import type { StateConfig } from "../registry";

const ctConfig: StateConfig = {
  slug: "ct",
  name: "Connecticut",
  systemName: "CT State",
  systemFullName: "CT State Community College",
  systemUrl: "https://ctstate.edu",
  collegeCount: 1,

  seniorWaiver: {
    ageThreshold: 62,
    legalCitation: "CGS \u00A710a-27",
    description:
      "Connecticut residents aged 62 and older may audit courses at CT State Community College tuition-free on a space-available basis.",
    bannerTitle: "Connecticut Senior Audit Program",
    bannerSummary:
      "Over 62 in Connecticut? You may be eligible to audit CT State courses tuition-free.",
    bannerDetail:
      "Connecticut General Statutes \u00A710a-27 allows residents aged 62+ to take courses at public institutions tuition-free on a space-available basis.",
  },

  transferSupported: true,
  popularCourses: ["ENG 101", "MAT 137", "BIO 111", "PSY 111", "HIS 101", "SOC 101"],
  defaultZip: "06103",
  defaultZipCity: "Hartford",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://reg-prod.ec.ct.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://reg-prod.ec.ct.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",

  branding: {
    siteName: "Community College Path Connecticut",
    tagline:
      "Search CT State Community College courses across all 12 campuses.",
    footerText:
      "Community College Path Connecticut \u2014 Find courses across all CT State campuses.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by CT State Community College or the Connecticut State Colleges & Universities system.",
    metaKeywords: [
      "CT State course search",
      "Connecticut community college courses",
      "CT State Community College",
      "CSCU course search",
      "Connecticut community college schedule",
    ],
  },
};

export default ctConfig;
