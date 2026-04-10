import type { StateConfig } from "../registry";

// Banner 9 SSB endpoints for the 12 publicly scrapable TBR community colleges.
// Roane State is omitted in v1: it migrated registration to Ellucian Experience
// (myraidernet.roanestate.edu) which requires SAML auth, so the Banner 9 SSB
// REST API is not exposed publicly. Their public schedule lookup still uses
// Banner 8 (ssb.roanestate.edu/prod_ssb), which this scraper does not speak.
const BANNER_URLS: Record<string, string> = {
  "chattanooga-state": "https://blss.chattanoogastate.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "cleveland-state": "https://ban-sserv.clevelandstatecc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "columbia-state": "https://ssb.columbiastate.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "dyersburg-state": "https://ssbprd.dscc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "jackson-state": "https://ssbprod.jscc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "motlow-state": "https://prodssb.mscc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "nashville-state": "https://pnsmss.nscc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "northeast-state": "https://ssb.northeaststate.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "pellissippi-state": "https://ssbprod.pstcc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "southwest-tn": "https://mafa1033ssbp.southwest.tn.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "volunteer-state": "https://ssb.volstate.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "walters-state": "https://prodssb.ws.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
};

const tnConfig: StateConfig = {
  slug: "tn",
  name: "Tennessee",
  systemName: "TBR",
  systemFullName: "Tennessee Board of Regents",
  systemUrl: "https://www.tbr.edu",
  collegeCount: 12,

  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "Tenn. Code Ann. \u00A7 49-7-113",
    description:
      "Tennessee residents aged 65 and older may attend credit courses at TBR community colleges with tuition and most mandatory fees waived on a space-available basis. A small service fee (typically capped around $70 per term) may still apply.",
    bannerTitle: "Tennessee Senior Tuition Waiver",
    bannerSummary:
      "Age 65 or older in Tennessee? You may be eligible to attend community college courses with tuition waived.",
    bannerDetail:
      "Tenn. Code Ann. \u00A7 49-7-113 allows Tennessee residents aged 65+ to attend credit courses at TBR community colleges with tuition and most mandatory fees waived on a space-available basis. A small service fee may still apply.",
  },

  transferSupported: true,
  // Transfer data sourced from UTK's public transfer course equivalency tool
  // at bannerssb.utk.edu (10k+ mappings across all 13 TBR CCs). Additional
  // universities (APSU, MTSU, etc.) are added incrementally by running
  // scripts/tn/transfer/scrape-*.ts adapters — see the plan file for details.

  popularCourses: ["ENGL 1010", "ENGL 1020", "MATH 1530", "HIST 2010", "BIOL 1110", "PSYC 1030"],
  defaultZip: "37203",
  defaultZipCity: "Nashville",

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) => {
    return BANNER_URLS[collegeSlug] || "https://www.tbr.edu/institutions/community-colleges";
  },

  collegeCoursesUrl: (collegeSlug: string) => {
    return BANNER_URLS[collegeSlug] || "https://www.tbr.edu/institutions/community-colleges";
  },

  branding: {
    siteName: "Community College Path Tennessee",
    tagline:
      "Search Tennessee community college courses across TBR institutions and plan your schedule.",
    footerText:
      "Community College Path Tennessee \u2014 Find courses across Tennessee Board of Regents community colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Tennessee Board of Regents (TBR).",
    metaKeywords: [
      "Tennessee community college courses",
      "TBR course search",
      "Tennessee community college schedule",
      "TN community college courses near me",
      "Tennessee Board of Regents",
      "Tennessee senior tuition waiver",
    ],
  },
};

export default tnConfig;
