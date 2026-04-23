import type { StateConfig } from "../registry";

const nhConfig: StateConfig = {
  slug: "nh",
  name: "New Hampshire",
  systemName: "CCSNH",
  systemFullName: "Community College System of New Hampshire",
  systemUrl: "https://www.ccsnh.edu",
  collegeCount: 7,

  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "NH RSA 188-F:20",
    description:
      "New Hampshire residents aged 65 and older may enroll in CCSNH community college courses tuition-free on a space-available basis.",
    bannerTitle: "New Hampshire Senior Tuition Waiver",
    bannerSummary:
      "Over 65 in New Hampshire? You may be eligible to enroll in CCSNH courses tuition-free.",
    bannerDetail:
      "New Hampshire law allows residents aged 65+ to enroll in credit courses at Community College System of New Hampshire institutions tuition-free on a space-available basis.",
  },

  // 2026-04: enabled after scripts/nh/scrape-transfer.ts populated
  // data/nh/transfer-equiv.json with ~4,400 mappings from 6 of 7 CCSNH
  // colleges via CollegeTransfer.Net (wmcc hit the public API rate limit
  // and will be filled by subsequent cron runs — partial runs are safe).
  // Note: USNH receiving institutions (UNH/Plymouth/Keene) are not
  // published to CollegeTransfer.Net, so in-state transfers are not
  // covered by this dataset; out-of-state (USC, Clemson, Utah, etc.) is.
  transferSupported: true,
  popularCourses: ["ENGL 101", "MATH 120", "BIOL 105", "PSYC 101", "HIST 101", "SOCI 101"],
  defaultZip: "03101",
  defaultZipCity: "Manchester",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.ccsnh.edu",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.ccsnh.edu",

  branding: {
    siteName: "Community College Path New Hampshire",
    tagline:
      "Search Community College System of New Hampshire courses across all 7 colleges.",
    footerText:
      "Community College Path New Hampshire \u2014 Find courses across all 7 CCSNH colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Community College System of New Hampshire (CCSNH).",
    metaKeywords: [
      "New Hampshire community college courses",
      "CCSNH course search",
      "Community College System of New Hampshire",
      "New Hampshire community college schedule",
    ],
  },
};

export default nhConfig;
