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

  transferSupported: false,
  popularCourses: [],
  defaultZip: "20001",

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
};

export default dcConfig;
