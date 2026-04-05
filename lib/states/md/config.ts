import type { StateConfig } from "../registry";

// Colleague Self-Service base URLs
const COLLEAGUE_URLS: Record<string, string> = {
  allegany: "https://selfservice.allegany.edu",
  carroll: "https://selfservice.carrollcc.edu",
  chesapeake: "https://sserv.chesapeake.edu",
  csm: "https://myservices.csmd.edu",
  hagerstown: "https://hcc-ecss01.hagerstowncc.edu:8173",
  howardcc: "https://colss-prod.ec.howardcc.edu",
  pgcc: "https://selfservice.pgcc.edu",
  "wor-wic": "https://selfservice.worwic.edu",
};

// Banner SSB 9/10 base URLs
const BANNER_SSB_URLS: Record<string, string> = {
  harford: "https://banner.harford.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  montgomery: "https://b9pubstu.glb.montgomerycollege.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
};

// Banner Classic (Banner 8) base URLs
const BANNER_CLASSIC_URLS: Record<string, string> = {
  ccbc: "https://simon.ccbcmd.edu/pls/PROD/bwckschd.p_disp_dyn_sched",
};

// Jenzabar JICS
const JENZABAR_URLS: Record<string, string> = {
  cecil: "https://my.cecil.edu/ICS/Course_Search.jnz",
  garrett: "https://my.garrettcollege.edu/ICS/Portal_Homepage.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search&screenType=next",
};

// Custom / other platforms
const OTHER_URLS: Record<string, string> = {
  aacc: "https://www.aacc.edu/course-search/",
  bccc: "https://portal.bccc.edu/RegentScripts/ctlwb01Project.exe?CMD=colwb57RequestChangeSelection",
  frederick: "https://html-schedule.frederick.edu/",
};

const mdConfig: StateConfig = {
  slug: "md",
  name: "Maryland",
  systemName: "Maryland CC",
  systemFullName: "Maryland Community Colleges",
  systemUrl: "https://mdacc.org",
  collegeCount: 16,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "MD Education Article § 16-106(b)",
    description:
      "Maryland residents aged 60 and older are exempt from tuition at any community college, space permitting. Fees and textbooks still apply. No income or retirement requirement for community colleges.",
    bannerTitle: "Maryland Senior Tuition Waiver",
    bannerSummary:
      "Over 60 in Maryland? You may be exempt from tuition at community colleges.",
    bannerDetail:
      "Maryland law exempts residents aged 60+ from community college tuition on a space-available basis. Fees and textbooks still apply.",
  },

  transferSupported: true,
  defaultZip: "21202",

  courseDiscoveryUrl: (
    collegeSlug: string,
    prefix: string,
    number: string
  ) => {
    // Colleague Self-Service
    const colleague = COLLEAGUE_URLS[collegeSlug];
    if (colleague && prefix && number) {
      return `${colleague}/Student/Courses/Search?keyword=${encodeURIComponent(prefix + " " + number)}`;
    }
    if (colleague) return `${colleague}/Student/Courses`;

    // Banner SSB 9/10
    const bannerSsb = BANNER_SSB_URLS[collegeSlug];
    if (bannerSsb) return bannerSsb;

    // Banner Classic
    const bannerClassic = BANNER_CLASSIC_URLS[collegeSlug];
    if (bannerClassic) return bannerClassic;

    // Jenzabar
    const jenzabar = JENZABAR_URLS[collegeSlug];
    if (jenzabar) return jenzabar;

    // Other platforms
    const other = OTHER_URLS[collegeSlug];
    if (other) return other;

    return "https://mdacc.org";
  },

  collegeCoursesUrl: (collegeSlug: string) => {
    const colleague = COLLEAGUE_URLS[collegeSlug];
    if (colleague) return `${colleague}/Student/Courses`;

    const bannerSsb = BANNER_SSB_URLS[collegeSlug];
    if (bannerSsb) return bannerSsb;

    const bannerClassic = BANNER_CLASSIC_URLS[collegeSlug];
    if (bannerClassic) return bannerClassic;

    const jenzabar = JENZABAR_URLS[collegeSlug];
    if (jenzabar) return jenzabar;

    const other = OTHER_URLS[collegeSlug];
    if (other) return other;

    return "https://mdacc.org";
  },

  branding: {
    siteName: "CC CourseMap Maryland",
    tagline:
      "Search Maryland community college courses, check transfer equivalencies, and build your schedule.",
    footerText:
      "CC CourseMap Maryland — Find courses across all 16 Maryland community colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Maryland Association of Community Colleges (MACC) or the Maryland Higher Education Commission (MHEC).",
    metaKeywords: [
      "Maryland community college courses",
      "MD community college course search",
      "Maryland community college transfer",
      "ARTSYS transfer equivalency",
      "community college courses near me",
      "Maryland community college schedule",
      "MD schedule builder",
    ],
  },
};

export default mdConfig;
