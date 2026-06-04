import type { StateConfig } from "../registry";

const akConfig: StateConfig = {
  slug: "ak",
  name: "Alaska",
  systemName: "Alaska CCs",
  systemFullName: "Alaska community colleges",
  systemUrl: "https://www.ilisagvik.edu/",
  collegeCount: 1,

  // Ilisagvik offers a North Slope Borough Elder Tuition Waiver: NSB
  // residents aged 62+ get tuition waived (fees, registration, textbooks
  // not covered). Statewide there is no Alaska CC senior statute reaching
  // Ilisagvik — AS 14.40.130's 60+ UA-system waiver doesn't bind this
  // tribally-controlled college. The Elder Waiver is the policy that
  // applies here. Source: ilisagvik.edu/become-a-student/tuition-waiver/
  seniorWaiver: {
    ageThreshold: 62,
    legalCitation: "Ilisagvik College — North Slope Borough Elder Tuition Waiver",
    description:
      "North Slope Borough residents aged 62+ qualify for a full tuition waiver at Ilisagvik College. Course fees, registration fees, textbooks, and lab kits are not covered. The waiver form must be submitted every semester before the withdrawal deadline.",
    bannerTitle: "Ilisagvik Elder Tuition Waiver (NSB Residents 62+)",
    bannerSummary:
      "62+ and a North Slope Borough resident? Ilisagvik waives tuition — re-apply each semester.",
    bannerDetail:
      "Ilisagvik College's North Slope Borough Elder Tuition Waiver covers tuition for NSB residents aged 62 or older. Students remain responsible for course fees, registration fees, textbooks, and lab kits. The waiver form must be completed and submitted before each semester's withdrawal deadline; contact Financial Aid at 907-852-1708 or fin.aid@ilisagvik.edu. Alaska has no statewide CC senior-tuition statute — the University of Alaska 60+ reduction under AS 14.40.130 applies to UA campuses, not to Ilisagvik.",
  },

  transferSupported: true,
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
    // Iḷisaġvik publishes its equivalencies to the University of Alaska
    // system in CollegeTransfer.Net's public OData API. Coverage is narrow
    // (one sending college → UAA) but real; scrape-transfer.ts keeps in-state
    // targets only.
    transfers: [{ scripts: ["scripts/ak/scrape-transfer.ts"], runner: "http" }],
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
