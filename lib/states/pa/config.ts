import type { StateConfig } from "../registry";

const paConfig: StateConfig = {
  slug: "pa",
  name: "Pennsylvania",
  systemName: "PA CCs",
  systemFullName: "Pennsylvania Commission for Community Colleges",
  systemUrl: "https://www.pacommunitycolleges.org",
  collegeCount: 15,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "24 P.S. \u00A7 19-1908-B",
    description:
      "Pennsylvania law allows residents aged 60 and older to audit courses at community colleges tuition-free on a space-available basis.",
    bannerTitle: "Pennsylvania Senior Audit Program",
    bannerSummary:
      "Over 60 in Pennsylvania? You may be eligible to audit community college courses for free.",
    bannerDetail:
      "Under 24 P.S. \u00A7 19-1908-B, Pennsylvania residents aged 60+ may audit courses at community colleges tuition-free on a space-available basis. Fees may still apply.",
  },

  transferSupported: true,
  popularCourses: ["ENG 101", "MAT 140", "BIO 110", "PSY 101", "HIS 101", "SOC 101"],
  defaultZip: "19104",
  defaultZipCity: "Philadelphia",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) => {
    // PA community colleges use varied platforms (Banner, Colleague, Workday).
    // No single unified course search URL exists.
    return `https://www.pacommunitycolleges.org`;
  },

  collegeCoursesUrl: (_collegeSlug: string) =>
    `https://www.pacommunitycolleges.org`,

  branding: {
    siteName: "Community College Path Pennsylvania",
    tagline:
      "Search Pennsylvania community college courses, check transfer equivalencies, and build your schedule.",
    footerText:
      "Community College Path Pennsylvania \u2014 Find courses across all 15 PA community colleges.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Pennsylvania Commission for Community Colleges or any individual Pennsylvania community college.",
    metaKeywords: [
      "Pennsylvania community college courses",
      "PA community college course search",
      "Pennsylvania community college transfer",
      "community college courses near me",
      "PA community college schedule",
      "PA TRAC transfer equivalencies",
    ],
  },
  universityAliases: [
    { slug: "psu", names: ["Penn State", "PSU", "Pennsylvania State University"] },
    { slug: "pitt", names: ["Pitt", "University of Pittsburgh", "U Pitt"] },
    { slug: "temple", names: ["Temple", "Temple University"] },
    { slug: "drexel", names: ["Drexel", "Drexel University"] },
    { slug: "villanova", names: ["Villanova", "Villanova University", "Nova"] },
    { slug: "la-salle", names: ["La Salle", "La Salle University"] },
    { slug: "west-chester", names: ["West Chester", "West Chester University", "WCU"] },
    { slug: "bloomsburg", names: ["Bloomsburg", "Bloomsburg University"] },
  ],
  scrapers: {
    // Covers 10 of 15 PA CCs across five SIS platforms: Banner SSB 9
    // (DCCC, HACC, LCCC), Banner 8 (CCP), Colleague Self-Service
    // (CCAC, Luzerne, MC3, RACC), CampusNexus / Anthology
    // (Westmoreland), and a static JSON dump (Northampton).
    //
    // The 5 colleges still without scrapers are:
    //   - bucks         Workday Student (no template; needs investigation)
    //   - butler        Ellucian Experience SSO portal only (no public SIS)
    //   - ccbc          Jenzabar JICS behind SAML
    //   - pa-highlands  Jenzabar JICS behind SAML
    //   - penn-college  SSO-gated (Penn State affiliate)
    courses: [
      { scripts: ["scripts/pa/scrape-banner-ssb.ts"], runner: "http" },
      { scripts: ["scripts/pa/scrape-banner-8.ts"], runner: "http" },
      { scripts: ["scripts/pa/scrape-colleague.ts"], runner: "playwright" },
      { scripts: ["scripts/pa/scrape-northampton.ts"], runner: "http" },
      { scripts: ["scripts/pa/scrape-westmoreland.ts"], runner: "http" },
    ],
    transfers: [
      { scripts: ["scripts/pa/scrape-transfer.ts"], runner: "http" },
      { scripts: ["scripts/pa/scrape-pitt-tes.ts"], runner: "http" },
    ],
    prereqs: [{ scripts: ["scripts/pa/scrape-catalog-prereqs.ts"], runner: "http" }],
    // Acalog (CCAC, Reading Area) via search_advanced discovery. Delaware County
    // (CourseLeaf, 104 paths/0 parsed), Northampton (Coursedog 369/0 parsed) +
    // CCP/HACC/Montgomery (catalogs unlocatable) are deferred.
    programs: [{ scripts: ["scripts/pa/scrape-programs.ts"], runner: "http" }],
  },
};

export default paConfig;
