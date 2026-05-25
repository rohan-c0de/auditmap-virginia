import type { StateConfig } from "../registry";

const moConfig: StateConfig = {
  slug: "mo",
  name: "Missouri",
  systemName: "MCCA",
  systemFullName: "Missouri Community College Association",
  systemUrl: "https://www.mccatoday.org/",
  collegeCount: 13,

  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "Missouri Revised Statutes § 173.270",
    description:
      "Missouri residents 65 and older may enroll in courses at state-supported colleges tuition-free on a space-available basis. Regular fees may still apply and seats are subject to availability.",
    bannerTitle: "Missouri Senior Citizen Tuition Waiver",
    bannerSummary:
      "Age 65+ in Missouri? Enroll tuition-free at state-supported colleges on a space-available basis.",
    bannerDetail:
      "Missouri Revised Statutes § 173.270 lets Missouri residents 65+ enroll in courses at state-supported colleges tuition-free on a space-available basis. Confirm with each college's registrar.",
  },

  transferSupported: false,
  popularCourses: ["ENG 101", "ENGL 101", "PSY 110", "MTH 128", "ENG 102", "PLS 101"],
  defaultZip: "65101",
  defaultZipCity: "Jefferson City",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.mccatoday.org/",

  collegeCoursesUrl: (_collegeSlug: string) => "https://www.mccatoday.org/",

  branding: {
    siteName: "Community College Path Missouri",
    tagline:
      "Search Missouri community college courses across all 13 colleges.",
    footerText:
      "Community College Path Missouri — Find courses across all 13 Missouri community colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Missouri Community College Association.",
    metaKeywords: [
      "Missouri community college courses",
      "Missouri community college class search",
      "Missouri Community College Association",
      "Missouri senior citizen tuition waiver",
    ],
  },
  scrapers: {
    // Two of MO's six scrapable colleges are wired; jefferson-college and
    // MCC-Kansas-City need re-fingerprint (see scripts/mo/scrape-colleague.ts).
    courses: [
      { scripts: ["scripts/mo/scrape-colleague.ts"], runner: "playwright" },
    ],
    // manual-only: transfers — no articulation portal registered for MO yet.
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — Phase 5+.
  },
};

export default moConfig;
