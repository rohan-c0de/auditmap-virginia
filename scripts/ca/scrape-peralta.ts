/**
 * scrape-peralta.ts — Peralta Community College District class schedule
 *
 * All four Peralta colleges (Berkeley City, College of Alameda, Laney,
 * Merritt) publish their schedule through HubSpot CRM custom objects,
 * served via a per-college GraphQL endpoint. The data is identical across
 * colleges — each campus is just a value in the `campus` field — so one
 * endpoint fetch covers the whole district.
 *
 * Endpoint (discovered in the React app at merritt.edu/online-schedule):
 *   GET https://laney.edu/_hcms/api/searchFilterGraphql?limit=200&offset=N
 *
 * Returns: { data: { CRM: { p_classes_collection: { items, total, limit,
 * offset } } } }. Hard limit per page is 200; ~10K total sections across
 * all terms requires ~54 paginated requests.
 *
 * Term codes (PS-style strm, 4-digit):
 *   1262 = Spring 2026
 *   1264 = Summer 2026
 *   1266 = Fall 2026
 * (We filter by strm_descr containing "2026" to be safe — older terms
 * are also present in the dataset.)
 *
 * Output:
 *   data/ca/courses/{berkeley-city-college,college-of-alameda,
 *                    laney-college,merritt-college}/{2026SP|SU|FA}.json
 *
 * Peralta's PeopleSoft (sa.peralta.edu) is fully SSO-gated via Oracle
 * Identity Cloud — no public class search there. The HubSpot endpoint
 * is the only public source.
 */

import * as fs from "fs";
import * as path from "path";

const API = "https://laney.edu/_hcms/api/searchFilterGraphql";
const PAGE_SIZE = 200;
const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses");

const CAMPUS_TO_SLUG: Record<string, string> = {
  Berkeley: "berkeley-city-college",
  Alameda:  "college-of-alameda",
  Laney:    "laney-college",
  Merritt:  "merritt-college",
};

const CAMPUS_TO_LABEL: Record<string, string> = {
  Berkeley: "Berkeley City College",
  Alameda:  "College of Alameda",
  Laney:    "Laney College",
  Merritt:  "Merritt College",
};

const TERM_TO_FILE: Record<string, string> = {
  "2026 Spring": "2026SP",
  "2026 Summer": "2026SU",
  "2026 Fall":   "2026FA",
};

interface ApiRow {
  course_title_long: string;
  units: string;
  class_nbr: string;
  campus: { label: string; value: string };
  days: { label: string; value: string }[];
  class_section: string;
  instruction_mode: string;
  times: string;
  instructor_name: string;
  enrl_cap: number;
  enrl_stat: { label: string; value: string } | null;
  subject: string;
  session_code: string;
  enrl_tot: number;
  catalog_nbr: string;
  class_notes: string;
  course_requirements: string;
  strm_descr: string;
  strm: string;
  room: string;
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

const DAY_ABBR: Record<string, string> = {
  Monday: "M",
  Tuesday: "T",
  Wednesday: "W",
  Thursday: "Th",
  Friday: "F",
  Saturday: "Sa",
  Sunday: "Su",
};

function parseDays(days: ApiRow["days"]): string {
  if (!days || days.length === 0) return "";
  const abbrs: string[] = [];
  for (const d of days) {
    const name = (d.value || d.label || "").trim();
    const ab = DAY_ABBR[name];
    if (ab && !abbrs.includes(ab)) abbrs.push(ab);
  }
  return abbrs.join(" ");
}

function parseTimes(times: string): { start: string; end: string } {
  if (!times) return { start: "", end: "" };
  const m = times.match(/^(\d{1,2}:\d{2}\s*[AP]M)\s+to\s+(\d{1,2}:\d{2}\s*[AP]M)$/i);
  if (!m) return { start: "", end: "" };
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/^0/, "");
  return { start: norm(m[1]), end: norm(m[2]) };
}

function deriveMode(instructionMode: string, room: string): CourseSection["mode"] {
  const mode = (instructionMode || "").toLowerCase();
  if (mode.includes("hybrid")) return "hybrid";
  if (mode.includes("online") || mode.includes("remote") || /online/i.test(room)) {
    return "online";
  }
  if (mode.includes("person") || mode.includes("face")) return "in-person";
  if (room && !/online|tba/i.test(room)) return "in-person";
  return "unknown";
}

const PREREQ_RE = /\b([A-Z]{2,5})\s+([A-Z]?\d{1,4}[A-Z]{0,2})\b/g;

function extractPrereqs(text: string): string[] {
  if (!text) return [];
  if (!/prereq/i.test(text)) return [];
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  PREREQ_RE.lastIndex = 0;
  while ((m = PREREQ_RE.exec(text)) !== null) {
    set.add(`${m[1]} ${m[2]}`);
  }
  return Array.from(set);
}

