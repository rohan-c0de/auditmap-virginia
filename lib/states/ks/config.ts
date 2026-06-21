import type { StateConfig } from "../registry";

// Per-college public class-search / schedule URLs. Harvested from the working
// scrapers in scripts/ks/ + data/state-health/fingerprint-baseline.json and
// probed 2026-06-17.
const REGISTRATION_URLS: Record<string, string> = {
  // Banner SSB 9.
  "butler-community-college":
    "https://banssreg1.butlercc.edu:8081/StudentRegistrationSsb/ssb/classSearch/classSearch",
  // Ellucian Colleague Self-Service (same hosts the scraper uses).
  "kansas-city-kansas-community-college":
    "https://selfservice.kckcc.edu/Student/Courses",
  "coffeyville-community-college":
    "https://coffey-ss.colleague.elluciancloud.com/Student/Courses",
  "highland-community-college":
    "https://colss-prod.highldsaas.elluciancloud.com/Student/Courses",
  "independence-community-college":
    "https://indycc-ss.colleague.elluciancloud.com/Student/Courses",
  // Jenzabar JICS Course Search / Course Schedule portlets.
  "cloud-county-community-college":
    "https://icloud.cloud.edu/ICS/Course_Search.jnz?portlet=Course_Search&screen=Advanced+Course+Search&screenType=next",
  "cowley-county-community-college":
    "https://mycc.cowley.edu/ICS/Course_Search.jnz?portlet=Course_Search&screen=Advanced+Course+Search&screenType=next",
  "dodge-city-community-college":
    "https://conqs.dc3.edu/ICS/Course_Search.jnz?portlet=Course_Search&screen=Advanced+Course+Search&screenType=next",
  "flint-hills-technical-college":
    "https://my.fhtc.edu/ICS/Academics/Course_Schedule.jnz?portlet=Course_Schedule&screen=Advanced+Course+Search&screenType=next",
  "fort-scott-community-college":
    "https://my.fortscott.edu/ICS/Course_Schedule.jnz?portlet=Course_Schedule&screen=Advanced+Course+Search&screenType=next",
  "labette-community-college":
    "https://redzone.labette.edu/ICS/The_Red_Zone.jnz?portlet=Course_Schedules&screen=Advanced+Course+Search&screenType=next",
  "neosho-county-community-college":
    "https://web.neosho.edu/ICS/Guest_Home.jnz?portlet=Course_Schedules&screen=Advanced+Course+Search&screenType=next",
  // Empower-XL public course catalog (Fort Hays Tech | Northwest, formerly
  // Northwest Kansas Technical College — slug retained from federal data).
  "northwest-kansas-technical-college":
    "https://nwktc.empower-xl.com/fusebox.cfm?fuseaction=CourseCatalog",
  // Bespoke public schedule apps (same endpoints the scrapers read).
  "hutchinson-community-college": "https://www.hutchcc.edu/courses",
  "allen-county-community-college":
    "https://web.allencc.edu/portal/asp/schedule.aspx",
  "manhattan-area-technical-college": "https://manhattantech.edu/course-search",
  "salina-area-technical-college":
    "https://sonis.salinatech.edu/courses/default.aspx",
};

// Honest fallback for KS colleges with no public class search (Cloudflare-walled
// human page or auth-gated SIS). Sourced from data/ks/scorecard/*.json schoolUrl.
// Never kansasregents.org per college — the Board of Regents site has no
// course listings.
const COLLEGE_HOMEPAGES: Record<string, string> = {
  "barton-county-community-college": "https://www.bartonccc.edu/",
  "colby-community-college": "https://www.colbycc.edu/",
  "garden-city-community-college": "https://www.gcccks.edu/",
  "johnson-county-community-college": "https://www.jccc.edu/",
  "pratt-community-college": "https://www.prattcc.edu/",
  "seward-county-community-college": "https://sccc.edu/",
};

const ksCollegeUrl = (collegeSlug: string): string =>
  REGISTRATION_URLS[collegeSlug] ??
  COLLEGE_HOMEPAGES[collegeSlug] ??
  "https://www.kansasregents.org/";

