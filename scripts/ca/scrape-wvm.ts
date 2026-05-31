/**
 * scrape-wvm.ts — West Valley-Mission CCD class schedule
 *
 * West Valley-Mission CCD (Mission College + West Valley College) publishes
 * its full schedule as static JSON files at schedule.wvm.edu/data/{term}/.
 * Four files per term provide everything:
 *   courses.json     — course catalog (subject, number, title, credits, description)
 *   crns.json        — sections (CRN, seats, enrollment, instruction mode, campus)
 *   ssrmeet.json     — meeting times (days, time, building, room)
 *   section-instructors.json — instructor name + email
 *
 * The SSBSECT_CAMP_CODE field distinguishes Mission College (MC) from
 * West Valley College (WV).
 *
 * Term codes: 202630 = Spring 2026, 202650 = Summer 2026, 202670 = Fall 2026
 *
 * Output: data/ca/courses/{mission-college,west-valley-college}/{2026SP|SU|FA}.json
 */

import * as fs from "fs";
import * as path from "path";

const BASE = "https://schedule.wvm.edu/data";
const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses");

const TERMS = [
  { code: "202630", fileTerm: "2026SP", name: "Spring 2026" },
  { code: "202650", fileTerm: "2026SU", name: "Summer 2026" },
  { code: "202670", fileTerm: "2026FA", name: "Fall 2026" },
];

const CAMPUS_TO_SLUG: Record<string, string> = {
  MC:  "mission-college",
  WVC: "west-valley-college",
};

const CAMPUS_TO_LABEL: Record<string, string> = {
  MC:  "Mission College",
  WVC: "West Valley College",
};

interface CrnRow {
  SUBJ_CODE: string;
  CRSE_NUMB: string;
  CRN: string;
  SSBSECT_PTRM_START_DATE: string;
  SSBSECT_INSM_CODE: string;
  INSTR_MODE: string;
  SSBSECT_CAMP_CODE: string;
  CREDIT_HRS: number | null;
  CAT_DESC: string | null;
  SSBSECT_MAX_ENRL: number;
  SSBSECT_ENRL: number;
  SSBSECT_SEATS_AVAIL: number;
  SSBSECT_CRSE_TITLE: string | null;
}

interface MeetRow {
  CRN: string;
  BUILDING: string;
  ROOM: string;
  BEGIN_TIME: string | null;
  END_TIME: string | null;
  DOW: string | null;
  DATE_RANGE_START: string;
}

interface InstrRow {
  SIRASGN_CRN: string;
  INSTRUCTOR_NAME: string;
}

