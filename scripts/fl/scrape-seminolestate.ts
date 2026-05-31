/**
 * scrape-seminolestate.ts — Seminole State College of Florida
 *
 * Seminole publishes their full catalog at
 *   https://www.seminolestate.edu/catalog/courses
 * with a 3-level drill-down:
 *
 *   /catalog/courses/<letter>       → 15 prefixes (e.g. /a → ACG, ACR, AER, ...)
 *   /catalog/courses/<prefix>       → all courses for that 3-letter subject
 *   /catalog/courses/<courseSlug>   → full course detail with sections
 *
 * Each course-detail page contains one or more <table class="course-listing">
 * blocks (one per session — Full Term, Session A, B, etc.) where each
 * <tr class="course-row course-row-listing"> is a section with cells:
 *   class#, times, days, dates, room, instructor.
 *
 * Term selection: course detail accepts ?term=<strm> where strm = the
 * data-strm value from the term dropdown (e.g. 2267=Fall 2026, 2264=Summer 2026).
 *
 * Heads-up: Seminole's server is regularly slow — 30-90s for a page is
 * normal. We set a 90s timeout and don't retry; partial saves every
 * 50 courses so we can resume.
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-seminolestate.ts
 *   npx tsx scripts/fl/scrape-seminolestate.ts --term "Fall 2026"
 *   npx tsx scripts/fl/scrape-seminolestate.ts --term "Fall 2026" --prefix mac
 */
import * as fs from "fs";
import * as path from "path";

const BASE = "https://www.seminolestate.edu";
const COLLEGE_SLUG = "seminolestate";
const DATA_DIR = path.join(process.cwd(), "data", "fl", "courses", COLLEGE_SLUG);

const TERM_MAP: Record<string, { strm: string; file: string }> = {
  "Spring 2026": { strm: "2261", file: "2026SP" },
  "Summer 2026": { strm: "2264", file: "2026SU" },
  "Fall 2026":   { strm: "2267", file: "2026FA" },
};

const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

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
  let prefixFilter: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) { termArg = args[i + 1]; i++; }
    else if (args[i] === "--prefix" && args[i + 1]) { prefixFilter = args[i + 1].toLowerCase(); i++; }
  }
  if (!termArg) termArg = "Summer 2026,Fall 2026";
  return { terms: termArg.split(",").map(t => t.trim()).filter(Boolean), prefixFilter };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchPage(url: string, timeoutMs = 90_000): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 cc-courseMap",
        "Accept-Encoding": "identity",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function normTime(raw: string): string {
  // "9:00 AM" / "10:50 PM" / "Online" / "TBA"
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return "";
  return `${m[1]}:${m[2]}${m[3].toUpperCase()}`;
}