const ksConfig: StateConfig = {
  slug: "ks",
  name: "Kansas",
  systemName: "Kansas Board of Regents",
  systemFullName: "Kansas Community and Technical Colleges (Kansas Board of Regents)",
  systemUrl: "https://www.kansasregents.org/",
  collegeCount: 24,

  // Kansas has no statewide senior tuition-waiver statute for community/technical
  // colleges. K.S.A. 76-731a covers Board of Regents (state university) institutions,
  // not community colleges (governed under K.S.A. Chapter 71). Each college sets its
  // own policy; common threshold is 60–65. Populated as "varies by college" per the
  // NE/AZ/CA pattern.
  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "No statewide statute for community/technical colleges; set by each college",
    description:
      "Kansas has no statewide senior-tuition statute for its community and technical colleges. Each college sets its own policy — many offer a reduced senior rate or waived tuition for residents aged 60+ on credit courses, often on a space-available basis. Terms vary by college; confirm with the registrar.",
    bannerTitle: "Kansas Senior Discounts (by college)",
    bannerSummary:
      "60+ in Kansas? Many community and technical colleges offer a reduced senior tuition rate — terms vary by college.",
    bannerDetail:
      "Kansas has no statewide senior-tuition statute for community and technical colleges. K.S.A. 76-731a covers state universities under the Board of Regents but does not extend to the 24-college community/technical system. Each college sets its own policy — commonly a reduced or waived senior rate for residents 60 or 65+ on a space-available basis, sometimes excluding lab fees and non-credit classes. Contact your college's registrar for the specific rate and eligibility.",
  },

  transferSupported: true,
  // Top 8 by section count across all wired KS colleges. Different colleges use
  // different prefixes (EG/EN/ENG for English Composition); list reflects the
  // raw rank in scraped data.
  popularCourses: [
    "EG 101",
    "EN 101",
    "PS 100",
    "MA 106",
    "EN 102",
    "SH 101",
    "ENG 101",
    "PSY 101",
  ],
  defaultZip: "67202",
  defaultZipCity: "Wichita",

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) =>
    ksCollegeUrl(collegeSlug),

  collegeCoursesUrl: (collegeSlug: string) => ksCollegeUrl(collegeSlug),

  branding: {
    siteName: "Community College Path Kansas",
    tagline: "Search Kansas community and technical college courses across all 24 colleges.",
    footerText: "Community College Path Kansas — Find courses across all 24 Kansas community and technical colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Kansas Board of Regents.",
    metaKeywords: [
      "Kansas community college courses",
      "Kansas community college class search",
      "Kansas Board of Regents",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/ks/scrape-banner-ssb.ts"], runner: "playwright" },
      { scripts: ["scripts/ks/scrape-colleague.ts"], runner: "playwright" },
      { scripts: ["scripts/ks/scrape-jenzabar-webforms.ts"], runner: "playwright" },
      { scripts: ["scripts/ks/scrape-fhnw-empower-xl.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-hutchinson.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-allen.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-manhattan-tech.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-colby.ts"], runner: "http" },
      { scripts: ["scripts/ks/scrape-salina.ts"], runner: "http" },
    ],
    // Kansas has no CollegeTransfer.Net in-state data and the Board of Regents
    // systemwide portal is Cloudflare-walled. Wichita State's public GenEd
    // Transfer Equivalency web app (ASP.NET WebForms) lists all 24 KS
    // community/technical colleges' course-to-course equivalencies, including
    // the KS Systemwide Transfer (KRSN) flag. scrape-transfer.ts drives the
    // two-step institution→results postback and keeps the latest effective
    // term per course.
    // Three receivers, each a public no-login source: Wichita State
    // (genedtsfequiv WebForms), KU (JSON API credittransfer-api.ku.edu),
    // Emporia State (htmx credittransfer.emporia.edu). K-State, Pittsburg State,
    // and Washburn publish only CollegeSource TES public views (CAPTCHA-gated,
    // not scrapeable); Fort Hays is PDF-only.
    transfers: [
      {
        scripts: [
          "scripts/ks/scrape-transfer.ts",
          "scripts/ks/scrape-transfer-ku.ts",
          "scripts/ks/scrape-transfer-emporia.ts",
        ],
        runner: "http",
      },
    ],
    prereqs: { source: "aggregate-from-courses" },
    // Programs: 10 of 24 KS colleges publish a scrapeable catalog. Live-probed
    // 2026-06-21; see scripts/ks/scrape-programs.ts for the per-college URL +
    // platform mapping. The remaining 14 are documented in
    // documentedCeilings.programs below (WordPress / PDF-only catalogs).
    programs: [
      {
        scripts: ["scripts/ks/scrape-programs.ts"],
        runner: "playwright",
      },
    ],
  },

  documentedCeilings: {
    programs:
      "14 of 24 KS colleges publish catalogs as WordPress prose / PDF-only / no public catalog subdomain (verified 2026-06-21): barton-county, cloud-county, dodge-city, flint-hills-technical, fort-scott, highland, hutchinson, independence, labette, manhattan-area-technical, north-central-kansas-technical, northwest-kansas-technical, pratt, salina-area-technical. Program requirements exist only inside PDFs; the web catalog pages carry no machine-readable course codes. Planner is data-limited for these pending PDF extraction.",
  },
};

export default ksConfig;
