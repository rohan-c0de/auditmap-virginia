/**
 * scrape-sdccd.ts — San Diego Community College District class schedule
 *
 * SDCCD publishes the full district schedule via a single public JSON API
 * served from mws-api.sdccd.edu. One call per term returns every credit
 * section across all three district colleges; a CAMPUS field on each row
 * indicates which college owns it (CITY / MESA / MIRA).
 *
 * Endpoint (discovered in www.sdccd.edu/students/class-search/js/app.js):
 *   GET https://mws-api.sdccd.edu/?term={STRM}&career=ugrd
 *
 * Term codes (PeopleSoft STRM, 4-digit):
 *   2263 = Spring 2026
 *   2265 = Summer 2026
 *   2267 = Fall 2026
 *
 * Output: data/ca/courses/{san-diego-city|mesa|miramar}-college/{2026SP|SU|FA}.json
 *
 * Continuing-education (sdcce.edu) data is NOT included — CE is non-credit
 * and isn't part of the CCCCO 117-college institution count. That data is
 * available at career=ce if needed in the future.
 */

import * as fs from "fs";
import * as path from "path";

const API_BASE = "https://mws-api.sdccd.edu/";
const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses");

interface TermSpec {
  name: string;
  strm: string;
  fileTerm: string;
}

const TERMS: TermSpec[] = [
  { name: "Spring 2026", strm: "2263", fileTerm: "2026SP" },
  { name: "Summer 2026", strm: "2265", fileTerm: "2026SU" },
  { name: "Fall 2026",   strm: "2267", fileTerm: "2026FA" },
];

const CAMPUS_TO_SLUG: Record<string, string> = {
  CITY: "san-diego-city-college",
  MESA: "san-diego-mesa-college",
  MIRA: "san-diego-miramar-college",
};

const CAMPUS_TO_LABEL: Record<string, string> = {
  CITY: "San Diego City College",
  MESA: "San Diego Mesa College",
  MIRA: "San Diego Miramar College",
};

interface ApiRow {
  CRSE_ID: string;
  STRM: string;
  SUBJECT: string;
  CATALOG_NBR: string;
  CRSE_NAME: string;
  CLASS_NBR: number;
  ENRL_CAP: number;
  ENRL_TOT: number;
  WAIT_CAP: number;
  WAIT_TOT: number;
  CAMPUS: string;
  LOCATION: string;
  MEETINGINFO: string;
  RQS: string;
  START_DT: string; // MM/DD/YYYY
  UNITS: number;
  COMPONENT: string;
}

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number | null;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  location: string;
  campus: string;
  mode: "in-person" | "online" | "hybrid" | "unknown";
  instructor: string;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface Meeting {
  location: string;
  days: string;
  start_time: string;
  end_time: string;
  instructor: string;
  component: string;
}

function parseMeetings(raw: string): Meeting[] {
  if (!raw) return [];
  const chunks = raw.split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
  const out: Meeting[] = [];
  for (const chunk of chunks) {
    const parts = chunk.split("|").map((s) => s.trim());
    // [0]=idx [1]=location [2]=days [3]=start [4]=end [5]=daypart
    // [6]=instructor [7]=email [8..10]=numeric [11]=Y/N print [12]=component
    if (parts.length < 7) continue;
    out.push({
      location: parts[1] || "",
      days: parts[2] || "",
      start_time: parts[3] || "",
      end_time: parts[4] || "",
      instructor: parts[6] || "",
      component: parts[12] || "",
    });
  }
  return out;
}

function pickPrimary(meetings: Meeting[]): Meeting | null {
  if (meetings.length === 0) return null;
  // Prefer a real classroom meeting with days set; fall back to first LEC,
  // then first meeting regardless.
  const real = meetings.find((m) => m.days && !/web/i.test(m.location));
  if (real) return real;
  const lec = meetings.find((m) => /LEC/i.test(m.component));
  return lec ?? meetings[0];
}

function deriveMode(meetings: Meeting[]): CourseSection["mode"] {
  if (meetings.length === 0) return "unknown";
  const hasWeb = meetings.some((m) => /web/i.test(m.location));
  const hasInPerson = meetings.some((m) => m.location && !/web|remote|online/i.test(m.location) && m.days);
  if (hasWeb && hasInPerson) return "hybrid";
  if (hasWeb) return "online";
  if (hasInPerson) return "in-person";
  return "unknown";
}

function normalizeTime(t: string): string {
  // "2:20 PM" → "2:20 pm"; "9:0 AM" → "9:00 am"
  if (!t) return "";
  const m = t.trim().match(/^(\d{1,2}):(\d{1,2})\s*(AM|PM|am|pm)$/);
  if (!m) return t.trim().toLowerCase();
  const h = parseInt(m[1], 10);
  const mm = m[2].padStart(2, "0");
  return `${h}:${mm} ${m[3].toLowerCase()}`;
}