function rowToSection(row: ApiRow): CourseSection | null {
  const campus = row.campus?.value?.trim();
  const slug = campus ? CAMPUS_TO_SLUG[campus] : undefined;
  if (!slug) return null;

  const fileTerm = TERM_TO_FILE[row.strm_descr];
  if (!fileTerm) return null; // not a current term

  const { start, end } = parseTimes(row.times);
  const enrlCap = row.enrl_cap ?? 0;
  const enrlTot = row.enrl_tot ?? 0;
  const seatsOpen = enrlCap > 0 ? Math.max(0, enrlCap - enrlTot) : null;

  const units = parseFloat(row.units);
  const credits = isFinite(units) ? units : null;

  const reqText = (row.course_requirements || "").trim();
  const prereqText = reqText && reqText !== "" ? reqText : null;
  const prereqCourses = extractPrereqs(reqText);

  return {
    college_code: slug,
    term: fileTerm,
    course_prefix: (row.subject || "").trim(),
    course_number: (row.catalog_nbr || "").trim(),
    course_title: (row.course_title_long || "").trim(),
    credits,
    crn: String(row.class_nbr),
    days: parseDays(row.days),
    start_time: start,
    end_time: end,
    start_date: "", // not present in API response
    location: (row.room || "").trim(),
    campus: CAMPUS_TO_LABEL[campus] ?? campus,
    mode: deriveMode(row.instruction_mode, row.room),
    instructor: (row.instructor_name || "").trim(),
    seats_open: seatsOpen,
    seats_total: enrlCap > 0 ? enrlCap : null,
    prerequisite_text: prereqText,
    prerequisite_courses: prereqCourses,
  };
}

const HOSTS = [
  "https://laney.edu",
  "https://merritt.edu",
  "https://www.berkeleycitycollege.edu",
  "https://alameda.peralta.edu",
];

async function fetchPage(offset: number, attempt = 0): Promise<{ items: ApiRow[]; total: number | null }> {
  const host = HOSTS[attempt % HOSTS.length];
  const url = `${host}/_hcms/api/searchFilterGraphql?limit=${PAGE_SIZE}&offset=${offset}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as {
      data?: { CRM?: { p_classes_collection?: { items: ApiRow[]; total: number } } };
    };
    const coll = body.data?.CRM?.p_classes_collection;
    if (!coll) throw new Error(`null collection`);
    return { items: coll.items ?? [], total: coll.total ?? null };
  } catch (err) {
    if (attempt < 7) {
      const wait = 500 * Math.pow(2, attempt);
      console.warn(`  retry offset=${offset} attempt=${attempt + 1} after ${wait}ms (${(err as Error).message})`);
      await new Promise((r) => setTimeout(r, wait));
      return fetchPage(offset, attempt + 1);
    }
    throw new Error(`HTTP error for offset=${offset} after 8 attempts: ${(err as Error).message}`);
  }
}

async function main() {
  console.log("Fetching first page...");
  const first = await fetchPage(0);
  const total = first.total ?? 0;
  console.log(`Total sections in API: ${total}`);

  const rows: ApiRow[] = [...first.items];
  for (let off = PAGE_SIZE; off < total; off += PAGE_SIZE) {
    try {
      const page = await fetchPage(off);
      rows.push(...page.items);
      if (off % (PAGE_SIZE * 10) === 0) {
        console.log(`  fetched ${rows.length}/${total}...`);
      }
    } catch (err) {
      // API has a soft cap around offset=10000 — past that, p_classes_collection
      // is null permanently. After exhausting retries, treat as end-of-data and
      // proceed with what we have rather than discarding hours of fetches.
      console.warn(`  giving up at offset=${off}: ${(err as Error).message}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`Fetched ${rows.length} total rows (target ${total}).\n`);

  // Bucket: college_slug → fileTerm → CourseSection[]
  const buckets = new Map<string, Map<string, CourseSection[]>>();
  let skipped = 0;
  for (const row of rows) {
    const section = rowToSection(row);
    if (!section) { skipped++; continue; }
    let perCollege = buckets.get(section.college_code);
    if (!perCollege) {
      perCollege = new Map();
      buckets.set(section.college_code, perCollege);
    }
    const list = perCollege.get(section.term) ?? [];
    list.push(section);
    perCollege.set(section.term, list);
  }
  console.log(`Mapped: ${rows.length - skipped} 2026 sections; skipped ${skipped} (older terms / unknown campus)\n`);

  for (const [slug, perTerm] of buckets.entries()) {
    const dir = path.join(DATA_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    for (const [fileTerm, sections] of perTerm.entries()) {
      // Dedup by CRN
      const seen = new Set<string>();
      const deduped = sections.filter((s) => {
        if (seen.has(s.crn)) return false;
        seen.add(s.crn);
        return true;
      });
      const out = path.join(dir, `${fileTerm}.json`);
      fs.writeFileSync(out, JSON.stringify(deduped, null, 2) + "\n");
      const removed = sections.length - deduped.length;
      console.log(
        `  ${slug}/${fileTerm}: ${deduped.length} sections${removed > 0 ? ` (-${removed} dupes)` : ""}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
