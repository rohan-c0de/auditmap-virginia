/**
 * Southeast Technical College (SD) — public Jenzabar JICS "STI Course Schedule"
 * portlet scraper.
 *
 * Why bespoke: STC publishes its full Fall/Spring/Summer schedule at
 *   https://my.southeasttech.edu/ICS/Admissions/Course_Schedule.jnz
 * via a non-standard `pi_STI_Course_Schedule` portlet (not the generic
 * Jenzabar `Course_Search` portlet the orchestrator's template targets).
 *
 * Why Playwright (not raw POST): the portlet's `__doPostBack` round-trip
 * needs a JICS portlet-context cookie that's only set after the browser
 * fully renders the page. Pure-Node POSTs land on the home page.
 *
 * Result table columns (11):
 *   Year | Term | Course Code | Title | Instructor | Credits
 *   | Start Date | End Date | Start Time | End Time | Days
 *
 * Course Code is space-separated: "AAR  000  1    O" → AAR 000-1, online.
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { chromium, type Page } from "playwright";

const SLUG = "southeast-technical-college";
const STATE = "sd";
const FORM_URL =
  "https://my.southeasttech.edu/ICS/Admissions/Course_Schedule.jnz";
const OUT_DIR = path.join(
  process.cwd(),
  "data",
  STATE,
  "courses",
  SLUG,
);

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
  mode: "in-person" | "online" | "hybrid" | "zoom";
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

function parseTerm(label: string): { code: string; year: number } | null {
  const m = label.match(
    /^(\d{4})-(\d{4}) School Year - (Fall|Spring|Summer|Winter) Term/i,
  );
  if (!m) return null;
  const startYear = parseInt(m[1], 10);
  const endYear = parseInt(m[2], 10);
  const season = m[3].toLowerCase();
  const year = season === "fall" ? startYear : endYear;
  return { code: `${season}-${year}`, year };
}

function parseCourseCode(raw: string): {
  prefix: string;
  number: string;
  section: string;
  flag: string;
} {
  const tokens = raw.trim().split(/\s+/);
  return {
    prefix: tokens[0] || "",
    number: tokens[1] || "",
    section: tokens[2] || "",
    flag: tokens[3] || "",
  };
}

function parseDate(mdY: string): string {
  const m = mdY.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function parseTime(t: string): string {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return "";
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

function inferMode(flag: string, days: string): CourseSection["mode"] {
  if (flag === "O" || flag.startsWith("O")) return "online";
  if (days.includes("HY")) return "hybrid";
  return "in-person";
}

function parseRowsFromHtml(html: string, termCode: string): CourseSection[] {
  const $ = cheerio.load(html);
  const rows: CourseSection[] = [];
  $("#pg0_V_DataGrid1 > tbody > tr, #pg0_V_DataGrid1 > tr").each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass("paginationClass")) return;
    const tds = $tr.find("> td");
    if (tds.length !== 11) return;
    const bg = ($tr.attr("style") || "").toLowerCase();
    if (bg.includes("navy")) return; // header
    const cells = tds
      .map((__, td) => $(td).text().replace(/ /g, " "))
      .get();
    const [
      year,
      term,
      courseCode,
      title,
      instructor,
      credits,
      startDate,
      _endDate,
      startTime,
      endTime,
      days,
    ] = cells;
    const code = parseCourseCode(courseCode);
    if (!code.prefix || !code.number) return;
    rows.push({
      college_code: SLUG,
      term: termCode,
      course_prefix: code.prefix,
      course_number: code.number,
      course_title: title.trim(),
      credits: parseFloat(credits) || 0,
      crn: `${code.prefix}-${code.number}-${code.section}-${year}-${term}`.replace(
        /\s+/g,
        "",
      ),
      days: (days || "").trim(),
      start_time: parseTime(startTime),
      end_time: parseTime(endTime),
      start_date: parseDate(startDate),
      location: "",
      campus: "main",
      mode: inferMode(code.flag, days),
      instructor: instructor.trim() || null,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });
  return rows;
}

async function scrapeAllPages(
  page: Page,
  termCode: string,
): Promise<CourseSection[]> {
  const all: CourseSection[] = [];
  const seenPostbackTargets = new Set<string>();
  for (let pageIdx = 1; pageIdx <= 80; pageIdx++) {
    const html = await page.content();
    const rows = parseRowsFromHtml(html, termCode);
    all.push(...rows);
    console.log(`    page ${pageIdx}: ${rows.length} rows`);

    // Extract __doPostBack targets for pagination links from the current HTML.
    const targets: string[] = [];
    const re = /__doPostBack\('(pg0\$V\$DataGrid1\$ctl\d+\$ctl\d+)'/g;
    let m;
    while ((m = re.exec(html))) targets.push(m[1]);
    const next = targets.find((t) => !seenPostbackTargets.has(t));
    if (!next) break;
    seenPostbackTargets.add(next);

    // Trigger postback via the page's own __doPostBack, then wait for the
    // DataGrid to update. Use a sentinel row to detect re-render.
    const firstRowBefore = await page
      .locator("#pg0_V_DataGrid1 tr")
      .nth(1)
      .innerHTML()
      .catch(() => "");
    await page.evaluate((t) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — __doPostBack is injected by ASP.NET
      window.__doPostBack(t, "");
    }, next);
    await page
      .waitForFunction(
        ({ sel, before }) => {
          const el = document.querySelector(sel);
          return el && el.innerHTML !== before;
        },
        { sel: "#pg0_V_DataGrid1 tr:nth-child(2)", before: firstRowBefore },
        { timeout: 20000 },
      )
      .catch(() => {
        // tolerate timeout — break out next iteration if no new targets
      });
  }
  // Dedup by CRN
  const dedup = new Map<string, CourseSection>();
  for (const s of all) dedup.set(s.crn, s);
  return Array.from(dedup.values());
}

async function scrapeTerm(
  page: Page,
  termValue: string,
  termLabel: string,
): Promise<CourseSection[]> {
  const parsed = parseTerm(termLabel);
  if (!parsed) {
    console.log(`  skip term (unparseable): ${termLabel}`);
    return [];
  }
  const termCode = parsed.code;
  console.log(`  term: ${termLabel} → ${termCode}`);

  await page.goto(FORM_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#pg0_V_ddlYear", { timeout: 15000 });
  await page.selectOption("#pg0_V_ddlYear", { label: termLabel });
  await page.click("#pg0_V_btnGo");
  await page.waitForLoadState("networkidle", { timeout: 20000 });

  return await scrapeAllPages(page, termCode);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    });
    const page = await ctx.newPage();
    await page.goto(FORM_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#pg0_V_ddlYear", { timeout: 15000 });
    const terms: Array<{ value: string; label: string }> = await page.$$eval(
      "#pg0_V_ddlYear option",
      (opts: Element[]) =>
        opts
          .map((o) => ({
            value: (o as HTMLOptionElement).value,
            label: (o.textContent || "").trim(),
          }))
          .filter(
            (o) => o.value !== "-1" && !/testing/i.test(o.label),
          ),
    );
    console.log(`Discovered ${terms.length} term(s):`);
    for (const t of terms) console.log(`  - ${t.label}`);
    let grand = 0;
    for (const t of terms) {
      const sections = await scrapeTerm(page, t.value, t.label);
      const parsed = parseTerm(t.label);
      if (!parsed) continue;
      const file = path.join(OUT_DIR, `${parsed.code}.json`);
      fs.writeFileSync(file, JSON.stringify(sections, null, 2));
      console.log(`  wrote ${sections.length} sections → ${file}`);
      grand += sections.length;
    }
    console.log(`\n=== Southeast Tech scrape complete: ${grand} sections ===`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
