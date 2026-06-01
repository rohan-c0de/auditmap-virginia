/**
 * Collin College — bespoke JSON API scrape
 *
 * Collin runs a Workday SIS for actual registration, but publishes its
 * public class schedule via a custom React/Nuxt SPA at
 * `collin-coursebook.web.app`, backed by an Azure App Service REST API at:
 *
 *   https://coursebook-collin-api.azurewebsites.net/sections
 *
 * The API:
 *   - returns paginated JSON; page size is fixed at 10 server-side, and
 *     ANY explicit `pageSize` query parameter (even =10) silently makes
 *     the endpoint return `data: []` — so we omit it entirely
 *   - 1,948 sections across the active academic periods (≈ 195 pages)
 *   - no auth, no API key, no rate-limit headers seen during smoke
 *   - fields are Workday-flavored (Starting_Academic_Period, Subject,
 *     CRN, Section_Status, Section_Capacity, Meeting_Patterns, …)
 *
 * Each item is mapped to the shared CourseSection schema used by every
 * other state's course scraper. Sections from each academic period are
 * grouped and written to data/tx/courses/collin-county-community-college-
 * district/{TERMCODE}.json.
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-collin.ts                # full sweep
 *   npx tsx scripts/tx/scrape-collin.ts --max-pages 3  # smoke (30 sections)
 */
import * as fs from "fs";
import * as path from "path";

const SLUG = "collin-county-community-college-district";
const STATE = "tx";
const API_URL = "https://coursebook-collin-api.azurewebsites.net/sections";
const OUT_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

type CourseMode = "in-person" | "online" | "hybrid" | "zoom";

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
  mode: CourseMode;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

/** Workday item — only fields we actually read. */
interface CollinItem {
  CRN?: string;
  Section?: string;
  Section_Number?: string;
  Subject?: string;
  Course_Number?: string;
  Title?: string;
  Units?: string;
  Description?: string;
  Days_of_the_Week?: string;
  Meeting_Patterns?: string;
  Delivery_Mode?: string;
  Campus_Locations?: string;
  Instructors?: string;
  Section_Capacity?: string;
  Enrollment_Count?: string;
  Section_Status?: string;
  Start_Date?: string;
  Starting_Academic_Period?: string;
}

