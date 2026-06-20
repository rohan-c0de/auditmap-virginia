import type { StateConfig } from "../registry";

// Per-college public class-search / schedule URLs. Harvested from the working
// scrapers in scripts/mt/ and probed 2026-06-17 (HTTP 200 for curl with a
// browser UA on all 8 wired colleges).
const REGISTRATION_URLS: Record<string, string> = {
  // Banner 8 dynamic schedule.
  "dawson-community-college":
    "https://ssbweb.dcc.umt.edu/dwsnssb/bwckschd.p_disp_dyn_sched",
  "miles-community-college":
    "https://ssbweb.mcc.umt.edu/milsssb/bwckschd.p_disp_dyn_sched",
  // Banner SSB 9 — shared with Montana Tech 4-year; scraper keeps Highlands
  // (South Campus) only.
  "highlands-college-of-montana-tech":
    "https://reg-prod.ec.mtech.edu/StudentRegistrationSsb/ssb/classSearch/classSearch",
  // SKC publishes per-term class lists as static pages.
  "salish-kootenai-college": "https://www.skc.edu/registrar/",
  // Chief Dull Knife — only public surface is per-term PDFs hosted at the
  // domain root.
  "chief-dull-knife-college": "https://www.cdkc.edu/",
  // Empower-XL public course catalog (ColdFusion).
  "aaniiih-nakoda-college":
    "https://empowerweb-ancollege.empower-xl.com/fusebox.cfm?fuseaction=CourseCatalog",
  // Jenzabar JICS Course Search portlet.
  "little-big-horn-college": "https://cloudram.lbhc.edu/ICS/Course_Search.jnz",
  // Bespoke ASP schedule pages.
  "flathead-valley-community-college": "https://elements.fvcc.edu/Schedules/",
};

// Honest fallback for the 2 MT colleges with no scraper-backed public class
// search. Sourced from data/mt/scorecard/*.json schoolUrl.
const COLLEGE_HOMEPAGES: Record<string, string> = {
  "stone-child-college": "https://www.stonechild.edu/",
  "fort-peck-community-college": "https://www.fpcc.edu/",
};

const mtCollegeUrl = (collegeSlug: string): string =>
  REGISTRATION_URLS[collegeSlug] ??
  COLLEGE_HOMEPAGES[collegeSlug] ??
  "https://mus.edu/";

