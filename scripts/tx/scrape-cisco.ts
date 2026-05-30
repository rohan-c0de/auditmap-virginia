/**
 * scrape-cisco.ts — Cisco College (TX) class-section scraper.
 *
 * Cisco runs the "CC4" (Power Campus / Jenzabar) public course-availability
 * widget at https://admin.cisco.edu/cc4/web_course_avail.html. The page wraps
 * a PXwidget that, on form submit, AJAX-loads a single large HTML table into
 * a #PXworkArea div. The table holds every section for the chosen term and
 * has a fixed 16-column schema — Course ID, Term Code, Course Title, Meeting
 * Days, Start/End Time, Start/End Date, Location, Instructor, Credits, Limit,
 * Enrolled, Campus, Short ID, Notes — which maps cleanly onto CourseSection.
 *
 * The widget bootstrap is JS-heavy (jQuery + PX framework + session cookies)
 * so a static curl can't reach the table; Playwright is needed but the run
 * itself is trivial: one click per term, ~10s per term. Fall 2026 returns
 * 2,032 rows in a single AJAX response.
 *
 * Output: data/tx/courses/cisco-college/{TERM}.json
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-cisco.ts                 # all available terms
 *   npx tsx scripts/tx/scrape-cisco.ts --term 2026FA   # one term
 *   npx tsx scripts/tx/scrape-cisco.ts --headed        # visible browser
 */

import { chromium, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

const SLUG = "cisco-college";
const COLLEGE_CODE = SLUG;
const COURSES_DIR = path.join(process.cwd(), "data", "tx", "courses", SLUG);
const ENTRY_URL = "https://admin.cisco.edu/cc4/web_course_avail.html";

// CC4 term codes → human file codes. The dropdown values include a trailing
// `/FILTER=...` clause that must be sent verbatim. Map: human → (cc4-value,
// numeric code that appears in result rows' Term Code column).
const TERMS: Array<{ file: string; cc4Value: string; code: string }> = [
  { file: "2026SU1", cc4Value: "253S/FILTER=.TERMCODE='253S'", code: "253S" },
  { file: "2026SU2", cc4Value: "254S/FILTER=.TERMCODE='254S'", code: "254S" },
  { file: "2026SUL", cc4Value: "253L/FILTER=.TERMCODE='253L'", code: "253L" },
  { file: "2026FA",  cc4Value: "261S/FILTER=TERMCODE='261S'",  code: "261S" },
  { file: "2026FA2", cc4Value: "262F/FILTER=.TERMCODE='262F'", code: "262F" },
];

const NAV_TIMEOUT = 60_000;
const PAGE_SETTLE = 5_000;
const RESULTS_TIMEOUT = 30_000;
const PER_TERM_DELAY = 2_000;

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number | null;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string;
  location: string;
  campus: string;
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  status: string;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface RawRow {
  courseId: string;
  termCode: string;
  title: string;
  days: string;
  startTime: string;
  endTime: string;
  startDate: string;
  endDate: string;
  location: string;
  instructor: string;
  credits: string;
  limit: string;
  enrolled: string;
  campus: string;
  shortId: string;
  notes: string;
}

function parseArgs(): { onlyTerm: string | null; headed: boolean } {
  const a = process.argv.slice(2);
  let onlyTerm: string | null = null;
  let headed = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--term" && a[i + 1]) onlyTerm = a[++i];
    else if (a[i] === "--headed") headed = true;
  }
  return { onlyTerm, headed };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function loadForm(page: Page): Promise<void> {
  await page.goto(ENTRY_URL, { waitUntil: "load", timeout: NAV_TIMEOUT });
  await page.waitForSelector("#TermSelect", { timeout: 20_000 });
  await sleep(PAGE_SETTLE);
}

async function runTermQuery(page: Page, cc4Value: string): Promise<RawRow[]> {
  // Set TermSelect = the chosen term, CampSelect = ALL, DeptSelect = ALL,
  // then click the page's Display button (its onclick fires PXwidgetOption,
  // which renders the result table into #PXworkArea via AJAX). The button
  // must be clicked through the page's own handler — submitting the form
  // directly bypasses PXwidget and sends literal %%pid$%% template tokens.
  await page.evaluate((v) => {
    (document.getElementById("TermSelect") as HTMLSelectElement).value = v;
    (document.getElementById("campSelect") as HTMLSelectElement).value = "ALL";
    (document.getElementById("deptselect") as HTMLSelectElement).value = "ALL";
  }, cc4Value);
  await sleep(500);
  // Clear any prior results so we can detect when the new ones arrive.
  await page.evaluate(() => {
    const wa = document.getElementById("PXworkArea");
    if (wa) wa.innerHTML = "";
  });
  await page.evaluate(() => {
    (document.forms[0].querySelector("input[type=button]") as HTMLInputElement).click();
  });
  // Poll for the result table to render. A populated PXworkArea has >1 row.
  const deadline = Date.now() + RESULTS_TIMEOUT;
  while (Date.now() < deadline) {
    await sleep(1000);
    const rowCount = await page.evaluate(() => {
      const wa = document.getElementById("PXworkArea");
      if (!wa) return -1;
      return wa.querySelectorAll("tr").length;
    });
    if (rowCount > 1) break;
  }
  return page.evaluate(() => {
    // Inline literal expressions — tsx wraps function declarations with
    // __name(), which page.evaluate can't resolve.
    const wa = document.getElementById("PXworkArea");
    if (!wa) return [] as RawRow[];
    const table = wa.querySelector("table");
    if (!table) return [] as RawRow[];
    const trs = Array.from(table.querySelectorAll("tr"));
    if (trs.length < 2) return [] as RawRow[];
    // Header may have multiple sub-rows; find the row whose first cell text
    // matches "Course ID" and treat subsequent rows as data.
    let headerIdx = -1;
    for (let i = 0; i < trs.length; i++) {
      const first = (trs[i].cells[0]?.textContent || "").trim();
      if (first === "Course ID") { headerIdx = i; break; }
    }
    if (headerIdx < 0) return [] as RawRow[];
    const out: RawRow[] = [];
    for (let i = headerIdx + 1; i < trs.length; i++) {
      const cells = Array.from(trs[i].cells).map((c) => (c.textContent || "").trim().replace(/\s+/g, " "));
      if (cells.length < 14 || !cells[0]) continue;
      out.push({
        courseId: cells[0] || "",
        termCode: cells[1] || "",
        title: cells[2] || "",
        days: cells[3] || "",
        startTime: cells[4] || "",
        endTime: cells[5] || "",
        startDate: cells[6] || "",
        endDate: cells[7] || "",
        location: cells[8] || "",
        instructor: cells[9] || "",
        credits: cells[10] || "",
        limit: cells[11] || "",
        enrolled: cells[12] || "",
        campus: cells[13] || "",
        shortId: cells[14] || "",
        notes: cells[15] || "",
      });
    }
    return out;
  });
}

// Parse "ACCT-2301 E1" or "BIOL-1408 01" → { prefix:"ACCT", number:"2301", section:"E1" }
function parseCourseId(id: string): { prefix: string; number: string; section: string } | null {
  const m = id.match(/^([A-Z]{2,5})-?(\d{3,4}[A-Z]?)\s+(\S+)\s*$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], section: m[3] };
}

