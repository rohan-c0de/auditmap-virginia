/**
 * Salina Area Technical College — SONIS course-search scraper
 *
 * Salina Tech's main marketing site (`salinatech.edu`) is fronted by an
 * IPC sgcaptcha bot-challenge wall that blocks plain HTTP requests with
 * a 202 + meta-refresh to `/.well-known/sgcaptcha/`. BUT the SIS itself
 * lives on a separate subdomain (`sonis.salinatech.edu`) that ISN'T
 * gated — direct HTTP fetches return a fully rendered ASP.NET table of
 * sections. We discovered the URL by running a Playwright probe against
 * the homepage (post-challenge) and pulling out the "Class Schedules"
 * dropdown links.
 *
 * Platform: SONIS (Jenzabar's small-college SIS).
 *
 * URL pattern:
 *   https://sonis.salinatech.edu/courses/default.aspx?campus=&dept=&Semester=N&Search=
 *
 * Semester codes: 1 = Fall, 2 = Spring, 3 = Summer.
 *
 * Each `<tr>` row has 7 cells:
 *   0: <span class="title">Course Title</span> <span class="title">(PREFIX NUMBER)</span>
 *   1: Section number
 *   2: Campus (e.g. "SATC Main Campus")
 *   3: Credits
 *   4: Instructor
 *   5: "Course Start Date: MM/DD/YYYY\nCourse End Date: MM/DD/YYYY"
 *   6: "MON/TUE/WED/THU/FRI 7:30 AM - 10:45 AM" or "TBD"
 *
 * Tracks GitHub issue #956.
 *
 * Usage:
 *   npx tsx scripts/ks/scrape-salina.ts
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "salina-area-technical-college";
const STATE = "ks";
const BASE_URL = "https://sonis.salinatech.edu/courses/default.aspx";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const SEMESTER_TO_SEASON: Record<string, "FA" | "SP" | "SU"> = { "1": "FA", "2": "SP", "3": "SU" };

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
  seats_open: null;
  seats_total: null;
  prerequisite_text: null;
  prerequisite_courses: string[];
}

const DAY_MAP: Record<string, string> = {
  MON: "M", TUE: "T", WED: "W", THU: "R", FRI: "F", SAT: "S", SUN: "U",
};

function parseDays(raw: string): { days: string; rest: string } {
  // e.g. "MON/TUE/WED/THU/FRI 7:30 AM - 10:45 AM"
  const dayPattern = /^((?:(?:MON|TUE|WED|THU|FRI|SAT|SUN)\/?)+)\s+(.*)$/;
  const m = raw.match(dayPattern);
  if (!m) return { days: "", rest: raw };
  const tokens = m[1].split("/").filter(Boolean);
  const days = tokens.map((t) => DAY_MAP[t] ?? "").join("");
  return { days, rest: m[2] };
}

function parseTime(raw: string): { start: string; end: string } {
  const m = raw.match(/(\d{1,2}:\d{2}\s?[AP]M)\s*-\s*(\d{1,2}:\d{2}\s?[AP]M)/i);
  if (!m) return { start: "", end: "" };
  return { start: m[1].toUpperCase().trim(), end: m[2].toUpperCase().trim() };
}

function parseDate(raw: string): string {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function inferMode(campus: string, days: string): "in-person" | "online" | "hybrid" {
  const c = campus.toLowerCase();
  if (c.includes("hybrid")) return "hybrid";
  if (c.includes("online") || c === "online") return "online";
  if (days === "" || c === "tbd") return "online";
  return "in-person";
}

async function fetchSemester(semester: string): Promise<string> {
  const url = `${BASE_URL}?campus=&dept=&Semester=${semester}&Search=`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  return await res.text();
}

function parseSemester(html: string, semester: string): CourseSection[] {
  const $ = cheerio.load(html);
  const rows: CourseSection[] = [];

  $("tr").each((_, row) => {
    const tds = $(row).find("> td").toArray();
    if (tds.length < 7) return;
    const titleSpans = $(tds[0]).find("span.title").toArray();
    if (titleSpans.length < 2) return;

    const title = $(titleSpans[0]).text().trim();
    const codeRaw = $(titleSpans[1]).text().trim().replace(/^\(|\)$/g, "");
    const codeMatch = codeRaw.match(/^([A-Z]{2,4})\s*(\d{3}[A-Z]?)$/);
    if (!codeMatch) return;
    const [, prefix, number] = codeMatch;

    const section = $(tds[1]).text().trim();
    const campus = $(tds[2]).text().trim();
    const credits = parseFloat($(tds[3]).text().trim()) || 0;
    const instructor = $(tds[4]).text().trim().replace(/\s+/g, " ") || null;

    const dateText = $(tds[5]).text();
    const dateLines = dateText.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
    const startDateLine = dateLines.find((l) => /start date/i.test(l)) ?? dateLines[0] ?? "";
    const start_date = parseDate(startDateLine);

    const timeText = $(tds[6]).text().replace(/\s+/g, " ").trim();
    if (timeText === "TBD" || timeText === "") {
      rows.push({
        college_code: SLUG,
        term: `${start_date.slice(0, 4) || ""}${SEMESTER_TO_SEASON[semester]}`,
        course_prefix: prefix,
        course_number: number,
        course_title: title,
        credits,
        crn: `${prefix}-${number}-${section}`,
        days: "",
        start_time: "",
        end_time: "",
        start_date,
        location: campus,
        campus,
        mode: inferMode(campus, ""),
        instructor: instructor === "" ? null : instructor,
        seats_open: null,
        seats_total: null,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
      return;
    }
    const { days, rest } = parseDays(timeText);
    const { start, end } = parseTime(rest);

    rows.push({
      college_code: SLUG,
      term: `${start_date.slice(0, 4) || ""}${SEMESTER_TO_SEASON[semester]}`,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits,
      crn: `${prefix}-${number}-${section}`,
      days,
      start_time: start,
      end_time: end,
      start_date,
      location: campus,
      campus,
      mode: inferMode(campus, days),
      instructor: instructor === "" ? null : instructor,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  return rows;
}

async function main() {
  console.log("🛠️  Salina Area Technical College (SONIS) scraper");
  console.log(`   Source: ${BASE_URL}`);
  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const byTerm = new Map<string, CourseSection[]>();
  for (const sem of ["1", "2", "3"]) {
    const html = await fetchSemester(sem);
    const sections = parseSemester(html, sem);
    if (sections.length === 0) {
      console.log(`    → 0 sections (semester=${sem})`);
      continue;
    }
    // Group by term (the function infers from start_date year)
    for (const s of sections) {
      if (!s.term || s.term.length < 6) continue; // bad year inference
      const arr = byTerm.get(s.term) ?? [];
      arr.push(s);
      byTerm.set(s.term, arr);
    }
    console.log(`    ✓ semester=${sem}: ${sections.length} sections`);
  }

  // Drop past terms
  const today = new Date().toISOString().slice(0, 10);
  let grandTotal = 0;
  for (const [term, sections] of [...byTerm].sort()) {
    const latestDate = sections.map((s) => s.start_date).filter(Boolean).sort().reverse()[0] ?? "";
    if (latestDate && latestDate < today) {
      console.log(`    ⊘ ${term}: latest ${latestDate} < today, skipping`);
      continue;
    }
    const outPath = path.join(COURSES_DIR, `${term}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`    → wrote ${term} (${sections.length} sections)`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ ${SLUG}: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("❌ Salina scraper failed:", err);
  process.exit(1);
});
