import type { StateConfig } from "../registry";

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

  transferSupported: false, // UNC CAA data to be added later

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) =>
    `https://www.nccommunitycolleges.edu/colleges/${collegeSlug}`,

  collegeCoursesUrl: (collegeSlug: string) =>
    `https://www.nccommunitycolleges.edu/colleges/${collegeSlug}`,

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
