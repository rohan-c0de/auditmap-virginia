import type { StateConfig } from "../registry";

const azConfig: StateConfig = {
  slug: "az",
  name: "Arizona",
  systemName: "Public 2-year",
  systemFullName: "Arizona Public 2-year Colleges",
  systemUrl: "",
  collegeCount: 21,

  // Arizona has no statewide senior-tuition statute analogous to NV's
  // NRS 396.540 or AL's § 16-60-114. ARS § 15-1444 gives each community
  // college district authority to set its own tuition policy, and most
  // districts (MCCCD, Pima, Cochise, etc.) offer some form of senior
  // discount — but the age threshold, fee structure, and eligibility
  // vary per district. The banner explains the patchwork.
  seniorWaiver: {
    ageThreshold: 65,
    legalCitation: "ARS § 15-1444 (district-level authority)",
    description:
      "Most Arizona community college districts offer tuition discounts to residents aged 65+ — typically space-available, sometimes free, sometimes reduced rate. Terms vary by district. Contact the registrar at your college for specifics.",
    bannerTitle: "Arizona Senior Tuition Discounts (by district)",
    bannerSummary:
      "Over 65 in Arizona? Most community college districts offer senior tuition discounts — terms vary by district.",
    bannerDetail:
      "Arizona has no statewide senior-tuition statute; ARS § 15-1444 lets each community college district set its own policy. In practice most districts (Maricopa, Pima, Cochise, Coconino, etc.) offer some combination of waived or reduced tuition for residents 65+ on a space-available basis. Some districts include fees, others don't. Contact your local college's registrar or financial aid office for the specific terms that apply.",
  },

  transferSupported: true,
  popularCourses: ["ENG 101", "PSY 101", "MAT 142", "BIO 201", "WRT 101", "ENG 102"],
  defaultZip: "85003",
  defaultZipCity: "Phoenix",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.example.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.example.edu/",

  branding: {
    siteName: "Community College Path Arizona",
    tagline: "Search course schedules across Arizona's 21 community colleges.",
    footerText: "Community College Path Arizona — Find courses across all 21 Arizona community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by Arizona's community college districts or AZTransfer.com.",
    metaKeywords: [
      "Arizona community college courses",
      "Arizona course search",
      "Maricopa Pima Cochise Coconino community college",
    ],
  },
  scrapers: {
    courses: [
      // Banner SSB 9 — Cochise, Pima, Coconino, Yavapai (4 colleges via shared template)
      { scripts: ["scripts/az/scrape-banner-ssb.ts"], runner: "http" },
      // Colleague Self-Service — Mohave (Ellucian Cloud) + Arizona Western
      // (self-hosted at colss-prod.ec.azwestern.edu).
      { scripts: ["scripts/az/scrape-colleague.ts"], runner: "playwright" },
      // Maricopa District (10 colleges via shared classes.sis.maricopa.edu)
      { scripts: ["scripts/az/scrape-maricopa.ts"], runner: "http" },
      // Diné College — PDF-only schedule (Microsoft Print To PDF output);
      // parsed via `pdftotext -layout`. Requires poppler-utils on the
      // runner (apt-get install -y poppler-utils, or `brew install poppler`).
      { scripts: ["scripts/az/scrape-dine.ts"], runner: "http" },
      // Jenzabar CMC Portal (ASP.NET WebForms) — Northland Pioneer +
      // Eastern Arizona. Both expose my.<domain>/CMCPortal/Common/
      // CourseSchedule.aspx with identical form structure; same template
      // as scripts/or/scrape-columbia-gorge.ts.
      { scripts: ["scripts/az/scrape-jenzabar-cmc.ts"], runner: "http" },
    ],
    // Inline prereq text harvested from every scraped section (19 of 21
    // AZ colleges covered: 4 Banner SSB + 2 Colleague + 10 Maricopa +
    // Diné + 2 Jenzabar CMC).
    prereqs: { source: "aggregate-from-courses" },
    // AZTransfer.com's Course Equivalency Guide (Apple WebObjects) is the
    // statewide articulation system. Scraper does DeptIndex per college →
    // ByInstDept per (college, subject) → one row per (CC course × ASU/NAU/UA).
    transfers: [
      { scripts: ["scripts/az/scrape-transfer-aztransfer.ts"], runner: "http" },
    ],
    // Programs: 4 Acalog catalogs (pima, yavapai, mohave, coconino) scraped via
    // search_advanced.php discovery (navoid auto-discovery finds 0 on these).
    // The Maricopa Coursedog catalog publishes no programs, and the other
    // Coursedog colleges (cochise/eastern-arizona/central-arizona) expose no
    // plannable requirements — see scripts/az/scrape-programs.ts for details.
    programs: [
      { scripts: ["scripts/az/scrape-programs.ts"], runner: "http" },
    ],
  },
  documentedCeilings: {
    courses: [
      {
        collegeSlug: "tohono-oodham-community-college",
        reason: "Tohono O'odham CC's Jenzabar JICS at my.tocc.edu/ICS/Course_Schedules.jnz requires SAML SSO login (StaticPages/SAML/ServiceProvider/Request.aspx redirect). No public guest endpoint. Verified 2026-05-24.",
      },
      {
        collegeSlug: "central-arizona-college",
        reason: "Central Arizona College has no public class-search system: catalog.centralaz.edu is the Acalog catalog only (course defs, no sections), and my.centralaz.edu / classes.centralaz.edu / schedule.centralaz.edu all return no DNS. The www.centralaz.edu registration page links only to a SAML-authed portal. Verified 2026-05-24.",
      },
    ],
  },
};

export default azConfig;