function parseStartDate(mdY: string): string {
  // "08/24/2026" → "2026-08-24"
  if (!mdY) return "";
  const m = mdY.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return mdY;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

const PREREQ_RE = /\b([A-Z]{2,5})\s+([A-Z]?\d{1,4}[A-Z]{0,2})\b/g;

function extractPrereqCourses(rqs: string): string[] {
  if (!rqs) return [];
  // Only treat strings that explicitly mention prerequisite as prereqs.
  // RQS often holds Advisory-only text, which we surface as prerequisite_text
  // but should NOT mark as required prereqs.
  if (!/prerequisite/i.test(rqs)) return [];
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  PREREQ_RE.lastIndex = 0;
  while ((m = PREREQ_RE.exec(rqs)) !== null) {
    set.add(`${m[1]} ${m[2]}`);
  }
  return Array.from(set);
}

function rowToSection(row: ApiRow, fileTerm: string): CourseSection | null {
  const slug = CAMPUS_TO_SLUG[row.CAMPUS];
  if (!slug) return null; // unknown campus (e.g. CE) — skip

  const meetings = parseMeetings(row.MEETINGINFO);
  const primary = pickPrimary(meetings);
  const mode = deriveMode(meetings);

  const prereqText = (row.RQS || "").trim() || null;
  const prereqCourses = extractPrereqCourses(row.RQS || "");

  const enrlCap = row.ENRL_CAP ?? 0;
  const enrlTot = row.ENRL_TOT ?? 0;
  const seatsOpen = enrlCap > 0 ? Math.max(0, enrlCap - enrlTot) : null;

  return {
    college_code: slug,
    term: fileTerm,
    course_prefix: (row.SUBJECT || "").trim(),
    course_number: (row.CATALOG_NBR || "").trim(),
    course_title: (row.CRSE_NAME || "").trim(),
    credits: typeof row.UNITS === "number" ? row.UNITS : null,
    crn: String(row.CLASS_NBR),
    days: primary?.days?.trim() ?? "",
    start_time: normalizeTime(primary?.start_time ?? ""),
    end_time: normalizeTime(primary?.end_time ?? ""),
    start_date: parseStartDate(row.START_DT || ""),
    location: primary?.location?.trim() ?? "",
    campus: CAMPUS_TO_LABEL[row.CAMPUS] ?? row.CAMPUS,
    mode,
    instructor: primary?.instructor?.trim() ?? "",
    seats_open: seatsOpen,
    seats_total: enrlCap > 0 ? enrlCap : null,
    prerequisite_text: prereqText,
    prerequisite_courses: prereqCourses,
  };
}

async function fetchTerm(strm: string): Promise<ApiRow[]> {
  const url = `${API_BASE}?term=${strm}&career=ugrd`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "application/json",
      Referer: "https://www.sdccd.edu/students/class-search/search.html",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const body = await res.json() as { status: string; data: { query: { rows: ApiRow[] } } };
  if (body.status !== "success") throw new Error(`API returned status=${body.status}`);
  return body.data?.query?.rows ?? [];
}

function dedupeByCrn(sections: CourseSection[]): CourseSection[] {
  const seen = new Set<string>();
  return sections.filter((s) => {
    if (seen.has(s.crn)) return false;
    seen.add(s.crn);
    return true;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const termFilter = getArg("--term");
  const termsToRun = termFilter
    ? TERMS.filter((t) => t.name === termFilter)
    : TERMS;
  if (termsToRun.length === 0) {
    console.error(`Unknown --term "${termFilter}". Valid: ${TERMS.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }

  for (const term of termsToRun) {
    console.log(`\n=== ${term.name} (STRM ${term.strm}) ===`);
    const rows = await fetchTerm(term.strm);
    console.log(`  fetched ${rows.length} raw rows`);

    const byCollege = new Map<string, CourseSection[]>();
    for (const row of rows) {
      const section = rowToSection(row, term.fileTerm);
      if (!section) continue;
      const list = byCollege.get(section.college_code) ?? [];
      list.push(section);
      byCollege.set(section.college_code, list);
    }

    for (const [slug, sections] of byCollege.entries()) {
      const deduped = dedupeByCrn(sections);
      const removed = sections.length - deduped.length;
      const dir = path.join(DATA_DIR, slug);
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, `${term.fileTerm}.json`);
      fs.writeFileSync(out, JSON.stringify(deduped, null, 2) + "\n");
      console.log(
        `  ${slug}: ${deduped.length} sections${removed > 0 ? ` (-${removed} dupes)` : ""} → ${out}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
