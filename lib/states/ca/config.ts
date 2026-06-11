import type { StateConfig } from "../registry";

const caConfig: StateConfig = {
  slug: "ca",
  name: "California",
  systemName: "California CCs",
  systemFullName: "California Community Colleges",
  systemUrl: "https://www.cccco.edu/",
  collegeCount: 117,

  // California does not have a single statewide senior-waiver statute; many
  // districts offer their own audit / senior-adult policies under Education
  // Code §§ 76300, 84810.5. Leaving null until per-college policies are
  // surveyed.
  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "Cal. Ed. Code § 76300 (district-level authority)",
    description:
      "California has no statewide senior-tuition statute. The California Community Colleges enrollment fee is set under Ed. Code § 76300, and individual districts may waive or reduce it for residents 60+ — terms (age, fees, eligibility) vary by district.",
    bannerTitle: "California Senior Tuition Discounts (by district)",
    bannerSummary:
      "Over 60 in California? Most community college districts offer senior tuition waivers or discounts — terms vary by district.",
    bannerDetail:
      "California has no statewide senior-tuition statute. Cal. Ed. Code § 76300 sets the standard enrollment fee, and individual community college districts may waive or reduce it for residents 60+ on a space-available basis. Some districts cover only the enrollment fee; others include health, parking, and other fees. Contact the financial aid or registrar office at your college for the specific terms.",
  },

  transferSupported: true,
  popularCourses: ["ENGL C1000", "COMM C1000", "STAT C1000", "ENGL C1001", "PSYC C1000", "POLS C1000"],
  defaultZip: "90029",
  defaultZipCity: "Los Angeles",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.cccco.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.cccco.edu/",

  branding: {
    siteName: "Community College Path California",
    tagline: "Search California community college courses across all 117 colleges.",
    footerText: "Community College Path California — Find courses across all 117 California community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the California Community Colleges Chancellor's Office.",
    metaKeywords: [
      "California community college courses",
      "California community college course search",
      "California Community Colleges",
      "CCC course search",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/ca/scrape-banner-ssb.ts"], runner: "http" },
      { scripts: ["scripts/ca/scrape-colleague.ts"], runner: "playwright" },
      // LACCD cluster: one bespoke scraper covers all 9 Los Angeles CC District
      // colleges via shared PS Community Access (mycollege-guest.laccd.edu).
      { scripts: ["scripts/ca/scrape-laccd.ts"], runner: "playwright" },
      // De Anza College (Foothill-De Anza CCD). The combined FHDA portal is
      // SSO-gated, but each campus publishes a public schedule on its own
      // domain — De Anza at deanza.edu/schedule/listings.html.
      { scripts: ["scripts/ca/scrape-deanza.ts"], runner: "http" },
      // Los Rios CCD cluster: four colleges (ARC, CRC, SCC, FLC) share a
      // centralized API at hub.losrios.edu/classSearch. One scraper fetches all
      // four via per-college schedule page discovery.
      { scripts: ["scripts/ca/scrape-losrios.ts"], runner: "http" },
      // San Diego CCD cluster: three credit colleges (City, Mesa, Miramar)
      // share the public mws-api.sdccd.edu endpoint. One call per term
      // returns every section across the district; CAMPUS field routes the
      // row to its college. Continuing-ed (sdcce.edu, career=ce) excluded.
      { scripts: ["scripts/ca/scrape-sdccd.ts"], runner: "http" },
      // Peralta CCD cluster: four colleges (Berkeley City, Alameda, Laney,
      // Merritt) share a HubSpot HubDB-backed React class search. Public
      // GraphQL endpoint at <college>.edu/_hcms/api/searchFilterGraphql
      // returns the district's full classes collection; CAMPUS field routes
      // rows to their college. Peralta's PeopleSoft is SSO-gated (Oracle
      // Identity Cloud) so this is the only public source.
      { scripts: ["scripts/ca/scrape-peralta.ts"], runner: "http" },
      // Contra Costa CCD cluster: three colleges (Contra Costa, Diablo Valley,
      // Los Medanos) share the district's ASP.NET WebForms search at
      // webapps.4cd.edu/apps/courseschedulesearch/search-course.aspx. The
      // scraper paginates via __doPostBack + VIEWSTATE; one (college, term)
      // takes ~30s–5min depending on size.
      { scripts: ["scripts/ca/scrape-4cd.ts"], runner: "http" },
      // West Hills CCD cluster: two colleges (Coalinga, Lemoore) share a
      // single Colleague-powered schedule page at classweb.westhillscollege.com
      // /schedule/. One GET returns every section across both colleges in an
      // HTML table; the College column distinguishes campuses.
      { scripts: ["scripts/ca/scrape-westhills.ts"], runner: "http" },
      // West Valley-Mission CCD: two colleges (Mission, West Valley) publish
      // full schedule as static JSON at schedule.wvm.edu/data/{term}/. Four
      // files per term (courses, crns, ssrmeet, section-instructors) provide
      // complete section data including seats, meeting times, and instructors.
      { scripts: ["scripts/ca/scrape-wvm.ts"], runner: "http" },
      // --- CA course-coverage expansion (2026-06) -------------------------
      // SMCCCD / CLPCCD / Kern CCD: each is one shared public Banner SSB 9
      // instance serving several colleges; bucketed to each college by
      // campusDescription (Skyline/Canada/CSM; Chabot/Las Positas; BC/
      // Porterville/CC).
      { scripts: ["scripts/ca/scrape-banner-cluster.ts"], runner: "http" },
      // Riverside CCD (RCC, Moreno Valley, Norco): one public SharePoint
      // OData backend (apps-studentrcc.msappproxy.net), one list per college.
      { scripts: ["scripts/ca/scrape-rccd.ts"], runner: "http" },
      // South Orange County CCD (Saddleback, Irvine Valley): shared public
      // "SmartSchedule" guest-JWT JSON API (classesapi.socccd.edu).
      { scripts: ["scripts/ca/scrape-socccd.ts"], runner: "http" },
      // San Bernardino CCD (Crafton Hills, San Bernardino Valley): shared
      // Colleague SearchAsync endpoint; split by LocationCode (CHC / SBVC).
      { scripts: ["scripts/ca/scrape-sbccd.ts"], runner: "http" },
      // Yosemite CCD (Modesto JC, Columbia): per-college public ASP.NET
      // WebForms class-search apps at myapps.yosemite.edu.
      { scripts: ["scripts/ca/scrape-yosemite.ts"], runner: "http" },
      // San Joaquin Delta College: unauthenticated CollegeScheduler GraphQL.
      { scripts: ["scripts/ca/scrape-delta.ts"], runner: "http" },
      // Imperial Valley College: public Laravel/Livewire schedule page.
      { scripts: ["scripts/ca/scrape-imperial.ts"], runner: "http" },
      // City College of San Francisco: public Drupal Views course schedule.
      { scripts: ["scripts/ca/scrape-ccsf.ts"], runner: "http" },
      // Cerritos College: bespoke public "Schedule+" CGI app.
      { scripts: ["scripts/ca/scrape-cerritos.ts"], runner: "http" },
      // College of Marin: public ASP.NET WebForms schedule search.
      { scripts: ["scripts/ca/scrape-marin.ts"], runner: "http" },
      // Mt. San Jacinto, Mendocino, Santiago Canyon: Colleague variants the
      // standard template can't drive (/css context, SearchAsync, shared host).
      { scripts: ["scripts/ca/scrape-colleague-variants.ts"], runner: "http" },
      // Long Beach City College: PeopleSoft "Viking" public guest class search.
      { scripts: ["scripts/ca/scrape-lbcc.ts"], runner: "playwright" },
      // College of the Redwoods: legacy WebAdvisor guest "Search for Classes".
      { scripts: ["scripts/ca/scrape-redwoods.ts"], runner: "playwright" },
      // Santa Barbara City College: public Banner ORDS pw_pub_sched package.
      { scripts: ["scripts/ca/scrape-sbcc.ts"], runner: "http" },
      // College of the Canyons (Santa Clarita CCD): public Colleague Self-
      // Service; bespoke term discovery (standard term endpoint returns empty).
      { scripts: ["scripts/ca/scrape-canyons.ts"], runner: "http" },
      // Santa Monica College: public Oracle APEX "Online Class List" (app 373),
      // driven with Playwright; units come from the per-term catalog HTML.
      { scripts: ["scripts/ca/scrape-smc.ts"], runner: "playwright" },
    ],
    prereqs: { source: "aggregate-from-courses" },
    transfers: [
      // ASSIST.org — XSRF-protected REST API. v1 covers system-level UCTCA +
      // CSUTC transferability lists (~145K mappings across 114 CCs). Per-major
      // course-by-course articulation is a future v2 enhancement.
      { scripts: ["scripts/ca/scrape-transfer-assist.ts"], runner: "http" },
      // ASSIST.org per-receiver coverage map — Phase A only. Indexes which
      // major-level transfer agreements exist for each (CC × receiving
      // institution) pair across all 63 UC / CSU / independent receivers.
      // Output: data/ca/transfer-coverage.json. Phase B (per-major detail
      // fetch) is intentionally NOT wired here because the ASSIST
      // articulation-detail endpoint rate-limits aggressively (see
      // scrape-assist-receivers.ts:phaseB header note).
      // manual-only: monthly cadence; ~5 min runtime; coverage is stable
      // across an academic year (ID 76 = 2025-26).
      { scripts: ["scripts/ca/scrape-assist-receivers.ts"], runner: "http" },
    ],
    programs: [
      // 14 CCs across 4 template-based catalog platforms (CourseLeaf 14,
      // Acalog 2, SCIQ 2, Coursedog 3). Wrapped scrape-template-programs.ts
      // reuses scripts/lib/scrape-{platform}-programs.ts shared templates.
      // eLumen (30 CCs) and Curricunet (20 CCs) deferred to follow-up PRs
      // (both are SPAs requiring new Playwright-based templates).
      { scripts: ["scripts/ca/scrape-template-programs.ts"], runner: "playwright" },
    ],
  },
  documentedCeilings: {
    courses: [
      {
        collegeSlug: "taft-college",
        reason:
          "Class search is behind PortalGuard SAML SSO (portalguard.taftcollege.edu) plus a Fastly bot-challenge; Banner app servers are campus-firewalled. Only a static SmartCatalog and term PDFs are public.",
      },
      {
        collegeSlug: "glendale-community-college",
        reason:
          "PeopleSoft Campus Solutions (psprd.glendale.edu) and Banner SSB both redirect to PortalGuard/SAML SSO; no COMMUNITY_ACCESS guest node and no CollegeScheduler instance.",
      },
      {
        collegeSlug: "copper-mountain-community-college",
        reason:
          "Colleague Student Planning sits behind Duo SAML SSO (experience.elluciancloud.com); ss.cmccd.edu is firewalled. Only static PDF schedules are public.",
      },
      {
        collegeSlug: "palomar-college",
        reason:
          "PeopleSoft + HighPoint CX (my.palomar.edu) -- every class-search path redirects to cmd=login; no public schedule subdomain or CollegeScheduler instance.",
      },
      {
        collegeSlug: "miracosta-college",
        reason:
          "PeopleSoft SURF (surf.miracosta.edu) -- all class-search nodes redirect to okta.miracosta.edu SSO; only PDF schedules are public.",
      },
      {
        collegeSlug: "california-indian-nations-college",
        reason:
          "SIS is Populi (cincollege.populiweb.com), login-only; the marketing site is CAPTCHA-walled. No public catalog or section endpoint.",
      },
      {
        collegeSlug: "los-angeles-county-college-of-nursing-and-allied-health",
        reason:
          "County-run cohort RN program (dhs.lacounty.gov); no online class-search SIS exists -- only consumer-info pages.",
      },
    ],
  },
};

export default caConfig;
