/**
 * Northwest Arkansas Community College (NWACC) — JSON export scraper
 *
 * NWACC publishes its master class list (open sections, all terms) as a
 * single ~1 MB JSON file consumed by their /classlisting.html widget:
 *   https://www.nwacc.edu/master-classes.json
 *
 * Records follow the Workday Student export shape — sample row:
 *   {
 *     "Section_Status": "Open",
 *     "Academic_Period": "2026 Summer 8 Week",
 *     "Course_Subjects": "Mathematics",
 *     "Course_Number": "MATH 0044",
 *     "Course_Listing": "MATH 0044-2 - Math Essentials",
 *     "Start_Date": "05-25-2026",
 *     "End_Date": "07-17-2026",
 *     "Meeting_Pattern": "MTWR | 12:00 PM - 1:50 PM",
 *     "Delivery_Mode": "In-Person",
 *     "Campus_Locations": "Benton County Campus, Arkansas",
 *     "Units_and_Unit_Type": "4 Semester Units",
 *     "Section_Capacity": "20",
 *     "Seats_Available": "8",
 *     "Instructors": "Kimuyen Cummings"
 *   }
 *
 * Usage: npx tsx scripts/ar/scrape-nwacc.ts
 */
import * as fs from "fs";
import * as path from "path";

const SLUG = "northwest-arkansas-community-college";
const STATE = "ar";
const FEED_URL = "https://www.nwacc.edu/master-classes.json";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

type Row = Record<string, string>;
type Section = {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  start_date: string | null;
  location: string | null;
  campus: string | null;
  mode: "in-person" | "online" | "hybrid" | "remote" | null;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: null;
  prerequisite_courses: [];
};

// Two patterns observed in the feed:
//   "Fall 2026"                       (season-year, ~62% of rows)
//   "2026 Summer 8 Week" / "2026 Fall 1st 8 Week"  (year-season-window)
// Both map to one term code "{YYYY}{SS}" — sub-windows (8 Week, 5 Week, …)
// share the standard term so they aggregate correctly in the UI.
function parseTermCode(period: string): string | null {
  const seasonFirst = period.match(/^(Fall|Spring|Summer|Winter)\s+(\d{4})\b/i);
  if (seasonFirst) {
    const season = seasonFirst[1].toUpperCase();
    const code = season === "FALL" ? "FA" : season === "SPRING" ? "SP" : season === "SUMMER" ? "SU" : "WI";
    return `${seasonFirst[2]}${code}`;
  }
  const yearFirst = period.match(/^(\d{4})\s+(Fall|Spring|Summer|Winter)\b/i);
  if (yearFirst) {
    const season = yearFirst[2].toUpperCase();
    const code = season === "FALL" ? "FA" : season === "SPRING" ? "SP" : season === "SUMMER" ? "SU" : "WI";
    return `${yearFirst[1]}${code}`;
  }
  return null;
}

// "MATH 0044" → ["MATH", "0044"]
function splitCourseNumber(s: string): [string, string] | null {
  const m = s.match(/^([A-Z]+)\s+([A-Z0-9-]+)$/);
  return m ? [m[1], m[2]] : null;
}

// "MATH 0044-2 - Math Essentials" → "Math Essentials"
function parseTitle(listing: string, fallback: string): string {
  const idx = listing.indexOf(" - ");
  return idx >= 0 ? listing.slice(idx + 3).trim() : fallback;
}

// "MATH 0044-2 - …" → "MATH-0044-2"  (stable per-section ID)
function parseCrn(listing: string, fallbackPrefix: string, fallbackNumber: string): string {
  const head = listing.split(" - ")[0]?.trim() ?? "";
  const m = head.match(/^([A-Z]+)\s+([A-Z0-9-]+)-(\w+)$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : `${fallbackPrefix}-${fallbackNumber}-?`;
}

// "MTWR | 12:00 PM - 1:50 PM" / "MTWR | 12:00 PM - 1:50 PM | 05/25/2026 - 07/17/2026"
function parseMeeting(pattern: string): { days: string | null; start_time: string | null; end_time: string | null } {
  if (!pattern) return { days: null, start_time: null, end_time: null };
  const parts = pattern.split("|").map((p) => p.trim());
  const days = parts[0] || null;
  const timePart = parts[1] ?? "";
  const tm = timePart.match(/^(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/);
  if (tm) return { days, start_time: tm[1], end_time: tm[2] };
  return { days, start_time: null, end_time: null };
}

// "4 Semester Units" → 4
function parseCredits(s: string): number {
  const m = s.match(/^(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

// "06-29-2026" → "2026-06-29"
function parseDate(s: string): string | null {
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

function parseMode(delivery: string): Section["mode"] {
  const d = delivery.toLowerCase();
  if (d.includes("remote")) return "remote";
  if (d.includes("online")) return "online";
  if (d.includes("hybrid") || d.includes("blended")) return "hybrid";
  if (d.includes("in-person") || d.includes("in person")) return "in-person";
  return null;
}

function toSection(row: Row): Section | null {
  const term = parseTermCode(row.Academic_Period ?? "");
  if (!term) return null;
  const cn = splitCourseNumber(row.Course_Number ?? "");
  if (!cn) return null;
  const [prefix, number] = cn;
  const title = parseTitle(row.Course_Listing ?? "", row.Course_Number ?? "");
  const crn = parseCrn(row.Course_Listing ?? "", prefix, number);
  const { days, start_time, end_time } = parseMeeting(row.Meeting_Pattern ?? "");
  const seatsOpenStr = row.Seats_Available;
  const seatsCapStr = row.Section_Capacity;
  return {
    college_code: SLUG,
    term,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits: parseCredits(row.Units_and_Unit_Type ?? ""),
    crn,
    days,
    start_time,
    end_time,
    start_date: parseDate(row.Start_Date ?? ""),
    location: row.Location || null,
    campus: row.Campus_Locations || null,
    mode: parseMode(row.Delivery_Mode ?? ""),
    instructor: row.Instructors || null,
    seats_open: seatsOpenStr ? Number(seatsOpenStr) : null,
    seats_total: seatsCapStr ? Number(seatsCapStr) : null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

async function main() {
  console.log(`Fetching ${FEED_URL}...`);
  const res = await fetch(FEED_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; cc-coursemap/1.0; +https://communitycollegepath.com)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from feed`);
  const rows = (await res.json()) as Row[];
  console.log(`  ${rows.length} raw rows.`);

  const currentYear = new Date().getFullYear();
  const byTerm = new Map<string, Section[]>();
  let skipped = 0;
  for (const row of rows) {
    const sec = toSection(row);
    if (!sec) {
      skipped++;
      continue;
    }
    const year = Number(sec.term.slice(0, 4));
    if (year < currentYear) {
      skipped++;
      continue;
    }
    if (!byTerm.has(sec.term)) byTerm.set(sec.term, []);
    byTerm.get(sec.term)!.push(sec);
  }
  console.log(`  ${rows.length - skipped} usable sections across ${byTerm.size} term(s); ${skipped} skipped.`);

  fs.mkdirSync(COURSES_DIR, { recursive: true });
  for (const [term, sections] of [...byTerm.entries()].sort()) {
    const out = path.join(COURSES_DIR, `${term}.json`);
    fs.writeFileSync(out, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  Written ${sections.length} sections to ${out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
