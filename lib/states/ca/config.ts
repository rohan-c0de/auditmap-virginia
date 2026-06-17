import type { StateConfig } from "../registry";

// California has no statewide SIS — every district runs its own class search.
// These are per-college public class-search / registration entry points,
// harvested from the working scrapers in scripts/ca/ and probed 2026-06-17
// (HTTP 200 for curl with a browser UA or verified in real headless Chromium).

const BANNER_PATH =
  "/StudentRegistrationSsb/ssb/classSearch/classSearch";
const COLLEAGUE_PATH = "/Student/Courses";

// LACCD PeopleSoft guest class search (covers all 9 LA CC District colleges).
const LACCD_CLASS_SEARCH =
  "https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL";
// Los Rios CCD shared class-search portal (4 colleges).
// hub.losrios.edu/classSearch is the API backend (500 to browsers);
// losrios.edu/class-search is the student-facing page.
const LOSRIOS_CLASS_SEARCH = "https://losrios.edu/class-search";
// SDCCD shared class-search page (3 colleges).
const SDCCD_CLASS_SEARCH =
  "https://www.sdccd.edu/students/class-search/search.html";
// Contra Costa CCD (4CD) shared course-schedule search (3 colleges).
const FOURCD_CLASS_SEARCH =
  "https://webapps.4cd.edu/apps/courseschedulesearch/search-course.aspx";
// West Hills CCD shared schedule (2 colleges).
const WESTHILLS_SCHEDULE =
  "https://classweb.westhillscollege.com/schedule/";
// West Valley-Mission CCD shared schedule (2 colleges).
const WVM_SCHEDULE = "https://schedule.wvm.edu/";
// South Orange County CCD shared class search (2 colleges).
const SOCCCD_CLASS_SEARCH = "https://classes.socccd.edu/";

