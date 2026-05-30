/**
 * Kilgore College — Jenzabar ICS "Course Search" portlet (ASP.NET WebForms)
 *
 * Closes the final remaining college from issue #456 cluster #8 (TX shared
 * form), after HCC (#460), Alamo (#469), Amarillo+Odessa (#471).
 *
 * Kilgore's public class-search lives at:
 *
 *   https://accesskc.kilgore.edu/ICS/Current_Students/Academics/AddDrop_Courses.jnz
 *     ?portlet=Course_search&screen=Advanced%20Course%20Search&screenType=next
 *
 * This is an ASP.NET WebForms variant of Jenzabar — the standard
 * scripts/lib/scrape-jenzabar.ts template expects `#stuRegTermSelect`
 * and doesn't apply. Kilgore's form uses `pg0$V$ddlTerm`, `pg0$V$btnSearch`,
 * and the results render in a single HTML table with ~20 rows per page
 * and a "Next" pager control.
 *
 * Approach (Playwright):
 *   1. Open the form page (public, no login required).
 *   2. Enumerate term-dropdown options; pick recent active terms.
 *   3. For each term:
 *      a. Select term, click Search.
 *      b. Parse the results table (Course code, Name, Faculty, Seats,
 *         Status, Schedule, Credits, Begin Date).
 *      c. Click Next until disabled, accumulating rows.
 *      d. Write data/tx/courses/kilgore-college/{TERM}.json in
 *         CourseSection schema (matches the rest of the repo).
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-kilgore.ts                    # all active terms
 *   npx tsx scripts/tx/scrape-kilgore.ts --term "2026;FA;FA"
 *   npx tsx scripts/tx/scrape-kilgore.ts --headed           # debug
 *   npx tsx scripts/tx/scrape-kilgore.ts --max-pages 2      # smoke test
 */
import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

const SLUG = "kilgore-college";
const STATE = "tx";
const FORM_URL =
  "https://accesskc.kilgore.edu/ICS/Current_Students/Academics/AddDrop_Courses.jnz" +
  "?portlet=Course_search&screen=Advanced%20Course%20Search&screenType=next";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const NAV_TIMEOUT = 45_000;
const PAGE_DELAY = 1500;

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

interface Args {
  termFilter: string | null;
  headed: boolean;
  maxPages: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let termFilter: string | null = null;
  let headed = false;
  let maxPages = Infinity;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) {
      termFilter = args[i + 1];
      i++;
    } else if (args[i] === "--headed") {
      headed = true;
    } else if (args[i] === "--max-pages" && args[i + 1]) {
      maxPages = parseInt(args[i + 1], 10);
      i++;
    }
  }
  return { termFilter, headed, maxPages };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface TermOption {
  value: string;
  label: string;
}

/**
 * Map Jenzabar term codes like "2026;FA;FA" → standard "2026FA".
 */
function jenzabarTermToStandard(value: string, label: string): string | null {
  // Try the value first: "2026;FA;FA" or "2026;SP;SP"
  const v = value.match(/(\d{4})\s*;\s*(FA|SP|SU|WI|FALL|SPRING|SUMMER|WINTER)/i);
  if (v) {
    const year = v[1];
    const term = v[2].toUpperCase();
    const map: Record<string, string> = { FA: "FA", FALL: "FA", SP: "SP", SPRING: "SP", SU: "SU", SUMMER: "SU", WI: "WI", WINTER: "WI" };
    return `${year}${map[term] ?? term.slice(0, 2)}`;
  }
  // Fall back to label parsing: "Fall 2026" / "FA 2026"
  const l = label.match(/(Fall|Spring|Summer|Winter|FA|SP|SU|WI)\s+(\d{4})/i);
  if (l) {
    const term = l[1].toUpperCase();
    const year = l[2];
    const map: Record<string, string> = { FA: "FA", FALL: "FA", SP: "SP", SPRING: "SP", SU: "SU", SUMMER: "SU", WI: "WI", WINTER: "WI" };
    return `${year}${map[term] ?? term.slice(0, 2)}`;
  }
  return null;
}

function parseCourseCode(raw: string): { prefix: string; number: string; section: string } {
  // "ACNT 2388 0W01" → prefix=ACNT number=2388 section=0W01
  const m = raw.match(/^([A-Z]{2,4})\s*(\d{3,4}[A-Z]?)\s*(.*)$/);
  if (!m) return { prefix: "UNK", number: "0", section: raw };
  return { prefix: m[1], number: m[2], section: m[3].trim() };
}

