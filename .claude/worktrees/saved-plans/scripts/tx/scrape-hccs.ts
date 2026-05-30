/**
 * scrape-hccs.ts
 *
 * Houston Community College runs PeopleSoft Campus Solutions Fluid. The
 * public Class Search at myeagle.hccs.edu uses ICAJAX, so we drive it with
 * Playwright after establishing a guest session.
 *
 * Two phases per run:
 *
 *   Phase 1 — Catalog sweep
 *     Navigate the SSR_CLSRCH_MAIN_FL component, click the requested term,
 *     and submit a series of keyword searches (vowel-paired letters plus a
 *     curated list of TX-CCNS prefixes). Each result row exposes
 *     `openSrchRsltURL(...)` in its anchor href — that URL is the deep link
 *     into the course-detail page. Collect (prefix, number, title, detailUrl)
 *     for every unique course we see across the sweep.
 *
 *   Phase 2 — Section drill
 *     For each unique course, navigate to its SSR_CS_WRAP_FL detail page.
 *     The "Class Selection" table renders one <tr> per section with these
 *     stable ids:
 *       CRN/mode      SSR_CLSRCH_F_WK_SSR_CMPNT_DESCR_1$294$$N
 *       Dates         SSR_CLSRCH_F_WK_SSR_MTG_DT_LONG_1$88$$N
 *       Days/Times    SSR_CLSRCH_F_WK_SSR_MTG_SCHED_L_1$134$$N
 *       Room/Campus   SSR_CLSRCH_F_WK_SSR_MTG_LOC_LONG_1$...
 *       Instructor    SSR_CLSRCH_F_WK_SSR_INSTR_LONG_1$86$$N
 *       Seats         SSR_CLSRCH_F_WK_SSR_DESCR50_1$...
 *
 * Output:
 *   data/tx/courses/houston-community-college/{TERMCODE}.json
 *     — CourseSection[] matching the schema used by every other state's
 *       course scraper (see e.g. data/tx/courses/south-texas-college/...).
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-hccs.ts                       # Fall 2026
 *   npx tsx scripts/tx/scrape-hccs.ts --term "Spring 2027"
 *   npx tsx scripts/tx/scrape-hccs.ts --headed              # visible browser
 *   npx tsx scripts/tx/scrape-hccs.ts --max-courses 20      # smoke test
 *   npx tsx scripts/tx/scrape-hccs.ts --catalog-only        # skip drill
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HCC_ROOT = "https://myeagle.hccs.edu/";
const ENTRY_URL =
  "https://myeagle.hccs.edu/psc/sag/EMPLOYEE/SA/c/SSR_STUDENT_FL.SSR_CLSRCH_MAIN_FL.GBL";

const SLUG = "houston-community-college";
const COLLEGE_CODE = "houston-community-college";
const COURSES_DIR = path.join(process.cwd(), "data", "tx", "courses", SLUG);
const CATALOG_PATH = path.join(
  process.cwd(),
  "data",
  "tx",
  "coursedog-catalog",
  `${SLUG}.json`
);

const NAV_TIMEOUT = 30_000;
const SEARCH_TIMEOUT = 45_000;
const DRILL_TIMEOUT = 45_000;
const INTER_DELAY = 1200;

// Term-name → file-code conversion used by every other state's scraper
const TERM_FILE_CODE: Record<string, string> = {
  "Summer 2026": "2026SU",
  "Fall 2026": "2026FA",
  "Spring 2027": "2027SP",
  "Summer 2027": "2027SU",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CatalogEntry {
  prefix: string;
  number: string;
  title: string;
  detailUrl: string;
}

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

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
  term: string;
  fileTerm: string;
  headed: boolean;
  maxCourses: number;
  maxQueries: number;
  catalogOnly: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let term = "Fall 2026";
  let headed = false;
  let maxCourses = Infinity;
  let maxQueries = Infinity;
  let catalogOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) {
      term = args[i + 1];
      i++;
    } else if (args[i] === "--headed") {
      headed = true;
    } else if (args[i] === "--max-courses" && args[i + 1]) {
      maxCourses = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--max-queries" && args[i + 1]) {
      maxQueries = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--catalog-only") {
      catalogOnly = true;
    }
  }
  const fileTerm = TERM_FILE_CODE[term];
  if (!fileTerm) {
    console.error(
      `Unknown term "${term}". Supported: ${Object.keys(TERM_FILE_CODE).join(", ")}`
    );
    process.exit(1);
  }
  return { term, fileTerm, headed, maxCourses, maxQueries, catalogOnly };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Phase 1 — catalog sweep
// ---------------------------------------------------------------------------

async function establishSession(page: Page): Promise<void> {
  await page.goto(HCC_ROOT, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
}

async function openClassSearch(page: Page): Promise<void> {
  await page.goto(ENTRY_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
  await page.waitForSelector("a[id^='SSR_CSTRMCUR_VW_DESCR$']", { timeout: 15_000 });
  await sleep(1500);
}

async function clickTerm(page: Page, termName: string): Promise<void> {
  const id = await page.evaluate((wanted: string) => {
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("a[id^='SSR_CSTRMCUR_VW_DESCR$']")
    );
    for (const a of anchors) {
      const t = (a.innerText || a.textContent || "").trim();
      if (/continuing\s*ed/i.test(t)) continue;
      if (t.toLowerCase() === wanted.toLowerCase()) return a.id;
    }
    return null;
  }, termName);
  if (!id) throw new Error(`Term row "${termName}" not found`);
  await page.evaluate((eid: string) => document.getElementById(eid)?.click(), id);
  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => {});
  await page.waitForSelector("#PTS_KEYWORDS3", { timeout: 15_000 });
  await sleep(1500);
}

async function runFirstKeywordSearch(page: Page, keyword: string): Promise<string> {
  // PS Fluid registers keyword changes through a chained onchange handler.
  // The handler must run between the keystrokes and the search submit, or
  // PS sends an empty SEARCH_TEXT. Keep the three steps in separate evaluate
  // calls with sleeps so each tick can flush.
  await page.focus("#PTS_KEYWORDS3");
  await page.keyboard.type(keyword, { delay: 80 });
  await sleep(300);
  await page.evaluate(() => {
    const el = document.getElementById("PTS_KEYWORDS3") as HTMLInputElement | null;
    if (el) {
      el.setAttribute("psnchg", "1");
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
    }
  });
  await sleep(500);
  await page.evaluate(() => {
    // @ts-expect-error - submitAction_win0 is injected by PeopleSoft Fluid
    submitAction_win0(document.win0, "PTS_SRCH_BTN");
  });
  await Promise.race([
    page.waitForURL(/SSR_CLSRCH_ES_FL/, { timeout: SEARCH_TIMEOUT }),
    page.waitForSelector("li[id^='PTS_RSLTS_LIST$'][id*='_row_']", { timeout: SEARCH_TIMEOUT }),
  ]);
  await page.waitForLoadState("networkidle", { timeout: SEARCH_TIMEOUT }).catch(() => {});
  await sleep(2000);
  const strm = new URL(page.url()).searchParams.get("ES_STRM");
  if (!strm) throw new Error(`Could not read ES_STRM from ${page.url()}`);
  return strm;
}

async function runDeepLinkSearch(page: Page, keyword: string, strm: string): Promise<void> {
  const url =
    `https://myeagle.hccs.edu/psc/sag_1/EMPLOYEE/SA/c/SSR_STUDENT_FL.SSR_CLSRCH_ES_FL.GBL` +
    `?Page=SSR_CLSRCH_ES_FL&SEARCH_GROUP=SSR_CLASS_SEARCH_LFF` +
    `&SEARCH_TEXT=${encodeURIComponent(keyword)}` +
    `&ES_INST=HCCSD&ES_STRM=${strm}&ES_ADV=N&INVOKE_SEARCHAGAIN=PTSF_GBLSRCH_FLUID`;
  await page.goto(url, { waitUntil: "networkidle", timeout: SEARCH_TIMEOUT });
  await sleep(2000);
}

async function extractCatalogPage(page: Page): Promise<CatalogEntry[]> {
  return page.evaluate(() => {
    const out: { prefix: string; number: string; title: string; detailUrl: string }[] = [];
    const seen = new Set<string>();
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("li[id^='PTS_RSLTS_LIST$'][id*='_row_']")
    );
    for (const row of rows) {
      const a = row.querySelector<HTMLAnchorElement>("a[id^='PTS_LIST_TITLE$']");
      const code = (a?.innerText || a?.textContent || "").trim();
      const m = code.match(/^([A-Z]{2,4})[ -]?(\d{3,4}[A-Z]?)\b/);
      if (!m) continue;
      const prefix = m[1];
      const number = m[2];
      const key = `${prefix}-${number}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const summary = Array.from(row.querySelectorAll<HTMLElement>("[id]")).find((el) =>
        el.id.includes("PTS_LIST_SUMMARY")
      );
      let title = "";
      if (summary) {
        const raw = (summary.innerText || summary.textContent || "").trim();
        const optsIdx = raw.search(/\d+\s+Class\s+Options?\s+Available/i);
        title = (optsIdx >= 0 ? raw.slice(0, optsIdx) : raw).trim().replace(/\s+/g, " ");
      }

      // Detail URL is in the anchor's href: openSrchRsltURL('...')
      const href = a?.getAttribute("href") || "";
      const m2 = href.match(/openSrchRsltURL\('([^']+)'\)/);
      const detailUrl = (m2?.[1] || "").replace(/&amp;/g, "&");
      if (!detailUrl) continue;

      out.push({ prefix, number, title, detailUrl });
    }
    return out;
  });
}

async function phase1CatalogSweep(page: Page, termName: string, maxQueries: number): Promise<CatalogEntry[]> {
  const all = new Map<string, CatalogEntry>();

  console.log("• Establishing guest session…");
  await establishSession(page);
  console.log("• Opening Class Search…");
  await openClassSearch(page);
  console.log(`• Clicking term row "${termName}"…`);
  await clickTerm(page, termName);

  // Warmup with a keyword we know returns results
  console.log("• Warmup search 'ENGL' to capture ES_STRM…");
  const strm = await runFirstKeywordSearch(page, "ENGL");
  console.log(`  ES_STRM=${strm}`);
  for (const c of await extractCatalogPage(page)) {
    all.set(`${c.prefix}-${c.number}`, c);
  }
  console.log(`  warmup captured ${all.size} courses`);

  const queries: string[] = [];
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") for (const v of "AEIOU") queries.push(ch + v);
  queries.push(
    "ART", "CRT", "DFT", "DRT", "GIS", "HMG", "ITS", "PHY", "PNT", "SGT", "WLD",
    "TECH", "MGMT", "MFGT", "PSYC", "POFT", "GOVT", "BMGT", "ACCT", "HITT",
    "PHED", "RNSG", "CJSA", "FIRT", "EMSP", "DAAC", "DSMA", "INRW"
  );
  const uniq = Array.from(new Set(queries)).slice(0, maxQueries);

  for (let i = 0; i < uniq.length; i++) {
    const q = uniq[i];
    process.stdout.write(`  [${q}] `);
    try {
      await runDeepLinkSearch(page, q, strm);
      const rows = await extractCatalogPage(page);
      let added = 0;
      for (const c of rows) {
        const k = `${c.prefix}-${c.number}`;
        if (!all.has(k)) {
          all.set(k, c);
          added++;
        }
      }
      console.log(`${rows.length} courses (${added} new, ${all.size} total)`);
    } catch (e) {
      console.log(`failed: ${(e as Error).message}`);
    }
    await sleep(INTER_DELAY);
  }

  return Array.from(all.values()).sort((a, b) =>
    a.prefix !== b.prefix ? a.prefix.localeCompare(b.prefix) : a.number.localeCompare(b.number)
  );
}

// ---------------------------------------------------------------------------
// Phase 2 — section drill
// ---------------------------------------------------------------------------

interface RawSectionRow {
  crnAndMode: string;
  dates: string;
  daysTimes: string;
  location: string;
  instructor: string;
  seats: string;
}

async function drillCourse(page: Page, detailUrl: string): Promise<RawSectionRow[]> {
  await page.goto(detailUrl, { waitUntil: "networkidle", timeout: DRILL_TIMEOUT });
  await sleep(2000);
  // NOTE: must not declare inner functions inside page.evaluate — tsx
  // transpiles them with __name() wrappers that don't exist in the page
  // context, throwing "ReferenceError: __name is not defined".
  return page.evaluate(() => {
    const out: RawSectionRow[] = [];
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("tr[id^='SSR_CLS_DTLS_VW$'][id*='_row_']")
    );
    for (const row of rows) {
      const idEls = Array.from(row.querySelectorAll<HTMLElement>("[id]"));
      const grab: Record<string, string> = {
        crnAndMode: "",
        dates: "",
        daysTimes: "",
        location: "",
        instructor: "",
        seats: "",
      };
      const fields: { key: keyof typeof grab; substr: string }[] = [
        { key: "crnAndMode", substr: "SSR_CMPNT_DESCR_1" },
        { key: "dates", substr: "SSR_MTG_DT_LONG_1" },
        { key: "daysTimes", substr: "SSR_MTG_SCHED_L_1" },
        { key: "location", substr: "SSR_MTG_LOC_LONG_1" },
        { key: "instructor", substr: "SSR_INSTR_LONG_1" },
        { key: "seats", substr: "SSR_DESCR50_1" },
      ];
      for (const f of fields) {
        const el = idEls.find((e) => e.id.includes(f.substr));
        if (!el) continue;
        const html = el.innerHTML.replace(/<br\s*\/?>/gi, "\n");
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        grab[f.key] = (tmp.innerText || tmp.textContent || "").trim();
      }
      if (!grab.crnAndMode) continue;
      out.push(grab as unknown as RawSectionRow);
    }
    return out;
  });
}

function parseCrnAndMode(s: string): { crn: string; mode: string } {
  // "Class Nbr 10202 - Hybrid"
  const m = s.match(/Class\s*Nbr\s*(\d+)\s*-?\s*(.*)$/i);
  if (!m) return { crn: "", mode: "" };
  return { crn: m[1], mode: m[2].trim() };
}

function normalizeMode(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes("online anytime") || r.includes("online on a schedule") || r.includes("online")) return "online";
  if (r.includes("hybrid")) return "hybrid";
  if (r.includes("in person")) return "in-person";
  return raw || "in-person";
}

function parseStartDate(s: string): string {
  // "08/17/2026 - 12/13/2026"
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
}

function parseDaysTimes(s: string): { days: string; start_time: string; end_time: string } {
  // Examples:
  //   "Thursday\n11:00AM to 12:20PM Hybrid class - Also meets online"
  //   "Monday Wednesday\n9:00AM to 10:20AM"
  //   "" (online-anytime)
  if (!s) return { days: "", start_time: "", end_time: "" };
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  // Day abbreviations PS uses long names — map them
  const dayMap: Record<string, string> = {
    monday: "M",
    tuesday: "Tu",
    wednesday: "W",
    thursday: "Th",
    friday: "F",
    saturday: "Sa",
    sunday: "Su",
  };
  let days = "";
  let timesLine = "";
  if (lines.length >= 2) {
    days = lines[0]
      .split(/\s+/)
      .map((w) => dayMap[w.toLowerCase()] || "")
      .join("");
    timesLine = lines[1];
  } else if (lines.length === 1) {
    // Either just days or just times
    if (/AM|PM/i.test(lines[0])) timesLine = lines[0];
    else
      days = lines[0]
        .split(/\s+/)
        .map((w) => dayMap[w.toLowerCase()] || "")
        .join("");
  }
  const tm = timesLine.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*(?:to|-|–)\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  const start_time = tm?.[1].replace(/\s+/g, " ").trim() || "";
  const end_time = tm?.[2].replace(/\s+/g, " ").trim() || "";
  return { days, start_time, end_time };
}

function parseSeats(s: string): { seats_open: number | null; seats_total: number | null } {
  // "9 Open Seats 12 Reserved Seats" or "Class Full" or ""
  if (!s) return { seats_open: null, seats_total: null };
  if (/class\s+full/i.test(s)) return { seats_open: 0, seats_total: null };
  const open = s.match(/(\d+)\s+Open\s+Seats/i);
  const reserved = s.match(/(\d+)\s+Reserved\s+Seats/i);
  const openN = open ? parseInt(open[1], 10) : null;
  const reservedN = reserved ? parseInt(reserved[1], 10) : null;
  // total = open + reserved (best we can infer)
  const total = openN !== null && reservedN !== null ? openN + reservedN : null;
  return { seats_open: openN, seats_total: total };
}

function parseInstructor(s: string): string | null {
  if (!s) return null;
  const t = s.trim();
  if (t.toLowerCase() === "staff" || t === "-") return null;
  return t.replace(/\s+/g, " ");
}

function rawToCourseSection(
  raw: RawSectionRow,
  course: CatalogEntry,
  fileTerm: string
): CourseSection | null {
  const { crn, mode: modeRaw } = parseCrnAndMode(raw.crnAndMode);
  if (!crn) return null;
  const { days, start_time, end_time } = parseDaysTimes(raw.daysTimes);
  const { seats_open, seats_total } = parseSeats(raw.seats);
  return {
    college_code: COLLEGE_CODE,
    term: fileTerm,
    course_prefix: course.prefix,
    course_number: course.number,
    course_title: course.title,
    credits: 0, // not exposed on the list/detail pages
    crn,
    days,
    start_time,
    end_time,
    start_date: parseStartDate(raw.dates),
    location: raw.location || "",
    campus: raw.location || "",
    mode: normalizeMode(modeRaw),
    instructor: parseInstructor(raw.instructor),
    seats_open,
    seats_total,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  console.log(
    `HCC scraper — term: ${args.term} (${args.fileTerm}), max-courses: ${
      args.maxCourses === Infinity ? "all" : args.maxCourses
    }, catalog-only: ${args.catalogOnly}, headed: ${args.headed}`
  );

  const browser: Browser = await chromium.launch({ headless: !args.headed });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  const start = Date.now();
  let catalog: CatalogEntry[] = [];
  const sections: CourseSection[] = [];

  try {
    catalog = await phase1CatalogSweep(page, args.term, args.maxQueries);
    console.log(`\n✓ Phase 1: ${catalog.length} unique courses\n`);

    if (!args.catalogOnly) {
      const targets = catalog.slice(0, args.maxCourses);
      console.log(`• Phase 2: drilling ${targets.length} course detail page(s)…`);
      for (let i = 0; i < targets.length; i++) {
        const c = targets[i];
        process.stdout.write(`  [${i + 1}/${targets.length}] ${c.prefix} ${c.number}… `);
        try {
          const raws = await drillCourse(page, c.detailUrl);
          let kept = 0;
          for (const r of raws) {
            const sec = rawToCourseSection(r, c, args.fileTerm);
            if (sec) {
              sections.push(sec);
              kept++;
            }
          }
          console.log(`${kept} section(s)`);
        } catch (e) {
          console.log(`failed: ${(e as Error).message}`);
        }
        await sleep(INTER_DELAY);
      }
    }
  } finally {
    await browser.close();
  }

  // Write catalog (still useful for prereq aggregation)
  fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
  const catalogOut = catalog.map((c) => ({
    prefix: c.prefix,
    number: c.number,
    title: c.title,
    credits: 0,
    description: "",
    prerequisite_text: null,
    prerequisite_courses: [],
  }));
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalogOut, null, 2) + "\n");
  console.log(`✓ Wrote catalog (${catalogOut.length} courses) → ${CATALOG_PATH}`);

  // Write sections file
  if (!args.catalogOnly) {
    fs.mkdirSync(COURSES_DIR, { recursive: true });
    const outPath = path.join(COURSES_DIR, `${args.fileTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`✓ Wrote sections (${sections.length}) → ${outPath}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\nDone in ${elapsed}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