function normDate(raw: string): string {
  // "05/11 - 08/05" → start side "05/11" (year inferred from term)
  const m = raw.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}`;
}

async function listPrefixes(letter: string): Promise<string[]> {
  const html = await fetchPage(`${BASE}/catalog/courses/${letter}`);
  if (!html) return [];
  const out = new Set<string>();
  // /catalog/courses/<3-letter-prefix>
  for (const m of html.matchAll(/href="\/catalog\/courses\/([a-z]{3,4})"/g)) {
    out.add(m[1]);
  }
  return [...out];
}

async function listCourses(prefix: string): Promise<string[]> {
  const html = await fetchPage(`${BASE}/catalog/courses/${prefix}`);
  if (!html) return [];
  const out = new Set<string>();
  for (const m of html.matchAll(/href="\/catalog\/courses\/([a-z]{3,5}\d{3,4}[a-z]?)"/g)) {
    out.add(m[1]);
  }
  return [...out];
}

interface ParsedCourse {
  prefix: string;
  number: string;
  title: string;
  sections: Array<{
    classNum: string;
    timesRaw: string;
    daysRaw: string;
    datesRaw: string;
    room: string;
    instructor: string;
    sessionLabel: string;
  }>;
}

function parseCoursePage(html: string, courseSlug: string): ParsedCourse {
  // Extract prefix + number from slug, e.g. "mac1105" or "mac2311h"
  const slugMatch = courseSlug.match(/^([a-z]{3,5})(\d{3,4}[a-z]?)$/);
  const prefix = slugMatch ? slugMatch[1].toUpperCase() : courseSlug.slice(0, 3).toUpperCase();
  const number = slugMatch ? slugMatch[2].toUpperCase() : courseSlug.slice(3).toUpperCase();

  // Title is typically in <h1> or <title>
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  let title = titleMatch ? stripTags(titleMatch[1]) : "";
  // Strip course code prefix from title
  title = title.replace(new RegExp(`^${prefix}\\s*${number}\\s*[-–]?\\s*`, "i"), "");

  const sections: ParsedCourse["sections"] = [];
  // Each <table class="course-listing"> has rows
  const tableMatches = [...html.matchAll(/<table class="course-listing[^"]*"[\s\S]*?<\/table>/gi)];
  for (const t of tableMatches) {
    const block = t[0];
    // Section number from "Showing classes during the <strong>Term</strong>"
    const rowMatches = [...block.matchAll(/<tr class="course-row course-row-listing[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const rm of rowMatches) {
      const cells = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => stripTags(m[1]));
      if (cells.length < 6) continue;
      sections.push({
        classNum: cells[0],
        timesRaw: cells[1],
        daysRaw: cells[2],
        datesRaw: cells[3],
        room: cells[4],
        instructor: cells[5],
        sessionLabel: "",
      });
    }
  }

  return { prefix, number, title, sections };
}

function rowsToSections(parsed: ParsedCourse, fileTermCode: string): CourseSection[] {
  const out: CourseSection[] = [];
  for (const s of parsed.sections) {
    if (!s.classNum) continue;
    const isOnline = /^online$/i.test(s.daysRaw) || /^online$/i.test(s.timesRaw) || /^online$/i.test(s.room);
    let startTime = "", endTime = "", days = "";
    if (!isOnline) {
      const tm = s.timesRaw.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
      if (tm) {
        startTime = normTime(tm[1]);
        endTime = normTime(tm[2]);
      }
      // Days: "MWF" or "TR" etc.
      const map: Record<string, string> = { M: "Mo", T: "Tu", W: "We", R: "Th", F: "Fr", S: "Sa", U: "Su" };
      days = s.daysRaw.split("").map(c => map[c] || "").join("");
    }
    const room = s.room.trim();
    out.push({
      college_code: COLLEGE_SLUG,
      term: fileTermCode,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: parsed.title,
      credits: 3,
      crn: s.classNum,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: "",
      location: isOnline ? "" : room,
      campus: room,
      mode: isOnline ? "online" : "in-person",
      instructor: s.instructor && !/staff|tba/i.test(s.instructor) ? s.instructor : null,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }
  return out;
}

async function scrapeTerm(termName: string, strm: string, fileTermCode: string, prefixFilter: string | null): Promise<CourseSection[]> {
  console.log(`\n  ${termName} (strm=${strm})`);

  const prefixes = new Set<string>();
  if (prefixFilter) {
    prefixes.add(prefixFilter);
  } else {
    for (const letter of ALPHABET) {
      const ps = await listPrefixes(letter);
      ps.forEach(p => prefixes.add(p));
      if (ps.length > 0) process.stdout.write(`.`);
      await sleep(200);
    }
    console.log(` discovered ${prefixes.size} prefixes`);
  }

  const allCourses: string[] = [];
  for (const pfx of prefixes) {
    const courses = await listCourses(pfx);
    allCourses.push(...courses);
    await sleep(200);
  }
  console.log(`  ${allCourses.length} courses to fetch`);

  const all: CourseSection[] = [];
  for (let i = 0; i < allCourses.length; i++) {
    const slug = allCourses[i];
    const html = await fetchPage(`${BASE}/catalog/courses/${slug}?term=${strm}`);
    if (!html) {
      process.stdout.write(`x`);
      continue;
    }
    const parsed = parseCoursePage(html, slug);
    const sections = rowsToSections(parsed, fileTermCode);
    all.push(...sections);
    if ((i + 1) % 25 === 0) {
      console.log(`  [${i + 1}/${allCourses.length}] running: ${all.length}`);
      if (all.length > 0) {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(
          path.join(DATA_DIR, `${fileTermCode}.partial.json`),
          JSON.stringify(all, null, 2) + "\n",
        );
      }
    }
    await sleep(250);
  }
  return all;
}

async function main() {
  const { terms, prefixFilter } = parseArgs();
  console.log(`\nSeminole State College — ${terms.join(", ")}`);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let total = 0;
  for (const termName of terms) {
    const cfg = TERM_MAP[termName];
    if (!cfg) { console.error(`Unknown term: ${termName}`); process.exit(1); }
    const sections = await scrapeTerm(termName, cfg.strm, cfg.file, prefixFilter);
    if (sections.length > 0) {
      const p = path.join(DATA_DIR, `${cfg.file}.json`);
      fs.writeFileSync(p, JSON.stringify(sections, null, 2) + "\n");
      const partial = path.join(DATA_DIR, `${cfg.file}.partial.json`);
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
    }
    console.log(`\n  ${termName}: ${sections.length} sections`);
    total += sections.length;
  }
  console.log(`\nDone! ${total} sections total\n`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
