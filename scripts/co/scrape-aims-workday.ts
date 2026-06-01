/**
 * Aims Community College (Colorado) — Workday Student course scraper
 *
 * Aims runs Workday Student. Its public class schedule lives at
 * schedule.aims.edu — a React SPA hosted on Netlify. The SPA does not call
 * Workday directly (CORS); instead a Netlify serverless function proxies the
 * request to a public Workday custom report. We hit that proxy directly:
 *
 *   https://schedule.aims.edu/.netlify/functions/coursesResults?<WORKDAY_REPORT_URL>&SISTermID=<TERM_ID>
 *
 * where <WORKDAY_REPORT_URL> is Aims' public "INT172" course schedule report:
 *   https://services1.myworkday.com/ccx/service/customreport2/aims/ISU_INT172_PSC/INT172_Aims_Public_Schedule_Courses_V2?format=json
 *
 * The proxy returns:
 *   { "ok": true, "coursesResults": { "Report_Entry": [ {section}, ... ] } }
 *
 * No auth, no SSO — verified public 2026-05-31.
 *
 * REAL field names (verified against the live response, NOT the task brief):
 *   Course_Number      e.g. "ECE1011"  — but ~3% of rows return a junk
 *                       "COURSE_DEFINITION-3-NNNN" placeholder here, so we
 *                       parse prefix/number from Course_Title instead.
 *   Course_Title       e.g. "ECE 1011 - Intro to Early Childhood Educ"
 *                       (always "PREFIX NUM - Descriptive name")
 *   Course_Subjects    subject name (e.g. "Early Childhood Education")
 *   Credits            string number, e.g. "3", "5.5"
 *   Delivery_Mode      Online | In-Person | Hybrid | Blended | Other Distance Mode
 *   Description        HTML
 *   Enrollment_Capacity "9/24" = enrolled/capacity  → seats_open = cap-enrolled
 *   SISID              e.g. "ECE1011-ZO01_202710" (used as crn)
 *   Section            e.g. "ZO01"
 *   Term_ID            "202710"
 *   Course_Status      Open | Closed
 *   Primary_Instructor_Name / _Email
 *   Start_End_Date     "05/26 - 08/04"  (MM/DD - MM/DD, NO year, NO times)
 *   Monday..Sunday     string "0"/"1" day-of-week flags
 *
 * Fields the task brief expected that DO NOT EXIST in this report:
 *   Meeting_Times, Room, Campus, Course_Status time fields, explicit start/end
 *   clock times. The Workday public report carries day-of-week flags and a
 *   date range only — no meeting clock times, no room, no campus. Those output
 *   fields are therefore left null/"".
 *
 * Usage:
 *   npx tsx scripts/co/scrape-aims-workday.ts            # all known terms
 *   npx tsx scripts/co/scrape-aims-workday.ts --term 202720
 *
 * Writes JSON arrays to data/co/courses/aims-community-college/<OUR_TERM>.json
 * Does NOT import to Supabase.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const COLLEGE_CODE = "aims-community-college";

const WORKDAY_REPORT =
  "https://services1.myworkday.com/ccx/service/customreport2/aims/ISU_INT172_PSC/INT172_Aims_Public_Schedule_Courses_V2?format=json";
const PROXY = "https://schedule.aims.edu/.netlify/functions/coursesResults";

// Workday SISTermID -> our term code. Verified present 2026-05-31:
//   202710 Summer 2026 (~551 sections), 202720 Fall 2026 (~1,664 sections).
//   202640 Spring 2026 is now empty. Add new term IDs here as Aims publishes.
const TERMS: Record<string, string> = {
  "202710": "2026SU",
  "202720": "2026FA",
};

const DAY_FIELDS: Array<[string, string]> = [
  ["Monday", "M"],
  ["Tuesday", "T"],
  ["Wednesday", "W"],
  ["Thursday", "R"],
  ["Friday", "F"],
  ["Saturday", "S"],
  ["Sunday", "U"],
];

interface RawSection {
  Course_Number?: string;
  Course_Title?: string;
  Course_Subjects?: string;
  Credits?: string;
  Delivery_Mode?: string;
  Enrollment_Capacity?: string;
  SISID?: string;
  Section?: string;
  Term_ID?: string;
  Course_Status?: string;
  Primary_Instructor_Name?: string;
  Start_End_Date?: string;
  [k: string]: unknown;
}

interface CourseRecord {
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
  end_date: string;
  location: string;
  campus: string;
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: null;
  prerequisite_courses: never[];
}

function normalizeMode(deliveryMode?: string): string {
  const m = (deliveryMode || "").trim().toLowerCase();
  if (!m) return "";
  if (m === "online" || m === "other distance mode") return "online";
  if (m === "in-person" || m === "in person") return "in-person";
  if (m === "hybrid" || m === "blended") return "hybrid";
  return m; // fall back to whatever Workday gave us, lowercased
}

/**
 * Parse "ECE 1011 - Intro to ..." -> {prefix:"ECE", number:"1011", title:"Intro to ..."}.
 * Falls back to SISID ("ECE1011-ZO01_202710") for prefix/number if the title
 * doesn't match the expected leading "PREFIX NUM - " pattern.
 */
