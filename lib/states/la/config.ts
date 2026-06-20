import type { StateConfig } from "../registry";

const laConfig: StateConfig = {
  slug: "la",
  name: "Louisiana",
  systemName: "LCTCS",
  systemFullName: "Louisiana Community and Technical College System",
  systemUrl: "https://www.lctcs.edu/",
  collegeCount: 12,

  seniorWaiver: {
    ageThreshold: 55,
    legalCitation: "La. R.S. 17:1807",
    description:
      "Louisiana residents 55+ are exempt from tuition and registration fees at public colleges — including LCTCS community and technical colleges — plus a 50% textbook reduction (La. R.S. 17:1807). The benefit applies only to the extent the legislature appropriates funds (PRIME Fund), so availability can vary year to year; confirm with the college.",
    bannerTitle: "Louisiana Senior Tuition Exemption (55+)",
    bannerSummary:
      "55+ in Louisiana? State law exempts you from tuition and registration fees — subject to annual state funding.",
    bannerDetail:
      "Under La. R.S. 17:1807, Louisiana residents aged 55 and older are exempt from tuition and registration fees at any public college or university (including LCTCS community and technical colleges) and receive a 50% reduction on textbook costs, whether in person or online. The exemption applies only if and to the extent the legislature appropriates funds (via the PRIME Fund), with reimbursement to colleges capped at $200 per credit hour — so in practice availability can vary by year. Contact the registrar to confirm the current term's funding before enrolling.",
  },

  transferSupported: true,
  popularCourses: ["ENGL 1010", "MATH 1100", "BIOL 1010", "PSYC 2000", "HIST 1010"],
  defaultZip: "70806",
  defaultZipCity: "Baton Rouge",

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    "https://www.lctcs.edu/",

  collegeCoursesUrl: (_collegeSlug: string) =>
    "https://www.lctcs.edu/",

  branding: {
    siteName: "Community College Path Louisiana",
    tagline: "Search LCTCS courses across all 12 Louisiana community and technical colleges.",
    footerText: "Community College Path Louisiana — Find courses across all 12 LCTCS colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by the Louisiana Community and Technical College System (LCTCS).",
    metaKeywords: [
      "Louisiana community college courses",
      "LCTCS course search",
      "Louisiana Community and Technical College System",
    ],
  },
  scrapers: {
    courses: [
      // 11 of 12 LCTCS colleges expose course data on a shared Banner SSB 9
      // host at reg-prod.ec.lctcs.edu, distinguished by a mepCode query
      // param. Same Ellucian MEP pattern as Alabama's OneACCS. The 12th
      // member (Northshore Technical CC) uses Coursedog instead and is
      // deferred — see DEFERRED-scrapers commit on this branch.
      {
        scripts: ["scripts/la/scrape-lctcs-banner-ssb.ts"],
        runner: "http",
      },
      // Northshore Technical CC — the 12th LCTCS college, not on the
      // shared Banner SSB host. Coursedog catalog gives course metadata
      // + 23 prereqs; the aggregator merges into prereqs.json. No
      // section data is available publicly (LoLA SSO).
      {
        scripts: ["scripts/la/scrape-coursedog.ts"],
        runner: "playwright",
      },
    ],
    prereqs: { source: "aggregate-from-courses" },
    transfers: [
      // Louisiana Board of Regents publishes the statewide Master Course
      // Articulation Matrix as an annual Excel file at laregents.edu/matrix-
      // archive/. Most recent "Final Approved" version is AY 2021-2022.
      // Covers all 11 LCTCS senders × 16 LSU/UL/SU public-system receivers.
      { scripts: ["scripts/la/scrape-regents-matrix.ts"], runner: "http" },
    ],
    programs: [
      // LA colleges with public catalogs: Fletcher/SLCC/Delta/BRCC + Delgado/
      // Bossier (acalog, all behind AWS WAF → Playwright), Nunez (courseleaf,
      // /programs/), Northshore (coursedog), Sowela (smartcatalogiq). The four
      // Acalog catalogs return HTTP 202 + empty on plain fetch, so the scraper
      // drives headless Chromium — hence runner: "playwright".
      { scripts: ["scripts/la/scrape-programs.ts"], runner: "playwright" },
    ],
  },
  // Northshore Technical CC (12th LCTCS college) has no public section data:
  // it's the one LCTCS member not on the shared Banner SSB host, and its
  // sections sit behind LoLA SSO. The Coursedog catalog (already scraped) gives
  // course metadata + prereqs via the aggregator, but never sections — so it's
  // not surfaced as course coverage (no fake/section-less listings — invariant
  // #4). Recorded as a ceiling so the audit excuses it from the denominator.
  documentedCeilings: {
    courses: [
      {
        collegeSlug: "northshore-technical-community-college",
        reason:
          "Northshore Technical CC is the only LCTCS college not on the shared Banner SSB host (reg-prod.ec.lctcs.edu); its sections sit behind LoLA SSO with no public guest class search. Only the Coursedog catalog is reachable (course metadata + 23 prereqs, fed to the aggregator) — never sections. Verified 2026-06.",
      },
    ],
    programs:
      "Programs cover the 7 LCTCS colleges with parseable public catalogs (6 Acalog + Nunez CourseLeaf). The remaining 5 (verified 2026-06): northshore's Coursedog lists 29 programs but parses 0 usable requirement lists; sowela's SmartCatalogIQ catalog-year discovery fails; central-louisiana-tech / northwest-louisiana-tech / river-parishes return HTTP 500 with no alternate catalog host. See data/la/DEFERRED-programs.md.",
  },
};

export default laConfig;
