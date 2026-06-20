import type { StateConfig } from "../registry";

// Per-college public class-search / schedule entry points. Harvested from the
// working scrapers in scripts/ar/ + data/state-health/fingerprint-baseline.json
// and probed 2026-06-17 (HTTP 200 for curl with a browser UA, or known
// scraper-target where the host is firewalled from this network but live for
// students). Power BI report URLs land on the embedded Course Schedule report
// the UA System publishes for its CCs.
const REGISTRATION_URLS: Record<string, string> = {
  // Ellucian Colleague Self-Service guest course-search (same hosts the
  // scrapers use).
  "black-river-technical-college":
    "https://selfservice.blackrivertech.org/Student/Courses",
  "north-arkansas-college": "https://my.northark.edu/Student/Courses",
  "southeast-arkansas-college": "https://p2.seark.edu:8443/Student/Courses",
  // Jenzabar ICS course-search portlet (public). Cert is self-signed at the
  // edge but the page renders in a normal browser.
  "east-arkansas-community-college":
    "https://my.eacc.edu/ICS/Course_Search.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search&screenType=next",
  // NWACC's only public surface is the JSON master schedule feed the scraper
  // reads (the human-facing schedule page is behind My.NWACC SSO). Send the
  // student to nwacc.edu/students for the next step in registration.
  "northwest-arkansas-community-college":
    "https://www.nwacc.edu/students/",
  // ColdFusion public schedule form (curl 403 from bots, 200 in a real browser).
  "ozarka-college": "https://www.ozarka.edu/academics/class-schedule/",
  // Per-term PDF schedules live on this page.
  "national-park-college":
    "https://www.np.edu/admissions-aid/registration/",
  // University of Arkansas System publishes each of its CCs' live schedules
  // as an embedded Power BI report — these are the public, unauthenticated
  // /view share URLs the scraper reads.
  "cossatot-community-college-of-the-university-of-arkansas":
    "https://app.powerbi.com/view?r=eyJrIjoiOTliODM5NDUtZDUwMy00OGZjLWFjMzItMTFmYTk1YTRhZTM1IiwidCI6ImM2NTExYjkyLTU3NmMtNGNkYy05MTdmLWY0ZTAyZWQ1ZDRjMCJ9",
  "university-of-arkansas-community-college-batesville":
    "https://app.powerbi.com/view?r=eyJrIjoiNDNiZmYwYTktODM4Yi00NDAyLWE2OWMtNjIyOGFiNTY3ZDI1IiwidCI6IjhjMWE4N2NiLTgwYjctNDEzZi05YWU4LTU1YzZhNTM3MDYwNCJ9",
  "university-of-arkansas-community-college-rich-mountain":
    "https://app.powerbi.com/view?r=eyJrIjoiOTM3ODZmMTAtZjBlZi00MTZhLWEyNTgtNjBlOTFiY2YyYjJkIiwidCI6IjhjMWE4N2NiLTgwYjctNDEzZi05YWU4LTU1YzZhNTM3MDYwNCJ9",
  "phillips-community-college-of-the-university-of-arkansas":
    "https://app.powerbi.com/view?r=eyJrIjoiMjFlNmU3NTItODYxNi00Mjk2LTg3MmEtOTM5ZWNkYWM0ODFiIiwidCI6IjhjMWE4N2NiLTgwYjctNDEzZi05YWU4LTU1YzZhNTM3MDYwNCJ9",
  // UACCM publishes only an 8-page PDF schedule; link the PDF directly.
  "university-of-arkansas-community-college-morrilton":
    "https://www.uaccm.edu/courses/crssch.pdf",
};

// Honest fallback for the colleges with no public class search (ANC + SouthArk
// JICS schedules are auth-gated — see documentedCeilings). Sourced from
// data/ar/scorecard/*.json schoolUrl. Never adhe.edu per college — ADHE is
// the state oversight agency, useless for student registration.
const COLLEGE_HOMEPAGES: Record<string, string> = {
  "arkansas-northeastern-college": "https://www.anc.edu/",
  "south-arkansas-college": "https://www.southark.edu/",
};

