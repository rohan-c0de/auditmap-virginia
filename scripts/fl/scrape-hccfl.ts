/**
 * scrape-hccfl.ts — Hillsborough Community College (Tampa area) class search
 *
 * HCC's class-search SPA at classes.hccfl.edu is fronted by a public REST
 * endpoint that returns every section for a given term in one JSON array.
 * No auth, no pagination — the easiest scraper in the FL set.
 *
 *   GET https://classes.hccfl.edu/api/courseSection?term=26/FA
 *     -> [{course,courseName,subject,section,...}, ...]   (~5MB / ~4k rows)
 *
 * Term codes are `YY/SS` where YY = 2-digit year, SS = SU/FA/SP.
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-hccfl.ts                       # SU + FA
 *   npx tsx scripts/fl/scrape-hccfl.ts --term "Fall 2026"
 */
import * as fs from "fs";
import * as path from "path";

const COLLEGE_SLUG = "hccfl";
const DATA_DIR = path.join(process.cwd(), "data", "fl", "courses", COLLEGE_SLUG);
const API = "https://classes.hccfl.edu/api/courseSection";

const TERM_MAP: Record<string, { api: string; file: string }> = {
  "Summer 2026": { api: "26/SU", file: "2026SU" },
  "Fall 2026":   { api: "26/FA", file: "2026FA" },
};

interface ApiSection {
  academicPeriod?: string;
  availability?: string;       // open seats (string)
  capacity?: string;
  taken?: string;
  building?: string;
  comments?: string;
  course?: string;             // catalog number
  courseName?: string;
  endDate?: string;
  endTime?: string;
  endTime2?: string;
  endTime3?: string;
  firstName?: string;
  firstName2?: string;
  lastName?: string;
  lastName2?: string;
  locationName?: string;       // campus
  meetingPattern?: string;     // days, e.g. "MWF"
  meetingPattern2?: string;
  meetingPattern3?: string;
  modality?: string;
  roomNumber?: string;
  section?: string;
  startDate?: string;
  startTime?: string;
  startTime2?: string;
  startTime3?: string;
  status?: string;
  subject?: string;            // prefix, e.g. "ACG"
  rowKey?: string;             // e.g. "26FA-ACG-2021-1"
  term?: string;
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
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

function parseArgs() {
  const args = process.argv.slice(2);
  let termArg = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) { termArg = args[i + 1]; i++; }
  }
  if (!termArg) termArg = "Summer 2026,Fall 2026";
  return termArg.split(",").map((t) => t.trim()).filter(Boolean);
}

function normalizeTime(t: string | undefined): string {
  if (!t) return "";
  // API returns 24h "HH:MM" or empty. Convert to 12h with am/pm.
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  let hr = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = hr >= 12 ? "PM" : "AM";
  hr = hr % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${mm}${ampm}`;
}

function dayPattern(p: string | undefined): string {
  if (!p) return "";
  // API uses single-letter codes M T W R F S U
  // Map directly to our two-letter convention used elsewhere (Mo, Tu, We, Th, Fr, Sa, Su)
  const map: Record<string, string> = { M: "Mo", T: "Tu", W: "We", R: "Th", F: "Fr", S: "Sa", U: "Su" };
  return p.split("").map((c) => map[c] || "").join("");
}

function determineMode(modality: string | undefined, building: string | undefined): string {
  const m = (modality || "").toLowerCase();
  const b = (building || "").toLowerCase();
  if (m.includes("online") || b.includes("online")) return "online";
  if (m.includes("hybrid")) return "hybrid";
  return "in-person";
}

function combine(loc: string | undefined, room: string | undefined): string {
  const parts = [loc, room].filter((s): s is string => Boolean(s && s.trim()));
  return parts.join(" - ");
}

function joinName(first: string | undefined, last: string | undefined): string | null {
  const name = [first, last].filter((s): s is string => Boolean(s && s.trim())).join(" ").trim();
  if (!name) return null;
  if (name.toLowerCase() === "tba" || name.toLowerCase() === "staff") return null;
  return name;
}

function transform(s: ApiSection, fileTermCode: string): CourseSection | null {
  const subject = s.subject?.trim();
  const number = s.course?.trim();
  if (!subject || !number) return null;
  return {
    college_code: COLLEGE_SLUG,
    term: fileTermCode,
    course_prefix: subject,
    course_number: number,
    course_title: (s.courseName || "").trim(),
    credits: 3, // not in API; default; UI tolerates this
    crn: s.rowKey || `${s.term}-${subject}-${number}-${s.section || "x"}`,
    days: dayPattern(s.meetingPattern),
    start_time: normalizeTime(s.startTime),
    end_time: normalizeTime(s.endTime),
    start_date: (s.startDate || "").split("-").slice(0, 3).join("-"),
    location: combine(s.locationName, s.roomNumber),
    campus: (s.locationName || "").trim(),
    mode: determineMode(s.modality, s.building),
    instructor: joinName(s.firstName, s.lastName),
    seats_open: s.availability ? parseInt(s.availability, 10) : null,
    seats_total: s.capacity ? parseInt(s.capacity, 10) : null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

async function fetchTerm(termName: string): Promise<{ termName: string; fileTermCode: string; sections: CourseSection[] }> {
  const cfg = TERM_MAP[termName];
  if (!cfg) {
    console.error(`Unknown term: "${termName}". Available:`, Object.keys(TERM_MAP).join(", "));
    process.exit(1);
  }
  const url = `${API}?term=${encodeURIComponent(cfg.api)}`;
  console.log(`  fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const data = (await res.json()) as ApiSection[];
  console.log(`  ${data.length} raw rows`);
  const sections = data.map((s) => transform(s, cfg.file)).filter((s): s is CourseSection => s !== null);
  return { termName, fileTermCode: cfg.file, sections };
}

async function main() {
  const terms = parseArgs();
  console.log(`\nHillsborough CC — fetching ${terms.length} term(s)`);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let total = 0;
  for (const t of terms) {
    const { termName, fileTermCode, sections } = await fetchTerm(t);
    const p = path.join(DATA_DIR, `${fileTermCode}.json`);
    fs.writeFileSync(p, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  ${termName}: ${sections.length} sections -> ${path.relative(process.cwd(), p)}`);
    total += sections.length;
  }
  console.log(`\nDone! ${total} sections across ${terms.length} term(s)\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