function normalizeTime(t: string): string {
  // Cisco shows times like "8:00AM" or "10:30 AM" or blank/TBA.
  if (!t || /^TBA$/i.test(t)) return "";
  return t.replace(/\s+/g, "");
}

function toInt(s: string): number | null {
  const n = parseInt((s || "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function toFloat(s: string): number | null {
  const n = parseFloat((s || "").trim());
  return Number.isFinite(n) ? n : null;
}

function rawToSection(r: RawRow, termFile: string): CourseSection | null {
  const ch = parseCourseId(r.courseId);
  if (!ch) return null;
  const limit = toInt(r.limit);
  const enrolled = toInt(r.enrolled);
  const seatsOpen = limit !== null && enrolled !== null ? Math.max(0, limit - enrolled) : null;
  const status = limit !== null && enrolled !== null ? (enrolled >= limit ? "Closed" : "Open") : "";
  return {
    college_code: COLLEGE_CODE,
    term: termFile,
    course_prefix: ch.prefix,
    course_number: ch.number,
    course_title: r.title,
    credits: toFloat(r.credits),
    crn: r.shortId || `${ch.prefix}${ch.number}-${ch.section}`,
    days: r.days,
    start_time: normalizeTime(r.startTime),
    end_time: normalizeTime(r.endTime),
    start_date: r.startDate,
    end_date: r.endDate,
    location: r.location,
    campus: r.campus,
    mode: "",
    instructor: r.instructor || null,
    seats_open: seatsOpen,
    seats_total: limit,
    status: status,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

async function main() {
  const args = parseArgs();
  fs.mkdirSync(COURSES_DIR, { recursive: true });
  const targets = args.onlyTerm ? TERMS.filter((t) => t.file === args.onlyTerm) : TERMS;
  if (targets.length === 0) {
    console.error(`Unknown term '${args.onlyTerm}'. Known: ${TERMS.map((t) => t.file).join(", ")}`);
    process.exit(1);
  }

  console.log(`Cisco College scraper — ${targets.length} term(s): ${targets.map((t) => t.file).join(", ")}`);

  const browser = await chromium.launch({ headless: !args.headed });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  });
  const page = await ctx.newPage();

  try {
    for (const term of targets) {
      console.log(`\n=== ${term.file} (${term.code}) ===`);
      await loadForm(page);
      const raw = await runTermQuery(page, term.cc4Value);
      console.log(`  raw rows: ${raw.length}`);
      const sections: CourseSection[] = [];
      const seenCRNs = new Set<string>();
      let skipped = 0;
      for (const r of raw) {
        const s = rawToSection(r, term.file);
        if (!s) { skipped++; continue; }
        if (seenCRNs.has(s.crn)) continue;
        seenCRNs.add(s.crn);
        sections.push(s);
      }
      console.log(`  parsed: ${sections.length} sections (${skipped} skipped malformed)`);
      const out = path.join(COURSES_DIR, `${term.file}.json`);
      fs.writeFileSync(out, JSON.stringify(sections, null, 2));
      console.log(`  ✓ ${out}`);
      await sleep(PER_TERM_DELAY);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