function parseCourse(
  title: string,
  sisid: string,
): { prefix: string; number: string; title: string } {
  const t = (title || "").trim();
  const m = t.match(/^([A-Za-z]+)\s+([A-Za-z0-9]+)\s*-\s*(.*)$/);
  if (m) {
    return { prefix: m[1].toUpperCase(), number: m[2], title: m[3].trim() };
  }
  // Fallback: derive prefix/number from the SISID head ("ECE1011-...").
  const head = (sisid || "").split("-")[0];
  const sm = head.match(/^([A-Za-z]+)(\d.*)$/);
  return {
    prefix: sm ? sm[1].toUpperCase() : "",
    number: sm ? sm[2] : "",
    title: t,
  };
}

function parseCredits(c?: string): number | null {
  if (c == null || c === "") return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

/**
 * "9/24" -> { open: 15, total: 24 } (enrolled/capacity).
 * "0/0" or unparseable -> { open: null, total: null }.
 */
function parseCapacity(cap?: string): {
  open: number | null;
  total: number | null;
} {
  const m = (cap || "").match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return { open: null, total: null };
  const enrolled = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isFinite(total) || total === 0) return { open: null, total: null };
  const open = Math.max(0, total - enrolled);
  return { open, total };
}

function parseDays(s: RawSection): string {
  return DAY_FIELDS.filter(([field]) => s[field] === "1")
    .map(([, letter]) => letter)
    .join("");
}

/**
 * "05/26 - 08/04" -> { start: "2026-05-26", end: "2026-08-04" }.
 * No year in source — infer from the term code (e.g. "2026FA" -> 2026).
 * Returns "" for unparseable halves.
 */
function parseDateRange(
  range: string | undefined,
  ourTerm: string,
): { start: string; end: string } {
  const year = ourTerm.slice(0, 4);
  const out = { start: "", end: "" };
  if (!range) return out;
  const parts = range.split("-").map((p) => p.trim());
  const fmt = (mmdd: string): string => {
    const m = mmdd.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!m) return "";
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  };
  if (parts[0]) out.start = fmt(parts[0]);
  if (parts[1]) out.end = fmt(parts[1]);
  return out;
}

async function fetchTerm(termId: string): Promise<RawSection[]> {
  const url = `${PROXY}?${WORKDAY_REPORT}&SISTermID=${termId}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (compatible; CommunityCollegePath/1.0; +https://communitycollegepath.com)",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for term ${termId}`);
  }
  const json = (await res.json()) as {
    ok?: boolean;
    coursesResults?: { Report_Entry?: RawSection[] };
  };
  if (!json.ok) {
    throw new Error(`Proxy returned ok=false for term ${termId}`);
  }
  return json.coursesResults?.Report_Entry ?? [];
}

function transform(raw: RawSection[], ourTerm: string): CourseRecord[] {
  return raw.map((s) => {
    const { prefix, number, title } = parseCourse(
      s.Course_Title ?? "",
      s.SISID ?? "",
    );
    const { open, total } = parseCapacity(s.Enrollment_Capacity);
    const { start, end } = parseDateRange(s.Start_End_Date, ourTerm);
    const instructor = (s.Primary_Instructor_Name || "").trim();
    return {
      college_code: COLLEGE_CODE,
      term: ourTerm,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits: parseCredits(s.Credits),
      crn: s.SISID || s.Section || "",
      days: parseDays(s),
      start_time: "",
      end_time: "",
      start_date: start,
      end_date: end,
      location: "",
      campus: "",
      mode: normalizeMode(s.Delivery_Mode),
      instructor: instructor || null,
      seats_open: open,
      seats_total: total,
      prerequisite_text: null,
      prerequisite_courses: [],
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const onlyTerm = termIdx >= 0 ? args[termIdx + 1] : undefined;

  const termIds = onlyTerm ? [onlyTerm] : Object.keys(TERMS);
  const outDir = join("data", "co", "courses", COLLEGE_CODE);
  mkdirSync(outDir, { recursive: true });

  console.log("🏔️  Aims Community College — Workday public schedule scraper");
  console.log(`   Proxy: ${PROXY}`);
  console.log(`   Terms: ${termIds.join(", ")}`);

  for (const termId of termIds) {
    const ourTerm = TERMS[termId] ?? termId;
    process.stdout.write(`\n→ Term ${termId} (${ourTerm})... `);
    let raw: RawSection[];
    try {
      raw = await fetchTerm(termId);
    } catch (err) {
      console.log(`FAILED: ${(err as Error).message}`);
      console.log("   leaving any existing file untouched.");
      continue;
    }
    console.log(`${raw.length} raw sections`);
    if (raw.length === 0) {
      console.log(
        `   term ${termId} returned 0 sections — NOT writing an empty file (would clobber prior data).`,
      );
      continue;
    }
    const records = transform(raw, ourTerm);
    const outPath = join(outDir, `${ourTerm}.json`);
    writeFileSync(outPath, JSON.stringify(records, null, 2) + "\n");
    console.log(`   wrote ${records.length} records → ${outPath}`);
  }

  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error("❌ Aims Workday scraper failed:", err);
  process.exit(1);
});
