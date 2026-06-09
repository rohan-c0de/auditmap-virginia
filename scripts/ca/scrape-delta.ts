/**
 * San Joaquin Delta College (Stockton, CA) — CollegeScheduler GraphQL scraper
 *
 * Delta College's public class search is a CollegeScheduler React SPA backed by
 * the same UNAUTHENTICATED GraphQL API used by Ivy Tech / Indiana
 * (https://api.collegescheduler.com/graphql). The institution environment name
 * is "deltacollege". This is the canonical CollegeScheduler pattern cloned from
 * scripts/in/scrape-ivy-tech.ts, adapted to Delta's single-college / multi-site
 * layout and to this state's output schema.
 *
 * The API exposes (all anonymous, plain POST):
 *   environment(name:"deltacollege") {
 *     courseSearchTerms { code name }                       // term list
 *     findCourses(termCode, first, after) { ... }           // cursor-paginated courses
 *     getCourseSections(courseId, first, after) { ... }     // sections per course
 *   }
 *
 * Verified live 2026-06-08: Fall 2026 (termCode 2267) returns ~1,625 sections;
 * Summer 2026 (termCode 2265) is also present. No Spring 2026 term is exposed.
 *
 * Delta is one college with several instructional sites (Stockton Main Campus,
 * Lodi-Galt, Manteca-Lathrop, Stockton Off Campus, Online). The API's `campus`
 * field already carries a human-readable site name, so it is preserved verbatim
 * on every record; college_code is always "san-joaquin-delta-college".
 *
 * Course descriptions embed an inline "Prerequisites: ..." sentence, so prereqs
 * are harvested in the same pass and merged into data/ca/prereqs.json keyed by
 * "<PREFIX> <NUMBER>" (only when at least one real course code is referenced).
 *
 * Output: data/ca/courses/san-joaquin-delta-college/<TERM>.json — a JSON array
 * matching the project's CA course schema exactly.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-delta.ts            # all current/future terms
 *   npx tsx scripts/ca/scrape-delta.ts --term 2267
 */
import * as fs from "fs";
import * as path from "path";

const API = "https://api.collegescheduler.com/graphql";
const ENV = "deltacollege";
const STATE = "ca";
const SLUG = "san-joaquin-delta-college";
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

/** CollegeScheduler term code (2267) + name ("Fall 2026") -> "2026FA". */
function termToStandard(name: string, code: string): string | null {
  const yr = (name.match(/\b(20\d{2})\b/) || [])[1] || code.slice(0, 4);
  const lower = name.toLowerCase();
  if (lower.includes("fall")) return `${yr}FA`;
  if (lower.includes("spring") || lower.includes("winter")) return `${yr}SP`;
  if (lower.includes("summer")) return `${yr}SU`;
  return null;
}

/**
 * Delta instructionMode -> site mode vocabulary (in-person/online/hybrid/zoom).
 * Observed values (Fall/Summer 2026):
 *   "Fully In Person"                  -> in-person
 *   "Fully Online"                     -> online
 *   "Hybrid - In Person & Online"      -> hybrid
 *   "In Person & Livestream Lecture"   -> hybrid (some on-ground + synchronous video)
 * A purely synchronous-video mode (livestream/virtual only, no in-person)
 * maps to "zoom". Falls back to the meeting building when the mode is blank.
 */
function mapMode(instructionMode: string | null, building: string | null): string {
  const m = (instructionMode || "").toLowerCase();
  if (m) {
    const hasInPerson = m.includes("in person") || m.includes("in-person");
    const hasOnline = m.includes("online");
    const hasLive = m.includes("livestream") || m.includes("virtual") || m.includes("synchronous");
    if (m.includes("hybrid") || (hasInPerson && hasOnline)) return "hybrid";
    if (hasInPerson && hasLive) return "hybrid"; // on-ground + simulcast
    if (hasLive && !hasInPerson) return "zoom"; // synchronous video only
    if (m.includes("fully online") || (hasOnline && !hasInPerson)) return "online";
    if (hasInPerson) return "in-person";
  }
  // Fallback on the meeting building when mode is blank/unrecognized.
  const b = (building || "").toUpperCase();
  if (b === "ONLINE" || b === "WWW" || b.includes("ONLINE")) return "online";
  if (b.includes("VIRT")) return "zoom";
  return "in-person";
}

const DAY_MAP: Record<string, string> = { M: "M", T: "Tu", W: "W", R: "Th", F: "F", S: "Sa", U: "Su" };
/** "TR" / "MW" -> "Tu Th" / "M W". CollegeScheduler uses single-char tokens. */
function mapDays(days: string | null): string {
  if (!days) return "";
  return days
    .split("")
    .map((c) => DAY_MAP[c] || "")
    .filter(Boolean)
    .join(" ");
}

