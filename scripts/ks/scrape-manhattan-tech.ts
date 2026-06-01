/**
 * Manhattan Area Technical College — Drupal Views course-search scraper
 *
 * MATC publishes its current-term course schedule via a Drupal 9 Views table
 * at `https://manhattantech.edu/course-search`, filtered by a `session` query
 * param (one of `summer` / `fall` / `spring`). Each row has semantic CSS
 * classes (`views-field-field-course-code-cs`, `views-field-field-start-date-cs`,
 * etc.) so cheerio parsing is straightforward.
 *
 * Course codes in the listing are formatted `PREFIX NUMBER SECTION` (e.g.
 * `BSC 110 1B3G1`). Title strings include the KRSN tag (Kansas Regents
 * Shared Number) when applicable — we keep the full string.
 *
 * Each Drupal session filter returns ONLY the next upcoming instance of
 * that session — when run in May 2026 you get Summer 2026; in November you'd
 * get Spring 2027. We infer the calendar year from the dominant `start-date`
 * field in the rows.
 *
 * IMPORTANT: the institutions.json entry for this college lists `matc.edu`
 * as the primary URL, which is WRONG — `matc.edu` is Milwaukee Area Technical
 * College (Wisconsin). The Kansas Manhattan Area Technical College is at
 * `manhattantech.edu`. This PR also corrects that record.
 *
 * Tracks GitHub issue #957.
 *
 * Usage:
 *   npx tsx scripts/ks/scrape-manhattan-tech.ts
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "manhattan-area-technical-college";
const STATE = "ks";
const BASE_URL = "https://manhattantech.edu/course-search";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

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

function parseDate(raw: string): string {
  // MATC writes "06-01-2026"
  const m = raw.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function parseTime(raw: string): { start: string; end: string } {
  const m = raw.match(/(\d{1,2}:\d{2}\s?(?:AM|PM))\s+to\s+(\d{1,2}:\d{2}\s?(?:AM|PM))/i);
  if (!m) return { start: "", end: "" };
  return { start: m[1].toUpperCase().trim(), end: m[2].toUpperCase().trim() };
}

function parseDays(raw: string): string {
  // MATC uses positional space-padded "MTWR" or "  W" — collapse whitespace, keep only [MTWRFSU]
  return raw.trim().replace(/\s+/g, "").replace(/[^MTWRFSU]/g, "");
}

function inferSessionTerm(session: string, dominantStartDate: string): string {
  const m = dominantStartDate.match(/^(\d{4})-(\d{2})/);
  if (!m) return "";
  const year = m[1];
  const month = parseInt(m[2], 10);
  if (session === "summer") return `${year}SU`;
  if (session === "fall") return `${year}FA`;
  if (session === "spring") return `${year}SP`;
  // Fallback by month
  if (month >= 1 && month <= 5) return `${year}SP`;
  if (month >= 6 && month <= 7) return `${year}SU`;
  if (month >= 8 && month <= 12) return `${year}FA`;
  return "";
}

function inferMode(location: string, days: string): "in-person" | "online" | "hybrid" {
  const l = location.toLowerCase();
  if (l.includes("hybrid")) return "hybrid";
  if (l.includes("online") || l === "" || (days === "" && l === "")) return "online";
  return "in-person";
}

async function scrapeSession(session: string): Promise<CourseSection[]> {
  const url = `${BASE_URL}?field_session_value=${session}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const $ = cheerio.load(html);

  const rows: Array<{
    courseCode: string;
    title: string;
    credits: string;
    startDate: string;
    days: string;
    time: string;
    location: string;
  }> = [];

  $("tr").each((_, row) => {
    const $row = $(row);
    const title = $row.find("td.views-field-title a").text().trim();
    const courseCode = $row.find("td.views-field-field-course-code-cs").text().trim();
    if (!title || !courseCode) return;
    const credits = $row.find("td.views-field-field-credit-hours-cs").text().trim();
    const startDate = $row.find("td.views-field-field-start-date-cs").text().trim();
    const days = $row.find("td.views-field-field-days-of-the-week").text();
    const time = $row.find("td.views-field-field-start-and-end-time").text().trim();
    const location = $row.find("td.views-field-field-location").text().trim();
    rows.push({ courseCode, title, credits, startDate, days, time, location });
  });

  if (rows.length === 0) return [];

  // Determine dominant start date → infer term
  const dateCounts: Record<string, number> = {};
  for (const r of rows) {
    const d = parseDate(r.startDate);
    if (d) dateCounts[d] = (dateCounts[d] || 0) + 1;
  }
  const dominantDate = Object.entries(dateCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const term = inferSessionTerm(session, dominantDate);
  if (!term) {
    console.log(`    ! ${session}: could not infer term (dominant date: ${dominantDate || "none"})`);
    return [];
  }

  const sections: CourseSection[] = [];
  for (const r of rows) {
    // "BSC 110 1B3G1" → prefix=BSC, number=110, section=1B3G1
    const codeMatch = r.courseCode.match(/^([A-Z]{2,5})\s+(\d{3}[A-Z]?)\s+(\S+)$/);
    if (!codeMatch) continue;
    const [, prefix, number, section] = codeMatch;
    const { start, end } = parseTime(r.time);
    const days = parseDays(r.days);
    const start_date = parseDate(r.startDate);
    const credits = parseFloat(r.credits) || 0;
    sections.push({
      college_code: SLUG,
      term,
      course_prefix: prefix,
      course_number: number,
      course_title: r.title,
      credits,
      crn: `${prefix}-${number}-${section}`,
      days,
      start_time: start,
      end_time: end,
      start_date,
      location: r.location,
      campus: r.location,
      mode: inferMode(r.location, days),
      instructor: null,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }
  return sections;
}

async function main() {
  console.log("⚙️  Manhattan Area Technical College scraper");
  console.log(`   Source: ${BASE_URL}`);

  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const byTerm = new Map<string, CourseSection[]>();
  for (const session of ["summer", "fall", "spring"]) {
    const sections = await scrapeSession(session);
    if (sections.length === 0) {
      console.log(`    → 0 sections (session=${session})`);
      continue;
    }
    const term = sections[0].term;
    const existing = byTerm.get(term) ?? [];
    byTerm.set(term, [...existing, ...sections]);
    console.log(`    ✓ session=${session} → ${term}: ${sections.length} sections`);
  }

  // Drop already-ended terms — MATC's "spring" filter sometimes returns the
  // most-recent past Spring if the upcoming one isn't published yet.
  const today = new Date().toISOString().slice(0, 10);
  let grandTotal = 0;
  for (const [term, sections] of byTerm) {
    const latestDate = sections
      .map((s) => s.start_date)
      .filter(Boolean)
      .sort()
      .reverse()[0] ?? "";
    if (latestDate && latestDate < today) {
      console.log(`    ⊘ ${term}: all sections start before today (latest ${latestDate}) — skipping`);
      continue;
    }
    const outPath = path.join(COURSES_DIR, `${term}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`    → wrote ${term} (${sections.length} sections) → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ ${SLUG}: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("❌ Manhattan Tech scraper failed:", err);
  process.exit(1);
});
