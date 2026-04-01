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
    siteName: "AuditMap North Carolina",
    tagline:
      "Discover which North Carolina community colleges allow course auditing, what it costs, and how to apply. Free for NC residents 65+.",
    footerText:
      "AuditMap North Carolina — Helping North Carolinians discover course auditing opportunities.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the North Carolina Community College System (NCCCS).",
    metaKeywords: [
      "North Carolina community college audit",
      "NCCCS audit course",
      "audit college class North Carolina",
      "free college courses seniors NC",
      "North Carolina 65+ tuition waiver",
      "NC community college courses",
    ],
  },
};

export default ncConfig;
