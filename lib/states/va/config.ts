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
  defaultZip: "22030",

  courseDiscoveryUrl: (collegeSlug: string, prefix: string, number: string) =>
    `https://courses.vccs.edu/colleges/${collegeSlug}/courses/${prefix}${number}`,

  collegeCoursesUrl: (collegeSlug: string) =>
    `https://courses.vccs.edu/colleges/${collegeSlug}/courses`,

  branding: {
    siteName: "CC CourseMap Virginia",
    tagline:
      "Search Virginia community college courses, check transfer equivalencies, and build your schedule. Free tuition for Virginia residents 60+.",
    footerText:
      "CC CourseMap Virginia — Find courses across all 23 VCCS colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Virginia Community College System (VCCS).",
    metaKeywords: [
      "Virginia community college courses",
      "VCCS course search",
      "Virginia community college transfer",
      "free college courses seniors Virginia",
      "Virginia 60+ tuition waiver",
      "VCCS schedule builder",
    ],
  },
};

export default vaConfig;
