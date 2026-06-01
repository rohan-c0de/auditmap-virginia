/**
 * Ivy Tech Community College (Indiana) — CollegeScheduler GraphQL scraper
 *
 * Ivy Tech is the entire Indiana statewide community-college system: one
 * Banner SIS, ~22 campuses. Its public class search is a React SPA at
 * https://ivytech.search.collegescheduler.com powered by an UNAUTHENTICATED
 * GraphQL API at https://api.collegescheduler.com/graphql (institution
 * environment name = "ivytech"). The MyIvy portal (my.ivytech.edu) is a
 * ServiceNow SSO portal — NOT the class search — which is what tripped the
 * fingerprinter into a false "auth-gated" verdict.
 *
 * The API exposes (all anonymous, plain POST):
 *   environment(name:"ivytech") {
 *     courseSearchTerms { code name }                       // term list
 *     findCourses(termCode, first, after) { ... }           // cursor-paginated courses
 *     getCourseSections(courseId, first, after) { ... }     // sections per course
 *   }
 *
 * Course descriptions embed prerequisite text inline (a "PREREQUISITES:"
 * block), so prereqs are harvested from the same pass and written to
 * data/in/prereqs.json — no separate Acalog catalog scrape needed.
 *
 * Each section carries a `campus` field (one of the ~22 Ivy Tech locations),
 * preserved on every record so the UI can filter by campus. All campuses
 * scrape in one run.
 *
 * Usage:
 *   npx tsx scripts/in/scrape-ivy-tech.ts            # all current/future terms
 *   npx tsx scripts/in/scrape-ivy-tech.ts --term 202620
 */
import * as fs from "fs";
import * as path from "path";

const API = "https://api.collegescheduler.com/graphql";
const ENV = "ivytech";
const STATE = "in";
const SLUG = "ivy-tech-community-college";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);
const PREREQS_PATH = path.join(process.cwd(), "data", STATE, "prereqs.json");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const CURRENT_YEAR = new Date().getFullYear();

// ---------------------------------------------------------------------------
// GraphQL transport (with retry)
// ---------------------------------------------------------------------------
async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
      if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
      if (!json.data) throw new Error("no data");
      return json.data;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Field mapping helpers
// ---------------------------------------------------------------------------

/** CollegeScheduler term code (202620) + name ("Fall 2026") -> "2026FA". */
function termToStandard(name: string, code: string): string | null {
  const yr = (name.match(/\b(20\d{2})\b/) || [])[1] || code.slice(0, 4);
  const lower = name.toLowerCase();
  if (lower.includes("fall")) return `${yr}FA`;
  if (lower.includes("spring") || lower.includes("winter")) return `${yr}SP`;
  if (lower.includes("summer")) return `${yr}SU`;
  return null;
}

/** Ivy Tech instructionMode -> site mode vocabulary (in-person/online/hybrid/zoom). */
function mapMode(instructionMode: string | null, building: string | null): string {
  const m = (instructionMode || "").toLowerCase();
  if (m.includes("traditional")) return "in-person";
  if (m === "online only" || m.includes("online")) return "online";
  if (m.includes("virtual")) return "zoom"; // synchronous video class
  if (m.includes("blended") || m.includes("learn anywhere")) return "hybrid";
  // Fallback on the meeting building when mode is blank.
  const b = (building || "").toUpperCase();
  if (b === "WWW") return "online";
  if (b.includes("VIRT")) return "zoom";
  return "in-person";
}

const DAY_MAP: Record<string, string> = { M: "M", T: "Tu", W: "W", R: "Th", F: "F", S: "Sa", U: "Su" };
/** "TR" -> "Tu Th". */
function mapDays(days: string | null): string {
  if (!days) return "";
  return days
    .split("")
    .map((c) => DAY_MAP[c] || "")
    .filter(Boolean)
    .join(" ");
}

