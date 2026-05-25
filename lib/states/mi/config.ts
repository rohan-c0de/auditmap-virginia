import type { StateConfig } from "../registry";

const BANNER_SSB_URLS: Record<string, string> = {
  "lansing-community-college": "https://starnetb.lcc.edu",
  "southwestern-michigan-college": "https://xeprod.swmich.edu",
  "washtenaw-community-college": "https://banner.wccnet.edu",
};

const COLLEAGUE_SELF_SERVICE_URLS: Record<string, string> = {
  "alpena-community-college": "https://acc-ss.colleague.elluciancloud.com",
  "delta-college": "https://ss.delta.edu",
  "glen-oaks-community-college": "https://colss-prod.ec.glenoaks.edu",
  "jackson-college": "https://jetstream.jccmi.edu",
  "mid-michigan-college": "https://selfservice.midmich.edu",
  "mott-community-college": "https://colss-prod.mottcsaas.elluciancloud.com",
  "muskegon-community-college": "https://muskegoncc-ss.colleague.elluciancloud.com",
  "oakland-community-college": "https://myocc.oaklandcc.edu",
  "schoolcraft-community-college-district": "https://self-service.schoolcraft.edu",
  "st-clair-county-community-college": "https://sc4sss03.sc4.edu",
};

const miConfig: StateConfig = {
  slug: "mi",
  name: "Michigan",
  systemName: "MCCA",
  systemFullName: "Michigan Community College Association",
  systemUrl: "https://www.mcca.org/",
  collegeCount: 31,

  // Michigan has no statewide senior-waiver statute; senior audit policies
  // are set per-college. Notable examples: WCCCD Senior Pass, Henry Ford
  // Senior Citizen tuition assistance. Surfaced per-institution rather than
  // as a state-wide banner.
  seniorWaiver: null,

  transferSupported: false,
  popularCourses: ["ENG 111", "ENG 1510", "ENG 101", "ENGL 101", "ENGL 121", "ENG 1520"],
  defaultZip: "48933",
  defaultZipCity: "Lansing",

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) => {
    const bannerUrl = BANNER_SSB_URLS[collegeSlug];
    if (bannerUrl) return `${bannerUrl}/StudentRegistrationSsb/ssb/classSearch/classSearch`;
    const ssUrl = COLLEAGUE_SELF_SERVICE_URLS[collegeSlug];
    return ssUrl ? `${ssUrl}/Student/Courses/Search` : "https://www.mcca.org/";
  },

  collegeCoursesUrl: (collegeSlug: string) => {
    const bannerUrl = BANNER_SSB_URLS[collegeSlug];
    if (bannerUrl) return `${bannerUrl}/StudentRegistrationSsb/ssb/classSearch/classSearch`;
    const ssUrl = COLLEAGUE_SELF_SERVICE_URLS[collegeSlug];
    return ssUrl ? `${ssUrl}/Student/Courses` : "https://www.mcca.org/";
  },

  branding: {
    siteName: "Community College Path Michigan",
    tagline:
      "Search Michigan community college courses across all 31 colleges.",
    footerText:
      "Community College Path Michigan — Find courses across all 31 Michigan community colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Michigan Community College Association.",
    metaKeywords: [
      "Michigan community college courses",
      "Michigan community college class search",
      "Michigan Community College Association",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/mi/scrape-colleague.ts"], runner: "playwright" },
      { scripts: ["scripts/mi/scrape-banner-ssb.ts"], runner: "http" },
    ],
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: transfers — no articulation portal registered for MI yet.
    // manual-only: programs — Phase 5+.
  },
};

export default miConfig;
