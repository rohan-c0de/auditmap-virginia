import type { StateConfig } from "../registry";

// Maps college slug → Colleague Self-Service base URL for course catalog links
const SELF_SERVICE_URLS: Record<string, string> = {
  "wake-technical": "https://selfserve.waketech.edu",
  "fayetteville-technical": "https://selfserv.faytechcc.edu",
  "durham-technical": "https://selfservice.durhamtech.edu",
  "central-piedmont": "https://mycollegess.cpcc.edu",
  "asheville-buncombe-technical": "https://selfservice.abtech.edu",
  "forsyth-technical": "https://my.forsythtech.edu",
  "guilford-technical": "https://selfservice.gtcc.edu",
  "pitt": "https://sscourses.pittcc.edu",
  "rowan-cabarrus": "https://ss-prod.cloud.rccc.edu",
  "alamance": "https://ss-prod.cloud.alamancecc.edu",
  "beaufort-county": "https://ss-prod.cloud.beaufortccc.edu",
  "bladen": "https://selfservice.bladencc.edu",
  "blue-ridge": "https://ss-prod.cloud.blueridge.edu",
  "caldwell": "https://selfservice.cccti.edu",
  "central-carolina": "https://ss-prod.cloud.cccc.edu",
  "craven": "https://selfservice.cravencc.edu",
  "haywood": "https://selfservice.haywood.edu",
  "isothermal": "https://ss-prod.cloud.isothermal.edu",
  "james-sprunt": "https://ss.jamessprunt.edu",
  "johnston": "https://selfserv.johnstoncc.edu",
  "lenoir": "https://ss.lenoircc.edu",
  "mcdowell-technical": "https://ss-prod.cloud.mcdowelltech.edu",
  "mitchell": "https://selfservice.mitchellcc.edu",
  "montgomery": "https://ss-prod.cloud.montgomery.edu",
  "piedmont": "https://ss.piedmontcc.edu",
  "randolph": "https://ss-prod.cloud.randolph.edu",
  "richmond": "https://ss-prod.cloud.richmondcc.edu",
  "roanoke-chowan": "https://selfservice.roanokechowan.edu",
  "robeson": "https://selfservice.robeson.edu",
  "rockingham": "https://ss-prod.cloud.rockinghamcc.edu",
  "sampson": "https://ss.sampsoncc.edu",
  "south-piedmont": "https://selfservice.spcc.edu",
  "southwestern": "https://ss.southwesterncc.edu",
  "stanly": "https://selfservice.stanly.edu",
  "vance-granville": "https://ss-prod.cloud.vgcc.edu",
  "wayne": "https://selfserv.waynecc.edu",
  "western-piedmont": "https://selfservice.wpcc.edu",
  "catawba-valley": "https://ss-prod-cloud.cvcc.edu",
  "gaston": "https://ss-prod-cloud.gaston.edu",
  "coastal-carolina": "https://ss-prod-cloud.coastalcarolina.edu",
  "nash": "https://ss-prod-cloud.nashcc.edu",
  "surry": "https://ssprod.surry.edu",
  "wilkes": "https://selfservice.cloud.wilkescc.edu",
  "davidson-davie": "https://selfservice.cloud.davidsondavie.edu",
  "halifax": "https://sss.halifaxcc.edu",
  "brunswick": "https://ss2-prod-cloud.brunswickcc.edu",
  "carteret": "https://ss-prod-cloud.carteret.edu",
  "edgecombe": "https://ss-prod-cloud.edgecombe.edu",
};

