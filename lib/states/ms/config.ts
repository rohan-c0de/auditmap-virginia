import type { StateConfig } from "../registry";

const msConfig: StateConfig = {
  slug: "ms",
  name: "Mississippi",
  systemName: "MCCB",
  systemFullName: "Mississippi Community College Board",
  systemUrl: "https://www.mccb.edu/",
  collegeCount: 15,

  // TODO: research senior-waiver statute for MS. Mississippi does not appear
  // to have a statewide senior tuition waiver statute for community colleges.
  // Individual colleges may offer senior discounts — verify before populating.
  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "Miss. Code § 37-29 (district-level authority)",
    description:
      "Mississippi has no statewide senior-tuition statute. The 15 community and junior colleges (organized under Miss. Code Title 37 Chapter 29) set their own tuition policies, and most offer reduced or waived tuition for residents 65+ on a space-available basis. Terms vary by college.",
    bannerTitle: "Mississippi Senior Tuition Discounts (by college)",
    bannerSummary:
      "Over 65 in Mississippi? Most community colleges offer senior tuition discounts — terms vary by college.",
    bannerDetail:
      "Mississippi has no statewide senior-tuition statute. The 15 community and junior colleges (organized under Miss. Code Title 37 Chapter 29) set their own tuition policies. Most offer reduced or waived tuition for residents 65+ on a space-available basis. Contact your college's registrar or financial aid office for the specific terms.",
  },

  transferSupported: true,
  popularCourses: ["SPT 1113", "ENG 1113", "HPR 2132", "HPR 1132", "BIO 2511", "PSY 1513"],
  defaultZip: "39201",
  defaultZipCity: "Jackson",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.mccb.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.mccb.edu/",

  branding: {
    siteName: "Community College Path Mississippi",
    tagline: "Search MCCB courses across all 15 Mississippi community colleges.",
    footerText: "Community College Path Mississippi — Find courses across all 15 MCCB colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Mississippi Community College Board (MCCB).",
    metaKeywords: [
      "Mississippi community college courses",
      "MCCB course search",
      "Mississippi Community College Board",
    ],
  },
  scrapers: {
    courses: [
      // Banner 8 (classic bwckschd): meridian (existing) + mississippi-delta.
      { scripts: ["scripts/ms/scrape-banner8.ts"], runner: "http" },
      // Banner SSB 9: holmes (api.holmescc.edu — non-canonical host).
      { scripts: ["scripts/ms/scrape-banner-ssb.ts"], runner: "http" },
      // Colleague Self-Service: east-mississippi (colss-prod.ec subdomain).
      { scripts: ["scripts/ms/scrape-colleague.ts"], runner: "playwright" },
      // Athena/Benchmark (ProGen WebSmart on IBM iSeries): southwest +
      // northwest MS. Both expose /athena/IXSCHED.pgm publicly.
      { scripts: ["scripts/ms/scrape-athena.ts"], runner: "http" },
      // Bespoke PHP class-search at Jones College (class-search.jcjc.edu).
      { scripts: ["scripts/ms/scrape-jones.ts"], runner: "http" },
      // Bespoke PHP schedule viewer at MGCCC
      // (mgccc.edu/website_schedules/index.php — multi-campus + multi-term).
      { scripts: ["scripts/ms/scrape-mgccc.ts"], runner: "http" },
      // ICC custom DNN module — public UI, API needs the DNN
      // RequestVerificationToken + ModuleId/TabId headers harvested from the
      // rendered page (no SSO).
      { scripts: ["scripts/ms/scrape-itawamba.ts"], runner: "http" },
      // Hinds CC — ASP.NET WebForms with full viewstate; driven via
      // headless Chromium with per-subject iteration to bypass the
      // server-side result-set cap.
      { scripts: ["scripts/ms/scrape-hinds.ts"], runner: "playwright" },
      // Coahoma CC — Jenzabar JICS Course_Schedules portlet; same
      // viewstate-driven postback pattern as Hinds, per-department iteration.
      { scripts: ["scripts/ms/scrape-coahoma.ts"], runner: "playwright" },
      // PRCC — actual SIS (Banner Extensibility) is SAML-walled, but the
      // bookstore (WebPRISM) exposes a public term→dept→course→section XML
      // cascade for textbook adoptions. The bookstore aggregates physical
      // sections by textbook adoption, so this yields course-level catalog
      // data per term rather than per-section granularity.
      { scripts: ["scripts/ms/scrape-prcc-bookstore.ts"], runner: "http" },
    ],
    transfers: [
      // University of Mississippi publishes public per-CC course-equivalency
      // tables (olemiss.edu/registrar/transfer-equivalencies) covering all 15
      // MS community colleges. One receiver for now — Mississippi State's data
      // is behind a Banner Extensibility XHR; USM/JSU publish nothing
      // course-level (they defer to MATT / transcript eval). Adding MSU is a
      // documented follow-up to lift MS above single-university coverage.
      { scripts: ["scripts/ms/scrape-transfer-olemiss.ts"], runner: "http" },
    ],
    prereqs: [{ scripts: ["scripts/ms/scrape-catalog-prereqs.ts"], runner: "playwright" }],
    programs: [{ scripts: ["scripts/ms/scrape-programs.ts"], runner: "http" }],
  },

  // 3 MS colleges with no public section data (verified 2026-06 via
  // untouchable-investigator + manual probes).
  documentedCeilings: {
    courses: [
      {
        collegeSlug: "copiah-lincoln-community-college",
        reason:
          "Co-Lin runs Jenzabar Athena on a non-standard port (access.colin.edu:444); the only public URL is athena/isclogin.pgm which is a username/password form. No Banner / Colleague / SSB alternative subdomain resolves; no public bookstore-XML; no PDF schedule on the marketing site. Verified 2026-06.",
      },
      {
        collegeSlug: "east-central-community-college",
        reason:
          "ECCC runs Jenzabar JICS at my.eccc.edu; the Course_Schedules portlet renders an empty 'Please log in to view this page' shell for guests (unlike Coahoma's identical platform). In-house bookstore has no XML cascade; no PDF schedule. Verified 2026-06.",
      },
      {
        collegeSlug: "northeast-mississippi-community-college",
        reason:
          "NEMCC's Banner SSB 9 at reg-prod.ec.nemcc.edu has guestLoginEnabled=false on every endpoint, and its Banner Extensibility customPage SAML-redirects all virtualDomain data calls. Bookstore is a Square Online e-commerce site (no class lookup). No PDF schedule. Verified 2026-06.",
      },
    ],
  },
};

export default msConfig;
