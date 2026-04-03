import type { StateConfig } from "../registry";

// Colleague Self-Service base URLs (need /Student/Courses appended)
const COLLEAGUE_URLS: Record<string, string> = {
  "aiken": "https://courses.atc.edu",
  "denmark": "https://selfservice.denmarktech.edu",
  "florence-darlington": "https://selfservice.fdtc.edu",
  "spartanburg": "https://selfserviceprod.sccsc.edu:8172",
  "lowcountry": "https://selfservice.tcl.edu",
  "central-carolina": "https://ssb.cctech.edu",
  "york": "https://coll-ss.yorktech.edu:8473",
  "trident": "https://selfservice.tridenttech.edu",
  "midlands": "https://collselfserve.midlandstech.edu",
  "northeastern": "https://selfservice.netc.edu",
  "orangeburg-calhoun": "https://collssprod.octech.edu",
};

// Non-Colleague platforms — URLs are already full paths to course search
const OTHER_PLATFORM_URLS: Record<string, string> = {
  // Banner SSB 9
  "piedmont": "https://banner.ptc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "tri-county": "https://prodban.tctc.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  // Banner 8
  "horry-georgetown": "https://ssb.hgtc.edu/PROD9/bwckschd.p_disp_dyn_sched",
  // Cygnet
  "greenville": "https://cygnet.gvltec.edu/courselist/courselist.cfm",
};

const scConfig: StateConfig = {
  slug: "sc",
  name: "South Carolina",
  systemName: "SCTCS",
  systemFullName: "South Carolina Technical College System",
  systemUrl: "https://www.sctechsystem.edu",
  collegeCount: 16,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "SC Code § 59-111-320",
    description:
      "South Carolina residents aged 60 and older may attend classes at any public technical college with tuition waived, space permitting. Fees and textbooks still apply.",
    bannerTitle: "South Carolina Senior Tuition Waiver",
    bannerSummary:
      "Over 60 in South Carolina? You may be eligible to attend technical college courses with tuition waived.",
    bannerDetail:
      "SC law allows residents aged 60+ to attend classes at public technical colleges with tuition waived, space permitting. Fees and textbooks still apply.",
  },

  transferSupported: true,
  defaultZip: "29201",

  courseDiscoveryUrl: (collegeSlug: string, prefix: string, number: string) => {
    // Colleague: append search path
    const colleague = COLLEAGUE_URLS[collegeSlug];
    if (colleague && prefix && number) {
      return `${colleague}/Student/Courses/Search?keyword=${encodeURIComponent(prefix + " " + number)}`;
    }
    if (colleague) return `${colleague}/Student/Courses`;

    // Non-Colleague platforms: URL is already a full course search path
    const other = OTHER_PLATFORM_URLS[collegeSlug];
    if (other) return other;

    return `https://www.sctechsystem.edu`;
  },

  collegeCoursesUrl: (collegeSlug: string) => {
    const colleague = COLLEAGUE_URLS[collegeSlug];
    if (colleague) return `${colleague}/Student/Courses`;

    const other = OTHER_PLATFORM_URLS[collegeSlug];
    if (other) return other;

    return `https://www.sctechsystem.edu`;
  },

  branding: {
    siteName: "CC CourseMap South Carolina",
    tagline:
      "Search South Carolina technical college courses, check transfer equivalencies, and build your schedule. Tuition waived for SC residents 60+.",
    footerText:
      "CC CourseMap South Carolina — Find courses across all 16 SCTCS colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the South Carolina Technical College System (SCTCS).",
    metaKeywords: [
      "South Carolina technical college courses",
      "SCTCS course search",
      "SC technical college transfer",
      "free college courses seniors SC",
      "South Carolina 60+ tuition waiver",
      "SC schedule builder",
    ],
  },
};

export default scConfig;
