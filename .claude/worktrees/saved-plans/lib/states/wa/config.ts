import type { StateConfig } from "../registry";

const waConfig: StateConfig = {
  slug: "wa",
  name: "Washington",
  systemName: "SBCTC",
  systemFullName: "Washington State Board for Community and Technical Colleges",
  systemUrl: "https://www.sbctc.edu/",
  collegeCount: 34,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "RCW 28B.50.265",
    description:
      "Washington residents aged 60+ may audit community and technical college courses on a space-available basis with tuition waived; a nominal registration fee (typically $5 per quarter) applies. Each of the 33 SBCTC colleges sets its own enrollment procedure.",
    bannerTitle: "Washington Senior Tuition Waiver",
    bannerSummary:
      "Over 60 in Washington? Audit community college courses tuition-free on a space-available basis.",
    bannerDetail:
      "Washington law (RCW 28B.50.265) allows residents aged 60+ to audit credit and noncredit courses at any of the 33 SBCTC community and technical colleges on a space-available basis. Tuition is waived; a small registration fee (typically $5 per quarter) applies. Northwest Indian College, a tribal college, is not part of SBCTC and sets its own policy.",
  },

  transferSupported: true,
  universityAliases: [
    { slug: "university-of-washington", names: ["UW", "University of Washington", "UW Seattle"] },
  ],
  popularCourses: ["ENGL& 101", "MATH& 141", "PSYC& 100", "BIOL& 160", "CMST& 220"],
  defaultZip: "98101",
  defaultZipCity: "Seattle",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.sbctc.edu/",

  collegeCoursesUrl: (_collegeSlug: string) => "https://www.sbctc.edu/",

  branding: {
    siteName: "Community College Path Washington",
    tagline: "Search Washington community and technical college courses across all 34 colleges.",
    footerText:
      "Community College Path Washington — Find courses across all 34 Washington community and technical colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by SBCTC or any Washington community or technical college.",
    metaKeywords: [
      "Washington community college courses",
      "SBCTC course search",
      "Washington community and technical colleges",
      "ctcLink class search",
    ],
  },
  scrapers: {
    courses: [
      // ctcLink covers 33 of 34 SBCTC colleges (Northwest Indian College, a
      // tribal college, is not part of SBCTC and serves its catalog via a
      // separate WordPress site — deferred).
      { scripts: ["scripts/wa/scrape-ctclink.ts"], runner: "http" },
    ],
    transfers: [{ scripts: ["scripts/wa/scrape-transfer-uw.ts"], runner: "http" }],
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — Phase 5+.
  },
};

export default waConfig;
