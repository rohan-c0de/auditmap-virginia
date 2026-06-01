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
  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "MCL 389.21+ (district-level authority)",
    description:
      "Michigan has no statewide senior-tuition statute for community colleges. Michigan's 28 community college districts (organized under the Community College Act, MCL 389.21+) set their own tuition policies, and many offer reduced or waived tuition for residents 60+ on a space-available basis. Terms vary by college.",
    bannerTitle: "Michigan Senior Tuition Discounts (by college)",
    bannerSummary:
      "Over 60 in Michigan? Most community colleges offer senior tuition discounts — terms vary by college.",
    bannerDetail:
      "Michigan has no statewide senior-tuition statute. The 28 community college districts (organized under the Community College Act, MCL 389.21+) set their own tuition policies. Many offer reduced or waived tuition for residents 60+ on a space-available basis, sometimes with fee adjustments. Contact your college's registrar or financial aid office for the specific terms.",
  },

  transferSupported: true,
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
      { scripts: ["scripts/mi/scrape-jenzabar-webforms.ts"], runner: "playwright" },
    ],
    prereqs: { source: "aggregate-from-courses" },
    transfers: [
      // MiTransfer.org AJAX portal — 5 major MI universities × 28 CCs, ~155 fetches.
      { scripts: ["scripts/mi/scrape-transfer-mitransfer.ts"], runner: "http" },
    ],
    programs: [
      {
        // discover-catalogs.ts fingerprints each MI college's catalog platform
        // → data/mi/catalog-discovery.json; the platform scrapers read it.
        // Keep ordered — discovery MUST run before the scrapers. Coverage:
        // 7 plannable colleges (498 programs). Gaps in data/mi/DEFERRED-programs.md.
        scripts: [
          "scripts/mi/discover-catalogs.ts",
          "scripts/mi/scrape-smartcatalogiq-programs.ts",
          "scripts/mi/scrape-acalog-programs.ts",
          "scripts/mi/scrape-misc-programs.ts",
        ],
        runner: "http",
      },
    ],
  },
};

export default miConfig;
