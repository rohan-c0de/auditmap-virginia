import type { StateConfig } from "../registry";

const ohConfig: StateConfig = {
  slug: "oh",
  name: "Ohio",
  systemName: "OACC",
  systemFullName: "Ohio Association of Community Colleges",
  systemUrl: "https://www.ohiocommunitycolleges.org/",
  collegeCount: 22,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "Ohio Revised Code § 3345.27 (Program 60)",
    description:
      "Ohio residents 60 and older may audit courses at state-supported colleges tuition-free on a space-available basis. Regular fees may still apply and audited courses do not count for degree credit.",
    bannerTitle: "Ohio Program 60",
    bannerSummary:
      "Over 60 in Ohio? You can audit classes at state-supported colleges tuition-free.",
    bannerDetail:
      "Ohio Revised Code § 3345.27 (Program 60) lets Ohio residents 60+ audit courses at state-assisted institutions tuition-free on a space-available basis. Confirm with each college's registrar.",
  },

  transferSupported: true,
  popularCourses: ["ENG 1010", "MATH 1410", "ENG 1020", "PSY 1010", "GEN 1070", "COMM 1010"],
  defaultZip: "43215",
  defaultZipCity: "Columbus",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.ohiocommunitycolleges.org/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.ohiocommunitycolleges.org/",

  branding: {
    siteName: "Community College Path Ohio",
    tagline: "Search Ohio community college courses across all 22 colleges.",
    footerText:
      "Community College Path Ohio — Find courses across all 22 Ohio community colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Ohio Association of Community Colleges.",
    metaKeywords: [
      "Ohio community college courses",
      "Ohio community college class search",
      "Ohio Association of Community Colleges",
      "Ohio Program 60",
    ],
  },
  scrapers: {
    // Five of OH's eight scrapable colleges are wired across three
    // platforms. The other three (committed during auto-add-state but
    // not represented in data/oh/courses today) need re-fingerprint.
    courses: [
      { scripts: ["scripts/oh/scrape-banner-ssb.ts"], runner: "http" },
      { scripts: ["scripts/oh/scrape-colleague.ts"], runner: "playwright" },
      { scripts: ["scripts/oh/scrape-banner8.ts"], runner: "http" },
    ],
    transfers: [
      // OSU Quick Equivalencies Excel — ~5K mappings across 15 OH CCs, single GET.
      { scripts: ["scripts/oh/scrape-transfer-osu.ts"], runner: "http" },
      // Statewide ORDS API (Transfer to Degree Guarantee, cems.regents.ohio.gov) —
      // every other OH public university (Cincinnati, Miami, Ohio U, Akron, Kent,
      // BGSU, Cleveland State, Toledo, Wright State, Youngstown) in one crawl.
      // OSU is excluded there (owned by scrape-transfer-osu.ts above).
      { scripts: ["scripts/oh/scrape-transfer-ords.ts"], runner: "http" },
    ],
    prereqs: { source: "aggregate-from-courses" },
    // Acalog (Sinclair, Owens) via search_advanced + CourseLeaf (Cuyahoga/Tri-C,
    // Lakeland, Rhodes State). Columbus State + Cincinnati State (CourseLeaf,
    // program index path TBD) and the other colleges are deferred.
    programs: [
      { scripts: ["scripts/oh/scrape-programs.ts"], runner: "http" },
    ],
  },
  documentedCeilings: {
    // Eastern Gateway Community College suspended operations in 2024 (it lost
    // HLC accreditation / federal aid eligibility after the "Free College"
    // dispute) and has no College Scorecard record — a name and unitid search
    // both return nothing. The other 21 OH colleges have full scorecard
    // coverage; this is the lone, permanent gap. Verified 2026-06-21.
    scorecard:
      "Eastern Gateway Community College closed in 2024 and publishes no College Scorecard record (no IPEDS unitid resolves). The remaining 21 Ohio colleges have full scorecard coverage.",
  },
};

export default ohConfig;
