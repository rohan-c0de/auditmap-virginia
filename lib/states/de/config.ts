import type { StateConfig } from "../registry";

const deConfig: StateConfig = {
  slug: "de",
  name: "Delaware",
  systemName: "Del Tech",
  systemFullName: "Delaware Technical Community College",
  systemUrl: "https://www.dtcc.edu",
  collegeCount: 1,

  seniorWaiver: {
    ageThreshold: 62,
    legalCitation: "Delaware Code Title 14, \u00A79009A",
    description:
      "Delaware residents aged 62 and older may audit courses at Delaware Technical Community College tuition-free on a space-available basis. Fees may still apply.",
    bannerTitle: "Delaware Senior Audit Program",
    bannerSummary:
      "Over 62 in Delaware? You may be eligible to audit Del Tech courses tuition-free.",
    bannerDetail:
      "Delaware Code Title 14, \u00A79009A allows Delaware residents aged 62+ to audit courses at Del Tech tuition-free on a space-available basis. Fees may still apply.",
  },

  transferSupported: true,
  popularCourses: ["ENG 111", "MAT 153", "BIO 120", "HIS 111", "PSY 121", "ECO 251"],
  defaultZip: "19901",

  courseDiscoveryUrl: (_collegeSlug: string, prefix: string, number: string) => {
    if (prefix && number) {
      return `https://banner.dtcc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch`;
    }
    return `https://banner.dtcc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch`;
  },

  collegeCoursesUrl: (_collegeSlug: string) =>
    `https://banner.dtcc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch`,

  branding: {
    siteName: "Community College Path Delaware",
    tagline:
      "Search Delaware Technical Community College courses and build your schedule.",
    footerText:
      "Community College Path Delaware \u2014 Find courses across all 4 Del Tech campuses.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by Delaware Technical Community College (DTCC).",
    metaKeywords: [
      "Delaware community college courses",
      "Del Tech course search",
      "DTCC course search",
      "Delaware Technical Community College",
      "community college courses near me",
      "Delaware community college schedule",
      "Del Tech schedule builder",
    ],
  },
};

export default deConfig;