/** Military integer (1345) -> "1:45 pm". 0/null -> "". */
function mapTime(t: number | null): string {
  if (t == null || t === 0) return "";
  const hh = Math.floor(t / 100);
  const mm = t % 100;
  const ampm = hh >= 12 ? "pm" : "am";
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

/** Strip HTML tags / entities to plain text. */
function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;| /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull the PREREQUISITES portion out of a course description and extract the
 * referenced course codes. Returns null when there are no real prereqs.
 */
function parsePrereqs(description: string | null): { text: string; courses: string[] } | null {
  if (!description) return null;
  const plain = stripHtml(description);
  const m = plain.match(/PREREQUISITES?:\s*(.*?)(?:CATALOG DESCRIPTION:|DESCRIPTION:|PRE\/COREQUISITES:|COREQUISITES:|$)/i);
  if (!m) return null;
  let text = m[1].trim().replace(/\s*\.\s*$/, "").trim();
  // Common "no prereq" sentinels.
  if (!text || /^(none|n\/a)\.?$/i.test(text)) return null;
  const codes = new Set<string>();
  const re = /\b([A-Z]{2,4})\s+(\d{3}[A-Z]?)\b/g;
  let cm: RegExpExecArray | null;
  while ((cm = re.exec(text)) !== null) codes.add(`${cm[1]} ${cm[2]}`);
  // Require at least one real course code; otherwise the "prereq" is just
  // an assessment/placement note with no structured chain to store.
  if (codes.size === 0) return null;
  return { text, courses: Array.from(codes) };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
const TERMS_Q = `query { environment(name: "${ENV}") { courseSearchTerms { code name } } }`;

const COURSES_Q = `query($term: String!, $after: String) {
  environment(name: "${ENV}") {
    findCourses(termCode: $term, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { id subject { shortName } courseNumber title creditsMin creditsMax description } }
    }
  }
}`;

const SECTIONS_Q = `query($cid: ID!, $after: String) {
  environment(name: "${ENV}") {
    getCourseSections(courseId: $cid, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        registrationNumber sectionNumber instructors instructionMode
        creditsMin creditsMax openSeats totalSeats campus
        meetings { days startTime endTime startDate endDate building room }
      } }
    }
  }
}`;

interface CourseNode {
  id: string;
  subject: { shortName: string };
  courseNumber: string;
  title: string;
  creditsMin: number | null;
  creditsMax: number | null;
  description: string | null;
}

interface Meeting {
  days: string | null;
  startTime: number | null;
  endTime: number | null;
  startDate: string | null;
  endDate: string | null;
  building: string | null;
  room: string | null;
}
interface SectionNode {
  registrationNumber: string;
  sectionNumber: string;
  instructors: string[] | null;
  instructionMode: string | null;
  creditsMin: number | null;
  creditsMax: number | null;
  openSeats: number | null;
  totalSeats: number | null;
  campus: string | null;
  meetings: Meeting[] | null;
}

async function fetchCourses(term: string): Promise<CourseNode[]> {
  const out: CourseNode[] = [];
  let after: string | null = null;
  for (;;) {
    const d: any = await gql(COURSES_Q, { term, after });
    const conn = d.environment.findCourses;
    for (const e of conn.edges) out.push(e.node);
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

async function fetchSections(courseId: string): Promise<SectionNode[]> {
  const out: SectionNode[] = [];
  let after: string | null = null;
  for (;;) {
    const d: any = await gql(SECTIONS_Q, { cid: courseId, after });
    const conn = d.environment.getCourseSections;
    for (const e of conn.edges) out.push(e.node);
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const termFilter = (() => {
    const i = process.argv.indexOf("--term");
    return i >= 0 ? process.argv[i + 1] : null;
  })();

  const td: any = await gql(TERMS_Q);
  const rawTerms: Array<{ code: string; name: string }> = td.environment.courseSearchTerms;
  const terms = rawTerms
    .map((t) => ({ ...t, std: termToStandard(t.name, t.code) }))
    .filter((t) => t.std && parseInt(t.std.slice(0, 4), 10) >= CURRENT_YEAR)
    .filter((t) => !termFilter || t.code === termFilter);

  console.log(`Terms to scrape: ${terms.map((t) => `${t.name} (${t.code} -> ${t.std})`).join(", ")}`);

  fs.mkdirSync(COURSES_DIR, { recursive: true });
  const prereqs: Record<string, { text: string; courses: string[] }> = fs.existsSync(PREREQS_PATH)
    ? JSON.parse(fs.readFileSync(PREREQS_PATH, "utf8"))
    : {};

  let grandTotal = 0;
  for (const term of terms) {
    const std = term.std!;
    console.log(`\n=== ${term.name} (${std}) ===`);
    const courses = await fetchCourses(term.code);
    console.log(`  ${courses.length} courses; fetching sections...`);

    const records: any[] = [];
    let done = 0;
    for (const c of courses) {
      const prefix = c.subject.shortName;
      const key = `${prefix} ${c.courseNumber}`;
      const pre = parsePrereqs(c.description);
      if (pre) prereqs[key] = pre;

      const sections = await fetchSections(c.id);
      for (const s of sections) {
        const mtg = (s.meetings || [])[0] || ({} as Meeting);
        const credits = (s.creditsMin ?? s.creditsMax ?? c.creditsMin ?? c.creditsMax ?? 0) || 0;
        const instructor = (s.instructors || [])
          .filter((n) => n && n.toLowerCase() !== "not assigned")
          .join(", ");
        const room = [mtg.building, mtg.room].filter((x) => x && x.toUpperCase() !== "VIRTUAL" && x.toUpperCase() !== "WWW").join(" ");
        records.push({
          college_code: SLUG,
          term: std,
          course_prefix: prefix,
          course_number: c.courseNumber,
          course_title: c.title,
          credits,
          crn: s.registrationNumber,
          section: s.sectionNumber,
          days: mapDays(mtg.days),
          start_time: mapTime(mtg.startTime),
          end_time: mapTime(mtg.endTime),
          start_date: mtg.startDate || null,
          end_date: mtg.endDate || null,
          location: room || "TBA",
          campus: s.campus || "",
          mode: mapMode(s.instructionMode, mtg.building),
          instructor,
          seats_open: s.openSeats ?? null,
          seats_total: s.totalSeats ?? null,
          prerequisite_text: pre ? pre.text : null,
          prerequisite_courses: pre ? pre.courses : [],
        });
      }
      done++;
      if (done % 100 === 0) console.log(`    ${done}/${courses.length} courses, ${records.length} sections so far`);
    }

    const outPath = path.join(COURSES_DIR, `${std}.json`);
    fs.writeFileSync(outPath, JSON.stringify(records, null, 2) + "\n");
    console.log(`  Wrote ${records.length} sections -> ${path.relative(process.cwd(), outPath)}`);
    grandTotal += records.length;
  }

  fs.writeFileSync(PREREQS_PATH, JSON.stringify(prereqs, null, 2) + "\n");
  console.log(`\nGrand total: ${grandTotal} sections across ${terms.length} term(s)`);
  console.log(`Prereqs: ${Object.keys(prereqs).length} courses -> ${path.relative(process.cwd(), PREREQS_PATH)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
