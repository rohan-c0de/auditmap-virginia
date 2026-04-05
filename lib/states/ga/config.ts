import type { StateConfig } from "../registry";

// Most TCSG colleges use Banner SSB for course search
const BANNER_URLS: Record<string, string> = {
  "albany-tech": "https://banner.albanytech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "athens-tech": "https://banner.athenstech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "atlanta-tech": "https://banner.atlantatech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "augusta-tech": "https://banner.augustatech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "central-ga-tech": "https://banner.centralgatech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "chattahoochee-tech": "https://banner.chattahoocheetech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "coastal-pines-tech": "https://banner.coastalpines.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "columbus-tech": "https://banner.columbustech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "ga-northwestern-tech": "https://banner.gntc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "ga-piedmont-tech": "https://banner.gptc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "gwinnett-tech": "https://banner.gwinnetttech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "lanier-tech": "https://banner.laniertech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "north-ga-tech": "https://banner.northgatech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "oconee-fall-line-tech": "https://banner.oftc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "ogeechee-tech": "https://banner.ogeecheetech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "savannah-tech": "https://banner.savannahtech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "south-ga-tech": "https://banner.southgatech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "southeastern-tech": "https://banner.southeasterntech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "southern-crescent-tech": "https://banner.sctech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "southern-regional-tech": "https://banner.southernregional.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "west-ga-tech": "https://banner.westgatech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "wiregrass-tech": "https://banner.wiregrass.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
};

const gaConfig: StateConfig = {
  slug: "ga",
  name: "Georgia",
  systemName: "TCSG",
  systemFullName: "Technical College System of Georgia",
  systemUrl: "https://www.tcsg.edu",
  collegeCount: 22,

  seniorWaiver: {
    ageThreshold: 62,
    legalCitation: "OCGA 20-4-20",
    description:
      "Georgia residents aged 62 and older may attend classes at TCSG institutions with tuition waived on a space-available basis. Fees and textbooks may still apply.",
    bannerTitle: "Georgia Senior Tuition Waiver",
    bannerSummary:
      "Age 62 or older in Georgia? You may be eligible to attend technical college courses with tuition waived.",
    bannerDetail:
      "Georgia law allows residents aged 62+ to attend classes at TCSG technical colleges with tuition waived on a space-available basis. Fees and textbooks may still apply.",
  },

  transferSupported: false,
  defaultZip: "30303",

  courseDiscoveryUrl: (collegeSlug: string, prefix: string, number: string) => {
    const banner = BANNER_URLS[collegeSlug];
    if (banner) return banner;
    return "https://www.tcsg.edu";
  },

  collegeCoursesUrl: (collegeSlug: string) => {
    const banner = BANNER_URLS[collegeSlug];
    if (banner) return banner;
    return "https://www.tcsg.edu";
  },

  branding: {
    siteName: "CC CourseMap Georgia",
    tagline:
      "Search Georgia technical college courses across all 22 TCSG institutions and plan your schedule.",
    footerText:
      "CC CourseMap Georgia — Find courses across all 22 TCSG colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Technical College System of Georgia (TCSG).",
    metaKeywords: [
      "Georgia technical college courses",
      "TCSG course search",
      "Georgia technical college schedule",
      "GA technical college courses near me",
      "TCSG colleges",
      "Georgia community college courses",
    ],
  },
};

export default gaConfig;
