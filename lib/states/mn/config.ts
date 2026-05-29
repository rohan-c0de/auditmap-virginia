import type { StateConfig } from "../registry";

const mnConfig: StateConfig = {
  slug: "mn",
  name: "Minnesota",
  systemName: "Minnesota State",
  systemFullName: "Minnesota State Colleges and Universities",
  systemUrl: "https://www.minnstate.edu/",
  collegeCount: 28,

  seniorWaiver: {
    ageThreshold: 62,
    legalCitation: "Minn. Stat. § 135A.51",
    description:
      "Minnesota residents aged 62 and older may take courses at Minnesota State colleges and universities with tuition waived on a space-available basis; audit is free and for-credit enrollment is $20/credit.",
    bannerTitle: "Minnesota Senior Citizen Education Program",
    bannerSummary:
      "Over 62 in Minnesota? Audit Minnesota State courses for free (small admin fee for credit).",
    bannerDetail:
      "Minnesota's Senior Citizen Education Program (Minn. Stat. § 135A.51) lets residents aged 62+ enroll in Minnesota State courses on a space-available basis with tuition waived. Audit registration is free; for-credit enrollment is $20/credit. Activity fees still apply.",
  },

  // 2026-05: enabled after scripts/mn/scrape-transfers.ts populated
  // data/mn/transfer-equiv.json with 6,167 mappings from 23 MnSCU CCs
  // to the 7 MnSCU 4-year universities, scraped from
  // eservices.minnstate.edu's equivalentSubmit endpoint.
  transferSupported: true,
  popularCourses: ["ENGL 1101", "MATH 1100", "BIOL 1100", "PSYC 1100", "HIST 1100", "ECON 1100"],
  defaultZip: "55101",
  defaultZipCity: "Saint Paul",
  universityAliases: [
    { slug: "bemidji-state-university", names: ["Bemidji State University", "BSU"] },
    { slug: "minnesota-state-university-mankato", names: ["Minnesota State University, Mankato", "MSU Mankato", "Mankato State"] },
    { slug: "minnesota-state-university-moorhead", names: ["Minnesota State University Moorhead", "MSU Moorhead", "MSUM"] },
    { slug: "st-cloud-state-university", names: ["St. Cloud State University", "SCSU"] },
    { slug: "winona-state-university", names: ["Winona State University", "WSU"] },
    { slug: "southwest-minnesota-state-university", names: ["Southwest Minnesota State University", "SMSU"] },
    { slug: "metro-state-university", names: ["Metropolitan State University", "Metro State"] },
  ],

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://eservices.minnstate.edu/registration/search/basic.html",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://eservices.minnstate.edu/registration/search/basic.html",

  branding: {
    siteName: "Community College Path Minnesota",
    tagline:
      "Search Minnesota State courses across all 26 community and technical colleges.",
    footerText:
      "Community College Path Minnesota — Find courses across the Minnesota State system.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by Minnesota State Colleges and Universities or the State of Minnesota.",
    metaKeywords: [
      "Minnesota community college courses",
      "Minnesota State course search",
      "MnSCU class search",
      "Minnesota State Colleges and Universities",
    ],
  },
  scrapers: {
    courses: [
      {
        scripts: ["scripts/mn/scrape-mn-eservices.ts"],
        runner: "http",
      },
    ],
    transfers: [
      {
        scripts: ["scripts/mn/scrape-transfers.ts"],
        runner: "http",
      },
    ],
    // manual-only: prereqs — eservices results don't include prereq text; needs catalog scraper follow-up.
    // manual-only: programs — discover-programs found no public catalog matches; needs college-by-college investigation.
  },
};

export default mnConfig;
