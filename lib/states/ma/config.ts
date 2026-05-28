import type { StateConfig } from "../registry";

const maConfig: StateConfig = {
  slug: "ma",
  name: "Massachusetts",
  systemName: "MassCC",
  systemFullName: "Massachusetts Community Colleges",
  systemUrl: "https://masscc.org",
  collegeCount: 15,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "MGL c. 15A, \u00A719",
    description:
      "Massachusetts residents aged 60 and older may attend state community college courses tuition-free on a space-available basis.",
    bannerTitle: "Massachusetts Senior Tuition Waiver",
    bannerSummary:
      "Over 60 in Massachusetts? You may be eligible to attend community college tuition-free.",
    bannerDetail:
      "Massachusetts law allows residents aged 60+ to attend credit courses at state community colleges tuition-free on a space-available basis.",
  },

  // 2026-04: enabled after scripts/ma/scrape-masstransfer.ts populated
  // data/ma/transfer-equiv.json with ~46k mappings covering all 15 MA CCs
  // × 14 state/UMass receivers via the MassTransfer public equivalency
  // database. Unlike per-college scrapes (NH), MassTransfer is a single
  // state-run source so coverage is uniform across all CCs — including
  // the ones whose scheduling systems are SSO-gated (Massasoit, Cape Cod,
  // QCC, Roxbury, MassBay).
  transferSupported: true,
  prerenderAtBuild: true, // High Search Console traffic; pre-render at build (#702)
  popularCourses: ["ENG 101", "MAT 128", "BIO 110", "PSY 101", "HIS 101", "SOC 101"],
  defaultZip: "02108",
  defaultZipCity: "Boston",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://masscc.org",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://masscc.org",

  branding: {
    siteName: "Community College Path Massachusetts",
    tagline:
      "Search Massachusetts Community Colleges courses across all 15 colleges.",
    footerText:
      "Community College Path Massachusetts \u2014 Find courses across all 15 MassCC colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by Massachusetts Community Colleges (MassCC) or the Commonwealth of Massachusetts.",
    metaKeywords: [
      "Massachusetts community college courses",
      "MassCC course search",
      "Massachusetts Community Colleges",
      "Massachusetts community college schedule",
    ],
  },
  universityAliases: [
    { slug: "umass-amherst", names: ["UMass Amherst", "UMass", "University of Massachusetts Amherst"] },
    { slug: "umass-boston", names: ["UMass Boston", "University of Massachusetts Boston"] },
    { slug: "umass-lowell", names: ["UMass Lowell", "UML", "University of Massachusetts Lowell"] },
    { slug: "umass-dartmouth", names: ["UMass Dartmouth", "University of Massachusetts Dartmouth"] },
    { slug: "bu", names: ["BU", "Boston University"] },
    { slug: "bc", names: ["BC", "Boston College"] },
    { slug: "northeastern", names: ["Northeastern", "Northeastern University", "NEU"] },
    { slug: "tufts", names: ["Tufts", "Tufts University"] },
    { slug: "brandeis", names: ["Brandeis", "Brandeis University"] },
    { slug: "bridgewater-state", names: ["Bridgewater State", "BSU", "Bridgewater State University"] },
    { slug: "salem-state", names: ["Salem State", "Salem State University"] },
    { slug: "westfield-state", names: ["Westfield State", "Westfield State University"] },
    { slug: "framingham-state", names: ["Framingham State", "Framingham State University"] },
    { slug: "fitchburg-state", names: ["Fitchburg State", "Fitchburg State University"] },
    { slug: "worcester-state", names: ["Worcester State", "Worcester State University"] },
  ],
  scrapers: {
    courses: [
      {
        scripts: ["scripts/ma/scrape-banner-ssb.ts", "scripts/ma/scrape-banner8.ts"],
        runner: "http",
      },
      { scripts: ["scripts/ma/scrape-colleague.ts"], runner: "playwright" },
    ],
    transfers: [{ scripts: ["scripts/ma/scrape-masstransfer.ts"], runner: "http" }],
    prereqs: [
      {
        scripts: [
          "scripts/ma/scrape-catalog-prereqs-gcc.ts",
          "scripts/ma/scrape-catalog-prereqs-middlesex.ts",
        ],
        runner: "http",
      },
    ],
    programs: [
      { scripts: ["scripts/ma/scrape-programs.ts"], runner: "http" },
      {
        scripts: ["scripts/ma/scrape-courseleaf-programs.ts"],
        runner: "http",
      },
      {
        scripts: ["scripts/ma/scrape-smartcatalogiq-programs.ts"],
        runner: "http",
      },
      {
        scripts: ["scripts/ma/scrape-qcc-pdf-programs.ts"],
        runner: "http",
      },
      {
        scripts: ["scripts/ma/scrape-cleancatalog-programs.ts"],
        runner: "http",
      },
      {
        scripts: ["scripts/ma/scrape-rcc-programs.ts"],
        runner: "http",
      },
      {
        scripts: ["scripts/ma/scrape-massasoit-programs.ts"],
        runner: "http",
      },
      {
        scripts: ["scripts/ma/scrape-coursedog-programs.ts"],
        runner: "playwright",
      },
    ],
  },
};

export default maConfig;