const REGISTRATION_URLS: Record<string, string> = {
  // --- Banner SSB 9 (single-college instances) ---
  "allan-hancock-college": `https://ssb.hancockcollege.edu${BANNER_PATH}`,
  "antelope-valley-community-college-district": `https://ssb.avc.edu${BANNER_PATH}`,
  "barstow-community-college": `https://ssbprod2.barstow.edu:8443${BANNER_PATH}`,
  "citrus-college": `https://ssb.citruscollege.edu${BANNER_PATH}`,
  "college-of-the-sequoias": `https://banweb.cos.edu${BANNER_PATH}`,
  "college-of-the-siskiyous": `https://reg-prod.cloud.siskiyous.edu${BANNER_PATH}`,
  "compton-college": `https://cmptn-prod-pxes02.banner.elluciancloud.com:8090${BANNER_PATH}`,
  "cuesta-college": `https://ssb2.cuesta.edu${BANNER_PATH}`,
  "feather-river-community-college-district": `https://reg-prod.frc.elluciancloud.com:8118${BANNER_PATH}`,
  "gavilan-college": `https://reg-prod.ec.gavilan.edu${BANNER_PATH}`,
  "monterey-peninsula-college": `https://reg-prod.mpc.elluciancloud.com:8103${BANNER_PATH}`,
  "mt-san-antonio-college": `https://prodrg.mtsac.edu${BANNER_PATH}`,
  "pasadena-city-college": `https://reg-prod.ec.pasadena.edu${BANNER_PATH}`,
  "rio-hondo-college": `https://prod-ssb9-registration.riohondo.edu:8443${BANNER_PATH}`,
  "santa-rosa-junior-college": `https://reg-prod.santarosajc.elluciancloud.com:8103${BANNER_PATH}`,
  "sierra-college": `https://ss.oci.sierracollege.edu${BANNER_PATH}`,
  "solano-community-college": `https://ssb.solano.edu${BANNER_PATH}`,

  // --- Banner SSB 9 (Coast CCD — 3 colleges share one host) ---
  "coastline-community-college": `https://reg-prod.ec.cccd.edu${BANNER_PATH}`,
  "golden-west-college": `https://reg-prod.ec.cccd.edu${BANNER_PATH}`,
  "orange-coast-college": `https://reg-prod.ec.cccd.edu${BANNER_PATH}`,

  // --- Banner SSB 9 (NOCCCD — 2 colleges) ---
  "cypress-college": `https://ssb.nocccd.edu${BANNER_PATH}`,
  "fullerton-college": `https://ssb.nocccd.edu${BANNER_PATH}`,

  // --- Banner SSB 9 (Ventura CCD — 3 colleges) ---
  "moorpark-college": `https://ssb.vcccd.edu${BANNER_PATH}`,
  "oxnard-college": `https://ssb.vcccd.edu${BANNER_PATH}`,
  "ventura-college": `https://ssb.vcccd.edu${BANNER_PATH}`,

  // --- Banner SSB 9 (SMCCD cluster — 3 colleges) ---
  "canada-college": `https://phx-ban-apps.smccd.edu${BANNER_PATH}`,
  "college-of-san-mateo": `https://phx-ban-apps.smccd.edu${BANNER_PATH}`,
  "skyline-college": `https://phx-ban-apps.smccd.edu${BANNER_PATH}`,

  // --- Banner SSB 9 (CLPCCD cluster — 2 colleges) ---
  "chabot-college": `https://banssprod.clpccd.cc.ca.us${BANNER_PATH}`,
  "las-positas-college": `https://banssprod.clpccd.cc.ca.us${BANNER_PATH}`,

  // --- Banner SSB 9 (Kern CCD cluster — 3 colleges) ---
  "bakersfield-college": `https://reg-prod.ec.kccd.edu${BANNER_PATH}`,
  "cerro-coso-community-college": `https://reg-prod.ec.kccd.edu${BANNER_PATH}`,
  "porterville-college": `https://reg-prod.ec.kccd.edu${BANNER_PATH}`,

  // --- Colleague Self-Service (single-college instances) ---
  "butte-college": `https://selfservice.butte.edu${COLLEAGUE_PATH}`,
  "cabrillo-college": `https://cabrillo-ss.colleague.elluciancloud.com${COLLEAGUE_PATH}`,
  "chaffey-college": `https://colss-prod.ec.chaffey.edu${COLLEAGUE_PATH}`,
  "college-of-the-canyons": `https://selfservice.canyons.edu${COLLEAGUE_PATH}`,
  "college-of-the-desert": `https://ss.collegeofthedesert.edu${COLLEAGUE_PATH}`,
  "el-camino-community-college-district": `https://selfservice.elcamino.edu${COLLEAGUE_PATH}`,
  "hartnell-college": `https://stuserv.hartnell.edu${COLLEAGUE_PATH}`,
  "lake-tahoe-community-college": `https://ss.ltcc.edu:8183${COLLEAGUE_PATH}`,
  "lassen-community-college": `https://webadvisor.lassencollege.edu:8171${COLLEAGUE_PATH}`,
  "mendocino-college": `https://service.mendocino.edu${COLLEAGUE_PATH}`,
  "merced-college": `https://ss-prod.mccd.edu${COLLEAGUE_PATH}`,
  "mt-san-jacinto-community-college-district": `https://selfservice.msjc.edu/css${COLLEAGUE_PATH}`,
  "napa-valley-college": `https://colss-prod.ec.napavalley.edu${COLLEAGUE_PATH}`,
  "ohlone-college": `https://selfservice.ohlone.edu:8443${COLLEAGUE_PATH}`,
  "palo-verde-college": `https://prod-selfserv.paloverde.edu${COLLEAGUE_PATH}`,
  "shasta-college": `https://mysc.shastacollege.edu${COLLEAGUE_PATH}`,
  "southwestern-college": `https://collselfserv.swccd.edu${COLLEAGUE_PATH}`,
  "victor-valley-college": `https://vvc-ss.colleague.elluciancloud.com${COLLEAGUE_PATH}`,

  // --- Colleague Self-Service (GCCCD — 2 colleges) ---
  "cuyamaca-college": `https://selfservice.gcccd.edu${COLLEAGUE_PATH}`,
  "grossmont-college": `https://selfservice.gcccd.edu${COLLEAGUE_PATH}`,

  // --- Colleague Self-Service (SJECCD — 2 colleges) ---
  "evergreen-valley-college": `https://colss-prod.ec.sjeccd.edu${COLLEAGUE_PATH}`,
  "san-jose-city-college": `https://colss-prod.ec.sjeccd.edu${COLLEAGUE_PATH}`,

  // --- Colleague Self-Service (YCCD — 2 colleges) ---
  "woodland-community-college": `https://wcc-self-service.yccd.edu${COLLEAGUE_PATH}`,
  "yuba-college": `https://yc-self-service.yccd.edu${COLLEAGUE_PATH}`,

  // --- Colleague Self-Service (SCCCD — 4 colleges share one host) ---
  "clovis-community-college": `https://selfservice.scccd.edu${COLLEAGUE_PATH}`,
  "fresno-city-college": `https://selfservice.scccd.edu${COLLEAGUE_PATH}`,
  "madera-community-college": `https://selfservice.scccd.edu${COLLEAGUE_PATH}`,
  "reedley-college": `https://selfservice.scccd.edu${COLLEAGUE_PATH}`,

  // --- Colleague Self-Service (RSCCD — 2 colleges) ---
  "santa-ana-college": `https://colss-prod.cloud.rsccd.edu${COLLEAGUE_PATH}`,
  "santiago-canyon-college": `https://colss-prod.cloud.rsccd.edu${COLLEAGUE_PATH}`,

  // --- Colleague Self-Service (SBCCD — 2 colleges) ---
  "crafton-hills-college": `https://colss-prod.ec.sbccd.edu${COLLEAGUE_PATH}`,
  "san-bernardino-valley-college": `https://colss-prod.ec.sbccd.edu${COLLEAGUE_PATH}`,

  // --- LACCD (9 colleges share PeopleSoft guest class search) ---
  "east-los-angeles-college": LACCD_CLASS_SEARCH,
  "los-angeles-city-college": LACCD_CLASS_SEARCH,
  "los-angeles-harbor-college": LACCD_CLASS_SEARCH,
  "los-angeles-mission-college": LACCD_CLASS_SEARCH,
  "los-angeles-pierce-college": LACCD_CLASS_SEARCH,
  "los-angeles-southwest-college": LACCD_CLASS_SEARCH,
  "los-angeles-trade-technical-college": LACCD_CLASS_SEARCH,
  "los-angeles-valley-college": LACCD_CLASS_SEARCH,
  "west-los-angeles-college": LACCD_CLASS_SEARCH,

  // --- Los Rios CCD (4 colleges share one class-search portal) ---
  "american-river-college": LOSRIOS_CLASS_SEARCH,
  "cosumnes-river-college": LOSRIOS_CLASS_SEARCH,
  "folsom-lake-college": LOSRIOS_CLASS_SEARCH,
  "sacramento-city-college": LOSRIOS_CLASS_SEARCH,

  // --- SDCCD (3 colleges) ---
  "san-diego-city-college": SDCCD_CLASS_SEARCH,
  "san-diego-mesa-college": SDCCD_CLASS_SEARCH,
  "san-diego-miramar-college": SDCCD_CLASS_SEARCH,

  // --- 4CD / Contra Costa CCD (3 colleges) ---
  "contra-costa-college": FOURCD_CLASS_SEARCH,
  "diablo-valley-college": FOURCD_CLASS_SEARCH,
  "los-medanos-college": FOURCD_CLASS_SEARCH,

  // --- West Hills CCD (2 colleges) ---
  "coalinga-college": WESTHILLS_SCHEDULE,
  "lemoore-college": WESTHILLS_SCHEDULE,

  // --- West Valley-Mission CCD (2 colleges) ---
  "mission-college": WVM_SCHEDULE,
  "west-valley-college": WVM_SCHEDULE,

  // --- SOCCCD (2 colleges) ---
  "irvine-valley-college": SOCCCD_CLASS_SEARCH,
  "saddleback-college": SOCCCD_CLASS_SEARCH,

  // --- Yosemite CCD ---
  "columbia-college": "https://myapps.yosemite.edu/ccClassSearch/",
  "modesto-junior-college": "https://myapps.yosemite.edu/mjcClassSearch/",

  // --- Bespoke public class-search apps ---
  "cerritos-college": "https://secure.cerritos.edu/schedule/",
  "city-college-of-san-francisco": "https://www.ccsf.edu/courses",
  "college-of-marin": "https://netapps.marin.edu/Apps/Directory/ScheduleSearch.aspx",
  "college-of-the-redwoods":
    "https://webadvisor.redwoods.edu/WAPROD/WebAdvisor?TYPE=P&PID=ST-XWESTS12A&CONSTITUENCY=WBST",
  "de-anza-college": "https://deanza.edu/schedule/",
  "foothill-college": "https://foothill.edu/schedule/",
  "imperial-valley-college": "https://www.imperial.edu/student-news/index.html",
  "long-beach-city-college":
    "https://www.cs.lbcc.edu/psc/guest/EMPLOYEE/SA/c/LBC_SS0017.LBC_SS0017_LST_FL.GBL",
  "santa-barbara-city-college":
    "https://banner.sbcc.edu/ords/ssb/pw_pub_sched.p_search",
  "santa-monica-college": "https://www.smc.edu/searchclasses",
};

// Colleges whose scraper uses an API not suitable for students (Peralta
// HubSpot GraphQL, Riverside SharePoint OData, Delta CollegeScheduler API).
// Homepage is the honest fallback — still better than cccco.edu.
const COLLEGE_HOMEPAGES: Record<string, string> = {
  "berkeley-city-college": "https://www.berkeleycitycollege.edu/",
  "college-of-alameda": "https://alameda.edu/",
  "laney-college": "https://laney.edu/",
  "merritt-college": "https://www.merritt.edu/",
  "moreno-valley-college": "https://www.mvc.edu/",
  "norco-college": "https://www.norcocollege.edu/",
  "riverside-city-college": "https://www.rcc.edu/",
  "san-joaquin-delta-college": "https://www.deltacollege.edu/",
};

const collegeUrl = (collegeSlug: string): string =>
  REGISTRATION_URLS[collegeSlug] ??
  COLLEGE_HOMEPAGES[collegeSlug] ??
  "https://www.cccco.edu/";

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

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) =>
    collegeUrl(collegeSlug),

  collegeCoursesUrl: (collegeSlug: string) => collegeUrl(collegeSlug),

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