const ncConfig: StateConfig = {
  slug: "nc",
  name: "North Carolina",
  systemName: "NCCCS",
  systemFullName: "North Carolina Community College System",
  systemUrl: "https://www.nccommunitycolleges.edu",
  collegeCount: 58,

  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "NC General Statute § 115D-5(b)(2)",
    description:
      "North Carolina residents aged 65 and older may audit up to 6 credit hours per semester at any NCCCS college for free, space permitting. Only lecture-based courses are eligible.",
    bannerTitle: "North Carolina Senior Audit Program",
    bannerSummary:
      "Over 65 in North Carolina? You may be eligible to audit college courses for free.",
    bannerDetail:
      "NC law allows residents aged 65+ to audit up to 6 credit hours per semester at community colleges for free, space permitting. Lecture courses only.",
  },

  transferSupported: true,
  prerenderAtBuild: true, // High Search Console traffic; pre-render at build (#702)
  popularCourses: ["ENG 111", "MAT 171", "BIO 111", "HIS 111", "PSY 150", "ECO 251"],
  defaultZip: "27601",
  defaultZipCity: "Raleigh",

  courseDiscoveryUrl: (collegeSlug: string, prefix: string, number: string) => {
    const base = SELF_SERVICE_URLS[collegeSlug];
    if (base && prefix && number) {
      return `${base}/Student/Courses/Search?keyword=${encodeURIComponent(prefix + " " + number)}`;
    }
    if (base) return `${base}/Student/Courses`;
    return `https://www.nccommunitycolleges.edu/colleges/${collegeSlug}`;
  },

  collegeCoursesUrl: (collegeSlug: string) => {
    const base = SELF_SERVICE_URLS[collegeSlug];
    if (base) return `${base}/Student/Courses`;
    return `https://www.nccommunitycolleges.edu/colleges/${collegeSlug}`;
  },

  branding: {
    siteName: "Community College Path North Carolina",
    tagline:
      "Search North Carolina community college courses, check transfer equivalencies, and build your schedule.",
    footerText:
      "Community College Path North Carolina — Find courses across all 58 NCCCS colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the North Carolina Community College System (NCCCS).",
    metaKeywords: [
      "North Carolina community college courses",
      "NCCCS course search",
      "NC community college transfer",
      "community college courses near me",
      "NC community college schedule",
      "NC schedule builder",
    ],
  },
  universityAliases: [
    { slug: "unc-chapel-hill", names: ["UNC", "UNC Chapel Hill", "University of North Carolina"] },
    { slug: "ncsu", names: ["NC State", "NCSU", "North Carolina State"] },
    { slug: "uncc", names: ["UNC Charlotte", "UNCC", "Charlotte"] },
    { slug: "uncg", names: ["UNC Greensboro", "UNCG"] },
    { slug: "ecu", names: ["ECU", "East Carolina", "East Carolina University"] },
    { slug: "appstate", names: ["App State", "Appalachian State", "Appalachian State University"] },
    { slug: "duke", names: ["Duke", "Duke University"] },
    { slug: "wake-forest", names: ["Wake Forest", "Wake Forest University"] },
    { slug: "uncw", names: ["UNCW", "UNC Wilmington"] },
    { slug: "ncat", names: ["NC A&T", "North Carolina A&T"] },
  ],
  scrapers: {
    courses: [
      {
        scripts: [
          "scripts/nc/scrape-albemarle.ts",
          "scripts/nc/scrape-cape-fear.ts",
          "scripts/nc/scrape-cleveland.ts",
          "scripts/nc/scrape-martin.ts",
          "scripts/nc/scrape-mayland.ts",
          "scripts/nc/scrape-pamlico.ts",
          "scripts/nc/scrape-sandhills.ts",
          "scripts/nc/scrape-southeastern.ts",
          "scripts/nc/scrape-tri-county.ts",
        ],
        runner: "http",
      },
      { scripts: ["scripts/nc/scrape-colleague.ts"], runner: "playwright" },
    ],
    transfers: [
      {
        scripts: [
          "scripts/nc/scrape-transfer-cns.ts",
          "scripts/nc/scrape-transfer-catawba.ts",
          "scripts/nc/scrape-transfer-elon.ts",
          "scripts/nc/scrape-transfer-hpu.ts",
          "scripts/nc/scrape-transfer-ncstate.ts",
          "scripts/nc/scrape-transfer-uncg.ts",
          "scripts/nc/scrape-transfer-wingate.ts",
        ],
        runner: "http",
      },
    ],
    prereqs: { source: "aggregate-from-courses" },
    programs: [
      {
        // discover-catalogs.ts fingerprints each NCCCS college's catalog platform
        // and writes data/nc/catalog-discovery.json; the platform scrapers read it.
        // Keep these in one ordered job — discovery MUST run before the scrapers.
        // Coverage: 17 colleges (acalog ×9, smartcatalogiq ×7, courseleaf ×1).
        // Known gaps (see data/nc/DEFERRED-programs.md): coursedog (Colleague-Ethos
        // variant won't parse), several smartcatalogiq instances nest programs below
        // the walker's depth or are on stale editions.
        scripts: [
          "scripts/nc/discover-catalogs.ts",
          "scripts/nc/scrape-smartcatalogiq-programs.ts",
          "scripts/nc/scrape-acalog-programs.ts",
          "scripts/nc/scrape-misc-programs.ts",
        ],
        runner: "http",
      },
    ],
  },
};

export default ncConfig;
