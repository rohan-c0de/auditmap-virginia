/**
 * Western Nebraska Community College — Google Sheets pubhtml scraper
 *
 * WNCC publishes per-term course schedules as public Google Sheets (pubhtml
 * format) linked from https://www.wncc.edu/academics/catalog-course-schedule.php.
 *
 * Each Google Sheet has multiple tabs; the "Master Schedule" tab (gid=0)
 * contains all sections. The pubhtml wrapper loads tabs via iframes, so we
 * fetch the individual sheet page URL directly:
 *   .../pubhtml/sheet?headers=false&gid=0
 *
 * Column layout (0-indexed, column 0 is a row number):
 *   1=SYN#  2=Course  3=Section  4=Course Title  5=Cr  6=Fees
 *   7=Loc   8=Start Date  9=End Date  10=Start  11=End  12=Days
 *   13=Rm   14=Instructor
 *
 * Usage:
 *   npx tsx scripts/ne/scrape-wncc.ts
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "western-nebraska-community-college";
const STATE = "ne";
const LANDING_URL = "https://www.wncc.edu/academics/catalog-course-schedule.php";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

interface TermSheet {
  term: string;
  url: string;
  label: string;
}

function inferTerm(label: string): string {
  const l = label.toLowerCase();
  const yearMatch = l.match(/20\d{2}/);
  const year = yearMatch ? yearMatch[0] : "";
  if (l.includes("fall")) return `${year}FA`;
  if (l.includes("spring")) return `${year}SP`;
  if (l.includes("summer")) return `${year}SU`;
  if (l.includes("winter")) return `${year}WI`;
  return year;
}

async function discoverSheets(): Promise<TermSheet[]> {
  const res = await fetch(LANDING_URL, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`Landing page failed: HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const sheets: TermSheet[] = [];
  $("a[href*='docs.google.com/spreadsheets']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const label = $(el).text().trim() || $(el).parent().text().trim();
    if (href.includes("pubhtml") || href.includes("pub?")) {
      const term = inferTerm(label);
      if (term) sheets.push({ term, url: href, label });
    }
  });

  const now = new Date(process.env.SCRAPE_NOW_ISO || "2026-05-31");
  const currentYear = now.getUTCFullYear();
  return sheets.filter((s) => {
    const year = parseInt(s.term.slice(0, 4), 10);
    return year >= currentYear;
  });
}

function toSheetUrl(pubhtmlUrl: string): string {
  const base = pubhtmlUrl.split("?")[0].replace(/\/$/, "");
  return `${base}/sheet?headers=false&gid=0`;
}

function to24(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!m) return raw.trim();
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${h.toString().padStart(2, "0")}:${min}`;
}

function parseDate(raw: string): string {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return "";
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function normalizeDays(raw: string): string {
  return raw
    .replace(/,\s*/g, "")
    .replace(/TH/gi, "R")
    .replace(/SU/gi, "U")
    .replace(/SA/gi, "S")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function inferMode(loc: string, days: string): "in-person" | "online" | "hybrid" {
  const l = loc.toLowerCase();
  if (l.includes("online") || l.includes("ol") || l === "internet") return "online";
  if (l.includes("hybrid")) return "hybrid";
  if (!days) return "online";
  return "in-person";
}

async function scrapeSheet(sheet: TermSheet): Promise<CourseSection[]> {
  const sheetUrl = toSheetUrl(sheet.url);
  const res = await fetch(sheetUrl, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Sheet fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const sections: CourseSection[] = [];

  $("table tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 10) return;

    const vals = cells.map((__, c) => $(c).text().trim()).get();

    // Columns: 0=SYN# 1=Course 2=Section 3=Title 4=Cr 5=Fees
    //          6=Loc 7=StartDate 8=EndDate 9=Start 10=End 11=Days 12=Rm 13=Instructor
    const courseRaw = vals[1] || "";
    const courseMatch = courseRaw.match(/^([A-Z]{2,5})-?(\d{3,5})$/);
    if (!courseMatch) return;

    const prefix = courseMatch[1];
    const number = courseMatch[2];
    const syn = vals[0] || "";
    const section = vals[2] || "";
    const title = vals[3] || "";
    const credits = parseFloat(vals[4]) || 0;
    const loc = vals[6] || "";
    const startDate = parseDate(vals[7] || "");
    const startTime = to24(vals[9] || "");
    const endTime = to24(vals[10] || "");
    const days = normalizeDays(vals[11] || "");
    const room = vals[12] || "";
    const instructor = vals[13] || null;

    sections.push({
      college_code: SLUG,
      term: sheet.term,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits,
      crn: syn || `${prefix}-${number}-${section}`,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      location: room ? `${loc} ${room}` : loc,
      campus: "WNCC",
      mode: inferMode(loc, days),
      instructor: instructor || null,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  return sections;
}

async function main() {
  console.log("Western Nebraska Community College — Google Sheets scraper");
  console.log(`   Landing: ${LANDING_URL}`);

  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const sheets = await discoverSheets();
  console.log(`   Found ${sheets.length} sheet(s): ${sheets.map((s) => `${s.term} (${s.label})`).join(", ")}`);

  if (sheets.length === 0) {
    console.log("   No current/future term sheets found on the landing page.");
    process.exit(0);
  }

  let grandTotal = 0;
  for (const sheet of sheets) {
    process.stdout.write(`  ${sheet.term} (${sheet.label})... `);
    try {
      const sections = await scrapeSheet(sheet);
      if (sections.length === 0) {
        console.log("0 sections (skipping)");
        continue;
      }
      const outPath = path.join(COURSES_DIR, `${sheet.term}.json`);
      fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
      console.log(`${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
      grandTotal += sections.length;
    } catch (err) {
      console.log(`error: ${(err as Error).message}`);
    }
  }

  console.log(`\n${SLUG}: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("WNCC scraper failed:", err);
  process.exit(1);
});
