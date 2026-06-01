import type { StateConfig } from "../registry";

const coConfig: StateConfig = {
  slug: "co",
  name: "Colorado",
  systemName: "CCCS",
  systemFullName: "Colorado Community College System",
  systemUrl: "https://cccs.edu/",
  collegeCount: 15,

  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "C.R.S. § 23-60-202 (State Board tuition authority); no statewide senior-tuition statute",
    description:
      "Colorado has no statewide senior-tuition statute. The State Board for Community Colleges and Occupational Education sets CCCS tuition, and each college sets its own senior policy — most commonly free or reduced-cost enrollment on a no-credit audit basis for residents 60+, space-available. Terms (age, fees, credit vs. audit) vary by college; confirm with the registrar.",
    bannerTitle: "Colorado Senior Tuition (by college)",
    bannerSummary:
      "Over 60 in Colorado? Many community colleges let seniors audit courses free or at reduced cost — terms vary by college.",
    bannerDetail:
      "Colorado has no statewide senior-tuition statute. Under the State Board for Community Colleges and Occupational Education (C.R.S. § 23-60-202), each CCCS college sets its own senior policy. In practice most colleges let residents 60+ enroll on a no-credit audit basis, free or at reduced cost, on a space-available basis after regular registration. Some exclude lab, computer, or special-equipment courses, and fees may still apply. Contact your college's registrar or financial aid office for the specific terms.",
  },

  transferSupported: true,
  popularCourses: ["ENG 121", "MAT 121", "BIO 111", "PSY 101", "HIS 121", "ECO 201"],
  defaultZip: "80202",
  defaultZipCity: "Denver",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://cccs.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://cccs.edu/",

  branding: {
    siteName: "Community College Path Colorado",
    tagline: "Search CCCS courses across all 15 Colorado community colleges.",
    footerText: "Community College Path Colorado — Find courses across all 15 CCCS colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Colorado Community College System (CCCS).",
    metaKeywords: [
      "Colorado community college courses",
      "CCCS course search",
      "Colorado Community College System",
    ],
  },
  scrapers: {
    courses: [
      // 13 CCCS colleges share a single Banner 8 host at
      // erpdnssb.cccs.edu/<CODE>/bwckschd.p_disp_dyn_sched (one path per
      // college, e.g. PRODACC for Arapahoe, PRODCCD for CCD). One scraper
      // covers the entire CCCS cluster.
      {
        scripts: ["scripts/co/scrape-cccs-banner8.ts"],
        runner: "http",
      },
      // Colorado Mountain College is the only standalone CO community
      // college outside CCCS; it runs Ellucian Colleague Self-Service at
      // selfservice.coloradomtn.edu with public guest access.
      {
        scripts: ["scripts/co/scrape-colleague.ts"],
        runner: "playwright",
      },
      // Aims Community College runs Workday Student. Its public class
      // schedule (schedule.aims.edu) is a React SPA backed by a Netlify
      // function that proxies a public Workday custom report — no SSO.
      // One HTTP scraper covers all Aims terms.
      {
        scripts: ["scripts/co/scrape-aims-workday.ts"],
        runner: "http",
      },
    ],
    // Transfers: only the University of Denver exposes a public, scrapeable
    // course-to-course articulation system (Banner bwcktart at
    // apps25.du.edu:8446 — ~336 CCCS→DU pairs). build-transfers.ts wraps it.
    // See documentedCeilings.transfers for why DU is the only public receiver.
    transfers: [
      {
        scripts: ["scripts/co/build-transfers.ts"],
        runner: "http",
      },
    ],
    // CCCS Banner 8 section descriptions carry no prerequisite text, so
    // aggregate-from-courses yields 0. Instead we scrape prerequisites from
    // the CCNS-shared catalogs: Red Rocks SmartCatalogIQ (rrcc) +
    // Community College of Denver CourseLeaf (catalog.ccd.edu). Because
    // Colorado uses statewide Common Course Numbering, a prereq keyed by
    // course code (e.g. BIO 2101) applies system-wide.
    prereqs: [
      {
        scripts: ["scripts/co/scrape-prereqs.ts"],
        runner: "http",
      },
    ],
    // manual-only: programs — Phase 6 (catalog discovery emitted a wrapper
    // at scripts/co/scrape-programs.ts but no catalogs matched a templated
    // platform; will be picked up when one of the CCCS Acalog/SmartCatalogIQ
    // / CleanCatalog catalogs gets a scraper).
  },
  documentedCeilings: {
    // Transfers cap at B: University of Denver is the ONLY Colorado receiver
    // with a public, scrapeable course-to-course articulation system (Banner
    // bwcktart, ~336 CCCS→DU pairs — shipped). Re-verified 2026-05-31 against
    // every major in-state receiver: CU Boulder/Denver and CSU/CSU-Pueblo are
    // Banner-9/PeopleSoft with no public bwcktart; UNC's Banner 8 is retired
    // and Banner 9 is SSO-gated; MSU Denver, Colorado Mesa, Western, Fort Lewis
    // gate everything behind SSO or Transferology (account required). UCCS and
    // MSU Denver publish only degree-plan advising PDFs (CCCS courses listed
    // with NO receiving course code) — not course-to-course equivalencies, so
    // they are intentionally excluded rather than shipped as same-code echoes.
    // CDHE GT Pathways is category-level (GT-CO1, etc.), not course-to-course.
    transfers:
      "University of Denver is the only CO receiver exposing public course-to-course articulation (Banner bwcktart). All other in-state receivers (CU, CSU, UNC, MSU Denver, UCCS, Colorado Mesa, Western, Fort Lewis) are SSO/Transferology-gated or publish only degree-plan advising sheets with no receiving course codes. Verified 2026-05-31.",
  },
};

export default coConfig;
