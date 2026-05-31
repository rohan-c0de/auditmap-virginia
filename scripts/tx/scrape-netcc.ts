/**
 * scrape-netcc.ts — Northeast Texas Community College (TX) class-section scraper.
 *
 * NTCC runs Jenzabar JICS with the Simple_Query "Find Courses" portlet at
 * https://myeagle.ntcc.edu/ICS/Find_Courses/. The page lists every active
 * term with a "View Results" link + an "Excel" export link per term. The
 * Excel link only works after the term's View Results postback has been
 * triggered (it primes a server-side cache); calling it cold returns
 * "Export failed. (cache empty)".
 *
 * Strategy:
 *   1. Playwright load /ICS/Find_Courses/ — no auth needed
 *   2. For each target term: click `__doPostBack('pgN$V$lnkViewResults','')`
 *      then fetch the now-active Excel link through the page's cookie
 *      context (Playwright's request.get inherits session)
 *   3. Auto-detect file format (the Excel link's content-type is
 *      application/octet-stream regardless of actual body): if it sniffs
 *      as HTML or SpreadsheetML XML, parse with cheerio; if it looks
 *      tab/comma-separated, parse as delimited text.
 *   4. Map columns to CourseSection schema (Status, Div, Course, Seq,
 *      BegTime, EndTime, Days, Instr, Cap, Enr, Avail, Begin, End, Census)
 *
 * Output: data/tx/courses/northeast-texas-community-college/{TERM}.json
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-netcc.ts                  # all listed terms
 *   npx tsx scripts/tx/scrape-netcc.ts --term 2026FA    # one term
 *   npx tsx scripts/tx/scrape-netcc.ts --headed         # visible browser
 */

import { chromium, type Page } from "playwright";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "northeast-texas-community-college";
const COLLEGE_CODE = SLUG;
const COURSES_DIR = path.join(process.cwd(), "data", "tx", "courses", SLUG);
const ENTRY_URL = "https://myeagle.ntcc.edu/ICS/Find_Courses/";

// Map NTCC's term labels (as they appear on the Find_Courses page) to file
// codes. The page lists past + future terms — only future/current are
// useful. Update labels here when NTCC publishes a new term.
const TERM_LABEL_TO_FILE: Record<string, string> = {
  "Spring 2026": "2026SP",
  "May Mini 2026": "2026MAY",
  "Summer 2026": "2026SU",
  "Fall 2026": "2026FA",
  "December Intersession 2026": "2026DEC",
};

const NAV_TIMEOUT = 60_000;
const PAGE_SETTLE = 4_000;
const POSTBACK_WAIT = 8_000;
const PER_TERM_DELAY = 1_500;

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

interface TermLink {
  label: string;
  fileCode: string;
  postbackTarget: string; // e.g. "pg3$V$lnkViewResults"
}

// Scrape the entry page for term blocks. Each block has a known label and
// adjacent "View Results" link with id like pgN_V_lnkViewResults; the
// __doPostBack target uses dollar-sign form (pgN$V$lnkViewResults).
// NTCC's page structure: each term block has an `<h2>` (or similar header
// node) with the term label, then a sub-block with the "View Results" link.
// The postback target's pgN index corresponds to the block ordinal — so we
// can also enumerate by index. To avoid mis-matching nested blocks, we
// find the IMMEDIATE preceding header sibling of each link rather than
// walking up indefinitely.
async function getTermLinks(page: Page): Promise<TermLink[]> {
  const raw = await page.evaluate(() => {
    const out: { label: string; postbackTarget: string }[] = [];
    const anchors = Array.from(document.querySelectorAll("a"));
    for (const a of anchors) {
      if (a.textContent?.trim() !== "View Results") continue;
      const href = a.getAttribute("href") || "";
      const m = href.match(/__doPostBack\('([^']+)'/);
      if (!m) continue;
      const target = m[1];
      // Walk previous siblings (across all ancestors up to body) looking for
      // the nearest text node containing a term label of the form
      // "<TermName> <YEAR>". Take the FIRST match — that's the label that
      // directly precedes this link in document order.
      const re = /(Spring|Summer|Fall|May Mini|December Intersession)\s*\d{4}/;
      // Walk the DOM in reverse document order starting from the link
      let walker: Element | null = a;
      let label = "";
      const visited = new Set<Element>();
      while (walker && !label) {
        let prev: Element | null = walker.previousElementSibling;
        while (prev && !label) {
          if (!visited.has(prev)) {
            visited.add(prev);
            const t = (prev.textContent || "").trim();
            const m2 = t.match(re);
            if (m2) { label = m2[0]; break; }
          }
          prev = prev.previousElementSibling;
        }
        walker = walker.parentElement;
      }
      out.push({ label, postbackTarget: target });
    }
    return out;
  });
  // Pair to file codes, dropping any unknown labels and de-duping by label.
  const seenLabels = new Set<string>();
  const out: TermLink[] = [];
  for (const r of raw) {
    if (!r.label || seenLabels.has(r.label)) continue;
    const fileCode = TERM_LABEL_TO_FILE[r.label];
    if (!fileCode) continue;
    seenLabels.add(r.label);
    out.push({ label: r.label, fileCode, postbackTarget: r.postbackTarget });
  }
  return out;
}

