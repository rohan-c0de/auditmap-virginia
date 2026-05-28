/**
 * Northampton Community College (PA) — static JSON scrape
 *
 * NCC's course-search page at northampton.edu/education-and-training/course-search.html
 * loads a custom DataTables UI that pulls every published section from a
 * single static JSON file:
 *
 *   https://www.northampton.edu/_files/js/course-search/courseData.json
 *
 * The file (~3.3 MB) contains a `Report_Entry` array of ~1,700 section
 * records — one entry per offered section across all current academic
 * periods. Each record has Title, Section, Academic_Period,
 * Meeting_Patterns, Days_of_the_Week, Start_Date, End_Date, Instructors,
 * Locations, Section_Capacity, Section_Status, Course_Definition.
 *
 * Notable quirks:
 *   - No CRN field. Sections are identified by their Section string,
 *     formatted like "CISC 115-MID-01 - Computer Science I".
 *   - Academic_Period values vary widely ("Fall 2026", "Mid-Fall 2026",
 *     "Accelerated Fall I 2026", "Summer II 2026", "4 Week Summer I
 *     2026", "Fall Flex 2026", ...). They all map to a calendar season
 *     for purposes of grouping into a term-keyed file.
 *
 * Usage:
 *   npx tsx scripts/pa/scrape-northampton.ts
 *   npx tsx scripts/pa/scrape-northampton.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";

const COLLEGE_SLUG = "northampton";
const STATE = "pa";
const DATA_URL =
  "https://www.northampton.edu/_files/js/course-search/courseData.json";

interface NccEntry {
  Academic_Period: string;
  Academic_Units?: string;
  Bookstore_URL?: string;
  Campus_Locations?: string;
  Course_Definition: string;
  Days_of_the_Week?: string;
  Delivery_Mode?: string;
  Description?: string;
  End_Date?: string;
  Instructors?: string;
  Locations?: string;
  Maximum_Units?: string;
  Meeting_Day_Patterns?: string;
  Meeting_Patterns?: string;
  Minimum_Units?: string;
  Number_of_Registered_Registration_Records?: string;
  Public_Notes?: string;
  Section: string;
  Section_Capacity?: string;
  Section_Status?: string;
  Start_Date?: string;
  Title?: string;
}

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

function academicPeriodToTerm(period: string): string | null {
  // Pull the year first, then determine season from the prose.
  const yearMatch = period.match(/(20\d{2})/);
  if (!yearMatch) return null;
  const year = yearMatch[1];
  const p = period.toLowerCase();
  if (p.includes("fall")) return `${year}FA`;
  if (p.includes("summer")) return `${year}SU`;
  if (p.includes("spring")) return `${year}SP`;
  if (p.includes("winter")) return `${year}WI`;
  return null;
}

function parseCourseDefinition(def: string): { prefix: string; number: string; title: string } | null {
  // Format: "CISC 115 - Computer Science I"
  const m = def.match(/^([A-Z]{2,4})\s+([0-9A-Z]+)\s*-\s*(.+)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], title: m[3].trim() };
}

function parseMeetingTimes(pattern: string): { start: string; end: string } {
  // "Tue | 1:00 PM - 3:50 PM"
  const m = pattern.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
  if (!m) return { start: "", end: "" };
  return { start: m[1].toLowerCase(), end: m[2].toLowerCase() };
}

function compactDays(daysField: string): string {
  // Convert "Monday, Wednesday, Friday" → "MWF"; "Tuesday" → "Tu"
  const map: Record<string, string> = {
    monday: "M",
    tuesday: "Tu",
    wednesday: "W",
    thursday: "Th",
    friday: "F",
    saturday: "Sa",
    sunday: "Su",
  };
  return daysField
    .split(/[,;]/)
    .map((d) => map[d.trim().toLowerCase()] ?? "")
    .join("");
}

function detectMode(deliveryMode: string, campus: string, location: string): CourseSection["mode"] {
  const dm = deliveryMode.toLowerCase();
  const c = campus.toLowerCase();
  const l = location.toLowerCase();
  if (dm === "online" || c.includes("virtual") || l.includes("virtual")) return "online";
  if (dm === "blended" || dm === "hybrid") return "hybrid";
  return "in-person";
}

function entryToSection(e: NccEntry, term: string): CourseSection | null {
  const courseDef = parseCourseDefinition(e.Course_Definition);
  if (!courseDef) return null;

  const meeting = parseMeetingTimes(e.Meeting_Patterns ?? "");
  const days = compactDays(e.Days_of_the_Week ?? "");
  const credits = parseFloat(e.Maximum_Units ?? e.Minimum_Units ?? "0");
  const capacity = parseInt(e.Section_Capacity ?? "0", 10);
  const registered = parseInt(e.Number_of_Registered_Registration_Records ?? "0", 10);
  // Section identifier — e.g. "CISC 115-MID-01" extracted from
  // "CISC 115-MID-01 - Computer Science I".
  const sectionId = e.Section.split(" - ")[0].trim();

  return {
    college_code: COLLEGE_SLUG,
    term,
    course_prefix: courseDef.prefix,
    course_number: courseDef.number,
    course_title: e.Title ?? courseDef.title,
    credits: isNaN(credits) ? 0 : credits,
    crn: sectionId,
    days,
    start_time: meeting.start,
    end_time: meeting.end,
    start_date: e.Start_Date ?? "",
    location: e.Locations ?? "",
    campus: e.Campus_Locations ?? "",
    mode: detectMode(e.Delivery_Mode ?? "", e.Campus_Locations ?? "", e.Locations ?? ""),
    instructor: e.Instructors?.trim() || null,
    seats_open: isNaN(capacity - registered) ? null : Math.max(0, capacity - registered),
    seats_total: isNaN(capacity) ? null : capacity,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");

  console.log(`NCC scraper — fetching ${DATA_URL}`);
  const res = await fetch(DATA_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (CommunityCollegePath/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { Report_Entry: NccEntry[] };
  const entries = data.Report_Entry ?? [];
  console.log(`  fetched ${entries.length} section entries`);

  // Group by canonical term code.
  const byTerm = new Map<string, CourseSection[]>();
  let skippedNoTerm = 0;
  let skippedNoCourse = 0;
  for (const e of entries) {
    const term = academicPeriodToTerm(e.Academic_Period);
    if (!term) {
      skippedNoTerm++;
      continue;
    }
    const sec = entryToSection(e, term);
    if (!sec) {
      skippedNoCourse++;
      continue;
    }
    if (!byTerm.has(term)) byTerm.set(term, []);
    byTerm.get(term)!.push(sec);
  }
  if (skippedNoTerm > 0) console.log(`  skipped ${skippedNoTerm} entries with unparseable Academic_Period`);
  if (skippedNoCourse > 0) console.log(`  skipped ${skippedNoCourse} entries with unparseable Course_Definition`);

  const outDir = path.join(process.cwd(), "data", STATE, "courses", COLLEGE_SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  let grandTotal = 0;
  for (const [term, sections] of byTerm) {
    const outFile = path.join(outDir, `${term}.json`);
    fs.writeFileSync(outFile, JSON.stringify(sections, null, 2));
    console.log(`  ${term}: ${sections.length} sections → ${outFile}`);
    grandTotal += sections.length;
  }
  console.log(`\nTotal: ${grandTotal} sections across ${byTerm.size} terms.`);

  if (!noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase(STATE);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