function parseSeats(s: string): { open: number | null; total: number | null } {
  // "19/20"
  const m = s.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (!m) return { open: null, total: null };
  return { open: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

function parseDays(daysRaw: string): string {
  // "TR" stays "TR"; "MWF" stays "MWF"; "M W F" → "MWF"
  return daysRaw.replace(/\s+/g, "");
}

function parseSchedule(s: string): {
  days: string;
  start_time: string;
  end_time: string;
  location: string;
  mode: string;
} {
  // Examples:
  //   "Web; Online Course, Internet, BlackBoard"
  //   "TR 8:30 AM-9:50 AM; Kilgore Campus, Bonnie Porter Busin..."
  //   "MWF 10:00 AM-10:50 AM; Longview Campus, Some Hall"
  const clean = s.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const [scheduleSide = "", locationSide = ""] = clean.split(/;\s*/, 2);
  const location = locationSide.trim();

  // Mode detection
  const isOnline = /web|online|internet|blackboard/i.test(scheduleSide + " " + locationSide);
  const isHybrid = /hybrid/i.test(scheduleSide + " " + locationSide);
  let mode: string;
  if (isHybrid) mode = "hybrid";
  else if (isOnline) mode = "online";
  else mode = "in-person";

  // Time extraction: "TR 8:30 AM-9:50 AM"
  const tm = scheduleSide.match(/([A-Z]{1,5})\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (tm) {
    return {
      days: parseDays(tm[1]),
      start_time: tm[2].replace(/\s+/g, " ").trim(),
      end_time: tm[3].replace(/\s+/g, " ").trim(),
      location,
      mode,
    };
  }
  return { days: "", start_time: "", end_time: "", location, mode };
}

function normalizeDate(d: string): string {
  // "8/24/2026" → "2026-08-24"
  const m = d.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);
  if (!m) return "";
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

function parseInstructor(s: string): string | null {
  const t = s.trim();
  if (!t || /^staff$/i.test(t) || t === "-") return null;
  return t;
}

interface RawRow {
  code: string;
  name: string;
  faculty: string;
  seats: string;
  status: string;
  schedule: string;
  credits: string;
  beginDate: string;
}

async function getTerms(page: Page): Promise<TermOption[]> {
  return page.evaluate(() => {
    const sel = document.querySelector<HTMLSelectElement>("#pg0_V_ddlTerm");
    if (!sel) return [];
    return Array.from(sel.options)
      .filter((o) => o.value && o.value.trim() && o.text.trim())
      .map((o) => ({ value: o.value, text: o.text.trim() }));
  }).then((opts) => opts.map((o) => ({ value: o.value, label: o.text })));
}

async function selectTermAndSearch(page: Page, termValue: string): Promise<void> {
  await page.selectOption("#pg0_V_ddlTerm", termValue);
  await sleep(500);
  await page.click("#pg0_V_btnSearch");
  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => {});
  await sleep(2000);
}

async function extractRowsFromCurrentPage(page: Page): Promise<RawRow[]> {
  // page.evaluate can throw "Execution context was destroyed" if a navigation
  // fires while it's running (transient race on slow CI). Retry up to 3×.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      return await page.evaluate(() => {
        // The results table is the one that contains a header row with "Course code".
        const tables = Array.from(document.querySelectorAll<HTMLTableElement>("table"));
        const resultsTable = tables.find((t) =>
          Array.from(t.querySelectorAll("th, td")).some((c) =>
            /Course\s*code/i.test(c.textContent || "")
          )
        );
        if (!resultsTable) return [];
        const rows = Array.from(resultsTable.querySelectorAll<HTMLTableRowElement>("tr"));
        const out: { code: string; name: string; faculty: string; seats: string; status: string; schedule: string; credits: string; beginDate: string }[] = [];
        for (const r of rows) {
          const cells = Array.from(r.querySelectorAll("td")).map((td) =>
            (td.innerText || td.textContent || "").trim()
          );
          // A data row has a course code in cells[2] (cells[0] is Add checkbox, cells[1] is Textbook link)
          if (cells.length < 10) continue;
          const code = cells[2];
          if (!code || !/^[A-Z]{2,4}\s*\d{3,4}/.test(code)) continue;
          out.push({
            code,
            name: cells[3] || "",
            faculty: cells[4] || "",
            seats: cells[5] || "",
            status: cells[6] || "",
            schedule: cells[7] || "",
            credits: cells[8] || "",
            beginDate: cells[9] || "",
          });
        }
        return out;
      });
    } catch (e) {
      if (attempt < 2 && /Execution context was destroyed|context/i.test(String(e))) {
        console.warn(`    extractRows attempt ${attempt + 1} failed (nav race), retrying...`);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw e;
    }
  }
  return [];
}

async function goToNextPage(page: Page): Promise<boolean> {
  // Kilgore's Jenzabar uses a letter-based navigator: an anchor with text
  // "Next page -->" whose href is
  //     javascript:__doPostBack('pg0$V$ltrNav','1')
  // when there's a next chunk; the anchor disappears at the end of the
  // alphabet. We detect by href substring rather than visible text.
  const clicked = await page.evaluate(() => {
    // Kilgore's pager: a row of letter-chunk anchors (each calling
    // __doPostBack('pg0$V$ltrNav', N) where N is the chunk number)
    // PLUS a "Next page -->" anchor whose arg is the NEXT chunk number
    // (1 on the initial page, 2 after one click, etc.). We match by
    // visible text on the special "Next page" anchor — it's the only
    // one whose anchor's text label contains "Next page".
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a"));
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      if (!/ltrNav/.test(href)) continue;
      const text = ((a.innerText || a.textContent) || "").trim();
      if (/next\s*page/i.test(text)) {
        a.click();
        return true;
      }
    }
    return false;
  });
  if (!clicked) return false;
  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => {});
  await sleep(PAGE_DELAY);
  return true;
}

