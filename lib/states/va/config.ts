import type { StateConfig } from "../registry";

const vaConfig: StateConfig = {
  slug: "va",
  name: "Virginia",
  systemName: "VCCS",
  systemFullName: "Virginia Community College System",
  systemUrl: "https://www.vccs.edu",
  collegeCount: 23,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "Virginia Code \u00A7 23.1-638",
    description:
      "Virginia law allows residents aged 60+ to sit in on classes at public colleges and universities at no cost, space permitting.",
    bannerTitle: "Virginia Senior Audit Program",
    bannerSummary:
      "Over 60 in Virginia? You may be eligible to audit college courses for free.",
    bannerDetail:
      "Virginia law allows residents aged 60+ to sit in on classes at public colleges and universities at no cost, space permitting.",
  },

  transferSupported: true,
  popularCourses: ["ENG 111", "ENG 112", "MTH 154", "MTH 161", "BIO 101", "HIS 121", "PSY 200", "ECO 201"],
  defaultZip: "22030",
  defaultZipCity: "Fairfax",

  courseDiscoveryUrl: (collegeSlug: string, prefix: string, number: string) =>
    `https://courses.vccs.edu/colleges/${collegeSlug}/courses/${prefix}${number}`,

  collegeCoursesUrl: (collegeSlug: string) =>
    `https://courses.vccs.edu/colleges/${collegeSlug}/courses`,

  branding: {
    siteName: "Community College Path Virginia",
    tagline:
      "Search Virginia community college courses, check transfer equivalencies, and build your schedule.",
    footerText:
      "Community College Path Virginia — Find courses across all 23 VCCS colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Virginia Community College System (VCCS).",
    metaKeywords: [
      "Virginia community college courses",
      "VCCS course search",
      "Virginia community college transfer",
      "community college courses near me",
      "Virginia community college schedule",
      "VCCS schedule builder",
    ],
  },
  universityAliases: [
    { slug: "gmu", names: ["GMU", "George Mason", "George Mason University"] },
    { slug: "vcu", names: ["VCU", "Virginia Commonwealth", "Virginia Commonwealth University"] },
    { slug: "uva", names: ["UVA", "University of Virginia"] },
    { slug: "vt", names: ["Virginia Tech", "VT", "Virginia Polytechnic"] },
    { slug: "odu", names: ["ODU", "Old Dominion", "Old Dominion University"] },
    { slug: "jmu", names: ["JMU", "James Madison", "James Madison University"] },
    { slug: "wm", names: ["William & Mary", "William and Mary", "W&M"] },
    { slug: "radford", names: ["Radford", "Radford University"] },
    { slug: "longwood", names: ["Longwood", "Longwood University"] },
    { slug: "liberty", names: ["Liberty", "Liberty University"] },
  ],
  scrapers: {
    // manual-only: courses — VA PeopleSoft scraper consistently exceeds the 6h GitHub Actions timeout; run manually when needed.
    // Transfers are SAFE on cron despite courses being manual-only. The eight
    // scrapers below hit external university transfer-equivalency portals
    // (GMU/ODU/UMW/UVA/VCU/VSU/VWU public HTML/JSON endpoints + Virginia Tech's
    // published VCCS-equivalency page) — none invoke the heavy PeopleSoft course
    // scrape they were previously (incorrectly) disabled alongside. They run
    // sequentially in one job because each loads data/va/transfer-equiv.json,
    // merges its own university's rows, and writes the file back.
    transfers: [
      {
        scripts: [
          "scripts/va/scrape-transfer-equiv.ts", // Virginia Tech (vt)
          "scripts/va/scrape-transfer-gmu.ts",
          "scripts/va/scrape-transfer-odu.ts",
          "scripts/va/scrape-transfer-umw.ts",
          "scripts/va/scrape-transfer-uva.ts",
          "scripts/va/scrape-transfer-vcu.ts",
          "scripts/va/scrape-transfer-vsu.ts",
          "scripts/va/scrape-transfer-vwu.ts",
        ],
        runner: "http",
      },
    ],
    // Prereqs aggregate from committed course-section prerequisite_text
    // (data/va/prereqs.json, 302 parsed chains; 4,227 sections carry prereq
    // text). This reads already-committed data — it does NOT run the heavy
    // PeopleSoft scraper — so it's safe on cron despite courses being manual-only.
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — disabled alongside courses.
  },
};

export default vaConfig;
