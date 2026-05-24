import type { StateConfig } from "../registry";

const azConfig: StateConfig = {
  slug: "az",
  name: "Az",
  systemName: "Public 2-year",
  systemFullName: "Az Public 2-year Colleges",
  systemUrl: "",
  collegeCount: 21,

  // TODO: research senior-waiver statute for Az.
  // Set to null if no waiver exists, or fill in per the SeniorWaiverConfig shape.
  seniorWaiver: null,

  transferSupported: false,
  popularCourses: [],
  defaultZip: "",
  defaultZipCity: "",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.example.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.example.edu/",

  branding: {
    siteName: "Community College Path Az",
    tagline: "Search Public 2-year courses across all 21 colleges.",
    footerText: "Community College Path Az — Find courses across all 21 Public 2-year colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by Az Public 2-year Colleges.",
    metaKeywords: [
      "Az community college courses",
      "Public 2-year course search",
      "Az Public 2-year Colleges",
    ],
  },
  scrapers: {
    courses: [
      // Banner SSB 9 — Cochise, Pima, Coconino (3 colleges via shared template)
      { scripts: ["scripts/az/scrape-banner-ssb.ts"], runner: "http" },
      // Colleague Self-Service — Mohave (Ellucian Cloud) + Arizona Western
      // (self-hosted at colss-prod.ec.azwestern.edu).
      { scripts: ["scripts/az/scrape-colleague.ts"], runner: "playwright" },
      // Maricopa District (10 colleges via shared classes.sis.maricopa.edu)
      { scripts: ["scripts/az/scrape-maricopa.ts"], runner: "http" },
    ],
    // Inline prereq text harvested from the scraped Banner SSB + Colleague +
    // Maricopa sections (15 of 21 AZ colleges covered).
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: transfers — AZ has no entry in articulation-portals.json
    //   yet. AZ's state system is AZTransfer.com; needs one-time integration.
    // manual-only: programs — scripts/az/scrape-programs.ts wrapper exists
    //   but each of the 4 Acalog catalogs needs manual navoid identification
    //   (auto-discovery finds catoid but not navoids — same as NV/CSN).
  },
  documentedCeilings: {
    courses: [
      {
        collegeSlug: "dine-college",
        reason: "Diné College (Navajo Nation tribal college) publishes course schedules only as semester PDFs (e.g. Fall-26-Course-Schedule-May-20-2026.pdf at www.dinecollege.edu/admissions/course-schedule/). The my.dinecollege.edu portal is SSO-gated via QuickLaunch. No live HTML/JSON schedule. Verified 2026-05-24.",
      },
    ],
  },
};

export default azConfig;