async function loadEntry(page: Page): Promise<void> {
  await page.goto(ENTRY_URL, { waitUntil: "load", timeout: NAV_TIMEOUT });
  await sleep(PAGE_SETTLE);
}

// After clicking View Results, the page transitions to a single-term
// results view. The Excel link's href is now backed by a cached server-side
// dataset. Fetch the link via the page's cookies.
async function fetchExcelForTerm(page: Page, link: TermLink): Promise<string | null> {
  // Trigger the postback that primes the cache
  await page.evaluate((target) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as unknown as { __doPostBack: (a: string, b: string) => void };
    if (typeof w.__doPostBack === "function") w.__doPostBack(target, "");
  }, link.postbackTarget);
  await sleep(POSTBACK_WAIT);

  // Find the (single, now-active) Excel link on the results page
  const excelHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll("a")).find(
      (x) => (x.textContent || "").trim() === "Excel",
    ) as HTMLAnchorElement | undefined;
    return a ? a.href : null;
  });
  if (!excelHref) return null;

  // Fetch via the browser context so cookies are sent automatically
  const resp = await page.request.get(excelHref);
  if (!resp.ok()) {
    console.warn(`    ⚠ excel fetch HTTP ${resp.status()}`);
    return null;
  }
  return resp.text();
}

interface RawRow {
  status: string;
  div: string;
  course: string;
  seq: string;
  begTime: string;
  endTime: string;
  days: string;
  instr: string;
  cap: string;
  enr: string;
  avail: string;
  begin: string;
  end: string;
  census: string;
}

// NTCC's "Excel" export is HTML — a single <table> with NO header row, just
// <tr><td>... data rows in this fixed 18-column order (empirically verified
// 2026-05-30 from a Fall 2026 export):
//   0:Status 1:Div 2:Course 3:Seq 4:Title 5:BegTime 6:EndTime 7:Days
//   8:Camp1  9:Camp2 10:Room 11:Instr 12:Cap 13:Enr 14:Avail
//   15:Begin 16:End 17:Census
// (Note: the on-screen "View Results" page shows only 15 columns; the
// Excel export adds Title + Camp1 + Camp2 + Room.)
function parseExcelBody(body: string, termFile: string): CourseSection[] {
  const $ = cheerio.load(body);
  const sections: CourseSection[] = [];
  const tables = $("table").toArray();
  if (tables.length === 0) {
    console.warn(`    ⚠ no <table> in body`);
    return sections;
  }
  // Use the largest table — protects against export wrapping the data in
  // a single table while having layout tables elsewhere.
  let biggest = tables[0];
  let biggestRows = $(biggest).find("tr").length;
  for (const t of tables) {
    const n = $(t).find("tr").length;
    if (n > biggestRows) { biggest = t; biggestRows = n; }
  }
  const seenCRNs = new Set<string>();
  $(biggest).find("tr").each((_, tr) => {
    const cells = $(tr).find("td").map((_, c) => $(c).text().trim().replace(/ /g, " ").replace(/\s+/g, " ")).get();
    if (cells.length < 18) return; // header row (if any) or layout junk
    const courseField = cells[2] || "";
    if (!/^[A-Z]{2,5}\s+\d{3,4}/.test(courseField)) return;
    const raw: RawRow = {
      status: cells[0], div: cells[1], course: cells[2], seq: cells[3],
      begTime: cells[5], endTime: cells[6], days: cells[7],
      instr: cells[11],
      cap: cells[12], enr: cells[13], avail: cells[14],
      begin: cells[15], end: cells[16], census: cells[17] || "",
    };
    const s = rawToSection(raw, termFile);
    if (!s) return;
    // Use the Title (cells[4]) and the Camp/Room (cells[8..10]) from the
    // extra columns the export gives us.
    s.course_title = cells[4] || "";
    const camp1 = (cells[8] || "").trim();
    const camp2 = (cells[9] || "").trim();
    const room = (cells[10] || "").trim();
    s.campus = camp1 || s.campus;
    s.location = [camp2, room].filter(Boolean).join(" ").trim();
    if (/^WEB/i.test(camp1) || /^WEB/i.test(camp2) || /^WEB/i.test(room)) s.mode = "online";
    if (seenCRNs.has(s.crn)) return;
    seenCRNs.add(s.crn);
    sections.push(s);
  });
  return sections;
}

