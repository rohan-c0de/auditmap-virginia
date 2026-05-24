import type { StateConfig } from "../registry";

const alConfig: StateConfig = {
  slug: "al",
  name: "Alabama",
  systemName: "ACCS",
  systemFullName: "Alabama Community College System",
  systemUrl: "https://www.accs.edu/",
  collegeCount: 23,

  // Ala. Code § 16-60-114 — ACCS Senior Adult Scholarship Program.
  // Alabama residents aged 60 and older may enroll in credit courses at
  // any ACCS institution with tuition waived, on a space-available basis.
  // Each course tuition is waived only once; repeating the course means
  // paying full tuition. Fees, books, and other charges still apply.
  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "Ala. Code § 16-60-114",
    description:
      "Alabama residents aged 60 and older may enroll in credit courses at any Alabama Community College System (ACCS) institution with tuition waived, on a space-available basis. Each course's tuition is waived once per student; repeating the course incurs full tuition. Fees, books, and other charges still apply.",
    bannerTitle: "Alabama Senior Adult Scholarship Program",
    bannerSummary:
      "Over 60 in Alabama? ACCS credit courses may be tuition-free on a space-available basis.",
    bannerDetail:
      "Under the ACCS Senior Adult Scholarship Program (Ala. Code § 16-60-114), Alabama residents aged 60+ may enroll in credit courses at any of the 23 ACCS community and technical colleges with tuition waived. Seats are allocated after regular registration (space-available), and the waiver applies once per course — repeating the course means paying full tuition. Fees, books, and other charges are not waived. Contact your college's financial aid office for the application form.",
  },

  transferSupported: true,
  popularCourses: ["ENG 101", "MTH 100", "BIO 103", "PSY 200", "HIS 201", "ECO 231"],
  defaultZip: "35203",
  defaultZipCity: "Birmingham",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.accs.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.accs.edu/",

  branding: {
    siteName: "Community College Path Alabama",
    tagline: "Search ACCS courses across all 23 Alabama community and technical colleges.",
    footerText: "Community College Path Alabama — Find courses across all 23 ACCS colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Alabama Community College System (ACCS).",
    metaKeywords: [
      "Alabama community college courses",
      "ACCS course search",
      "Alabama Community College System",
    ],
  },
  scrapers: {
    courses: [
      // Most ACCS colleges run on a shared Banner 8 host at
      // ssb-prod.ec.accs.edu/PROD/<CODE>/bwckschd.p_disp_dyn_sched
      // (one path per college, e.g. /PROD/JSCC for Jefferson State).
      // scripts/al/scrape-accs-banner8.ts wraps the shared Banner 8
      // template with a HOSTS map for 19 of the 23 ACCS colleges.
      {
        scripts: ["scripts/al/scrape-accs-banner8.ts"],
        runner: "http",
      },
      // OneACCS Banner SSB 9 — 4 ACCS colleges that migrated to the
      // newer multi-tenant Banner SSB 9 at reg-prod.ec.accs.edu,
      // distinguished by mepCode (not by URL path). These colleges'
      // codes collide with the Banner 8 path codes for OTHER colleges
      // (e.g. CACC on Banner 8 = Coastal Alabama, but mepCode=CACC on
      // OneACCS = Central Alabama), so the two scrapers are necessarily
      // separate.
      {
        scripts: ["scripts/al/scrape-accs-banner-ssb9.ts"],
        runner: "http",
      },
    ],
    // STARS was rebranded to "Alabama Transfers" at alabamatransfers.com,
    // backed by a CraftCMS GraphQL API at admin.alabamatransfers.com/api.
    // scrape-transfer-stars.ts walks the 276 AGSC master courses, each
    // of which has a courseEquivalencyTable mapping it to ~14 receiving
    // universities. We cross-product against all 23 AL CCs (AGSC course
    // codes are statewide — a given prefix+number means the same course
    // at every AL CC that offers it) to produce ~86K equivalency records.
    transfers: [
      { scripts: ["scripts/al/scrape-transfer-stars.ts"], runner: "http" },
    ],
    // OneACCS Banner SSB 9 sections come with inline prereq text
    // (~12% of AL sections carry it today; the rest come from the older
    // ssb-prod.ec.accs.edu Banner 8 cluster which doesn't expose
    // prereqs). The aggregator scans every section's prerequisite_text
    // / prerequisite_courses fields and flattens them into a single
    // data/al/prereqs.json keyed by course code.
    prereqs: { source: "aggregate-from-courses" },
    // manual-only: programs — Phase 5+.
  },
};

export default alConfig;