interface CourseRow {
  SUBJ_CODE: string;
  CRSE_NUMB: string;
  CRSE_TITLE: string;
  LONG_CRSE_TITLE: string;
  SCBCRSE_CREDIT_HR_LOW: number | null;
  COURSE_ALIAS: string | null;
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

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

function formatTime(raw: string | null): string {
  if (!raw) return "";
  const m = raw.match(/^(\d{2})(\d{2})$/);
  if (!m) return raw;
  let h = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = h >= 12 ? "pm" : "am";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${mm} ${ampm}`;
}

function formatDate(raw: string | null): string {
  if (!raw) return "";
  // "08-29-2026" → "2026-08-29"
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  // ISO date
  const d = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (d) return `${d[1]}-${d[2]}-${d[3]}`;
  return "";
}

function deriveMode(instrMode: string, building: string): CourseSection["mode"] {
  const mode = (instrMode || "").toLowerCase();
  if (mode.includes("hybrid")) return "hybrid";
  if (mode.includes("online") || mode.includes("asynch")) return "online";
  if (mode.includes("person")) return "in-person";
  if (building && !/online/i.test(building)) return "in-person";
  return "unknown";
}

const PREREQ_RE = /\b([A-Z]{2,5})\s*(\d{1,4}[A-Z]{0,2})\b/g;

function extractPrereqs(catDesc: string | null): { text: string | null; courses: string[] } {
  if (!catDesc) return { text: null, courses: [] };
  const lines = catDesc.split("\n");
  const prereqLine = lines.find((l) => /prerequisite/i.test(l));
  if (!prereqLine) return { text: null, courses: [] };
  const courses = new Set<string>();
  let m: RegExpExecArray | null;
  PREREQ_RE.lastIndex = 0;
  while ((m = PREREQ_RE.exec(prereqLine)) !== null) {
    courses.add(`${m[1]} ${m[2]}`);
  }
  return { text: prereqLine.trim(), courses: Array.from(courses) };
}

async function main() {
  for (const term of TERMS) {
    console.log(`\n=== ${term.name} (${term.code}) ===`);

    const [courses, crns, meets, instrs] = await Promise.all([
      fetchJson<CourseRow[]>(`${BASE}/${term.code}/courses.json`),
      fetchJson<CrnRow[]>(`${BASE}/${term.code}/crns.json`),
      fetchJson<MeetRow[]>(`${BASE}/${term.code}/ssrmeet.json`),
      fetchJson<InstrRow[]>(`${BASE}/${term.code}/section-instructors.json`),
    ]);
    console.log(`  courses=${courses.length} crns=${crns.length} meets=${meets.length} instrs=${instrs.length}`);

    // Index course catalog by SUBJ+CRSE
    const courseMap = new Map<string, CourseRow>();
    for (const c of courses) {
      courseMap.set(`${c.SUBJ_CODE}|${c.CRSE_NUMB}`, c);
    }

    // Index meetings by CRN (take first meeting with times)
    const meetMap = new Map<string, MeetRow>();
    for (const m of meets) {
      if (!meetMap.has(m.CRN) || (!meetMap.get(m.CRN)!.BEGIN_TIME && m.BEGIN_TIME)) {
        meetMap.set(m.CRN, m);
      }
    }

    // Index instructors by CRN
    const instrMap = new Map<string, string>();
    for (const i of instrs) {
      if (!instrMap.has(i.SIRASGN_CRN)) {
        instrMap.set(i.SIRASGN_CRN, i.INSTRUCTOR_NAME);
      }
    }

    const byCollege = new Map<string, CourseSection[]>();

    for (const crn of crns) {
      const slug = CAMPUS_TO_SLUG[crn.SSBSECT_CAMP_CODE];
      if (!slug) continue;

      const courseKey = `${crn.SUBJ_CODE}|${crn.CRSE_NUMB}`;
      const course = courseMap.get(courseKey);
      const meet = meetMap.get(crn.CRN);
      const instructor = instrMap.get(crn.CRN) ?? "";

      const title = crn.SSBSECT_CRSE_TITLE
        ?? course?.LONG_CRSE_TITLE?.trim()
        ?? course?.CRSE_TITLE
        ?? "";
      const credits = crn.CREDIT_HRS ?? course?.SCBCRSE_CREDIT_HR_LOW ?? null;
      const { text: prereqText, courses: prereqCourses } = extractPrereqs(crn.CAT_DESC);

      const section: CourseSection = {
        college_code: slug,
        term: term.fileTerm,
        course_prefix: crn.SUBJ_CODE,
        course_number: course?.COURSE_ALIAS ?? crn.CRSE_NUMB,
        course_title: title,
        credits,
        crn: crn.CRN,
        days: (meet?.DOW ?? "").replace(/\s+/g, " ").trim(),
        start_time: formatTime(meet?.BEGIN_TIME ?? null),
        end_time: formatTime(meet?.END_TIME ?? null),
        start_date: formatDate(meet?.DATE_RANGE_START ?? null),
        location: [meet?.BUILDING, meet?.ROOM].filter((s) => s && s !== "ONLINE").join(" ").trim() || (meet?.BUILDING ?? ""),
        campus: CAMPUS_TO_LABEL[crn.SSBSECT_CAMP_CODE] ?? crn.SSBSECT_CAMP_CODE,
        mode: deriveMode(crn.INSTR_MODE, meet?.BUILDING ?? ""),
        instructor,
        seats_open: crn.SSBSECT_SEATS_AVAIL ?? null,
        seats_total: crn.SSBSECT_MAX_ENRL ?? null,
        prerequisite_text: prereqText,
        prerequisite_courses: prereqCourses,
      };

      const list = byCollege.get(slug) ?? [];
      list.push(section);
      byCollege.set(slug, list);
    }

    for (const [slug, sections] of byCollege.entries()) {
      // Dedup by CRN
      const seen = new Set<string>();
      const deduped = sections.filter((s) => {
        if (seen.has(s.crn)) return false;
        seen.add(s.crn);
        return true;
      });
      const dir = path.join(DATA_DIR, slug);
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, `${term.fileTerm}.json`);
      fs.writeFileSync(out, JSON.stringify(deduped, null, 2) + "\n");
      console.log(`  ${slug}: ${deduped.length} sections → ${out}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
