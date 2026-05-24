import type { StateConfig } from "../registry";

const txConfig: StateConfig = {
  slug: "tx",
  name: "Texas",
  systemName: "Texas Community Colleges",
  systemFullName: "Texas Public Community Colleges",
  // Texas has no single statewide CC system — 50 independent districts
  // overseen by the Texas Higher Education Coordinating Board. The Texas
  // Association of Community Colleges (TACC) is the closest thing to a
  // unified portal.
  systemUrl: "https://www.tacc.org/",
  collegeCount: 59,

  // Texas Education Code § 54.365 ("Tuition Exemption for Persons 65
  // Years of Age or Older") — Texas residents 65+ may take up to 6 credit
  // hours per semester at any state-funded institution tuition-free, on a
  // space-available basis. Each college applies the waiver on top of its
  // own registration timing.
  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "Tex. Educ. Code § 54.365",
    description:
      "Texas residents aged 65 and older may enroll in up to 6 credit hours per semester at any state-funded community college tuition-free, on a space-available basis. Fees may still apply; each college sets registration timing for senior space-available seats.",
    bannerTitle: "Texas Senior Tuition Exemption",
    bannerSummary:
      "Over 65 in Texas? Up to 6 credit hours per semester may be tuition-free at any state-funded college.",
    bannerDetail:
      "Texas Education Code § 54.365 lets Texas residents aged 65+ take up to 6 credit hours per semester at any state-funded community college without paying tuition, on a space-available basis. Fees still apply; seats are allocated after regular registration. Contact your college's registrar for the timing.",
  },

  transferSupported: false,
  popularCourses: [],
  defaultZip: "77002",
  defaultZipCity: "Houston",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.tacc.org/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.tacc.org/",

  branding: {
    siteName: "Community College Path Texas",
    tagline: "Search Texas community college courses across all 59 public colleges.",
    footerText: "Community College Path Texas — Find courses across all 59 Texas public community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Texas Higher Education Coordinating Board, the Texas Association of Community Colleges, or any Texas community college.",
    metaKeywords: [
      "Texas community college courses",
      "Texas community college schedule",
      "Texas community colleges",
      "Texas senior tuition exemption",
    ],
  },
  scrapers: {
    courses: [
      // Houston Community College runs PeopleSoft Fluid with an ICAJAX
      // class search behind a guest session. Driven by Playwright — sweeps
      // the keyword search to enumerate courses, then drills each course's
      // SSR_CS_WRAP_FL detail page to capture section rows (CRN, dates,
      // days/times, location, instructor, seats). Writes both the
      // section file (data/tx/courses/houston-community-college/{TERM}.json)
      // and a catalog dump (data/tx/coursedog-catalog/houston-community-college.json)
      // for prereq aggregation.
      {
        scripts: ["scripts/tx/scrape-hccs.ts"],
        runner: "playwright",
      },
      // Alamo Colleges District (San Antonio) — 5 colleges share one
      // public Banner SSB 9 instance at lum010.alamo.edu:8010 (the
      // aces.alamo.edu Banner is auth-gated; this lum010 host has guest
      // read-only access). Same pattern as IECC + UHCC: one Banner
      // session per term, split by campusDescription into 5 buckets.
      // Closes issue #456 cluster #2.
      {
        scripts: ["scripts/tx/scrape-alamo.ts"],
        runner: "http",
      },
      // Ellucian Colleague Self-Service — 2 colleges. The auto-add-state
      // fingerprinter only probed colleges' primary domains and missed
      // these subdomain SIS hosts:
      //   amarillo-college  → acselfservice.actx.edu
      //   odessa-college    → sserv.odessa.edu
      // Closes 2 of 3 remaining colleges from issue #456 cluster #8.
      // Kilgore (Jenzabar at accesskc.kilgore.edu) deferred to a
      // follow-up since its portlet URL isn't the standard
      // Course_Search.jnz pattern the template expects.
      {
        scripts: ["scripts/tx/scrape-colleague.ts"],
        runner: "playwright",
      },
      // Kilgore College — Jenzabar ICS Course Search portlet at
      // accesskc.kilgore.edu. Uses the ASP.NET WebForms variant
      // (pg0$V$ddlTerm, pg0$V$btnSearch) so the standard Jenzabar
      // template at scripts/lib/scrape-jenzabar.ts (which expects
      // #stuRegTermSelect) doesn't apply. Custom Playwright scraper
      // drives the form, paginates via the letter-chunk "Next page -->"
      // postback, and parses the results <table> directly.
      // Closes the final remaining college from issue #456 cluster #8.
      {
        scripts: ["scripts/tx/scrape-kilgore.ts"],
        runner: "playwright",
      },
      // Howard College + Southwest College for the Deaf share a single
      // Concourse Syllabus Management instance (Intellidemia) at
      // howardcollege.campusconcourse.com. One scraper covers both slugs;
      // the form's campus_id filter splits SW → swcd and BS/LA/SA/ON →
      // howard-college. HTTP-only — Concourse exposes paginated search
      // results as plain HTML, no auth, no JS required. Sparse data: no
      // CRN/seats/meeting times in the public listing (CRN synthesized
      // from Concourse's internal course_id; instructor IS available).
      {
        scripts: ["scripts/tx/scrape-howard.ts"],
        runner: "http",
      },
    ],
    // manual-only: transfers — Phase 3 (transfer-equiv) not yet wired up.
    // manual-only: prereqs — Phase 4.
    // manual-only: programs — Phase 5+.
  },
};

export default txConfig;