// "ABDR 1323 032 TR" → prefix=ABDR, number=1323, section="032 TR"
function parseCourseField(c: string): { prefix: string; number: string; section: string } | null {
  const m = c.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)(.*)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], section: (m[3] || "").trim() };
}

function normalizeTime(t: string): string {
  if (!t || /^TBA$/i.test(t)) return "";
  return t.replace(/\s+/g, "");
}

function toIsoDate(d: string): string {
  // NTCC date format is MM-DD-YYYY
  const m = (d || "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return d || "";
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function toInt(s: string): number | null {
  const n = parseInt((s || "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function rawToSection(r: RawRow, termFile: string): CourseSection | null {
  const c = parseCourseField(r.course);
  if (!c) return null;
  const cap = toInt(r.cap);
  const enr = toInt(r.enr);
  const avail = toInt(r.avail);
  return {
    college_code: COLLEGE_CODE,
    term: termFile,
    course_prefix: c.prefix,
    course_number: c.number,
    course_title: "", // NTCC's Find_Courses table doesn't include titles
    credits: null,    // not in the export
    crn: `${c.prefix}${c.number}-${c.section || "00"}-${r.div || "x"}-${termFile}`,
    days: (r.days || "").replace(/\s+/g, ""),
    start_time: normalizeTime(r.begTime),
    end_time: normalizeTime(r.endTime),
    start_date: toIsoDate(r.begin),
    end_date: toIsoDate(r.end),
    location: "",
    campus: r.div || "",
    mode: "",
    instructor: r.instr || null,
    seats_open: avail !== null ? avail : (cap !== null && enr !== null ? cap - enr : null),
    seats_total: cap,
    status: (r.status || "").trim(),
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

async function main() {
  const args = parseArgs();
  fs.mkdirSync(COURSES_DIR, { recursive: true });

  console.log(`NTCC scraper — entry: ${ENTRY_URL}`);

  const browser = await chromium.launch({ headless: !args.headed });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  });
  const page = await ctx.newPage();

  try {
    await loadEntry(page);
    const terms = await getTermLinks(page);
    console.log(`→ ${terms.length} term(s) discovered: ${terms.map((t) => t.label).join(", ")}`);

    const targets = args.onlyTerm ? terms.filter((t) => t.fileCode === args.onlyTerm) : terms;
    if (targets.length === 0) {
      console.error(`No term matched '${args.onlyTerm}'`);
      process.exit(1);
    }

    for (const term of targets) {
      console.log(`\n=== ${term.label} (${term.fileCode}) ===`);
      // Each term needs a fresh entry-page load (the postback navigates away)
      await loadEntry(page);
      // Re-discover term links — the postback target may not be stable across
      // page loads if NTCC re-orders the term blocks
      const freshLinks = await getTermLinks(page);
      const fresh = freshLinks.find((l) => l.label === term.label);
      if (!fresh) {
        console.warn(`  ⚠ ${term.label} no longer on page — skipping`);
        continue;
      }
      const body = await fetchExcelForTerm(page, fresh);
      if (!body) {
        console.warn(`  ⚠ no Excel body returned — skipping`);
        continue;
      }
      console.log(`  fetched ${body.length} bytes`);
      if (process.env.NETCC_DEBUG) {
        const dbg = path.join("/tmp", `netcc-${term.fileCode}.bin`);
        fs.writeFileSync(dbg, body);
        console.log(`  DEBUG body → ${dbg}`);
      }
      const sections = parseExcelBody(body, term.fileCode);
      console.log(`  parsed ${sections.length} sections`);
      const out = path.join(COURSES_DIR, `${term.fileCode}.json`);
      fs.writeFileSync(out, JSON.stringify(sections, null, 2));
      console.log(`  → ${out}`);
      await sleep(PER_TERM_DELAY);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
