/**
 * scrape-smc.ts — Santa Monica College public "Online Class List"
 *
 * Source: Oracle APEX application 373 (no login), reached from
 *   https://www.smc.edu/searchclasses  →  https://smccis.smc.edu/smcweb/f?p=373:1
 *
 * Mechanism (confirmed by live inspection 2026-06-08):
 *   • The search page is a single APEX page (f?p=373:1) with a term <select>
 *     (#P1_SEMCODE) and a multi-select subject list (#P1_SUBJECTS). Class Type
 *     defaults to "Regular & Online" and Status to "Open & Closed & See
 *     Instructor", so a (term, subject) pair is a complete, valid search.
 *   • The "Search" button runs `apex.submit({request:'SUBMIT'})`, which POSTs
 *     the form to wwv_flow.accept and 302-redirects back to
 *     f?p=373:1:<session>:SEARCH::RP:: with the results region (#schedule_result
 *     → table#report_table_schedule_result) populated. We drive that submit
 *     directly and wait for the "Query Results" heading.
 *   • Results table columns: Course Name ("ACCTG  1"), Former Name, Course
 *     Title, Section (the section number — used as CRN), Status (OPEN/CLOSED/
 *     CANCELLED/SEE INSTRUCTOR), Schedule ("MW 8 a.m.-10:15 a.m." or
 *     "ARRANGE-3Hours" for async), Section Modality (On Ground / Hybrid /
 *     Hyflex / Scheduled / Flexible / …), Campus, Location ("SCI 157" /
 *     "ONLINE"), Instructor ("KING J"), Begin-End Week, Begin-End Date
 *     ("08/31 - 12/22"), Books.
 *   • A section with multiple meeting patterns (e.g. lecture + lab) appears as
 *     several rows sharing the same Section number; we group by section and
 *     merge day tokens, keeping the earliest-listed meeting's times/location.
 *   • Units (credits) are NOT in the schedule table. They are parsed once per
 *     term from the public catalog page web_cat_sched_<termcode>.html
 *     ("ACCTG 1, Financial Accounting 5 units"). Seat counts are not published
 *     anywhere in the public app, so seats_open/seats_total are null.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-smc.ts                       # all upcoming terms, all subjects
 *   npx tsx scripts/ca/scrape-smc.ts --term "Fall 2026"
 *   npx tsx scripts/ca/scrape-smc.ts --term "Fall 2026,Spring 2026"
 *   npx tsx scripts/ca/scrape-smc.ts --term "Fall 2026" --subject 25   # single subject id
 *   npx tsx scripts/ca/scrape-smc.ts --headed
 *
 * Output: data/ca/courses/santa-monica-college/<2026FA|2026SP|2026SU>.json
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const COLLEGE_CODE = "santa-monica-college";
const SEARCH_URL = "https://smccis.smc.edu/smcweb/f?p=373:1";
const CATALOG_URL = (termCode: string) =>
  `https://smccis.smc.edu/isisdoc/web_cat_sched_${termCode}.html`;

const NAV_TIMEOUT = 45_000;
const SEARCH_WAIT = 60_000;
const INTER_SEARCH_DELAY = 700;

const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses", COLLEGE_CODE);

// APEX term code → file-term code. Discovered from the #P1_SEMCODE <select>.
const TERMS: Record<string, { code: string; file: string }> = {
  "Spring 2026": { code: "20261", file: "2026SP" },
  "Summer 2026": { code: "20262", file: "2026SU" },
  "Fall 2026": { code: "20263", file: "2026FA" },
};

// SMC day tokens → contract tokens (M Tu W Th F Sa Su).
// SMC legend: U-Sunday M-Monday T-Tuesday W-Wednesday Th-Thursday F-Friday S-Saturday.
// Order matters: match the 2-char "Th" before single "T", and "Sa"/"Su" forms.
const DAY_TOKENS: Array<[RegExp, string]> = [
  [/^Th/, "Th"],
  [/^Su/, "Su"],
  [/^Sa/, "Sa"],
  [/^U/, "Su"],
  [/^S/, "Sa"],
  [/^M/, "M"],
  [/^T/, "Tu"],
  [/^W/, "W"],
  [/^F/, "F"],
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawRow {
  course: string;
  title: string;
  section: string;
  status: string;
  schedule: string;
  modality: string;
  campus: string;
  location: string;
  instructor: string;
  dates: string;
}

interface Section {
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
  mode: "in-person" | "online" | "hybrid" | "zoom";
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const argv = process.argv.slice(2);
  let terms: string[] | null = null;
  let subjectFilter: string | null = null;
  let headed = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--term" && argv[i + 1]) {
      terms = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--subject" && argv[i + 1]) {
      subjectFilter = argv[++i].trim();
    } else if (a === "--headed") {
      headed = true;
    }
  }
  return { terms, subjectFilter, headed };
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Strip private-use-area glyphs (SMC's info-icon font uses U+E000–U+F8FF),
 * control chars, and collapse whitespace. The schedule report embeds icon
 * <span>s whose font glyphs render as PUA code points in innerText.
 */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function clean(s: string): string {
  return s
    .replace(/[\u00A0]/g, " ")
    .replace(/[\uE000-\uF8FF\uFEFF\u200B-\u200F\u2028\u2029\u0000-\u001F]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "ACCTG  1" → { prefix: "ACCTG", number: "1" } */
function splitCourse(courseName: string): { prefix: string; number: string } | null {
  const m = courseName.replace(/\s+/g, " ").trim().match(/^([A-Z]+(?:\/[A-Z]+)?)\s+([0-9]+[A-Z]*)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

/** "MW" → "M W" ; "TTh" → "Tu Th" ; "" if unparseable */
function parseDays(raw: string): string {
  let s = raw.trim();
  const out: string[] = [];
  let guard = 0;
  while (s.length > 0 && guard++ < 12) {
    let matched = false;
    for (const [re, tok] of DAY_TOKENS) {
      const m = s.match(re);
      if (m) {
        out.push(tok);
        s = s.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) s = s.slice(1); // skip stray char
  }
  return out.join(" ");
}

/** Normalize "8 a.m." / "10:15 a.m." / "3 p.m." → "8:00 AM" / "10:15 AM" / "3:00 PM" */
function normalizeTime(raw: string): string | null {
  const m = raw
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|noon)$/);
  if (!m) {
    // "noon" / "12 noon"
    if (/noon/i.test(raw)) return "12:00 PM";
    return null;
  }
  if (m[3] === "noon") return "12:00 PM";
  const hh = parseInt(m[1], 10);
  const mm = m[2] ? m[2] : "00";
  const ap = m[3].startsWith("a") ? "AM" : "PM";
  return `${hh}:${mm} ${ap}`;
}

/**
 * Parse a Schedule cell.
 *   "MW 8 a.m.-10:15 a.m."  → days "M W", start "8:00 AM", end "10:15 AM"
 *   "ARRANGE-3Hours"        → async, days "", times ""
 *   "TBA"                   → async
 */
function parseSchedule(raw: string): { days: string; start: string; end: string } {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s || /^ARRANGE/i.test(s) || /^TBA/i.test(s) || /^N\/A/i.test(s)) {
    return { days: "", start: "", end: "" };
  }
  // Split leading day-letters from the time range.
  const m = s.match(/^([A-Za-z]+)\s+(.+?)-(.+)$/);
  if (!m) {
    return { days: parseDays(s), start: "", end: "" };
  }
  const days = parseDays(m[1]);
  const start = normalizeTime(m[2]) ?? "";
  const end = normalizeTime(m[3]) ?? "";
  return { days, start, end };
}

/** "08/31 - 12/22" → "2026-08-31" (uses the term's calendar year) */
function parseStartDate(raw: string, year: number): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Map SMC modality + location → contract mode. */
function deriveMode(modality: string, location: string, campus: string): Section["mode"] {
  const mod = modality.toLowerCase();
  const loc = location.toLowerCase();
  const camp = campus.toLowerCase();
  if (mod.includes("hybrid")) return "hybrid";
  if (mod.includes("hyflex")) return "hybrid";
  if (mod.includes("scheduled") && !mod.includes("flex")) return "zoom"; // "Online – Scheduled" = live Zoom meetings
  if (mod.includes("flex") || mod.includes("online")) return "online";
  if (mod.includes("on ground") || mod.includes("ground")) return "in-person";
  // fall back to location/campus
  if (loc.includes("online") || camp.includes("online")) return "online";
  return "in-person";
}

function titleCaseInstructor(raw: string): string | null {
  const s = raw.trim();
  if (!s || /^staff$/i.test(s) || s === "-" || /^tba$/i.test(s)) return null;
  return s;
}

// ---------------------------------------------------------------------------
// Catalog (units) fetch
// ---------------------------------------------------------------------------

async function fetchUnits(page: Page, termCode: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const url = CATALOG_URL(termCode);
  let html = "";
  // SMC's isisdoc host serves an incomplete TLS chain; use a lenient request
  // context (read-only public catalog HTML, no credentials) to fetch it.
  const ctx = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
  try {
    const resp = await ctx.request.get(url, { timeout: NAV_TIMEOUT });
    if (!resp.ok()) {
      console.warn(`  [units] catalog HTTP ${resp.status()} for ${url} — credits will default to 0`);
      return map;
    }
    html = await resp.text();
  } catch (e: unknown) {
    console.warn(`  [units] catalog fetch failed (${errMsg(e)}) — credits will default to 0`);
    return map;
  } finally {
    await ctx.close();
  }
  const txt = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  // Catalog entries take two forms, both "<CODE><sep> <Title> <N> units":
  //   "ACCTG 1, Financial Accounting 5 units"               (regular courses)
  //   "MATH 2C: Concurrent Support for Precalculus 7 units" (co-req support)
  // Accept either a comma or a colon as the code/title separator. Title runs
  // up to the units count (no comma/colon inside it). Ranges ("1-3 units")
  // keep the low number.
  const re = /([A-Z]{2,}(?:\/[A-Z]+)?\s+[0-9]+[A-Z]*)[,:]\s+[^,:]{2,90}?\s+([0-9]+(?:\.[0-9]+)?)(?:\s*-\s*[0-9.]+)?\s+units?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt)) !== null) {
    const key = m[1].replace(/\s+/g, " ").trim();
    const units = parseFloat(m[2]);
    if (!Number.isNaN(units) && !map.has(key)) map.set(key, units);
  }
  console.log(`  [units] parsed ${map.size} course→units entries from catalog`);
  return map;
}