interface ApiPage {
  data: CollinItem[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** "2026 Summer Semester" → "2026SU"; "2026 Fall Semester" → "2026FA". */
function periodToCode(period: string): string | null {
  const m = period.match(/(\d{4})\s+(Fall|Spring|Summer|Winter)/i);
  if (!m) return null;
  const map: Record<string, string> = {
    FALL: "FA",
    SPRING: "SP",
    SUMMER: "SU",
    WINTER: "WI",
  };
  return `${m[1]}${map[m[2].toUpperCase()]}`;
}

const DAY_NAMES: Record<string, string> = {
  MONDAY: "M",
  TUESDAY: "T",
  WEDNESDAY: "W",
  THURSDAY: "R",
  FRIDAY: "F",
  SATURDAY: "S",
  SUNDAY: "U",
};

function parseDays(s: string): string {
  if (!s) return "";
  return s
    .split(/[,;|]/)
    .map((d) => DAY_NAMES[d.trim().toUpperCase()] ?? "")
    .join("");
}

/**
 * "Wednesday | 9:00 AM - 11:50 AM; Wednesday | 8:00 AM - 8:50 AM"
 * → { start_time, end_time } from the first pattern.
 */
function parseMeetingTimes(s: string): { start_time: string; end_time: string } {
  if (!s) return { start_time: "", end_time: "" };
  const first = s.split(";")[0] ?? "";
  const m = first.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!m) return { start_time: "", end_time: "" };
  return { start_time: m[1].trim(), end_time: m[2].trim() };
}

function classifyMode(dm: string | undefined): CourseMode {
  const v = (dm ?? "").toLowerCase();
  if (/hybrid|combination/.test(v)) return "hybrid";
  if (/online|distance|web/.test(v)) return "online";
  if (/zoom/.test(v)) return "zoom";
  return "in-person";
}

function parseSeats(it: CollinItem): { open: number | null; total: number | null } {
  const cap = parseInt(it.Section_Capacity ?? "", 10);
  const enr = parseInt(it.Enrollment_Count ?? "", 10);
  const total = Number.isFinite(cap) ? cap : null;
  const enrolled = Number.isFinite(enr) ? enr : 0;
  const open = total !== null ? Math.max(0, total - enrolled) : null;
  return { open, total };
}

/**
 * Pull a "Prerequisite ..." sentence out of the description. Collin embeds
 * prereqs inline like:
 *   "Prerequisite ABDR 1315. 2 credit hours. (W)"
 *   "Prerequisites: ENGL 1301 with a grade of C or better."
 */
function extractPrereqs(desc: string | undefined): {
  text: string | null;
  courses: string[];
} {
  if (!desc) return { text: null, courses: [] };
  const m = desc.match(/Prerequisite[s]?[:\s].+?(?=(?:\.\s+\d|\.\s+\(|\.$))/i);
  if (!m) return { text: null, courses: [] };
  const text = m[0].replace(/\s+/g, " ").trim();
  const codes = Array.from(text.matchAll(/\b([A-Z]{2,4})\s*(\d{3,4})\b/g)).map(
    ([, prefix, num]) => `${prefix} ${num}`
  );
  return { text, courses: Array.from(new Set(codes)) };
}

function itemToSection(it: CollinItem, termFile: string): CourseSection | null {
  const subject = (it.Subject ?? "").trim();
  const number = (it.Course_Number ?? "").trim();
  if (!subject || !number) return null;
  const dm = classifyMode(it.Delivery_Mode);
  const { start_time, end_time } = parseMeetingTimes(it.Meeting_Patterns ?? "");
  const days = parseDays(it.Days_of_the_Week ?? "");
  const { open, total } = parseSeats(it);
  const { text: prereq_text, courses: prereq_courses } = extractPrereqs(
    it.Description
  );
  const campus = (it.Campus_Locations ?? "").trim();
  return {
    college_code: SLUG,
    term: termFile,
    course_prefix: subject,
    course_number: number,
    course_title: (it.Title ?? "").trim(),
    credits: parseFloat(it.Units ?? "") || 0,
    crn: (it.CRN ?? `${subject}-${number}-${it.Section_Number ?? ""}`).trim(),
    days,
    start_time,
    end_time,
    start_date: (it.Start_Date ?? "").trim(),
    location: campus,
    campus,
    mode: dm,
    instructor: (it.Instructors ?? "").trim() || null,
    seats_open: open,
    seats_total: total,
    prerequisite_text: prereq_text,
    prerequisite_courses: prereq_courses,
  };
}

async function fetchPage(page: number): Promise<ApiPage> {
  // Important: do NOT include &pageSize=... — see the file header. The
  // server treats any pageSize value (even the working default of 10) as
  // an instruction to return an empty data array.
  const url = `${API_URL}?page=${page}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on page ${page}`);
  return (await res.json()) as ApiPage;
}

async function main() {
  const args = process.argv.slice(2);
  const maxPagesArg = args.find((a) => a.startsWith("--max-pages="))?.split("=")[1];
  const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : Infinity;

  console.log(`🦬 Collin College — Azure API sweep`);
  console.log(`   ${API_URL}`);

  // First page tells us how many to expect
  const first = await fetchPage(1);
  console.log(
    `   totalItems=${first.totalItems} totalPages=${first.totalPages}`
  );

  // Group sections by term-file code
  const byTerm = new Map<string, CourseSection[]>();
  const skippedNoPeriod: string[] = [];

  function ingestItems(items: CollinItem[]) {
    for (const it of items) {
      const period = it.Starting_Academic_Period ?? "";
      const code = periodToCode(period);
      if (!code) {
        if (period && !skippedNoPeriod.includes(period)) {
          skippedNoPeriod.push(period);
        }
        continue;
      }
      const sec = itemToSection(it, code);
      if (!sec) continue;
      if (!byTerm.has(code)) byTerm.set(code, []);
      byTerm.get(code)!.push(sec);
    }
  }

  ingestItems(first.data);

  const pageCap = Math.min(first.totalPages, maxPages);
  for (let p = 2; p <= pageCap; p++) {
    if (p % 20 === 0 || p === pageCap) {
      console.log(`   page ${p}/${pageCap} …`);
    }
    let attempt = 0;
    while (true) {
      try {
        const page = await fetchPage(p);
        ingestItems(page.data);
        break;
      } catch (e) {
        attempt++;
        if (attempt > 3) throw e;
        await sleep(2000 * attempt);
      }
    }
    await sleep(50); // gentle pacing
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let grandTotal = 0;
  const summary: Array<{ term: string; sections: number }> = [];
  for (const [term, sections] of [...byTerm.entries()].sort()) {
    const outFile = path.join(OUT_DIR, `${term}.json`);
    fs.writeFileSync(outFile, JSON.stringify(sections, null, 2) + "\n");
    console.log(`   ✓ ${term}: ${sections.length} sections → ${outFile}`);
    summary.push({ term, sections: sections.length });
    grandTotal += sections.length;
  }
  if (skippedNoPeriod.length > 0) {
    console.log(`   ⚠️  skipped periods (unmappable): ${skippedNoPeriod.join(", ")}`);
  }
  console.log(`\n✅ ${grandTotal} sections across ${summary.length} terms.`);
}

main().catch((e) => {
  console.error("❌ Collin scraper failed:", e);
  process.exit(1);
});
