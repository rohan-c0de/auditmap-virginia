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

  // 7 MS colleges with no public section data (verified 2026-06 via
  // untouchable-investigator + manual probes).
  documentedCeilings: {
    courses: [
      {
        collegeSlug: "copiah-lincoln-community-college",
        reason:
          "Co-Lin runs Jenzabar Athena on a non-standard port (access.colin.edu:444); the only public URL is athena/isclogin.pgm which is a username/password form — no guest path. Verified 2026-06.",
      },
      {
        collegeSlug: "east-central-community-college",
        reason:
          "ECCC runs Jenzabar JICS at my.eccc.edu; the Course_Schedules portlet renders an empty 'Please log in to view this page' shell for guests (unlike Coahoma's identical platform which does grant guest access). Verified 2026-06.",
      },
      {
        collegeSlug: "itawamba-community-college",
        reason:
          "ICC's class schedule is a custom DNN module (ICC_Live_Class_Schedule) at iccms.edu/CourseSchedule whose getTerms/getCourses API returns {Message: 'Authorization has been denied for this request.'} to unauthenticated callers. ssb.iccms.edu redirects to a Banner 8 login. Verified 2026-06.",
      },
      {
        collegeSlug: "northeast-mississippi-community-college",
        reason:
          "NEMCC's Banner SSB 9 at reg-prod.ec.nemcc.edu has guestLoginEnabled=false on every endpoint — no public class search. No alternate PDF/HTML schedule on nemcc.edu. Verified 2026-06.",
      },
      {
        collegeSlug: "pearl-river-community-college",
        reason:
          "PRCC's Banner Extensibility ClassSearch page advertises guestLoginEnabled=true in its meta tags, but every /BannerExtensibility/internalPb/virtualDomains/* data endpoint 302-redirects to /saml/login — the guest flag controls UI flow only, not data access. Verified 2026-06.",
      },
      {
        collegeSlug: "hinds-community-college",
        reason:
          "DEFERRED — not a ceiling. Hinds publishes a public class search at coursesearch.hindscc.edu (ASP.NET WebForms over PeopleSoft) but it requires full __VIEWSTATE/__EVENTVALIDATION postbacks; /api/TitleSearch returns title strings only. Headless Playwright follow-up needed. Tracked separately.",
      },
      {
        collegeSlug: "coahoma-community-college",
        reason:
          "DEFERRED — not a ceiling. Coahoma's Jenzabar JICS Course_Schedules portlet (myccc.coahomacc.edu) is publicly accessible but the search form is ASP.NET WebForms with massive __VIEWSTATE; needs Playwright. Tracked separately.",
      },
    ],
  },
};

export default msConfig;
