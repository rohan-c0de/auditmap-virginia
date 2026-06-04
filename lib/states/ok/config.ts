import type { StateConfig } from "../registry";

// Oklahoma's 13 community colleges are independent institutions overseen by
// the Oklahoma State Regents for Higher Education (OSRHE). The auto-add-state
// orchestrator scraped 3 Banner SSB 9 (TCC, NEO A&M, Muscogee Nation) and 1
// Banner 8 (Connors State) via built-in templates. Five additional colleges
// run Ellucian Colleague Self-Service on publicly accessible guest endpoints
// — the orchestrator's fingerprinter missed them (3 got tagged "auth-gated"
// because Ellucian Experience portal aggregator returned SSO, 1 got "custom
// HTML" because aggiesonline doesn't match the standard subdomain pattern).
// See scripts/ok/scrape-colleague.ts for the per-college host map.
const SELF_SERVICE_URLS: Record<string, string> = {
  // Banner SSB 9 — built-in template
  "tulsa-community-college": "https://banapp.tulsacc.edu",
  "northeastern-oklahoma-aandm-college": "https://ssb-prod.neo.edu",
  "college-of-the-muscogee-nation": "https://ssb.mcn.edu",
  // Banner 8 — built-in template
  "connors-state-college": "https://ssb.connorsstate.edu",
  // Colleague Self-Service — see scripts/ok/scrape-colleague.ts
  "oklahoma-city-community-college": "https://colss-prod.ec.occc.edu",
  "redlands-community-college": "https://selfservice.redlandscc.edu",
  "western-oklahoma-state-college": "https://selfservice.wosc.edu",
  "carl-albert-state-college": "https://selfservice.carlalbert.edu",
  "murray-state-college": "https://aggiesonline.mscok.edu",
};

const okConfig: StateConfig = {
  slug: "ok",
  name: "Oklahoma",
  systemName: "OSRHE",
  systemFullName: "Oklahoma State System of Higher Education",
  systemUrl: "https://okhighered.org/",
  collegeCount: 13,

  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "OK Admin Code § 610:35-5-1(g) (OSRHE Senior Citizen waiver)",
    description:
      "Oklahoma residents 65 and older may enroll in undergraduate credit courses at state institutions tuition-free on a space-available basis.",
    bannerTitle: "Oklahoma Senior Citizen Tuition Waiver",
    bannerSummary:
      "Over 65 in Oklahoma? Tuition may be waived for credit classes on a space-available basis.",
    bannerDetail:
      "OSRHE policy 35-5-1(g) lets Oklahoma residents 65+ enroll in undergraduate credit courses tuition-free at state colleges on a space-available basis. Confirm specifics with each college's registrar.",
  },

  transferSupported: true,
  popularCourses: ["ENGL 1113", "ENGL 1213", "MATH 1513", "HIST 1493", "PSYC 1113", "COMM 1113"],
  defaultZip: "73102",
  defaultZipCity: "Oklahoma City",

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) =>
    SELF_SERVICE_URLS[collegeSlug] ?? "https://okhighered.org/",

  collegeCoursesUrl: (collegeSlug: string) => {
    const base = SELF_SERVICE_URLS[collegeSlug];
    if (!base) return "https://okhighered.org/";
    // Colleague vs Banner — pick the right student-courses path
    if (base.includes("selfservice") || base.includes("colss-prod") || base.includes("aggiesonline")) {
      return `${base}/Student/Courses`;
    }
    return base;
  },

  branding: {
    siteName: "Community College Path Oklahoma",
    tagline: "Search Oklahoma community college courses across all 13 colleges.",
    footerText: "Community College Path Oklahoma — Find courses across all 13 Oklahoma community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Oklahoma State Regents for Higher Education or any individual Oklahoma community college.",
    metaKeywords: [
      "Oklahoma community college courses",
      "Tulsa Community College courses",
      "Oklahoma City Community College courses",
      "Rose State College courses",
      "Redlands Community College courses",
      "OSRHE",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/ok/scrape-colleague.ts"], runner: "playwright" },
      // Banner SSB 9 (TCC, NEO A&M, Muscogee Nation) and Banner 8 (Connors State)
      // run via the built-in scrape-banner-ssb and scrape-banner-8 templates,
      // wired up automatically by scheduled-scrape.yml from the fingerprint pass.
      //
      // manual-only: rose-state-college — PeopleSoft Community Access at
      // oasis.rose.edu/psc/classsearchguest/.../COMMUNITY_ACCESS.CLASS_SEARCH.GBL.
      // Public-accessible; needs a bespoke PS scraper (adapt scripts/ca/scrape-laccd.ts
      // for the single-college, no-cluster-bucketing case). Deferred to follow-up PR.
      //
      // manual-only: northern-oklahoma-college, seminole-state-college — Jenzabar
      // Course_Search.jnz portlet (portal.noc.edu/ICS/Course_Search.jnz and
      // my.sscok.edu/ICS/Course_Search.jnz). Public-accessible; needs new Jenzabar
      // template (none exists in repo yet). Deferred to follow-up platform PR.
      //
      // manual-only: eastern-oklahoma-state-college — no public guest course-search
      // URL found; site publishes only a PDF self-service guide. Skipped.
    ],
    // Oklahoma Course Equivalency Project (OCEP, vita.okhighered.org) is the
    // authoritative statewide source. It's a group model — each course belongs
    // to a statewide equivalency group and every institution's course in that
    // group is mutually transferable. scrape-transfer.ts enumerates all 12
    // OCEP-registered OK community colleges, queries each equivalency group
    // once, and emits edges to all other in-state institutions (universities,
    // regionals, colleges).
    transfers: [{ scripts: ["scripts/ok/scrape-transfer.ts"], runner: "http" }],
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — none of the 13 catalogs matched a templated
    // platform (acalog/courseleaf/smartcatalogiq/coursedog/cleancatalog).
  },
};

export default okConfig;
