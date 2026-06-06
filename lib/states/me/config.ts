import type { StateConfig } from "../registry";

const meConfig: StateConfig = {
  slug: "me",
  name: "Maine",
  systemName: "MCCS",
  systemFullName: "Maine Community College System",
  systemUrl: "https://www.mccs.me.edu",
  collegeCount: 7,

  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "MRSA Title 20-A, \u00A712701",
    description:
      "Maine residents aged 65 and older may audit courses at any MCCS community college tuition-free on a space-available basis.",
    bannerTitle: "Maine Senior Audit Program",
    bannerSummary:
      "Over 65 in Maine? You may be eligible to audit MCCS courses tuition-free.",
    bannerDetail:
      "Maine law allows residents aged 65+ to audit credit courses at Maine Community College System institutions tuition-free on a space-available basis.",
  },

  // In-state transfers sourced from UMaine's MaineStreet Transfer
  // Equivalency Guest portal (PeopleSoft, no login required). The
  // old CollegeTransfer.Net script (`scripts/me/scrape-transfer.ts`)
  // is retained manual-only for out-of-state use if the in-state rule
  // is ever relaxed.
  transferSupported: true,
  prerenderAtBuild: true, // High Search Console traffic; pre-render at build (#702)
  popularCourses: ["ENG 101", "MAT 101", "BIO 101", "PSY 101", "HIS 101", "SOC 101"],
  defaultZip: "04101",
  defaultZipCity: "Portland",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.mccs.me.edu",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.mccs.me.edu",

  branding: {
    siteName: "Community College Path Maine",
    tagline:
      "Search Maine Community College System courses across all 7 colleges.",
    footerText:
      "Community College Path Maine \u2014 Find courses across all 7 MCCS colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Maine Community College System (MCCS).",
    metaKeywords: [
      "Maine community college courses",
      "MCCS course search",
      "Maine Community College System",
      "Maine community college schedule",
    ],
  },
  universityAliases: [
    { slug: "uma", names: ["UMA", "University of Maine at Augusta"] },
    { slug: "umf", names: ["UMF", "University of Maine at Farmington"] },
    { slug: "umfk", names: ["UMFK", "University of Maine at Fort Kent"] },
    { slug: "umaine", names: ["UMaine", "University of Maine", "University of Maine & University of Maine at Machias"] },
    { slug: "usm", names: ["USM", "University of Southern Maine"] },
    { slug: "umpi", names: ["UMPI", "University of Maine at Presque Isle"] },
  ],
  scrapers: {
    courses: [{ scripts: ["scripts/me/scrape-mccs.ts"], runner: "playwright" }],
    transfers: [{ scripts: ["scripts/me/scrape-transfer-mainestreet.ts"], runner: "playwright" }],
    prereqs: [{ scripts: ["scripts/me/scrape-catalog-prereqs.ts"], runner: "http" }],
    // manual-only: programs — all 7 MCCS colleges publish catalogs as PDF/DOCX
    // only (no Acalog/Coursedog/CourseLeaf/etc.); see documentedCeilings.programs.
  },

  documentedCeilings: {
    // No programs: all 7 Maine CC System colleges (cmcc/emcc/kvcc/nmcc/smcc/wccc/
    // yccc) publish their catalog as PDF or DOCX behind WordPress (verified
    // 2026-06). The programs-of-study web pages are marketing prose with no course
    // codes; requirements live only inside the PDF/DOCX. No supported catalog
    // platform is present, so the degree-path planner is data-limited here pending
    // a PDF-extraction approach.
    programs:
      "All 7 Maine CC System colleges publish catalogs as PDF/DOCX behind WordPress (no Acalog/Coursedog/CourseLeaf/SmartCatalogIQ/CleanCatalog). Program requirements exist only inside the PDFs/DOCX; the web program pages carry no course codes. Planner is data-limited pending PDF extraction. Verified 2026-06.",
  },
};

export default meConfig;