// ---------------------------------------------------------------------------
// Scrape one (term, subject)
// ---------------------------------------------------------------------------

const ROW_EXTRACT = `
  (function () {
    var trs = Array.prototype.slice.call(
      document.querySelectorAll("#report_table_schedule_result tbody tr")
    );
    return trs.map(function (tr) {
      function c(h) {
        var el = tr.querySelector('td[headers="' + h + '"]');
        return el ? el.innerText.replace(/\\s+/g, " ").trim() : "";
      }
      return {
        course: c("COURSE_NAME"), title: c("COURSE_TITLE"), section: c("SECTION"),
        status: c("CLS_STATUS"), schedule: c("SCHEDULE"), modality: c("SECTION_MODALITY"),
        campus: c("CAMPUS"), location: c("LOCATION"), instructor: c("INSTRUCTOR"),
        dates: c("BEGIN_END_DATE")
      };
    });
  })()
`;

async function getSubjects(page: Page): Promise<Array<{ id: string; name: string }>> {
  const subs: Array<{ id: string; name: string }> = await page.evaluate(`
    (function () {
      var sel = document.querySelector("#P1_SUBJECTS");
      if (!sel) return [];
      return Array.prototype.slice.call(sel.querySelectorAll("option"))
        .filter(function (o) { return o.value && o.value !== "0"; })
        .map(function (o) { return { id: o.value, name: o.textContent.trim() }; });
    })()
  `);
  return subs;
}