function rawToSection(r: RawRow, termFile: string): CourseSection | null {
  const { prefix, number, section } = parseCourseCode(r.code);
  if (prefix === "UNK") return null;
  const { days, start_time, end_time, location, mode } = parseSchedule(r.schedule);
  const { open, total } = parseSeats(r.seats);
  const credits = parseFloat(r.credits) || 0;
  return {
    college_code: SLUG,
    term: termFile,
    course_prefix: prefix,
    course_number: number,
    course_title: r.name,
    credits,
    // Kilgore doesn't expose a separate CRN; the section identifier
    // (e.g. "ACNT 2388 0W01" → "0W01") is the closest stable handle.
    crn: section || `${prefix}-${number}`,
    days,
    start_time,
    end_time,
    start_date: normalizeDate(r.beginDate),
    location,
    campus: location.split(",")[0]?.trim() || "",
    mode,
    instructor: parseInstructor(r.faculty),
    seats_open: open,
    seats_total: total,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

function pickTermsToScrape(terms: TermOption[]): TermOption[] {
  // Kilgore exposes the same standard term as multiple variants:
  //   2026;FA      — umbrella ("Fall Semester")           ← what we want
  //   2026;FA;FA   — Fall 16-week
  //   2026;FA;1D   — Fall 1st 8-week
  //   2026;FA;1L   — Fall 2nd 8-week
  // The umbrella value contains all sub-term sections; the sub-variants
  // are subsets. Keep only the umbrella (value has no third segment).
  return terms.filter((t) => {
    if (!t.value || /select/i.test(t.label)) return false;
    if (/view only|past|archived/i.test(t.label)) return false;
    // Skip sub-term variants — they have a 3rd `;`-segment
    const parts = t.value.split(";");
    if (parts.length > 2) return false;
    // Keep if year >= current
    const m = t.value.match(/(\d{4})/);
    if (!m) return true;
    const year = parseInt(m[1], 10);
    const now = new Date().getFullYear();
    return year >= now;
  });
}

async function main() {
  const args = parseArgs();
  console.log("🏈 Kilgore College Jenzabar scraper");
  console.log(`   URL: ${FORM_URL}`);

  const browser: Browser = await chromium.launch({ headless: !args.headed });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  const start = Date.now();
  const summary: Record<string, number> = {};

  try {
    console.log("• Loading form…");
    await page.goto(FORM_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    await sleep(1500);

    const allTerms = await getTerms(page);
    const candidates = pickTermsToScrape(allTerms);
    const targets = args.termFilter
      ? candidates.filter((t) => t.value === args.termFilter || t.label === args.termFilter)
      : candidates;
    console.log(`• ${allTerms.length} total terms; ${candidates.length} candidates; ${targets.length} target(s)`);
    for (const t of targets) console.log(`    - ${t.value} → ${t.label}`);

    for (const term of targets) {
      const termFile = jenzabarTermToStandard(term.value, term.label);
      if (!termFile) {
        console.log(`  skip ${term.value}: can't map to standard term code`);
        continue;
      }
      console.log(`\n• ${term.label} (${term.value} → ${termFile})`);

      // Each term needs a fresh form load (the back-button quirks of
      // ASP.NET ViewState make multi-term searches unreliable).
      await page.goto(FORM_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
      await sleep(1200);

      await selectTermAndSearch(page, term.value);

      const sections: CourseSection[] = [];
      let pageNum = 1;
      while (true) {
        const rows = await extractRowsFromCurrentPage(page);
        for (const r of rows) {
          const sec = rawToSection(r, termFile);
          if (sec) sections.push(sec);
        }
        console.log(`    page ${pageNum}: +${rows.length} rows (total: ${sections.length})`);
        if (pageNum >= args.maxPages) {
          console.log(`    stopping (--max-pages ${args.maxPages})`);
          break;
        }
        const hasNext = await goToNextPage(page);
        if (!hasNext) break;
        pageNum++;
      }

      const outDir = COURSES_DIR;
      const outFile = path.join(outDir, `${termFile}.json`);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify(sections, null, 2) + "\n");
      console.log(`  ✓ ${termFile}: ${sections.length} sections → ${outFile}`);
      summary[termFile] = sections.length;
    }
  } finally {
    await browser.close();
  }

  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\n✅ Done — ${total} sections across ${Object.keys(summary).length} term(s) in ${elapsed}s`);
}

main().catch((e) => {
  console.error("❌ Kilgore scraper failed:", e);
  process.exit(1);
});
