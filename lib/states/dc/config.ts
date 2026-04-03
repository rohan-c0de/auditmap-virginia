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
    siteName: "CC CourseMap DC",
    tagline:
      "Search UDC Community College courses and build your schedule. Tuition waived for DC residents 65+.",
    footerText:
      "CC CourseMap DC — Find courses at UDC Community College.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the University of the District of Columbia.",
    metaKeywords: [
      "DC community college courses",
      "UDC Community College",
      "UDC-CC course search",
      "free college courses seniors DC",
      "District of Columbia 65+ tuition waiver",
      "UDC schedule builder",
    ],
  },
};

export default dcConfig;
