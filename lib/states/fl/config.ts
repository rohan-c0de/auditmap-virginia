import type { StateConfig } from "../registry";

const flConfig: StateConfig = {
  slug: "fl",
  name: "Florida",
  systemName: "FCS",
  systemFullName: "Florida College System",
  systemUrl: "https://www.fldoe.org/schools/higher-ed/fl-college-system/",
  collegeCount: 28,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "FL Stat. § 1009.26(4)",
    description:
      "Florida residents aged 60 and older may have tuition and fees waived at Florida College System institutions for credit courses on a space-available basis. Each college decides which fees to waive; credit earned this way does not count toward graduation.",
    bannerTitle: "Florida Senior Tuition Waiver",
    bannerSummary:
      "Over 60 in Florida? Tuition and fees may be waived at FCS colleges for space-available enrollment.",
    bannerDetail:
      "Florida law allows residents aged 60+ to attend Florida College System credit courses with tuition and fees waived on a space-available basis. Each college sets its own policy on which fees are waivable; credit earned this way generally does not apply toward graduation.",
  },

  // Florida transfers run on SCNS (Statewide Course Numbering System) —
  // courses with the same prefix + 3-digit number + lab code at any FL
  // public institution are equivalent by FL Stat. § 1007.24. Phase 3
  // scraper at scripts/fl/scrape-scns-flatfile.ts builds transfer-equiv
  // from SCNS's public flat-file dump.
  transferSupported: true,
  popularCourses: ["ENC 1101", "MAC 1105", "BSC 1010", "PSY 2012", "AMH 2010", "SYG 2000"],
  defaultZip: "33132",
  defaultZipCity: "Miami",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.fldoe.org/schools/higher-ed/fl-college-system/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.fldoe.org/schools/higher-ed/fl-college-system/",

  branding: {
    siteName: "Community College Path Florida",
    tagline:
      "Search Florida College System courses across all 28 state colleges.",
    footerText:
      "Community College Path Florida — Find courses across all 28 FCS colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Florida College System or the Florida Department of Education.",
    metaKeywords: [
      "Florida community college courses",
      "FCS course search",
      "Florida College System",
      "Florida community college schedule",
      "Florida senior tuition waiver",
    ],
  },
  universityAliases: [
    { slug: "uf", names: ["UF", "University of Florida", "Gators"] },
    { slug: "fsu", names: ["FSU", "Florida State", "Florida State University"] },
    { slug: "ucf", names: ["UCF", "Central Florida", "University of Central Florida"] },
    { slug: "usf", names: ["USF", "South Florida", "University of South Florida"] },
    { slug: "fiu", names: ["FIU", "Florida International", "Florida International University"] },
    { slug: "fau", names: ["FAU", "Florida Atlantic", "Florida Atlantic University"] },
    { slug: "famu", names: ["FAMU", "Florida A&M", "Florida A&M University"] },
    { slug: "fgcu", names: ["FGCU", "Florida Gulf Coast", "Florida Gulf Coast University"] },
    { slug: "unf", names: ["UNF", "North Florida", "University of North Florida"] },
    { slug: "uwf", names: ["UWF", "West Florida", "University of West Florida"] },
    { slug: "ncf", names: ["NCF", "New College", "New College of Florida"] },
    { slug: "flpoly", names: ["Florida Poly", "Florida Polytechnic", "Florida Polytechnic University"] },
    { slug: "miami", names: ["Miami", "University of Miami", "UM"] },
    { slug: "rollins", names: ["Rollins", "Rollins College"] },
  ],
  scrapers: {
    courses: [
      // Banner SSB 9 — 10 colleges (the largest cluster after the platform
      // survey in #270). The other 16 FCS colleges use Banner 8, Workday
      // (auth-gated), PeopleSoft, Coursedog, or custom apps; those will
      // land in separate scrapers as Phase 2 follow-up PRs.
      { scripts: ["scripts/fl/scrape-banner-ssb.ts"], runner: "http" },
      // Banner 8 (legacy) — fgc + cfk, the only two FCS colleges on
      // classic Banner. Uses the shared template at lib/scrape-banner-8.
      { scripts: ["scripts/fl/scrape-banner8.ts"], runner: "http" },
      // Coursedog catalog (FSCJ) — Workday-registered colleges that publish
      // a public Coursedog catalog. Sections are auth-gated but the catalog
      // gives course-level prereqs feeding into prereqs.json.
      { scripts: ["scripts/fl/scrape-coursedog.ts"], runner: "playwright" },
      // St. Petersburg College — custom paginated JSON API at
      // classes.spcollege.edu. ~4.7k sections per term plus prereq
      // text embedded in course descriptions (~60% coverage). See
      // scrape-spcollege.ts header for the API shape.
      { scripts: ["scripts/fl/scrape-spcollege.ts"], runner: "http" },
    ],
    transfers: [
      // SCNS flat-file dump — single 80 MB download, no auth, covers all
      // 28 FCS × 12 public 4-year articulations in one run. Replaces the
      // per-receiver scraper pattern used in other states.
      { scripts: ["scripts/fl/scrape-scns-flatfile.ts"], runner: "http" },
    ],
    // Banner SSB 9 sections carry prereqs inline; Coursedog catalog data
    // contributes catalog-level prereqs for FSCJ. Aggregator walks both
    // data/fl/courses/*/* and data/fl/coursedog-catalog/*.json.
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — Phase 5+.
  },
};

export default flConfig;