const mtConfig: StateConfig = {
  slug: "mt",
  name: "Montana",
  systemName: "Montana University System",
  systemFullName: "Montana University System Community Colleges",
  systemUrl: "https://mus.edu",
  collegeCount: 10,
  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "Mont. Code § 20-25-421 (Board of Regents policy)",
    description:
      "Montana residents aged 65 and older may enroll in credit courses at any Montana University System institution, including the 2-year colleges, with tuition waived on a space-available basis. Fees still apply.",
    bannerTitle: "Montana Senior Citizens' Tuition Waiver",
    bannerSummary:
      "Over 65 in Montana? Tuition is waived at MUS colleges on a space-available basis.",
    bannerDetail:
      "Under Mont. Code § 20-25-421 and Board of Regents policy 940.13, Montana residents aged 65+ may enroll in credit courses at any Montana University System institution (including the 2-year colleges) tuition-free on a space-available basis after the regular registration period. Fees, books, and other charges still apply.",
  },

  transferSupported: true,
  popularCourses: ["COLS 111", "ENGL 101", "NASD 101", "ENGL 306", "ENGL 202", "WRIT 101"],
  defaultZip: "59601",
  defaultZipCity: "Helena",

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) =>
    mtCollegeUrl(collegeSlug),

  collegeCoursesUrl: (collegeSlug: string) => mtCollegeUrl(collegeSlug),

  branding: {
    siteName: "Community College Path Montana",
    tagline: "Search community college courses across all 10 Montana colleges.",
    footerText: "Community College Path Montana — Find courses across all 10 Montana community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Montana University System.",
    metaKeywords: [
      "Montana community college courses",
      "Montana community college course search",
      "Montana University System community colleges",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/mt/scrape-banner8.ts"], runner: "http" },
      { scripts: ["scripts/mt/scrape-skc.ts"], runner: "http" },
      { scripts: ["scripts/mt/scrape-cdkc.ts"], runner: "http" },
      // aaniiih-nakoda-college: Empower-XL (ComSpec) at the non-canonical host
      // empowerweb-ancollege.empower-xl.com — public ColdFusion CourseCatalog
      // flow (GET token, POST courseCatalog.cfc GetList → ui-grid HTML), same
      // shape as ak's Ilisagvik. Cloudflare-fronted, so a browser UA is used.
      { scripts: ["scripts/mt/scrape-aaniiih-nakoda.ts"], runner: "http" },
      // highlands-college-of-montana-tech: the 2-year division of Montana Tech.
      // No host of its own — its courses live in Montana Tech's public Banner
      // SSB 9 at reg-prod.ec.mtech.edu; the scraper keeps only South Campus
      // (Highlands) sections, dropping the shared 4-year North Campus.
      { scripts: ["scripts/mt/scrape-highlands.ts"], runner: "http" },
      // little-big-horn-college: Jenzabar ICS via direct HTTP POST (no browser
      // needed — no EVENTVALIDATION, session cookie + VIEWSTATE sufficient).
      // cloudram.lbhc.edu/ICS — non-canonical host; uses GUID term IDs.
      { scripts: ["scripts/mt/scrape-lbhc.ts"], runner: "http" },
      // flathead-valley-community-college: bespoke ASP schedule pages at
      // elements.fvcc.edu/Schedules/{term}/{campus}.asp — plain HTML tables,
      // no auth. Terms discovered by probing candidate dirs directly (the
      // top-level index only lists past terms).
      { scripts: ["scripts/mt/scrape-fvcc.ts"], runner: "http" },
    ],
    prereqs: { source: "aggregate-from-courses" },
    transfers: [
      // Montana University System Common Course Numbering (CCN) matrix at
      // ccn.mus.edu — a public server-rendered HTML grid of every common-
      // numbered course and which MUS campuses offer it. The scraper
      // paginates the grid and, for each course offered at both a 2-year
      // sender and a 4-year campus, emits an identity equivalency (CCN keeps
      // the same course code statewide) for the six MUS universities.
      // In-state by construction. ~1,300 mappings.
      { scripts: ["scripts/mt/scrape-transfer-ccn.ts"], runner: "http" },
    ],
    // manual-only: programs — Phase 5+.
    // DEFERRED-scrapers: fort-peck-community-college — interactive Jenzabar JICS
    //   at fpcportal.jenzabarcloud.com is auth-gated (empty portlet for guests),
    //   but term-by-term PDF class schedules are public on Webflow CDN (linked
    //   from fpcc.edu/academics/academics-resources). Needs a PDF extractor —
    //   distinct, larger effort than the interactive scrapers above. NOT a
    //   ceiling (data is public), just deferred.
  },
  // stone-child-college runs Empower XL at scc.empower-xl.com but only the
  // applicationLogin.xhtml page is public — every course-catalog path 404s and
  // there is no guest catalog link. Genuinely auth-gated, so it's a ceiling
  // (verified 2026-06). (Contrast aaniiih-nakoda, whose Empower-XL exposes a
  // public CourseCatalog endpoint and IS scraped above.)
  documentedCeilings: {
    courses: [
      {
        collegeSlug: "stone-child-college",
        reason:
          "Stone Child College runs Empower XL at scc.empower-xl.com, but only /new/EMPOWER/authentication/applicationLogin.xhtml is reachable — every course-catalog path returns 404 and the login page exposes no guest/public catalog link. No public course-section data exists. Verified 2026-06.",
      },
    ],
  },
};

export default mtConfig;
