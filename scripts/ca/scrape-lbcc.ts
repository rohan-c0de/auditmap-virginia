/**
 * scrape-lbcc.ts — Long Beach City College class search
 *
 * LBCC runs a PeopleSoft "Viking Student System" (host www.cs.lbcc.edu) with a
 * PUBLIC GUEST class-search portal — no login. The relevant component is a
 * custom LBCC bolt-on, the "Open Classes List":
 *   https://www.cs.lbcc.edu/psc/guest/EMPLOYEE/SA/c/LBC_SS0017.LBC_SS0017_LST_FL.GBL
 *
 * Guest cookie bootstrap (mandatory): a direct hit to the GBL redirect-loops to
 * cmd=login UNLESS the guest PS_TOKEN / PS_TokenSite cookies are seeded first by
 * GETting the guest Fluid landing page:
 *   https://www.cs.lbcc.edu/psc/guest/EMPLOYEE/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL
 * (site name is literally `guest`; `PROD_guest` returns "Site name is not valid").
 *
 * The Open Classes List is a PeopleSoft Fluid grid. Its filter dropdowns
 * (Term / Academic Career / Class Type) auto-refresh the grid via partial
 * postback — there is no Search button. We drive it with Playwright:
 *   1. GET landing (seed cookies) → navigate to the Open Classes List.
 *   2. Set Academic Career = Credit, Class Type = All Open Classes.
 *   3. Select the target term, wait until the result header settles to
 *      "Showing All Open Credit classes in <Term>", then harvest every
 *      rendered grid row (the grid renders the full result set, no paging).
 *
 * Grid columns (field ids):
 *   LBC_CLSLIST_DW_LBC_CLASS_NBR_CHAR  — class number (our CRN)
 *   LBC_COURSE_HTML                    — "<PREFIX> <NUMBER>: <Title>"
 *   LBC_CLSLIST_DW_LBC_UNITS_HTML      — units (credits)
 *   LBC_CLSLIST_DW_LBC_DATERANGE_HTML  — "MM/DD/YYYY - MM/DD/YYYY"
 *   LBC_CLSLIST_DW_LBC_MEETING_CHAR    — days/times/room (multi-line for multi-mtg)
 *   LBC_CLSLIST_DW_LBC_INSTR_CHAR      — instructor(s), newline-separated
 *   LBC_CLSLIST_DW_SSR_TOTAL_SEATS     — OPEN seats (this view publishes open
 *                                        seats only — no section capacity, so
 *                                        seats_total is null, never fabricated)
 *
 * Note: the "Open Classes List" by design lists only sections that currently
 * have open seats. That is the live published guest dataset; we record it
 * faithfully (seats_open from the grid, seats_total null).
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-lbcc.ts
 *   npx tsx scripts/ca/scrape-lbcc.ts --term "Fall 2026"
 *   npx tsx scripts/ca/scrape-lbcc.ts --term "Summer 2026,Fall 2026"
 *   npx tsx scripts/ca/scrape-lbcc.ts --headed
 *
 * Detach if a full run is expected to exceed 10 minutes:
 *   ( nohup npx tsx scripts/ca/scrape-lbcc.ts > /tmp/lbcc-scrape.log 2>&1 < /dev/null & )
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const COLLEGE_CODE = "long-beach-city-college";

const HOST = "https://www.cs.lbcc.edu";
const LANDING_URL = `${HOST}/psc/guest/EMPLOYEE/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL`;
const LIST_URL = `${HOST}/psc/guest/EMPLOYEE/SA/c/LBC_SS0017.LBC_SS0017_LST_FL.GBL`;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses", COLLEGE_CODE);

const NAV_TIMEOUT = 45_000;
const SETTLE_TIMEOUT = 60_000; // grid partial-postback can be slow on big terms

// Term dropdown values (LBC_SS0017_WRK_STRM) → schema file code.
// Confirmed live 2026-06-08: 1755=2026 Spring, 1760=2026 Summer, 1765=2026 Fall.
const TERMS: Record<string, { strm: string; file: string; header: string }> = {
  "Spring 2026": { strm: "1755", file: "2026SP", header: "2026 Spring" },
  "Summer 2026": { strm: "1760", file: "2026SU", header: "2026 Summer" },
  "Fall 2026": { strm: "1765", file: "2026FA", header: "2026 Fall" },
};

// Default = upcoming/just-published terms. Spring 2026 is past; Summer & Fall
// 2026 are the live upcoming terms. Override with --term.
const DEFAULT_TERMS = "Summer 2026,Fall 2026";

// Filter dropdown ids
const SEL_TERM = "#LBC_SS0017_WRK_STRM";
const SEL_CAREER = "#LBC_SS0017_WRK_LBC_SRC_CAREER";
const SEL_CLASS_TYPE = "#LBC_SS0017_WRK_LBC_SRC_CLASS_TYPE";

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

type Mode = "in-person" | "online" | "hybrid" | "zoom";

interface CourseRow {
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
  mode: Mode;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

// Raw row scraped from the DOM grid (one per section).
interface RawRow {
  classNbr: string;
  course: string; // "<PREFIX> <NUMBER>: <Title>"
  units: string;
  dateRange: string; // "MM/DD/YYYY - MM/DD/YYYY"
  meeting: string; // multi-line meeting schedule
  instructor: string; // newline-separated
  openSeats: string;
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let termArg = "";
  let headed = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) {
      termArg = args[i + 1];
      i++;
    } else if (args[i] === "--headed") {
      headed = true;
    }
  }
  if (!termArg) termArg = DEFAULT_TERMS;
  const names = termArg
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const terms: Array<{ name: string; strm: string; file: string; header: string }> = [];
  for (const name of names) {
    const t = TERMS[name];
    if (!t) {
      console.error(`Unknown term: "${name}". Available: ${Object.keys(TERMS).join(", ")}`);
      process.exit(1);
    }
    terms.push({ name, ...t });
  }
  return { terms, headed };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Parsing helpers (pure — unit-testable)
// ---------------------------------------------------------------------------

const DAY_MAP: Array<[RegExp, string]> = [
  [/\bMon\b/, "M"],
  [/\bTue\b/, "Tu"],
  [/\bWed\b/, "W"],
  [/\bThu\b/, "Th"],
  [/\bFri\b/, "F"],
  [/\bSat\b/, "Sa"],
  [/\bSun\b/, "Su"],
];
const DAY_ORDER = ["M", "Tu", "W", "Th", "F", "Sa", "Su"];

/** "<PREFIX> <NUMBER>: <Title>" → {prefix, number, title}. */
export function parseCourse(raw: string): { prefix: string; number: string; title: string } {
  const ci = raw.indexOf(":");
  const left = (ci >= 0 ? raw.slice(0, ci) : raw).trim();
  const title = ci >= 0 ? raw.slice(ci + 1).trim() : "";
  const parts = left.split(/\s+/);
  const prefix = (parts[0] || "").trim();
  const number = (parts.slice(1).join(" ") || "").trim();
  return { prefix, number, title };
}

