/**
 * Hinds Community College — public course-search scraper (Playwright).
 *
 * coursesearch.hindscc.edu is a multi-select ASP.NET WebForms page sitting
 * over PeopleSoft. The form fields we care about:
 *   - listBoxTerm   (multi-select) — pick the "All" pseudo-options
 *                    ("2026_Summer_%", "2026_Fall_%") so a single search
 *                    returns every session under a season.
 *   - Button1       — submit.
 *
 * Public POST endpoints (TitleSearch) only return titles, so we drive
 * the form with a headless browser, then parse the rendered results.
 *
 * Usage:
 *   npx tsx scripts/ms/scrape-hinds.ts
 *   npx tsx scripts/ms/scrape-hinds.ts --no-import
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { chromium, type Page } from "playwright";

const STATE = "ms";
const SLUG = "hinds-community-college";
const URL = "https://coursesearch.hindscc.edu";

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
  mode: "in-person" | "online" | "hybrid";
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: null;
  prerequisite_courses: never[];
}

function seasonFromValue(termValue: string): string {
  // e.g. "2026_Summer_%" / "2026_FALL_FIRST_4_WEEK_SESSION" / "2026_Fall_%".
  const m = termValue.match(/^(\d{4})_([A-Za-z]+)/);
  if (!m) return termValue;
  const year = m[1];
  const seasonRaw = m[2].toUpperCase();
  const code = seasonRaw.startsWith("FA") ? "FA"
             : seasonRaw.startsWith("SP") ? "SP"
             : seasonRaw.startsWith("SU") ? "SU" : "WI";
  return `${year}${code}`;
}

async function listSeasonOptions(page: Page): Promise<Array<{ value: string; label: string }>> {
  return page.$$eval(
    'select[id="ContentPlaceHolder1_listBoxTerm"] option',
    (opts) => opts
      .map((o) => ({
        value: (o as HTMLOptionElement).value,
        label: (o.textContent || "").trim(),
      }))
      // Use only the "All" rollup per season — avoids duplicate sections
      // across overlapping 4/8/full-term sub-sessions.
      .filter((o) => /^\d{4}_(Summer|Fall|Spring|Winter)_%$/i.test(o.value))
  );
}

async function searchSeason(page: Page, value: string, label: string, subjectCode?: string): Promise<CourseSection[]> {
  // The Bootstrap-multiselect wrapper is purely visual; the underlying
  // <select> still drives form submission, so we set its `.value` arrays
  // directly and trigger change. Then click Search.
  await page.evaluate((args) => {
    const { v, subj } = args as { v: string; subj?: string };
    const termSel = document.querySelector('select[id="ContentPlaceHolder1_listBoxTerm"]') as HTMLSelectElement | null;
    if (termSel) {
      for (const opt of Array.from(termSel.options)) opt.selected = opt.value === v;
      termSel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const subjSel = document.querySelector('select[id="ContentPlaceHolder1_listBoxSubject"]') as HTMLSelectElement | null;
    if (subjSel) {
      for (const opt of Array.from(subjSel.options)) opt.selected = subj ? opt.value === subj : false;
      subjSel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const w = window as unknown as { jQuery?: (s: string) => { multiselect: (op: string) => void } };
    if (w.jQuery) {
      w.jQuery('[id*=listBoxTerm]').multiselect('rebuild');
      w.jQuery('[id*=listBoxSubject]').multiselect('rebuild');
    }
  }, { v: value, subj: subjectCode });

  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => undefined),
    page.click('input[id="ContentPlaceHolder1_Button1"]'),
  ]);
  await page.waitForTimeout(800);

  // Hinds wraps the result table in a DataTables.net instance with
  // iDisplayLength=50 — the OTHER rows are still in the DOM but
  // display:none. Flip the length to -1 (= all) so cheerio sees them all.
  await page.evaluate(() => {
    const w = window as unknown as { jQuery?: (sel: string) => { DataTable?: (op?: unknown) => { page?: { len: (n: number) => unknown }; draw: () => void } } };
    const $ = w.jQuery;
    if (!$) return;
    const $table = $("table.dataTable, table[id*='Results'], table.display");
    const dt = (($table as unknown) as { DataTable?: () => { page: { len: (n: number) => unknown }; draw: () => void } }).DataTable?.();
    if (dt) {
      dt.page.len(-1);
      dt.draw();
    }
  });
  await page.waitForTimeout(500);

  const termKey = seasonFromValue(value);
  if (process.env.HINDS_DEBUG) {
    const rowCount = await page.evaluate(() => document.querySelectorAll("table tr").length);
    console.log(`  DBG ${termKey}: ${rowCount} total <tr> in DOM`);
  }
  const html = await page.content();
  return parseResults(html, termKey);
}

function parseDays(raw: string): string {
  if (!raw || /TBA|ARR|N\/A/i.test(raw)) return "";
  const upper = raw.toUpperCase().replace(/TH/g, "R");
  const out: string[] = [];
  for (const c of upper) if ("MTWRFSU".includes(c) && !out.includes(c)) out.push(c);
  return out.join("");
}

function to24(raw: string): string {
  if (!raw || /TBA|ARR/i.test(raw)) return "";
  const m = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM|A|P)?/i);
  if (!m) return "";
  let h = parseInt(m[1], 10);
  const ap = (m[3] ?? "").toUpperCase().charAt(0);
  if (ap === "P" && h !== 12) h += 12;
  if (ap === "A" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function parseResults(html: string, termKey: string): CourseSection[] {
  const $ = cheerio.load(html);
  // Pick the largest table — it's the results grid; the filter sidebar is
  // a few small tables.
  let bestEl: unknown = null;
  let bestRows = 0;
  $("table").each((_, tbl) => {
    const r = $(tbl).find("tr").length;
    if (r > bestRows) {
      bestRows = r;
      bestEl = tbl;
    }
  });
  if (!bestEl || bestRows < 2) return [];
  const rows = $(bestEl as Parameters<typeof $>[0]).find("tr").toArray();
  const headerCells = $(rows[0]).find("th, td").toArray().map((c) =>
    $(c).text().trim().toLowerCase().replace(/\s+/g, " ")
  );
  const idx = (...names: string[]): number => {
    for (const n of names) {
      const i = headerCells.findIndex((h) => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  // Hinds renders a combined "course section" column rather than separate
  // subject/catalog/section columns. Format on the live site:
  //   "ACC 2213 01"  or "ACC 2213-01"  or "ACC 2213 - Principles of Acc"
  const cCourseSec = idx("course section", "course");
  const cLoc = idx("location");
  const cMeets = idx("meets", "days", "pattern");
  const cMode = idx("delivery", "mode");
  const cCred = idx("credit", "units");
  const cInstr = idx("instructor", "faculty");
  const cStatus = idx("registration", "status");
  if (cCourseSec < 0 || cMeets < 0) {
    console.error(`  table header mismatch: ${headerCells.slice(0, 12).join(" | ")}`);
    return [];
  }
  if (process.env.HINDS_DEBUG && rows.length > 1) {
    console.log("DBG row1 cells:", $(rows[1]).find("td").toArray().map((c) => $(c).text().trim().slice(0, 60)));
    console.log("DBG row1 course-cell HTML:", ($(rows[1]).find("td").eq(cCourseSec).html() ?? "").slice(0, 400));
  }

  const sections: CourseSection[] = [];
  for (let i = 1; i < rows.length; i++) {
    const $row = $(rows[i]);
    const cells = $row.find("td").toArray().map((c) => $(c).text().trim());
    if (cells.length === 0) continue;
    // The "course section" cell typically packs multiple lines (rich HTML
    // with course code on line 1, title on line 2). Pull the raw HTML so we
    // can split by <br>.
    const courseCellHtml = $row.find("td").eq(cCourseSec).html() ?? "";
    const courseLines = courseCellHtml
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    // Live format: "ABT 1146-UD1 - Struct Analysis & Dam Rep I"
    //   <PREFIX> <NUMBER>-<SECTION> - <TITLE>
    const combined = courseLines.join(" ");
    const m = combined.match(/^([A-Z]{2,5})\s+(\d+[A-Z]*)-([A-Z0-9]+)\s*-\s*(.+)$/);
    if (!m) continue;
    const subject = m[1];
    const catalog = m[2];
    const sectionId = m[3];
    const titleLine = m[4].trim();

    const meets = cells[cMeets] ?? "";
    // "MWF 9:00 AM - 9:50 AM" / "TR 10:30 AM - 11:45 AM" / "TBA"
    const daysStr = meets.split(/\s+/)[0] ?? "";
    const days = parseDays(daysStr);
    const timeMatches = meets.match(/(\d{1,2}:\d{2}\s*[AP]M?)/gi) ?? [];
    const startTime = to24(timeMatches[0] ?? "");
    const endTime = to24(timeMatches[1] ?? "");

    const location = (cLoc >= 0 ? cells[cLoc] : "") || "Hinds CC";
    const mode = (cMode >= 0 ? cells[cMode] : "") || "";
    const isOnline = /virtual|online|web\b/i.test(mode + " " + location);
    const credits = cCred >= 0 ? parseFloat((cells[cCred] ?? "").replace(/[^0-9.]/g, "")) || 0 : 0;
    const status = cStatus >= 0 ? (cells[cStatus] ?? "") : "";

    sections.push({
      college_code: SLUG,
      term: termKey,
      course_prefix: subject,
      course_number: catalog,
      course_title: titleLine || "",
      credits,
      crn: `${subject}-${catalog}-${sectionId}`,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: "",
      location: isOnline ? "Online" : location,
      campus: location,
      mode: isOnline ? "online" : "in-person",
      instructor: cInstr >= 0 ? (cells[cInstr] || null) : null,
      seats_open: /open/i.test(status) ? 1 : 0,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }
  return sections;
}

async function main() {
  const noImport = process.argv.includes("--no-import");

  console.log("Hinds CC — coursesearch.hindscc.edu scraper");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 90_000 });

  const seasons = await listSeasonOptions(page);
  console.log(`  Seasons: ${seasons.map((s) => s.label).join(", ")}`);

  const outDir = path.join(process.cwd(), "data", STATE, "courses", SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  // Enumerate subjects. The "All" pseudo-term search returned only ~250
  // rows per season — Hinds caps the rendered result set, so per-subject
  // iteration is required to capture the full schedule.
  const subjects: Array<{ code: string; label: string }> = await page.$$eval(
    'select[id="ContentPlaceHolder1_listBoxSubject"] option',
    (opts) => opts
      .map((o) => ({ code: (o as HTMLOptionElement).value, label: (o.textContent || "").trim() }))
      .filter((o) => o.code && !o.code.endsWith("_%"))
  );
  console.log(`  Subjects: ${subjects.length}`);

  let grand = 0;
  for (const s of seasons) {
    const termKey = seasonFromValue(s.value);
    const all: CourseSection[] = [];
    const seen = new Set<string>();
    for (const subj of subjects) {
      try {
        const sections = await searchSeason(page, s.value, s.label, subj.code);
        for (const sec of sections) {
          if (seen.has(sec.crn)) continue;
          seen.add(sec.crn);
          all.push(sec);
        }
      } catch (err) {
        console.error(`  ERROR ${termKey}/${subj.code}: ${(err as Error).message}`);
      }
      // Return to a clean search form between subjects.
      await page.goto(URL, { waitUntil: "networkidle" });
    }
    if (all.length === 0) {
      console.log(`  ${termKey}: 0 sections`);
      continue;
    }
    const outPath = path.join(outDir, `${termKey}.json`);
    fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + "\n");
    console.log(`  ${termKey}: ${all.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grand += all.length;
  }
  await browser.close();
  console.log(`\n${SLUG}: ${grand} total sections`);
  if (noImport) console.log("   (--no-import)");
}

main().catch((err) => {
  console.error("Hinds scraper failed:", err);
  process.exit(1);
});