/** Military integer (1345) -> "1:45 PM". 0/null -> "". */
function mapTime(t: number | null): string {
  if (t == null || t === 0) return "";
  const hh = Math.floor(t / 100);
  const mm = t % 100;
  const ampm = hh >= 12 ? "PM" : "AM";
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

/** Strip HTML tags / entities to plain text. */
function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;| /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull the "Prerequisites:" portion out of a Delta course description and
 * extract the referenced course codes. Delta descriptions begin with e.g.
 * `Prerequisites: ART 7A with a grade of "C" or better. <catalog text>`.
 * Returns null when there are no real prereqs (e.g. "Prerequisites: None.").
 */
function parsePrereqs(description: string | null): { text: string; courses: string[] } | null {
  if (!description) return null;
  const plain = stripHtml(description);
  // Capture from "Prerequisite(s):" up to the next sentence-ending period that
  // is followed by a capitalized word (end of the prereq clause) — but keep it
  // simple and bounded: stop at the first period that closes the prereq phrase.
  const m = plain.match(/Pre-?requisites?:\s*(.*?)(?:Co-?requisites?:|Advisory:|Recommended:|$)/i);
  if (!m) return null;
  let text = m[1].trim();
  // The prereq clause typically ends at the first ". " before the catalog
  // description; trim everything after a sentence boundary that introduces the
  // general description, while preserving "C" grade notations.
  const cut = text.search(/\.\s+[A-Z]/);
  if (cut > 0) text = text.slice(0, cut + 1);
  text = text.replace(/\s*\.\s*$/, "").trim();
  if (!text || /^(none|n\/a)\.?$/i.test(text)) return null;
  const codes = new Set<string>();
  // CA course codes: 2-4 letter prefix + number (e.g. "ART 7A", "MATH 1A",
  // "ENG 1A", "BIOL 31"). Numbers may have a trailing letter.
  const re = /\b([A-Z]{2,4})\s+(\d{1,3}[A-Z]?)\b/g;
  let cm: RegExpExecArray | null;
  while ((cm = re.exec(text)) !== null) {
    // Skip grade-notation false positives like the "C" in "grade of C".
    codes.add(`${cm[1]} ${cm[2]}`);
  }
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

interface SectionRecord {
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
  start_date: string | null;
  location: string;
  campus: string;
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}
interface CoursesResponse {
  environment: { findCourses: { pageInfo: PageInfo; edges: Array<{ node: CourseNode }> } };
}
interface SectionsResponse {
  environment: { getCourseSections: { pageInfo: PageInfo; edges: Array<{ node: SectionNode }> } };
}
interface TermsResponse {
  environment: { courseSearchTerms: Array<{ code: string; name: string }> };
}

async function fetchCourses(term: string): Promise<CourseNode[]> {
  const out: CourseNode[] = [];
  let after: string | null = null;
  for (;;) {
    const d: CoursesResponse = await gql<CoursesResponse>(COURSES_Q, { term, after });
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
    const d: SectionsResponse = await gql<SectionsResponse>(SECTIONS_Q, { cid: courseId, after });
    const conn = d.environment.getCourseSections;
    for (const e of conn.edges) out.push(e.node);
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

/** Build a human "Bldg Room" location, dropping ONLINE/virtual placeholders. */
function buildLocation(mtg: Meeting): string {
  const parts = [mtg.building, mtg.room]
    .map((x) => (x || "").trim())
    .filter((x) => x && !["ONLINE", "WWW", "VIRTUAL", "TBA"].includes(x.toUpperCase()));
  // The building string from Delta often already contains the room
  // (e.g. "BUDD 103 PAINTING ROOM" with room "103"); de-dupe an exact room
  // token that is already a prefix of the building.
  if (parts.length === 2 && parts[0].toUpperCase().includes(parts[1].toUpperCase())) {
    return parts[0];
  }
  return parts.join(" ").trim();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const termFilter = (() => {
    const i = process.argv.indexOf("--term");
    return i >= 0 ? process.argv[i + 1] : null;
  })();

  const td = await gql<TermsResponse>(TERMS_Q);
  const rawTerms: Array<{ code: string; name: string }> = td.environment.courseSearchTerms;
  const terms = rawTerms
    .map((t) => ({ ...t, std: termToStandard(t.name, t.code) }))
    .filter((t) => t.std && parseInt(t.std.slice(0, 4), 10) >= CURRENT_YEAR)
    .filter((t) => !termFilter || t.code === termFilter || t.std === termFilter);

  if (terms.length === 0) {
    console.error(`No matching terms. Available: ${rawTerms.map((t) => `${t.name} (${t.code})`).join(", ")}`);
    process.exit(1);
  }

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

    const records: SectionRecord[] = [];
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
        const instructor =
          (s.instructors || [])
            .filter((n) => n && n.trim() && n.trim().toLowerCase() !== "not assigned" && n.trim().toLowerCase() !== "staff")
            .join(", ") || null;
        const location = buildLocation(mtg);
        records.push({
          college_code: SLUG,
          term: std,
          course_prefix: prefix,
          course_number: c.courseNumber,
          course_title: c.title,
          credits,
          crn: s.registrationNumber,
          days: mapDays(mtg.days),
          start_time: mapTime(mtg.startTime),
          end_time: mapTime(mtg.endTime),
          start_date: mtg.startDate || null,
          location: location || "TBA",
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

    if (records.length === 0) {
      // Never write an empty/stub file — leave any existing data untouched.
      console.error(`  WARNING: 0 sections parsed for ${std}; not writing a file.`);
      continue;
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
