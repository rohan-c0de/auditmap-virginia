import type { StateConfig } from "../registry";

const vaConfig: StateConfig = {
  slug: "va",
  name: "Virginia",
  systemName: "VCCS",
  systemFullName: "Virginia Community College System",
  systemUrl: "https://www.vccs.edu",
  collegeCount: 23,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "Virginia Code \u00A7 23.1-638",
    description:
      "Virginia law allows residents aged 60+ to sit in on classes at public colleges and universities at no cost, space permitting.",
    bannerTitle: "Virginia Senior Audit Program",
    bannerSummary:
      "Over 60 in Virginia? You may be eligible to audit college courses for free.",
    bannerDetail:
      "Virginia law allows residents aged 60+ to sit in on classes at public colleges and universities at no cost, space permitting.",
  },

  transferSupported: true,
  popularCourses: ["ENG 111", "ENG 112", "MTH 154", "MTH 161", "BIO 101", "HIS 121", "PSY 200", "ECO 201"],
  defaultZip: "22030",

  courseDiscoveryUrl: (collegeSlug: string, prefix: string, number: string) =>
    `https://courses.vccs.edu/colleges/${collegeSlug}/courses/${prefix}${number}`,

  collegeCoursesUrl: (collegeSlug: string) =>
    `https://courses.vccs.edu/colleges/${collegeSlug}/courses`,

  branding: {
    siteName: "Community College Path Virginia",
    tagline:
      "Search Virginia community college courses, check transfer equivalencies, and build your schedule.",
    footerText:
      "Community College Path Virginia — Find courses across all 23 VCCS colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Virginia Community College System (VCCS).",
    metaKeywords: [
      "Virginia community college courses",
      "VCCS course search",
      "Virginia community college transfer",
      "community college courses near me",
      "Virginia community college schedule",
      "VCCS schedule builder",
    ],
  },
};

export default vaConfig;