async function searchSubject(
  page: Page,
  termCode: string,
  subjectId: string
): Promise<RawRow[]> {
  // Always start from a clean search page so item state is fresh.
  await page.goto(SEARCH_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
  await page.selectOption("#P1_SEMCODE", termCode);
  await page.selectOption("#P1_SUBJECTS", subjectId);

  await page.evaluate(`window.apex.submit({ request: "SUBMIT" })`);
  await page.waitForLoadState("load", { timeout: SEARCH_WAIT }).catch(() => {});

  // Either results appear, or the "no rows" / instructions region stays.
  await page
    .waitForFunction(
      `(function(){
        var h=(document.querySelector('#schedule_result_heading')||{}).textContent||'';
        var hasTable=!!document.querySelector('#report_table_schedule_result tbody tr');
        return /Query Results/.test(h) || hasTable || /no data|not find|0 records/i.test(
          (document.querySelector('#schedule_result')||{}).innerText||'');
      })()`,
      { timeout: SEARCH_WAIT }
    )
    .catch(() => {});
  await page.waitForTimeout(400);

  // APEX renders the results report 25 rows per page. Walk every page via the
  // "Next" pagination button, accumulating rows, until the button disappears.
  // We de-dupe by (section + schedule) because a meeting row can repeat if a
  // page boundary lands mid-section, and stop on the row-info text settling.
  const ROW_INFO = `(function(){
    var sr=(document.querySelector('#schedule_result')||{}).innerText||'';
    var m=sr.match(/row\\(s\\)\\s*([0-9]+\\s*-\\s*[0-9]+)\\s*of\\s*([0-9]+)/i);
    return m ? m[1].replace(/\\s/g,'')+'/'+m[2] : '';
  })()`;

  const all: RawRow[] = [];
  const seen = new Set<string>();
  const MAX_PAGES = 200; // safety; SMC's largest subject is ~10 pages
  for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
    const rows: RawRow[] = await page.evaluate(ROW_EXTRACT);
    for (const r of rows) {
      const key = `${r.section}|${r.schedule}|${r.location}|${r.dates}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(r);
      }
    }

    const nextCount = await page.locator(".t-Report-paginationLink--next").count();
    if (nextCount === 0) break;

    const before = await page.evaluate(ROW_INFO);
    await page.locator(".t-Report-paginationLink--next").first().click().catch(() => {});
    // Wait for the row-info banner to advance; if it doesn't, assume last page.
    const changed = await page
      .waitForFunction(`${ROW_INFO} !== ${JSON.stringify(before)}`, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!changed) break;
    await page.waitForTimeout(250);
  }
  return all;
}

// ---------------------------------------------------------------------------
// Build sections from raw rows (group multi-meeting sections)
// ---------------------------------------------------------------------------

function buildSections(
  rows: RawRow[],
  fileTerm: string,
  year: number,
  units: Map<string, number>
): Section[] {
  // Sanitize every field first (strips info-icon PUA glyphs the report embeds).
  const cleaned: RawRow[] = rows.map((r) => ({
    course: clean(r.course),
    title: clean(r.title),
    section: clean(r.section),
    status: clean(r.status),
    schedule: clean(r.schedule),
    modality: clean(r.modality),
    campus: clean(r.campus),
    location: clean(r.location),
    instructor: clean(r.instructor),
    dates: clean(r.dates),
  }));

  // Group by section number; merge meeting day tokens, keep first row's times.
  const bySection = new Map<string, RawRow[]>();
  for (const r of cleaned) {
    const key = r.section.trim();
    if (!key) continue;
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key)!.push(r);
  }

  const out: Section[] = [];
  for (const [section, group] of Array.from(bySection.entries())) {
    const head = group[0];
    const parts = splitCourse(head.course);
    if (!parts) continue; // skip un-parseable course names rather than fabricate

    // Merge day tokens across all meetings; take the first meeting that has a time.
    const dayTokens: string[] = [];
    let start = "";
    let end = "";
    let location = head.location;
    for (const r of group) {
      const sched = parseSchedule(r.schedule);
      for (const tok of sched.days.split(" ").filter(Boolean)) {
        if (!dayTokens.includes(tok)) dayTokens.push(tok);
      }
      if (!start && sched.start) {
        start = sched.start;
        end = sched.end;
        if (r.location) location = r.location;
      }
    }

    const courseKey = `${parts.prefix} ${parts.number}`;
    const credits = units.get(courseKey) ?? 0;
    const startDate = parseStartDate(head.dates, year);

    out.push({
      college_code: COLLEGE_CODE,
      term: fileTerm,
      course_prefix: parts.prefix,
      course_number: parts.number,
      course_title: head.title.trim(),
      credits,
      crn: section,
      days: dayTokens.join(" "),
      start_time: start,
      end_time: end,
      start_date: startDate ?? "",
      location: location.trim(),
      campus: head.campus.trim(),
      mode: deriveMode(head.modality, location, head.campus),
      instructor: titleCaseInstructor(head.instructor),
      seats_open: null, // not published in SMC's public class list
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  // Stable sort: prefix, number, crn
  out.sort(
    (a, b) =>
      a.course_prefix.localeCompare(b.course_prefix) ||
      a.course_number.localeCompare(b.course_number, undefined, { numeric: true }) ||
      a.crn.localeCompare(b.crn, undefined, { numeric: true })
  );
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  const { terms, subjectFilter, headed } = parseArgs();
  const termNames = terms ?? Object.keys(TERMS);

  // Validate term names.
  for (const t of termNames) {
    if (!TERMS[t]) {
      console.error(`Unknown term "${t}". Known: ${Object.keys(TERMS).join(", ")}`);
      process.exit(1);
    }
  }

  const browser: Browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  let anyWritten = false;
  try {
    for (const termName of termNames) {
      const { code: termCode, file: fileTerm } = TERMS[termName];
      const year = parseInt(fileTerm.slice(0, 4), 10);
      console.log(`\n=== ${termName} (${termCode} → ${fileTerm}) ===`);

      // Seed page + discover subjects.
      await page.goto(SEARCH_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
      let subjects = await getSubjects(page);
      if (subjectFilter) subjects = subjects.filter((s) => s.id === subjectFilter);
      if (subjects.length === 0) {
        console.error(`  No subjects found${subjectFilter ? ` matching ${subjectFilter}` : ""}.`);
        continue;
      }
      console.log(`  ${subjects.length} subjects to scrape`);

      const units = await fetchUnits(page, termCode);

      const allRows: RawRow[] = [];
      for (let i = 0; i < subjects.length; i++) {
        const subj = subjects[i];
        let rows: RawRow[] = [];
        try {
          rows = await searchSubject(page, termCode, subj.id);
        } catch (e: unknown) {
          console.warn(`  [${subj.name}] error: ${errMsg(e)} — retrying once`);
          try {
            rows = await searchSubject(page, termCode, subj.id);
          } catch (e2: unknown) {
            console.warn(`  [${subj.name}] failed again: ${errMsg(e2)}`);
          }
        }
        console.log(`  [${i + 1}/${subjects.length}] ${subj.name}: ${rows.length} meeting rows`);
        allRows.push(...rows);
        await page.waitForTimeout(INTER_SEARCH_DELAY);
      }

      if (allRows.length === 0) {
        console.error(`  No rows scraped for ${termName} — writing nothing for this term.`);
        continue;
      }

      const sections = buildSections(allRows, fileTerm, year, units);
      if (sections.length === 0) {
        console.error(`  0 sections after parsing ${allRows.length} rows — writing nothing.`);
        continue;
      }

      fs.mkdirSync(DATA_DIR, { recursive: true });
      const outPath = path.join(DATA_DIR, `${fileTerm}.json`);
      fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
      anyWritten = true;
      console.log(`  ✓ wrote ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);

      // Quick integrity summary.
      const withCredits = sections.filter((s) => s.credits > 0).length;
      const withDays = sections.filter((s) => s.days).length;
      const modes = sections.reduce<Record<string, number>>((acc, s) => {
        acc[s.mode] = (acc[s.mode] || 0) + 1;
        return acc;
      }, {});
      console.log(
        `    credits>0: ${withCredits}/${sections.length} · scheduled(days): ${withDays} · modes: ${JSON.stringify(modes)}`
      );
    }
  } finally {
    await browser.close();
  }

  if (!anyWritten) {
    console.error("\nNothing written. Source could not be driven or returned no data.");
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
