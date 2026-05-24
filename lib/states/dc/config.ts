import type { StateConfig } from "../registry";

const dcConfig: StateConfig = {
  slug: "dc",
  name: "District of Columbia",
  systemName: "UDC-CC",
  systemFullName: "University of the District of Columbia Community College",
  systemUrl: "https://www.udc.edu/cc/",
  collegeCount: 1,

  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "DC Municipal Regulations",
    description:
      "District of Columbia residents aged 65 and older may have tuition and fees waived at UDC Community College, space permitting.",
    bannerTitle: "DC Senior Tuition Waiver",
    bannerSummary:
      "Over 65 in DC? You may be eligible to attend UDC Community College with tuition waived.",
    bannerDetail:
      "DC residents aged 65+ may attend UDC Community College with tuition and fees waived, space permitting. Degree-seeking seniors pay half tuition.",
  },

  // DC has no in-state CC→4yr articulation pipeline at all. UDC publishes
  // four articulation PDFs (all to MD/VA schools, dropped by the in-state
  // rule), and the Consortium of Universities arrangement is cross-
  // registration, not course-equivalency. UDC's 1,453 CollegeTransfer.Net
  // entries target zero DC institutions. The dc-transfers cron job was
  // therefore removed from `scrapers` below in 2026-05; if a structured
  // in-state source ever appears, re-add the cron entry and flip this
  // back to true. The scraper script `scripts/dc/scrape-transfer.ts` is
  // retained for manual use.
  transferSupported: false,
  popularCourses: ["IGED 110C", "IGED 120C", "IGED 130C", "BIOL 111C", "MATH 105C", "PSYC 201C"],
  defaultZip: "20001",
  defaultZipCity: "Washington",

  courseDiscoveryUrl: (collegeSlug: string, prefix: string, number: string) => {
    if (prefix && number) {
      return `https://reg-prod.ec.udc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch`;
    }
    return `https://reg-prod.ec.udc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch`;
  },

  collegeCoursesUrl: () => {
    return `https://reg-prod.ec.udc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch`;
  },

  branding: {
    siteName: "Community College Path DC",
    tagline:
      "Search UDC Community College courses and build your schedule.",
    footerText:
      "Community College Path DC — Find courses at UDC Community College.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the University of the District of Columbia.",
    metaKeywords: [
      "DC community college courses",
      "UDC Community College",
      "UDC-CC course search",
      "community college courses near me",
      "DC community college schedule",
      "UDC schedule builder",
    ],
  },
  universityAliases: [
    { slug: "american", names: ["AU", "American", "American University"] },
    { slug: "howard", names: ["Howard", "Howard University"] },
    { slug: "gwu", names: ["GWU", "GW", "George Washington", "George Washington University"] },
    { slug: "georgetown", names: ["Georgetown", "Georgetown University"] },
    { slug: "catholic", names: ["CUA", "Catholic University", "Catholic University of America"] },
    { slug: "udc", names: ["UDC", "University of the District of Columbia"] },
  ],
  scrapers: {
    courses: [{ scripts: ["scripts/dc/scrape-banner.ts"], runner: "http" }],
    // manual-only: transfers — DC has no in-state CC→4yr articulation pipeline; see `transferSupported` comment above.
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — Acalog program scraper not yet wired up for this state.
  },
  documentedCeilings: {
    transfers:
      "UDC's 1,400+ CollegeTransfer.Net equivalencies target zero in-state institutions. The in-state-only rule strips every row to empty on each run.",
  },
};

export default dcConfig;
