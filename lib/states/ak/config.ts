import type { StateConfig } from "../registry";

const akConfig: StateConfig = {
  slug: "ak",
  name: "Alaska",
  systemName: "Alaska CCs",
  systemFullName: "Alaska community colleges",
  systemUrl: "https://www.ilisagvik.edu/",
  collegeCount: 1,

  // Alaska has no community-college *system* and no statutory senior-tuition
  // waiver that reaches Ilisagvik (the state's only IPEDS-listed CC, a
  // tribally-controlled college in Utqiagvik). The University of Alaska
  // system has its own 60+ tuition reduction under AS 14.40.130, but that
  // statute does not bind Ilisagvik. Leave null until a registrar contact
  // confirms any tribal-college-specific policy.
  seniorWaiver: null,

  transferSupported: false,
  popularCourses: ["ENGL 101", "MATH 105", "BIOL 100", "PSY 101", "HIST 131"],
  defaultZip: "99723",
  defaultZipCity: "Utqiagvik",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://empowerweb.ilisagvik.edu/fusebox.cfm?fuseaction=CourseCatalog&rpt=1",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://empowerweb.ilisagvik.edu/fusebox.cfm?fuseaction=CourseCatalog&rpt=1",

  branding: {
    siteName: "Community College Path Alaska",
    tagline: "Search Ilisagvik College course sections — Alaska's tribally-controlled community college.",
    footerText: "Community College Path Alaska — Find courses at Ilisagvik College in Utqiagvik.",
    disclaimer:
      "This is an independent project and is not affiliated with, endorsed by, or sponsored by Ilisagvik College.",
    metaKeywords: [
      "Alaska community college courses",
      "Ilisagvik College course search",
      "Utqiagvik tribal college",
    ],
  },
  scrapers: {
    // Ilisagvik runs Empower SIS (ComSpec International), a ColdFusion-based
    // SIS hosted at empowerweb.ilisagvik.edu. The public course catalog is
    // reachable via a two-step flow (GET form for cookie+CSRF token, POST
    // term code → JSON-wrapped ui-grid HTML). See scripts/ak/scrape-ilisagvik.ts.
    courses: [
      {
        scripts: ["scripts/ak/scrape-ilisagvik.ts"],
        runner: "http",
      },
    ],
    // manual-only: transfers — Alaska has no registered articulation portal
    // and Ilisagvik (one CC, tribal-controlled) doesn't publish bulk transfer
    // equivalencies. Skip until a data source is identified.
    // Empower SIS sections don't expose prerequisite text, so we scrape the
    // catalog (CleanCatalog at catalog.ilisagvik.edu) for the `field-pr`
    // block on each course detail page. Pantheon rate-limits raw fetch and
    // IP-bans aggressively; the scraper uses Playwright with a 1.5s delay.
    prereqs: [
      {
        scripts: ["scripts/ak/scrape-catalog-prereqs.ts"],
        runner: "playwright",
      },
    ],
    // catalog.ilisagvik.edu runs CleanCatalog; the wrapper script discovers
    // degrees via the platform's /degrees index.
    programs: [
      {
        scripts: ["scripts/ak/scrape-programs.ts"],
        runner: "http",
      },
    ],
  },
  // Alaska has no public CC→4-year articulation data to scrape: the state
  // operates no registered articulation portal, and its single community
  // college (Ilisagvik, tribally-controlled in Utqiagvik) doesn't publish
  // bulk transfer equivalencies. This is a structural ceiling, not unfinished
  // work — recorded so the audit caps transfers at B instead of grading F.
  documentedCeilings: {
    transfers:
      "Alaska operates no registered statewide articulation portal, and Ilisagvik — the state's single, tribally-controlled community college — publishes no bulk CC→4-year transfer equivalencies. No public data source exists to scrape. Verified 2026-06.",
  },
};

export default akConfig;