const arCollegeUrl = (collegeSlug: string): string =>
  REGISTRATION_URLS[collegeSlug] ??
  COLLEGE_HOMEPAGES[collegeSlug] ??
  "https://adhe.edu/";

const arConfig: StateConfig = {
  slug: "ar",
  name: "Arkansas",
  systemName: "Public 2-year",
  systemFullName: "Arkansas Public 2-year Colleges",
  // Arkansas has no single community college system. Oversight comes from
  // the Arkansas Division of Higher Education (ADHE), which also operates
  // ACTS (the statewide course-transfer common-numbering system). Several
  // AR community colleges are affiliated with the University of Arkansas
  // System (UACC-Batesville, -Hope, -Morrilton, -Rich Mountain, Phillips
  // CC, Cossatot, UAPTC); the rest are independent.
  systemUrl: "https://adhe.edu/",
  collegeCount: 14,
  seniorWaiver: {
    ageThreshold: 60,
    legalCitation: "Ark. Code § 6-60-204",
    description:
      "Arkansas residents aged 60 and older may enroll in credit courses at any Arkansas state-supported institution of higher education, including community colleges, with tuition waived on a space-available basis. Fees may still apply.",
    bannerTitle: "Arkansas Senior Citizens' Tuition Waiver",
    bannerSummary:
      "Over 60 in Arkansas? Tuition is waived at state-supported colleges on a space-available basis.",
    bannerDetail:
      "Under Ark. Code § 6-60-204, Arkansas residents aged 60+ may enroll tuition-free in credit courses at any state-supported institution of higher education on a space-available basis. Fees, books, and other charges still apply. Contact the registrar at your college for the enrollment process.",
  },

  transferSupported: true,
  popularCourses: ["ENGL 1013", "PSYC 2003", "ENGL 1023", "MATH 1203", "BIOL 1544", "PLSC 2003"],
  defaultZip: "72201",
  defaultZipCity: "Little Rock",

  courseDiscoveryUrl: (collegeSlug: string, _prefix: string, _number: string) =>
    arCollegeUrl(collegeSlug),

  collegeCoursesUrl: (collegeSlug: string) => arCollegeUrl(collegeSlug),

  branding: {
    siteName: "Community College Path Arkansas",
    tagline: "Search course schedules across Arkansas's 14 community colleges.",
    footerText: "Community College Path Arkansas — Find courses across all 14 Arkansas community colleges.",
    disclaimer: "This is an independent project and is not affiliated with, endorsed by, or sponsored by Arkansas's community colleges, the Arkansas Division of Higher Education (ADHE), or the ACTS Course Transfer System.",
    metaKeywords: [
      "Arkansas community college courses",
      "Arkansas course search",
      "NWACC NorthWest Arkansas community college",
      "UACC Batesville Hope Morrilton Rich Mountain",
      "ACTS Arkansas Course Transfer System",
    ],
  },
  scrapers: {
    courses: [
      { scripts: ["scripts/ar/scrape-colleague.ts"], runner: "playwright" },
      { scripts: ["scripts/ar/scrape-nwacc.ts"], runner: "http" },
      { scripts: ["scripts/ar/scrape-eacc.ts"], runner: "playwright" },
      { scripts: ["scripts/ar/scrape-ozarka.ts"], runner: "http" },
      { scripts: ["scripts/ar/scrape-npc.ts"], runner: "http" },
      { scripts: ["scripts/ar/scrape-ua-powerbi.ts"], runner: "playwright" },
      // UACCM (Morrilton) doesn't expose Power BI / Banner / Colleague /
      // Workday. The only public schedule is an 8-page PDF at
      // uaccm.edu/courses/crssch.pdf; parsed via `pdftotext -layout`
      // (requires poppler-utils on the runner).
      { scripts: ["scripts/ar/scrape-uaccm.ts"], runner: "http" },
    ],
    // AR's ACTS (Arkansas Course Transfer System) statewide portal at
    // acts.adhe.edu is firewalled from most cloud egress IPs. Workaround:
    // each AR public university publishes its ACTS-equivalency table as a
    // static HTML catalog page (no captcha, no auth). The aggregator pulls
    // 3 master tables (ATU, UAF, UCA) directly — fast, no Playwright.
    //
    // Because Act 747 of 2011 mandates ACTS common course numbers across
    // all AR public colleges, one mapping per (ACTS course × receiver)
    // covers all 22 AR community colleges with no per-CC variation.
    //
    // Follow-ups: UALR/UAFS/UAPB/SAU need per-course Acalog harvest;
    // ASU-Jonesboro/HSU have interactive portals (Playwright); UAM has
    // no public ACTS page.
    transfers: [
      { scripts: ["scripts/ar/scrape-transfer-acts-catalogs.ts"], runner: "http" },
      // ASU-Jonesboro publishes a clean JSON API at asutep.astate.edu/server/
      // (action dispatcher; no auth, no CAPTCHA). One scraper, all AR sending
      // CCs, ~14K mappings. Same flow could in principle work from a residential
      // IP for other universities, but no other AR receiver exposes one.
      { scripts: ["scripts/ar/scrape-transfer-asu-jonesboro.ts"], runner: "http" },
    ],
    // Prereqs aggregated from course-search prerequisite_text (data/ar/prereqs.json,
    // 413 parsed chains). No dedicated catalog scraper; refreshed from committed courses.
    prereqs: { source: "aggregate-from-courses" },
    // Programs scraper currently covers 2 of 14 AR colleges (NPC + Northark
    // via Acalog). Remaining catalogs are mixed (PDF-only, bespoke HTML,
    // 403-blocked Acalog at NWACC). Follow-ups documented in the scraper
    // header.
    programs: [
      { scripts: ["scripts/ar/scrape-programs.ts"], runner: "http" },
      // SEARK: PDF catalog parser — requires pdftotext (poppler-utils).
      // Produces 43 programs (AAS/TC/CP/AA/AGS/CGS/AAT) from the 148-page
      // 2025-2026 SEARK catalog PDF at seark.edu.
      { scripts: ["scripts/ar/scrape-seark-pdf-programs.ts"], runner: "http" },
    ],
  },
  documentedCeilings: {
    // HSU (Henderson State) operates its transfer-equivalency tool at
    // tcet.hsu.edu behind an Azure AD Application Proxy. Unauthenticated
    // requests get HTTP 500 from the proxy connector before the underlying
    // app sees them. UAPB (Pine Bluff) was the original ACTS aux page
    // (acts_information.aspx) but that URL is now 404; UAPB publishes no
    // public per-course mapping anywhere on uapb.edu. Both would require
    // registrar contact or staff credentials to close.
    transfers:
      "HSU (Henderson State, tcet.hsu.edu) sits behind Azure AD App Proxy — 500 to anonymous; UAPB (Pine Bluff) has no public per-course ACTS table. Both require registrar contact to close. The other 7 AR public 4-years are covered via ATU/UAF/UCA master tables, the UALR/UAFS/SAU/UAM Acalog harvest, and the ASU-Jonesboro JSON API.",
    courses: [
      {
        collegeSlug: "arkansas-northeastern-college",
        reason: "ANC's class schedule lives in Jenzabar JICS at myanc.anc.edu/ICS/Course_Schedules.jnz. The portlet is configured to require authentication; anonymous requests get the JICS login shell, not section data. No bypass without credentials. Verified 2026-05-25.",
      },
      {
        collegeSlug: "south-arkansas-college",
        reason: "SouthArk's class schedule lives in Jenzabar JICS at mycampus.southark.edu/ICS/Course_Schedules.jnz. Same auth-gated configuration as ANC — no public guest endpoint. Verified 2026-05-25.",
      },
    ],
  },
};

export default arConfig;
