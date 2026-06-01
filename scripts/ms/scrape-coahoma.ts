/**
 * Coahoma Community College — Jenzabar JICS course-schedule scraper (Playwright).
 *
 * Coahoma's JICS portal at myccc.coahomacc.edu exposes the Course_Schedules
 * portlet's Advanced Course Search to guests, but the form is ASP.NET
 * WebForms with full __VIEWSTATE / __EVENTVALIDATION — we drive it via a
 * headless browser.
 *
 * Strategy:
 *   1. Load the Advanced Course Search portlet page.
 *   2. Enumerate the term dropdown (top-level rollup options like
 *      "2026-2027 Acad Yr - Fall Term", value="2026;10").
 *   3. For each top-level term, select it and click Search; parse the
 *      rendered results table.
 *
 * Usage:
 *   npx tsx scripts/ms/scrape-coahoma.ts
 *   npx tsx scripts/ms/scrape-coahoma.ts --no-import
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { chromium, type Page } from "playwright";

const STATE = "ms";
const SLUG = "coahoma-community-college";
const URL =
  "https://myccc.coahomacc.edu/ICS/Welcome_to_Coahoma_Community_College.jnz?portlet=Course_Schedules&screen=Advanced+Course+Search&screenType=next";

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

function normalizeTermLabel(label: string): string {
  // "2026-2027 Acad Yr - Fall Term" / "2025-2026 Acad Yr - Summer 1"
  const m = label.match(/(\d{4})-(\d{4})\s+Acad\s+Yr\s*-\s*(Fall|Spring|Summer|Winter)/i);
  if (!m) return label.replace(/\s+/g, "_");
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  const season = m[3].toLowerCase();
  // Fall belongs to the start year; Spring/Summer/Winter belong to the end year.
  const year = season === "fall" ? start : end;
  const code = season === "fall" ? "FA" : season === "spring" ? "SP" : season === "summer" ? "SU" : "WI";
  return `${year}${code}`;
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

async function listTerms(page: Page): Promise<Array<{ value: string; label: string }>> {
  return page.$$eval(
    'select[id="pg0_V_ddlTerm"] option',
    (opts) => opts
      .map((o) => ({
        value: (o as HTMLOptionElement).value,
        label: (o.textContent || "").trim(),
      }))
      .filter((o) => o.value && /^\d{4};\d{2}$/.test(o.value)) // top-level only
  );
}

async function searchTerm(page: Page, value: string, dept?: string): Promise<CourseSection[]> {
  await page.selectOption('select[id="pg0_V_ddlTerm"]', value);
  if (dept !== undefined) {
    await page.selectOption('select[id="pg0_V_ddlDept"]', dept);
  }
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => undefined),
    page.click('input[id="pg0_V_btnSearch"]'),
  ]);
  await page.waitForTimeout(800);
  const html = await page.content();
  return parseResults(html, normalizeTermLabelFromValue(value));
}

async function listDepartments(page: Page): Promise<Array<{ code: string; label: string }>> {
  return page.$$eval(
    'select[id="pg0_V_ddlDept"] option',
    (opts) => opts
      .map((o) => ({
        code: (o as HTMLOptionElement).value,
        label: (o.textContent || "").trim(),
      }))
      .filter((o) => o.code && o.code !== "")
  );
}

function normalizeTermLabelFromValue(v: string): string {
  // "2026;10" → Fall 2026; "2026;20" → Spring 2027; "2025;30" → Summer 2026.
  const m = v.match(/^(\d{4});(\d{2})$/);
  if (!m) return v;
  const year = parseInt(m[1], 10);
  const code = m[2];
  // JICS season codes used by Coahoma: 10=Fall, 20=Spring, 30=Summer1, 40=Summer2.
  if (code === "10") return `${year}FA`;
  if (code === "20") return `${year + 1}SP`;
  if (code === "30" || code === "40") return `${year + 1}SU`;
  return `${year}${code}`;
}

function parseResults(html: string, termKey: string): CourseSection[] {
  const $ = cheerio.load(html);
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
  // Live header set on Coahoma's portlet:
  //   add | textbooks | course code | name | faculty | seats open | status |
  //   schedule | credits | begin date | end date
  const cCode = idx("course code");
  const cName = idx("name");
  const cFaculty = idx("faculty");
  const cSeats = idx("seats open", "seats");
  const cSchedule = idx("schedule");
  const cCredits = idx("credits", "credit");
  const cStatus = idx("status");
  const cBegin = idx("begin date");

  if (cCode < 0 || cName < 0) {
    console.error(`  table header mismatch: ${headerCells.slice(0, 12).join(" | ")}`);
    return [];
  }
  if (process.env.COAHOMA_DEBUG && rows.length > 1) {
    console.log("DBG headers:", headerCells);
    console.log("DBG row1:", $(rows[1]).find("td").toArray().map((c) => $(c).text().trim().slice(0, 50)));
    console.log("DBG row2:", $(rows[2])?.find("td").toArray().map((c) => $(c).text().trim().slice(0, 50)));
  }

  const sections: CourseSection[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = $(rows[i]).find("td").toArray().map((c) => $(c).text().trim());
    if (cells.length === 0) continue;
    // Course code cell: "ACC-2213 H01"  or "ACC-2213-01"  or "ENG-1113 V1"
    // Coahoma renders course codes either space-separated ("ABT 1146 A")
    // or dash-separated ("ACC-2213-01"). Handle both.
    const codeStr = cells[cCode] ?? "";
    const m = codeStr.match(/^([A-Z]{2,5})[\s-]+(\d+[A-Z]*)\s*[\s-]?\s*([A-Z0-9]+)?$/);
    if (!m) continue;
    const subject = m[1];
    const catalog = m[2];
    const sectionId = m[3] || "";

    const scheduleStr = cSchedule >= 0 ? (cells[cSchedule] ?? "") : "";
    // Schedule example: "MWF 9:00 AM - 9:50 AM" or "TBA" or "Online".
    const dayToken = scheduleStr.split(/\s+/)[0] ?? "";
    const days = parseDays(dayToken);
    const timeMatches = scheduleStr.match(/(\d{1,2}:\d{2}\s*[AP]M?)/gi) ?? [];
    const startTime = to24(timeMatches[0] ?? "");
    const endTime = to24(timeMatches[1] ?? "");

    const title = cells[cName] ?? "";
    const isOnline = /online|virtual|web\b/i.test(scheduleStr + " " + title);
    const credits = cCredits >= 0 ? parseFloat((cells[cCredits] ?? "").replace(/[^0-9.]/g, "")) || 0 : 0;
    const statusStr = cStatus >= 0 ? (cells[cStatus] ?? "") : "";
    const seatsOpen = cSeats >= 0 ? (parseFloat((cells[cSeats] ?? "").replace(/[^0-9]/g, "")) || null) : null;

    sections.push({
      college_code: SLUG,
      term: termKey,
      course_prefix: subject,
      course_number: catalog,
      course_title: title,
      credits,
      crn: `${subject}-${catalog}-${sectionId}`,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: cBegin >= 0 ? (cells[cBegin] ?? "") : "",
      location: isOnline ? "Online" : "Coahoma CC",
      campus: "Coahoma CC",
      mode: isOnline ? "online" : "in-person",
      instructor: cFaculty >= 0 ? (cells[cFaculty] || null) : null,
      seats_open: seatsOpen,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
    void statusStr;
  }
  return sections;
}

async function main() {
  const noImport = process.argv.includes("--no-import");
  console.log("Coahoma CC — JICS Advanced Course Search scraper");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 90_000 });

  const terms = await listTerms(page);
  // Keep only currently-relevant terms (2026 academic year).
  const targets = terms.filter((t) => /^(2026|2027);/.test(t.value));
  console.log(`  Terms: ${targets.map((t) => t.label).join(" | ")}`);

  const outDir = path.join(process.cwd(), "data", STATE, "courses", SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  // JICS Course_Schedules portlet caps the unfiltered result set, so we
  // iterate by department to ensure we capture every section.
  const depts = await listDepartments(page);
  console.log(`  Departments: ${depts.length}`);

  let grand = 0;
  for (const t of targets) {
    const termKey = normalizeTermLabelFromValue(t.value);
    const all: CourseSection[] = [];
    const seen = new Set<string>();
    for (const d of depts) {
      try {
        const sections = await searchTerm(page, t.value, d.code);
        for (const sec of sections) {
          if (seen.has(sec.crn)) continue;
          seen.add(sec.crn);
          all.push(sec);
        }
      } catch (err) {
        console.error(`  ERROR ${termKey}/${d.code}: ${(err as Error).message}`);
      }
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
  void normalizeTermLabel;
}

main().catch((err) => {
  console.error("Coahoma scraper failed:", err);
  process.exit(1);
});
