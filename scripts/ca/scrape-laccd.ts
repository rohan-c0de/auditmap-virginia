/**
 * scrape-laccd.ts — Los Angeles Community College District class search
 *
 * All 9 LACCD colleges share a single PeopleSoft instance with anonymous
 * "Community Access" class search at
 *   https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL
 *
 * Strategy:
 *   • One LACCD "Institution" + a "Campus" dropdown — but the Campus filter
 *     is silently ignored by LACCD's PS deployment (it accepts the value
 *     but does not narrow results). Instead, search by (Term, Subject)
 *     district-wide, then bucket each returned section by the prefix of
 *     its location string ("City-FH 214" → LACC, "EAST-Online" → ELAC, etc.).
 *   • PS shows a "would you like to continue?" modal for searches with
 *     >100 sections — auto-confirm via #ICSave.
 *   • PS hard-rejects searches with >400 sections ("will exceed the maximum
 *     limit of 400 sections"). For those subjects we subdivide by catalog
 *     number range (1-99, 100-199, 200+) and merge.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-laccd.ts --term "Fall 2026"
 *   npx tsx scripts/ca/scrape-laccd.ts --term "Spring 2026,Summer 2026,Fall 2026"
 *   npx tsx scripts/ca/scrape-laccd.ts --term "Fall 2026" --subject MATH
 *   npx tsx scripts/ca/scrape-laccd.ts --term "Fall 2026" --slug los-angeles-city-college
 *   npx tsx scripts/ca/scrape-laccd.ts --term "Fall 2026" --headed
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PS_URL =
  "https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL";

const NAV_TIMEOUT = 30_000;
const SEARCH_WAIT = 45_000;
const INTER_SEARCH_DELAY = 1200;
const MAX_RETRIES = 2;
const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses");

const TERM_CODES: Record<string, string> = {
  "Spring 2026": "2264",
  "Summer 2026": "2266",
  "Fall 2026":   "2268",
};

const TERM_FILE_CODES: Record<string, string> = {
  "Spring 2026": "2026SP",
  "Summer 2026": "2026SU",
  "Fall 2026":   "2026FA",
};

// LACCD location-prefix → community-college-path slug.
// Each section's MTG_ROOM field starts with a campus-code prefix
// ("City-FH 214", "EAST-Online", "Trade-Library", etc.).
const PREFIX_TO_SLUG: Array<[RegExp, string]> = [
  [/^City[-\s]/i,      "los-angeles-city-college"],
  [/^EAST[-\s]/i,      "east-los-angeles-college"],
  [/^Harbor[-\s]/i,    "los-angeles-harbor-college"],
  [/^Mission[-\s]/i,   "los-angeles-mission-college"],
  [/^Pierce[-\s]/i,    "los-angeles-pierce-college"],
  [/^Southwest[-\s]/i, "los-angeles-southwest-college"],
  [/^Trade[-\s]/i,     "los-angeles-trade-technical-college"],
  [/^Valley[-\s]/i,    "los-angeles-valley-college"],
  [/^West[-\s]/i,      "west-los-angeles-college"],
  // Lowercase / no-dash fallbacks
  [/^city/i,           "los-angeles-city-college"],
  [/^east/i,           "east-los-angeles-college"],
  [/^harbor/i,         "los-angeles-harbor-college"],
  [/^mission/i,        "los-angeles-mission-college"],
  [/^pierce/i,         "los-angeles-pierce-college"],
  [/^southwest/i,      "los-angeles-southwest-college"],
  [/^trade/i,          "los-angeles-trade-technical-college"],
  [/^valley/i,         "los-angeles-valley-college"],
  [/^west/i,           "west-los-angeles-college"],
];

const ALL_LACCD_SLUGS = Array.from(new Set(PREFIX_TO_SLUG.map(([_, s]) => s)));

// Superset of subject codes across the 9 LACCD colleges. Missing entries
// return 0 sections — harmless.
const LACCD_SUBJECTS = [
  "ACCTG", "ADM JUS", "ADMJUS", "AERO", "AFRO AM", "AFROAM", "AIRCT", "ANATOMY",
  "ANIMAL S", "ANTHRO", "AP ED", "APED", "ARABIC", "ARC", "ARCH", "ART",
  "ASIAN", "ASL", "ASL ENG", "ASTRO", "AT TECH", "AUTO BO", "AUTO TC",
  "AUTOBO", "AUTOTC", "AVIAT",
  "BAKING", "BIOLOGY", "BLDG CN", "BLDGCN", "BLUEPRG", "BRDCST", "BROADC", "BUS",
  "CAOT", "CARPN", "CD/ECE", "CH DEV", "CHDEV", "CHEM", "CHICANO",
  "CHIN", "CHINESE", "CINEMA", "CIS", "CISCO", "CJ", "CLD DEV", "CMNCT",
  "CO SCI", "COMM", "COMP DEV", "COMP SC", "CONS ED", "COOP ED", "CORR SC",
  "COSCI", "COSMET", "COUNSEL", "CSIT", "CULIN A", "CULINA", "CULIN", "CWE",
  "DANCE", "DANCEST", "DANCETC", "DENT AS", "DENTAS", "DESIGN", "DEV COM", "DEVCOM",
  "DI TECH", "DIETET", "DIST ED", "DRAFT", "DRAMA",
  "E S L", "EARTH", "EARTH S", "ECON", "EDUC", "EDUC TC", "EDUC AS", "EDUCTC",
  "ELEC TC", "ELECTR", "ELECTC", "ELECTRO", "ENG TC", "ENG", "ENGL", "ENGLISH",
  "ENV SCI", "ENV TC", "ENVR SC", "ENVRSC",
  "ESL", "ETH STD", "ETHN ST", "ETHST", "FAM CST", "FAM&CST", "FAMCST", "FAM CS",
  "FAMCS", "FAS DSN", "FASDSN",
  "FILM", "FIN", "FIRE TC", "FIRETC", "FRENCH", "FSHN", "FSHNTC",
  "GEN ENG", "GENENG", "GEO", "GEOG", "GEOL", "GERM",
  "GLOBAL", "GRAPHIC", "GRPHC", "GUID",
  "HEBREW", "HIST", "HLTH", "HRS", "HUM", "HUMAN",
  "IND ENG", "IND TC", "INDENG", "INDTC", "INTL",
  "ITALIAN", "ITAL",
  "JAPAN", "JAPNS", "JOURNAL", "JOUR",
  "KIN", "KIN MAJ", "KINAQ", "KINATH", "KINMAJ", "KORE",
  "LATIN", "LAW", "LBR/IR", "LEARN F", "LERN SK", "LIB SCI",
  "MARKET", "MATH", "MEDIA", "MEN DEV", "METAL T", "MICRO", "MICRO B",
  "MID EAS", "MKTG", "MULT D", "MUSIC",
  "NURSING", "NUR SCI", "NURSCI", "NUTRIT", "NUTR",
  "OCEANO", "OCEANTC", "OFF AD", "OFFADM", "OFFCOC",
  "PARALEG", "PE", "PE TC", "PERS DEV", "PERSDV", "PHIL", "PHILOS", "PHOTO",
  "PHY ED", "PHY SCI", "PHYSCS", "PHYSICS", "PHYSIO", "POLI SCI", "POLI",
  "POLISC", "POL SCI", "PORTUGUE", "PRINT",
  "PSYCH", "PUBLIC R", "PUBLREL",
  "QUAL CO",
  "READ", "READING", "REAL ES", "REC RE", "RECR", "RELIGN",
  "SCI MAJ", "SIGN LG", "SLAV",
  "SOC", "SOCIO", "SOC ST", "SP COM", "SPAN", "SPANISH", "SPCOM", "SPEECH",
  "STAT", "STATIS", "STDV", "STDY SK", "SUPV",
  "TEACHER", "TECHED", "THEAT", "THEATER", "TRAVEL",
  "URBAN ST", "URBNST",
  "VIET",
  "WELDING", "WELD", "WMN STD", "WMNSTD", "WMNS ST",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  location: string;
  campus: string;
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface ParsedTerm {
  termName: string;
  psTermCode: string;
  fileTermCode: string;
}

interface RawSection {
  courseTitle: string;
  classNbr: string;
  sectionType: string;
  dayTime: string;
  campus: string;
  room: string;
  instructor: string;
  dates: string;
  instrMethod: string;
  isOpen: boolean;
}

type SearchOutcome = "results" | "no-results" | "exceeds-400" | "failed";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let slugFilter: string | null = null;
  let termArg = "";
  let subject: string | null = null;
  let headed = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) {
      termArg = args[i + 1];
      i++;
    } else if (args[i] === "--slug" && args[i + 1]) {
      slugFilter = args[i + 1];
      i++;
    } else if (args[i] === "--subject" && args[i + 1]) {
      subject = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === "--headed") {
      headed = true;
    }
  }

  // Default to the terms LACCD currently publishes (Summer often unpublished
  // until later in spring — verify before adding).
  if (!termArg) termArg = "Spring 2026,Fall 2026";

  const termNames = termArg.split(",").map((t) => t.trim()).filter(Boolean);
  const terms: ParsedTerm[] = [];
  for (const termName of termNames) {
    const psTermCode = TERM_CODES[termName];
    const fileTermCode = TERM_FILE_CODES[termName];
    if (!psTermCode || !fileTermCode) {
      console.error(`Unknown term: "${termName}". Available:`, Object.keys(TERM_CODES).join(", "));
      process.exit(1);
    }
    terms.push({ termName, psTermCode, fileTermCode });
  }

  if (slugFilter && !ALL_LACCD_SLUGS.includes(slugFilter)) {
    console.error(`Unknown slug: ${slugFilter}. LACCD colleges:`);
    for (const s of ALL_LACCD_SLUGS) console.error(`  ${s}`);
    process.exit(1);
  }

  return { slugFilter, terms, subject, headed };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let consecutiveSearchFailures = 0;
const MAX_CONSECUTIVE_SEARCH_FAILURES = 5;

// Bucket a section's location string to a LACCD college slug.
function resolveLocationSlug(location: string): string | null {
  // Some sections list multiple locations (multi-meeting), separated by \n.
  const first = location.split(/[\n,]/)[0]?.trim() ?? "";
  for (const [re, slug] of PREFIX_TO_SLUG) {
    if (re.test(first)) return slug;
  }
  return null;
}

// ---------------------------------------------------------------------------
// PS page interaction
// ---------------------------------------------------------------------------

async function navigateToSearch(page: Page): Promise<boolean> {
  try {
    await page.goto(PS_URL, {
      waitUntil: "networkidle",
      timeout: NAV_TIMEOUT,
    });
    await sleep(1200);
    return await page
      .locator("#CLASS_SRCH_WRK2_STRM\\$35\\$")
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
  } catch (err) {
    console.error(`    ⚠ Nav failed: ${(err as Error).message}`);
    return false;
  }
}

async function applyCommonCriteria(page: Page, termCode: string): Promise<void> {
  const instSel = page.locator("#CLASS_SRCH_WRK2_INSTITUTION\\$31\\$");
  if ((await instSel.inputValue().catch(() => "")) !== "LACCD") {
    await instSel.selectOption("LACCD");
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  }
  await page.selectOption("#CLASS_SRCH_WRK2_STRM\\$35\\$", termCode);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.selectOption("#SSR_CLSRCH_WRK_ACAD_CAREER\\$2", "CR");
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
}

async function setSubject(page: Page, subjectCode: string): Promise<void> {
  const subjLoc = page.locator("#SSR_CLSRCH_WRK_SUBJECT\\$0");
  await subjLoc.click();
  await subjLoc.fill("");
  await subjLoc.type(subjectCode, { delay: 40 });
  await page.keyboard.press("Tab");
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.selectOption("#SSR_CLSRCH_WRK_SSR_EXACT_MATCH1\\$1", "E");
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
}

async function setCatalogNbrRange(
  page: Page,
  op: "G" | "T" | "E" | "C",
  value: string,
): Promise<void> {
  // SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$1 is the SUBJECT exact-match.
  // The CATALOG_NBR has its own exact-match — typically $0 or a later $.
  // Based on the form field list: SSR_CLSRCH_WRK_CATALOG_NBR$1 (the input),
  // and the operator dropdown name is just below it. Let's set the catalog
  // nbr input and let its exact-match default to "is exactly" / fall-through.
  await page.locator("#SSR_CLSRCH_WRK_CATALOG_NBR\\$1").fill(value);
  await page.keyboard.press("Tab");
  // Match-type field next to catalog nbr (use the GE/LE operator).
  // PS Class Search exposes this as an "exact match" type select beside the
  // input. Find any select that has "greater than or equal to" option and
  // matches the catalog-nbr region.
  const matchSelect = page.locator(
    'select[id^="SSR_CLSRCH_WRK_SSR_EXACT_MATCH"]:not([id$="$1"])',
  );
  const count = await matchSelect.count();
  if (count > 0) {
    await matchSelect.first().selectOption(op);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  }
}

async function clearCatalogNbr(page: Page): Promise<void> {
  await page.locator("#SSR_CLSRCH_WRK_CATALOG_NBR\\$1").fill("");
  await page.keyboard.press("Tab");
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
}

async function clickSearch(page: Page): Promise<SearchOutcome> {
  // Uncheck "open only"
  const openOnly = page.locator("#SSR_CLSRCH_WRK_SSR_OPEN_ONLY\\$3");
  if (await openOnly.isChecked().catch(() => false)) {
    await openOnly.uncheck();
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
  }

  await page.click("#CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH");

  await page.waitForFunction(
    () => {
      const text = document.body?.innerText || "";
      return (
        text.includes("class section(s) found") ||
        text.includes("search returns no results") ||
        text.includes("no results that match") ||
        text.includes("would you like to continue") ||
        text.includes("will exceed the maximum")
      );
    },
    { timeout: SEARCH_WAIT }
  );

  await sleep(400);
  let bodyText = await page.evaluate(() => document.body?.innerText || "");

  if (bodyText.includes("will exceed the maximum")) return "exceeds-400";

  // >100 confirmation
  if (bodyText.includes("would you like to continue")) {
    await page.evaluate(() => {
      const ok = document.querySelector('input[id="#ICSave"]') as HTMLInputElement | null;
      if (ok) ok.click();
    });
    await page.waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        return (
          text.includes("class section(s) found") ||
          text.includes("search returns no results")
        );
      },
      { timeout: 60_000 }
    );
    await sleep(600);
    bodyText = await page.evaluate(() => document.body?.innerText || "");
  }

  if (bodyText.includes("class section(s) found")) return "results";
  if (bodyText.includes("no results") || bodyText.includes("returns no results"))
    return "no-results";
  return "failed";
}

async function search(
  page: Page,
  subjectCode: string,
  termCode: string,
  catalogRange: { op: "G" | "T"; value: string } | null = null,
): Promise<SearchOutcome> {
  try {
    await applyCommonCriteria(page, termCode);
    await setSubject(page, subjectCode);
    if (catalogRange) await setCatalogNbrRange(page, catalogRange.op, catalogRange.value);
    const out = await clickSearch(page);
    consecutiveSearchFailures = 0;
    return out;
  } catch (err) {
    consecutiveSearchFailures++;
    console.error(
      `    ⚠ Search failed (${consecutiveSearchFailures}/${MAX_CONSECUTIVE_SEARCH_FAILURES}): ${(err as Error).message}`
    );
    if (consecutiveSearchFailures >= MAX_CONSECUTIVE_SEARCH_FAILURES) {
      throw new Error(
        `PS search broken — ${consecutiveSearchFailures} consecutive failures. Aborting.`
      );
    }
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// Result extraction
// ---------------------------------------------------------------------------

async function extractResults(page: Page): Promise<RawSection[]> {
  return page.evaluate(() => {
    const sections: any[] = [];
    const courseTitles: string[] = [];
    for (let i = 0; ; i++) {
      const el = document.getElementById(`win0divSSR_CLSRSLT_WRK_GROUPBOX2GP$${i}`);
      if (!el) break;
      courseTitles.push((el as HTMLElement).innerText?.trim() || "");
    }

    let m = 0;
    while (true) {
      const classNbrEl = document.getElementById(`MTG_CLASS_NBR$${m}`);
      if (!classNbrEl) break;

      let courseTitle = "";
      const sectionEl = document.getElementById(`win0divSSR_CLSRSLT_WRK_GROUPBOX3$${m}`);
      if (sectionEl) {
        let parent: HTMLElement | null = sectionEl.parentElement;
        while (parent) {
          if (parent.id?.startsWith("win0divSSR_CLSRSLT_WRK_GROUPBOX2$")) {
            const idx = parseInt(parent.id.split("$")[1]);
            if (!isNaN(idx) && idx < courseTitles.length) courseTitle = courseTitles[idx];
            break;
          }
          parent = parent.parentElement;
        }
      }

      const statusEl = document.getElementById(
        `win0divDERIVED_CLSRCH_SSR_STATUS_LONG$${m}`
      );
      const statusImg = statusEl?.querySelector("img");

      sections.push({
        courseTitle,
        classNbr: (classNbrEl as HTMLElement).innerText?.trim() || "",
        sectionType: (document.getElementById(`MTG_CLASSNAME$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        dayTime: (document.getElementById(`MTG_DAYTIME$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        campus: (document.getElementById(`DERIVED_CLSRCH_DESCR4$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        room: (document.getElementById(`MTG_ROOM$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        instructor: (document.getElementById(`MTG_INSTR$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        dates: (document.getElementById(`MTG_TOPIC$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        instrMethod: (document.getElementById(`DERIVED_CLSRCH_DESCR5$${m}`) as HTMLElement | null)?.innerText?.trim() || "",
        isOpen: statusImg?.getAttribute("alt") !== "Closed",
      });
      m++;
    }
    return sections;
  });
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseCourseTitle(raw: string): { prefix: string; number: string; title: string } {
  const m = raw.match(/^([A-Z][A-Z &/]{1,10}?)\s+(\d{1,4}[A-Z]{0,3})\s*[-–—]\s*(.+)$/);
  if (m) return { prefix: m[1].trim(), number: m[2], title: m[3].trim() };
  const parts = raw.split(/\s+/);
  return {
    prefix: parts[0] || "UNK",
    number: parts[1] || "000",
    title: parts.slice(2).join(" "),
  };
}

function parseDayTime(raw: string): { days: string; startTime: string; endTime: string } {
  if (!raw || raw === "TBA" || raw.toLowerCase().includes("tba")) {
    return { days: "", startTime: "", endTime: "" };
  }
  const m = raw.match(/^([A-Za-z]+)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)/);
  if (m) return { days: m[1], startTime: m[2].trim(), endTime: m[3].trim() };
  const daysOnly = raw.match(/^([A-Za-z]+)$/);
  if (daysOnly) return { days: daysOnly[1], startTime: "", endTime: "" };
  return { days: "", startTime: "", endTime: "" };
}

function parseDates(raw: string): string {
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return "";
}

function determineMode(instrMethod: string, room: string): string {
  const method = instrMethod.toLowerCase();
  const loc = room.toLowerCase();
  if (method.includes("web-online") || method.includes("online")) return "online";
  if (method.includes("hybrid")) return "hybrid";
  if (loc.includes("online") && !loc.match(/online live/i)) return "online";
  if (loc.includes("online live")) return "online";
  if (loc.includes("hybrid")) return "hybrid";
  if (loc.includes("zoom")) return "zoom";
  return "in-person";
}

function parseCredits(sectionType: string): number {
  const m = sectionType.match(/(\d+(?:\.\d+)?)\s*(?:unit|credit)/i);
  return m ? Math.round(parseFloat(m[1])) : 3;
}

function rawToSection(
  raw: RawSection,
  collegeSlug: string,
  fileTermCode: string,
): CourseSection | null {
  if (!raw.classNbr) return null;
  const { prefix, number, title } = parseCourseTitle(raw.courseTitle);
  const { days, startTime, endTime } = parseDayTime(raw.dayTime);
  const startDate = parseDates(raw.dates);
  const mode = determineMode(raw.instrMethod, raw.room);
  const credits = parseCredits(raw.sectionType);
  let instructor: string | null = raw.instructor || null;
  if (instructor && (instructor.toLowerCase() === "staff" || instructor === "-")) instructor = null;
  return {
    college_code: collegeSlug,
    term: fileTermCode,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits,
    crn: raw.classNbr,
    days,
    start_time: startTime,
    end_time: endTime,
    start_date: startDate,
    location: raw.room,
    campus: raw.campus,
    mode,
    instructor,
    seats_open: raw.isOpen ? 1 : 0,
    seats_total: null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

// ---------------------------------------------------------------------------
// Search-and-bucket: one search across the district, distribute to colleges
// ---------------------------------------------------------------------------

async function searchSubjectAndBucket(
  page: Page,
  subjectCode: string,
  psTermCode: string,
  fileTermCode: string,
): Promise<{ byCollege: Record<string, CourseSection[]>; unmapped: number; outcome: SearchOutcome }> {
  const byCollege: Record<string, CourseSection[]> = {};
  for (const slug of ALL_LACCD_SLUGS) byCollege[slug] = [];

  // First: try unfiltered search
  const tryOne = async (catalogRange: { op: "G" | "T"; value: string } | null) => {
    let out: SearchOutcome = "failed";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await navigateToSearch(page);
      out = await search(page, subjectCode, psTermCode, catalogRange);
      if (out !== "failed") break;
    }
    if (out !== "results") return { sections: [] as RawSection[], outcome: out };
    const sections = await extractResults(page);
    return { sections, outcome: out };
  };

  await navigateToSearch(page);
  const first = await tryOne(null);
  let unmapped = 0;

  // v1: don't subdivide. Mark exceeds-400 subjects as TODOs for a follow-up.
  // (Catalog-Nbr subdivision needs more discovery; the operator-dropdown
  // selector wasn't reliable. Adding range subdivision is tracked as
  // follow-up work in the PR body.)
  if (first.outcome !== "results") {
    return { byCollege, unmapped: 0, outcome: first.outcome };
  }

  for (const raw of first.sections) {
    const slug = resolveLocationSlug(raw.room);
    if (!slug) {
      unmapped++;
      continue;
    }
    const section = rawToSection(raw, slug, fileTermCode);
    if (section) byCollege[slug].push(section);
  }

  return { byCollege, unmapped, outcome: "results" };
}

// ---------------------------------------------------------------------------
// Main term scrape
// ---------------------------------------------------------------------------

async function scrapeTerm(
  browser: Browser,
  termName: string,
  psTermCode: string,
  fileTermCode: string,
  subjectFilter: string | null,
  slugFilter: string | null,
): Promise<{ byCollege: Record<string, CourseSection[]>; tooLarge: string[]; unmapped: number }> {
  const page = await browser.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  const byCollege: Record<string, CourseSection[]> = {};
  for (const slug of ALL_LACCD_SLUGS) byCollege[slug] = [];
  const tooLarge: string[] = [];
  let unmapped = 0;

  try {
    console.log(`\n📚 LACCD — ${termName} (PS ${psTermCode})`);
    const subjects = subjectFilter ? [subjectFilter] : LACCD_SUBJECTS;
    console.log(`  ${subjects.length} subjects to scan`);

    for (let si = 0; si < subjects.length; si++) {
      const subjectCode = subjects[si];
      process.stdout.write(`  [${si + 1}/${subjects.length}] ${subjectCode.padEnd(10)} `);

      const result = await searchSubjectAndBucket(page, subjectCode, psTermCode, fileTermCode);

      if (result.outcome === "exceeds-400") {
        // The subdivision also exceeded 400 — mark as too-large
        tooLarge.push(subjectCode);
        console.log("→ skipped (subdivision still >400)");
        await sleep(INTER_SEARCH_DELAY);
        continue;
      }
      if (result.outcome === "no-results") {
        console.log("→ 0");
        await sleep(INTER_SEARCH_DELAY);
        continue;
      }
      if (result.outcome !== "results") {
        console.log("→ failed");
        await sleep(INTER_SEARCH_DELAY);
        continue;
      }

      let total = 0;
      for (const slug of ALL_LACCD_SLUGS) {
        const sub = result.byCollege[slug];
        if (slugFilter && slug !== slugFilter) continue;
        if (sub.length === 0) continue;
        byCollege[slug].push(...sub);
        total += sub.length;
      }
      unmapped += result.unmapped;
      console.log(`→ ${total} sections distributed${result.unmapped ? ` (${result.unmapped} unmapped)` : ""}`);

      await sleep(INTER_SEARCH_DELAY);
    }
  } finally {
    await page.close();
  }

  return { byCollege, tooLarge, unmapped };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { slugFilter, terms, subject, headed } = parseArgs();

  const browser = await chromium.launch({ headless: !headed });
  const startTime = Date.now();
  let grandTotal = 0;
  const tooLargeAll: Record<string, string[]> = {};
  let unmappedTotal = 0;

  try {
    for (const { termName, psTermCode, fileTermCode } of terms) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`LACCD PeopleSoft Scraper — ${termName}`);
      console.log(`Term code: ${psTermCode} → ${fileTermCode}`);
      console.log(`Colleges: ${slugFilter ? slugFilter : `all 9 LACCD`}`);
      if (subject) console.log(`Subject filter: ${subject}`);
      console.log(`${"=".repeat(60)}`);

      const { byCollege, tooLarge, unmapped } = await scrapeTerm(
        browser,
        termName,
        psTermCode,
        fileTermCode,
        subject,
        slugFilter,
      );

      if (tooLarge.length > 0) tooLargeAll[termName] = tooLarge;
      unmappedTotal += unmapped;

      let termTotal = 0;
      console.log(`\n  Per-college totals (${termName}):`);
      for (const slug of ALL_LACCD_SLUGS) {
        if (slugFilter && slug !== slugFilter) continue;
        const sections = byCollege[slug];
        if (sections.length === 0) {
          console.log(`    ${slug.padEnd(42)} 0`);
          continue;
        }
        const dir = path.join(DATA_DIR, slug);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `${fileTermCode}.json`);
        fs.writeFileSync(filePath, JSON.stringify(sections, null, 2) + "\n");
        console.log(`    ${slug.padEnd(42)} ${sections.length}`);
        termTotal += sections.length;
      }
      console.log(`  ${termName} total: ${termTotal}`);
      grandTotal += termTotal;
    }
  } finally {
    await browser.close();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `Done! ${grandTotal} sections across LACCD's 9 colleges, ${terms.length} term(s) in ${elapsed}s`,
  );
  if (unmappedTotal > 0) {
    console.log(`⚠ ${unmappedTotal} sections had unmappable location prefixes (likely TBA-only)`);
  }
  if (Object.keys(tooLargeAll).length > 0) {
    console.log(`\n⚠ Subjects still exceeding 400 after catalog-nbr subdivision:`);
    for (const [t, subs] of Object.entries(tooLargeAll)) {
      console.log(`  ${t}: ${subs.join(", ")}`);
    }
  }
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
