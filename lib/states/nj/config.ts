import type { StateConfig } from "../registry";

// NJ community colleges predominantly use Ellucian Colleague Self-Service
// for course scheduling. The public Self-Service JSON REST API endpoints
// vary by college but follow a common URL pattern:
//   https://<host>/Student/Courses/Search
//
// Transfer equivalency data is centralized at NJTransfer.org, a state-mandated
// CGI database maintained by the NJ Transfer consortium. This is the primary
// source for CC-to-university transfer mappings.
//
// The 18 community colleges are coordinated by the New Jersey Council of
// County Colleges (NJCCC). Some former independent colleges have merged
// under the Rowan College umbrella but retain separate campuses and codes.

const COLLEAGUE_SELF_SERVICE_URLS: Record<string, string> = {
  "atlantic-cape": "https://ssb.atlantic.edu/Student",
  "bergen": "https://selfservice.bergen.edu/Student",
  "brookdale": "https://selfservice.brookdalecc.edu/Student",
  "camden": "https://selfservice.camdencc.edu/Student",
  "ccm": "https://selfservice.ccm.edu/Student",
  "essex": "https://selfservice.essex.edu/Student",
  "hccc": "https://selfservice.hccc.edu/Student",
  "mercer": "https://selfservice.mccc.edu/Student",
  "middlesex": "https://selfservice.middlesexcc.edu/Student",
  "ocean": "https://selfservice.ocean.edu/Student",
  "passaic": "https://selfservice.pccc.edu/Student",
  "rvcc": "https://selfservice.raritanval.edu/Student",
  "rcbc": "https://selfservice.rcbc.edu/Student",
  "rcsj-cumberland": "https://selfservice.rcsj.edu/Student",
  "rcsj-gloucester": "https://selfservice.rcsj.edu/Student",
  "salem": "https://selfservice.salemcc.edu/Student",
  "sussex": "https://selfservice.sussex.edu/Student",
  "ucnj": "https://selfservice.ucc.edu/Student",
  "warren": "https://selfservice.warren.edu/Student",
};

const njConfig: StateConfig = {
  slug: "nj",
  name: "New Jersey",
  systemName: "NJ County Colleges",
  systemFullName: "New Jersey Council of County Colleges",
  systemUrl: "https://www.njcommunitycolleges.org",
  collegeCount: 18,

  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "N.J.S.A. 18A:64A-26.1",
    description:
      "New Jersey law provides a tuition waiver for state residents aged 65 and older to enroll in credit courses at county colleges on a space-available basis. Fees may still apply.",
    bannerTitle: "NJ Senior Citizen Tuition Waiver",
    bannerSummary:
      "Age 65 or older in New Jersey? You may be eligible to take county college courses with tuition waived.",
    bannerDetail:
      "Under N.J.S.A. 18A:64A-26.1, New Jersey residents aged 65 and older may enroll in credit courses at any county college with tuition waived on a space-available basis. Student fees and course-specific fees may still apply. Registration typically opens after matriculated students have enrolled.",
  },

  transferSupported: true,
  // Transfer data comes from NJTransfer.org, the state-mandated transfer
  // equivalency database managed by the NJ Transfer consortium. Covers
  // CC-to-university mappings for Rutgers, NJIT, Montclair State, Rowan,
  // TCNJ, Kean, Stockton, William Paterson, and many private institutions.

  popularCourses: ["ENG 101", "MAT 151", "BIO 101", "PSY 101", "HIS 101", "SOC 101"],
  defaultZip: "08901",
  defaultZipCity: "New Brunswick",

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) => {
    // Most NJ CCs use Ellucian Colleague Self-Service. Link to the
    // college's course search page when available.
    const ssUrl = COLLEAGUE_SELF_SERVICE_URLS[collegeSlug];
    return ssUrl ? `${ssUrl}/Courses/Search` : "https://www.njcommunitycolleges.org";
  },

  collegeCoursesUrl: (collegeSlug: string) => {
    const ssUrl = COLLEAGUE_SELF_SERVICE_URLS[collegeSlug];
    return ssUrl ? `${ssUrl}/Courses` : "https://www.njcommunitycolleges.org";
  },

  branding: {
    siteName: "Community College Path New Jersey",
    tagline:
      "Search New Jersey community college courses, check transfer equivalencies, and build your schedule.",
    footerText:
      "Community College Path New Jersey — Find courses across all 18 NJ county colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the New Jersey Council of County Colleges or any individual county college.",
    metaKeywords: [
      "New Jersey community college courses",
      "NJ county college course search",
      "NJ community college transfer",
      "NJTransfer equivalency",
      "community college courses near me",
      "NJ community college schedule",
      "NJ senior citizen tuition waiver",
    ],
  },
};

export default njConfig;