/** "MM/DD/YYYY - MM/DD/YYYY" → ISO start date "YYYY-MM-DD" (or ""). */
export function parseStartDate(dateRange: string): string {
  const m = dateRange.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return "";
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

/** Days tokens from one meeting line, e.g. "Mon Tue Wed Thu ..." → "MTuWTh". */
function extractDaysFromLine(line: string): string {
  const found: string[] = [];
  for (const [re, code] of DAY_MAP) if (re.test(line)) found.push(code);
  found.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return found.join("");
}

/** First "H:MM AM - H:MM PM" pair from a line → {start,end} (12h with AM/PM). */
function extractTimesFromLine(line: string): { start: string; end: string } {
  const m = line.match(
    /(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i,
  );
  if (!m) return { start: "", end: "" };
  return {
    start: m[1].replace(/\s+/g, " ").toUpperCase(),
    end: m[2].replace(/\s+/g, " ").toUpperCase(),
  };
}

/** Room code in parens at the end of a meeting line, e.g. "(LAC-T2310)". */
function extractRoomFromLine(line: string): string {
  const m = line.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : "";
}

/**
 * Interpret the multi-line meeting schedule.
 *   - "Arranged Hours (Online)"         → fully online async
 *   - timed line(s) "(LAC-..)/(TTC-..)"  → in-person
 *   - timed in-person + WEB/OTH/PARTONLINE line → hybrid
 * Returns the primary days/times (first timed line), a location string, a
 * campus code (LAC / TTC / Online), and the mode.
 */
export function parseMeeting(meeting: string): {
  days: string;
  start_time: string;
  end_time: string;
  location: string;
  campus: string;
  mode: Mode;
} {
  const lines = meeting
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const hasOnlineMarker = /partonline|\(online\)|\bweb\b|arranged hours/i.test(meeting);

  // First line that carries an actual day + time = the primary in-person meeting.
  let primary: { days: string; start: string; end: string; room: string } | null = null;
  let anyInPersonRoom = "";
  for (const line of lines) {
    const days = extractDaysFromLine(line);
    const { start, end } = extractTimesFromLine(line);
    const room = extractRoomFromLine(line);
    if (days && start && end) {
      if (!primary) primary = { days, start, end, room };
      if (room && !/online/i.test(room) && !anyInPersonRoom) anyInPersonRoom = room;
    } else if (room && !/online/i.test(room) && !anyInPersonRoom) {
      anyInPersonRoom = room;
    }
  }

  // Fully online async: no timed in-person meeting, only online markers.
  if (!primary && (!anyInPersonRoom || /online/i.test(meeting))) {
    return {
      days: "",
      start_time: "",
      end_time: "",
      location: "Online",
      campus: "Online",
      mode: "online",
    };
  }

  if (!primary) {
    // No timed meeting but an in-person room exists (e.g. arranged in-person).
    const campus = campusFromRoom(anyInPersonRoom);
    return {
      days: "",
      start_time: "",
      end_time: "",
      location: anyInPersonRoom || "Arranged",
      campus,
      mode: "in-person",
    };
  }

  const campus = campusFromRoom(primary.room || anyInPersonRoom);
  const mode: Mode = hasOnlineMarker ? "hybrid" : "in-person";
  return {
    days: primary.days,
    start_time: primary.start,
    end_time: primary.end,
    location: primary.room || anyInPersonRoom || "",
    campus,
    mode,
  };
}

/** Campus code from a room string. LBCC: LAC (Liberal Arts Campus), TTC (Trade-Tech, formerly PCC). */
function campusFromRoom(room: string): string {
  if (!room) return "";
  if (/online/i.test(room)) return "Online";
  const up = room.toUpperCase();
  if (up.startsWith("LAC")) return "LAC";
  if (up.startsWith("TTC") || up.startsWith("PCC")) return "TTC";
  // Fall back to the prefix before the first dash.
  const m = room.match(/^([A-Za-z]+)/);
  return m ? m[1].toUpperCase() : room;
}

/** First instructor "Last,First" (newline-separated list), or null. */
export function parseInstructor(raw: string): string | null {
  const first = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean)[0];
  if (!first) return null;
  if (/^staff$/i.test(first) || /to be (announced|assigned)/i.test(first)) return null;
  // Normalize "Last,First" → "Last, First" to match the existing dataset style.
  const m = first.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[1].trim()}, ${m[2].trim()}` : first;
}

function parseSeats(raw: string): number | null {
  const n = parseInt(raw.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function parseCredits(raw: string): number {
  // Units may be "1", "3", "0.5", or a range "1-3" — take the first number.
  const m = raw.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

export function rawToCourseRow(raw: RawRow, termFile: string): CourseRow | null {
  const { prefix, number, title } = parseCourse(raw.course);
  if (!prefix || !number) return null;
  const crn = raw.classNbr.trim();
  if (!/^\d+$/.test(crn)) return null;
  const m = parseMeeting(raw.meeting);
  return {
    college_code: COLLEGE_CODE,
    term: termFile,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits: parseCredits(raw.units),
    crn,
    days: m.days,
    start_time: m.start_time,
    end_time: m.end_time,
    start_date: parseStartDate(raw.dateRange),
    location: m.location,
    campus: m.campus,
    mode: m.mode,
    instructor: parseInstructor(raw.instructor),
    seats_open: parseSeats(raw.openSeats),
    seats_total: null, // Open Classes List publishes open seats only; never fabricate capacity.
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

// ---------------------------------------------------------------------------
// Playwright driving
// ---------------------------------------------------------------------------

async function settleHeader(page: Page, careerLabel: string, termHeader: string): Promise<boolean> {
  const want = `Showing All Open ${careerLabel} classes in ${termHeader}`;
  try {
    await page.waitForFunction(
      (expected) => (document.body?.innerText || "").includes(expected),
      want,
      { timeout: SETTLE_TIMEOUT },
    );
    return true;
  } catch {
    return false;
  }
}

async function selectAndSettle(
  page: Page,
  selector: string,
  value: string,
  careerLabel: string,
  termHeader: string,
): Promise<boolean> {
  await page.selectOption(selector, value);
  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => {});
  await sleep(800);
  return settleHeader(page, careerLabel, termHeader);
}

async function extractRows(page: Page): Promise<RawRow[]> {
  // NB: this callback is serialized and run in the browser. It must NOT declare
  // any inner function (named decl OR arrow const): tsx/esbuild's keepNames
  // injects a `__name(...)` wrapper that does not exist in the page context
  // (ReferenceError: __name). So every cell read is inlined, as in scrape-laccd.
  return page.evaluate(() => {
    const out: RawRow[] = [];
    for (let i = 0; ; i++) {
      const classNbrEl = document.getElementById(`LBC_CLSLIST_DW_LBC_CLASS_NBR_CHAR$${i}`);
      if (!classNbrEl) break;
      out.push({
        classNbr: (classNbrEl as HTMLElement).innerText.trim(),
        course:
          (document.getElementById(`LBC_COURSE_HTML$${i}`) as HTMLElement | null)?.innerText.trim() || "",
        units:
          (document.getElementById(`LBC_CLSLIST_DW_LBC_UNITS_HTML$${i}`) as HTMLElement | null)?.innerText.trim() || "",
        dateRange:
          (document.getElementById(`LBC_CLSLIST_DW_LBC_DATERANGE_HTML$${i}`) as HTMLElement | null)?.innerText.trim() || "",
        meeting:
          (document.getElementById(`LBC_CLSLIST_DW_LBC_MEETING_CHAR$${i}`) as HTMLElement | null)?.innerText.trim() || "",
        instructor:
          (document.getElementById(`LBC_CLSLIST_DW_LBC_INSTR_CHAR$${i}`) as HTMLElement | null)?.innerText.trim() || "",
        openSeats:
          (document.getElementById(`LBC_CLSLIST_DW_SSR_TOTAL_SEATS$${i}`) as HTMLElement | null)?.innerText.trim() || "",
      });
    }
    return out;
  });
}

async function scrapeTerm(
  page: Page,
  term: { name: string; strm: string; file: string; header: string },
): Promise<CourseRow[]> {
  console.log(`\n[${term.name}] navigating to Open Classes List…`);
  await page.goto(LIST_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
  await sleep(1500);

  // Ensure Academic Career = Credit and Class Type = All Open Classes.
  // (Defaults are usually CRED + ALL, but set them explicitly to be safe.)
  await page.selectOption(SEL_CAREER, "CRED").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => {});
  await sleep(600);
  await page.selectOption(SEL_CLASS_TYPE, "ALL").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => {});
  await sleep(600);

  // Select the term and wait for the grid header to settle.
  const ok = await selectAndSettle(page, SEL_TERM, term.strm, "Credit", term.header);
  if (!ok) {
    throw new Error(
      `[${term.name}] grid header never settled to "Showing All Open Credit classes in ${term.header}"`,
    );
  }
  await sleep(1000); // let the full grid finish rendering

  const raw = await extractRows(page);
  console.log(`[${term.name}] grid rendered ${raw.length} rows`);
  if (raw.length === 0) {
    throw new Error(`[${term.name}] zero rows extracted despite settled header`);
  }

  const rows: CourseRow[] = [];
  let dropped = 0;
  for (const r of raw) {
    const cr = rawToCourseRow(r, term.file);
    if (cr) rows.push(cr);
    else dropped++;
  }
  console.log(`[${term.name}] parsed ${rows.length} sections (${dropped} dropped as unparseable)`);
  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { terms, headed } = parseArgs();
  console.log(`LBCC scraper — terms: ${terms.map((t) => t.name).join(", ")}`);

  let browser: Browser | null = null;
  const results: Array<{ term: string; file: string; count: number; sample: CourseRow | null }> = [];

  try {
    browser = await chromium.launch({ headless: !headed });
    const ctx = await browser.newContext({ userAgent: UA, acceptDownloads: false });
    const page = await ctx.newPage();

    // Cookie bootstrap: GET the guest Fluid landing page to seed PS_TOKEN /
    // PS_TokenSite, without which the Open Classes List redirect-loops to login.
    console.log("Seeding guest cookies via landing page…");
    await page.goto(LANDING_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    await sleep(1200);
    const cookies = await ctx.cookies();
    // The guest session marker is PS_TokenSite (+ PS_LASTSITE pinned to `guest`).
    // Headless Playwright surfaces PS_TokenSite rather than a literal PS_TOKEN.
    const hasToken = cookies.some(
      (c) => c.name === "PS_TokenSite" || c.name === "PS_TOKEN",
    );
    const lastSite = cookies.find((c) => c.name === "PS_LASTSITE")?.value || "";
    if (!hasToken) {
      throw new Error(
        "Guest cookie bootstrap failed — PS_TokenSite not set after landing-page GET",
      );
    }
    console.log(
      `Guest cookies seeded (${cookies.length} cookies, PS_TokenSite present, PS_LASTSITE=${lastSite}).`,
    );

    for (const term of terms) {
      const rows = await scrapeTerm(page, term);
      // Write only on success with non-empty data (never write empty/stub files).
      if (rows.length === 0) {
        console.error(`[${term.name}] no rows — skipping write per no-stub rule.`);
        continue;
      }
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const outPath = path.join(DATA_DIR, `${term.file}.json`);
      // Idempotent: deterministic order (by CRN) so re-runs produce stable diffs.
      rows.sort((a, b) => a.crn.localeCompare(b.crn, undefined, { numeric: true }));
      fs.writeFileSync(outPath, JSON.stringify(rows, null, 2) + "\n");
      console.log(`[${term.name}] wrote ${rows.length} rows → ${outPath}`);
      results.push({ term: term.name, file: term.file, count: rows.length, sample: rows[0] });
    }
  } finally {
    if (browser) await browser.close();
  }

  // Summary
  console.log("\n========== SUMMARY ==========");
  if (results.length === 0) {
    console.error("No terms written. Reporting as NOT-COMPLETED.");
    process.exit(1);
  }
  for (const r of results) {
    console.log(`${r.term} (${r.file}): ${r.count} sections`);
    if (r.sample) {
      console.log(
        `  sample: ${r.sample.course_prefix} ${r.sample.course_number} "${r.sample.course_title}" ` +
          `crn=${r.sample.crn} ${r.sample.days} ${r.sample.start_time}-${r.sample.end_time} ` +
          `mode=${r.sample.mode} campus=${r.sample.campus} seats_open=${r.sample.seats_open}`,
      );
    }
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
