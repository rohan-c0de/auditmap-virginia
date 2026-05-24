import type { StateConfig } from "../registry";

// Colleague Self-Service base URLs (no /Student suffix — appended by courseDiscoveryUrl).
// 10 confirmed publicly accessible for scraping; 6 deferred colleges kept for discovery links.
const COLLEAGUE_SELF_SERVICE_URLS: Record<string, string> = {
  "atlantic-cape": "https://acccdtsfss22.atlantic.edu",
  "bergen": "https://selfservice.bergen.edu",
  "brookdale": "https://selfservice.brookdalecc.edu",
  "camden": "https://selfservice.camdencc.edu",
  "ccm": "https://titansdirect.ccm.edu",
  "hccc": "https://libertylink.hccc.edu",
  "mercer": "https://mercer-ss.colleague.elluciancloud.com",
  "middlesex": "https://middlesexcollege-ss.colleague.elluciancloud.com",
  "ocean": "https://selfservice.ocean.edu",
  "passaic": "https://eselfservice.pccc.edu",
  "rcbc": "https://selfservice2019.rcbc.edu",
  "rcsj-cumberland": "https://selfservice.rcsj.edu",
  "rcsj-gloucester": "https://selfservice.rcsj.edu",
  "salem": "https://selfservice.salemcc.edu",
  "sussex": "https://selfservice.sussex.edu",
  "ucnj": "https://ucc-ss.colleague.elluciancloud.com",
  "warren": "https://selfservice.warren.edu",
};

// Banner SSB base URLs (essex, rvcc use Banner instead of Colleague)
const BANNER_SSB_URLS: Record<string, string> = {
  "essex": "https://bannerprod.essex.edu",
  "rvcc": "https://reg-prod.ec.raritanval.edu",
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
    const bannerUrl = BANNER_SSB_URLS[collegeSlug];
    if (bannerUrl) return `${bannerUrl}/StudentRegistrationSsb/ssb/classSearch/classSearch`;
    const ssUrl = COLLEAGUE_SELF_SERVICE_URLS[collegeSlug];
    return ssUrl ? `${ssUrl}/Student/Courses/Search` : "https://www.njcommunitycolleges.org";
  },

  collegeCoursesUrl: (collegeSlug: string) => {
    const bannerUrl = BANNER_SSB_URLS[collegeSlug];
    if (bannerUrl) return `${bannerUrl}/StudentRegistrationSsb/ssb/classSearch/classSearch`;
    const ssUrl = COLLEAGUE_SELF_SERVICE_URLS[collegeSlug];
    return ssUrl ? `${ssUrl}/Student/Courses` : "https://www.njcommunitycolleges.org";
  },

  universityAliases: [
    { slug: "rutgers", names: ["Rutgers", "Rutgers University"] },
    { slug: "rutgers-nb", names: ["Rutgers New Brunswick"] },
    { slug: "njit", names: ["NJIT", "New Jersey Institute of Technology"] },
    { slug: "montclair", names: ["Montclair", "Montclair State", "Montclair State University"] },
    { slug: "rowan", names: ["Rowan", "Rowan University"] },
    { slug: "tcnj", names: ["TCNJ", "The College of New Jersey", "College of New Jersey"] },
    { slug: "kean", names: ["Kean", "Kean University"] },
    { slug: "seton-hall", names: ["Seton Hall", "Seton Hall University"] },
  ],
  scrapers: {
    courses: [
      { scripts: ["scripts/nj/scrape-colleague.ts"], runner: "playwright" },
      { scripts: ["scripts/nj/scrape-banner-ssb.ts"], runner: "http" },
      // RCSJ cluster: one bespoke scraper covers Rowan College of South
      // Jersey's two campuses (Cumberland + Gloucester) via shared Anthology /
      // Campus Nexus portal (sisportal-100962.campusnexus.cloud). HTTP-only
      // (uses Node's https module, not fetch — Anthology Cloud rejects HTTP/2).
      { scripts: ["scripts/nj/scrape-rcsj.ts"], runner: "http" },
    ],
    transfers: [{ scripts: ["scripts/nj/scrape-transfer.ts"], runner: "http" }],
    prereqs: { source: "aggregate-from-courses" },
    programs: [{ scripts: ["scripts/nj/scrape-programs.ts"], runner: "http" }],
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
