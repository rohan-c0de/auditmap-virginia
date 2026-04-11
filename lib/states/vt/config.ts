import type { StateConfig } from "../registry";

const vtConfig: StateConfig = {
  slug: "vt",
  name: "Vermont",
  systemName: "CCV",
  systemFullName: "Community College of Vermont",
  systemUrl: "https://ccv.edu",
  collegeCount: 1,

  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "VSA Title 16, \u00A72185",
    description:
      "Vermont residents aged 65 and older may audit courses at CCV tuition-free on a space-available basis.",
    bannerTitle: "Vermont Senior Audit Program",
    bannerSummary:
      "Over 65 in Vermont? You may be eligible to audit CCV courses tuition-free.",
    bannerDetail:
      "Vermont law allows residents aged 65+ to audit credit courses at state colleges tuition-free on a space-available basis. Fees may still apply.",
  },

  transferSupported: true,
  popularCourses: ["ENG 1061", "MAT 1041", "BIO 1011", "PSY 1011", "HIS 1210", "SOC 1010"],
  defaultZip: "05401",
  defaultZipCity: "Burlington",

  courseDiscoveryUrl: (_collegeSlug: string, prefix: string, number: string) =>
    `https://selfservice.vsc.edu/Student/Courses/Search?keyword=${encodeURIComponent(`${prefix} ${number}`)}`,

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://selfservice.vsc.edu/Student/Courses/Search",

  branding: {
    siteName: "Community College Path Vermont",
    tagline:
      "Search Community College of Vermont courses across all 12 academic centers.",
    footerText:
      "Community College Path Vermont \u2014 Find courses at CCV\u2019s 12 locations statewide.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Community College of Vermont (CCV) or the Vermont State Colleges System.",
    metaKeywords: [
      "CCV course search",
      "Vermont community college courses",
      "Community College of Vermont",
      "CCV schedule builder",
      "Vermont community college schedule",
    ],
  },
};

export default vtConfig;
