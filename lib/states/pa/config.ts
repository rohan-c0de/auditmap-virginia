import type { StateConfig } from "../registry";

const paConfig: StateConfig = {
  slug: "pa",
  name: "Pennsylvania",
  systemName: "PA CCs",
  systemFullName: "Pennsylvania Commission for Community Colleges",
  systemUrl: "https://www.pacommunitycolleges.org",
  collegeCount: 15,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "24 P.S. \u00A7 19-1908-B",
    description:
      "Pennsylvania law allows residents aged 60 and older to audit courses at community colleges tuition-free on a space-available basis.",
    bannerTitle: "Pennsylvania Senior Audit Program",
    bannerSummary:
      "Over 60 in Pennsylvania? You may be eligible to audit community college courses for free.",
    bannerDetail:
      "Under 24 P.S. \u00A7 19-1908-B, Pennsylvania residents aged 60+ may audit courses at community colleges tuition-free on a space-available basis. Fees may still apply.",
  },

  transferSupported: true,
  popularCourses: ["ENG 101", "MAT 140", "BIO 110", "PSY 101", "HIS 101", "SOC 101"],
  defaultZip: "19104",
  defaultZipCity: "Philadelphia",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) => {
    // PA community colleges use varied platforms (Banner, Colleague, Workday).
    // No single unified course search URL exists.
    return `https://www.pacommunitycolleges.org`;
  },

  collegeCoursesUrl: (_collegeSlug: string) =>
    `https://www.pacommunitycolleges.org`,

  branding: {
    siteName: "Community College Path Pennsylvania",
    tagline:
      "Search Pennsylvania community college courses, check transfer equivalencies, and build your schedule.",
    footerText:
      "Community College Path Pennsylvania \u2014 Find courses across all 15 PA community colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Pennsylvania Commission for Community Colleges or any individual Pennsylvania community college.",
    metaKeywords: [
      "Pennsylvania community college courses",
      "PA community college course search",
      "Pennsylvania community college transfer",
      "community college courses near me",
      "PA community college schedule",
      "PA TRAC transfer equivalencies",
    ],
  },
};

export default paConfig;
