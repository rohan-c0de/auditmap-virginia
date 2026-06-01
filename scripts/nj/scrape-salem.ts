/**
 * Salem Community College — Ellucian Colleague Self-Service (Search/Section API).
 *
 * Salem's Colleague host moved to self-service.salemcc.edu (hyphen), and it
 * uses the older `Search/Section` UI module rather than the `Student/Courses`
 * module the other NJ Colleague colleges use — so the shared scrape-colleague.ts
 * (which drives Student/Courses) can't reach it. Its public section-search API
 * needs no login:
 *
 *   GET  /selfservice/Search/Section?college=SCC&status=Open   (sets session cookie)
 *   POST /selfservice/Sections/Search                          (JSON)
 *        body { sectionSearchParameters:{college:"SCC",status:"Open",
 *               registrationType:"TRAD"}, startIndex, length }
 *        → { data: { overallCount, sections:[ { eventId:"ACC131", section:"01",
 *            eventName, credits, seatsLeft, maximumSeats, year, term,
 *            instructors:[{fullName}], schedules:[{dayDesc,startTime,endTime,
 *            bldgName,roomId}] } ] } }
 *
 * Usage:
 *   npx tsx scripts/nj/scrape-salem.ts
 *   npx tsx scripts/nj/scrape-salem.ts --no-import
 */
import * as fs from "fs";
import * as path from "path";

const SLUG = "salem";
const STATE = "nj";
const HOST = "https://self-service.salemcc.edu";
const COLLEGE = "SCC";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: null;
  prerequisite_courses: never[];
}

function termCode(year: number | string, term: string): string {
  const t = String(term).toUpperCase();
  const s = t.startsWith("FALL") ? "FA" : t.startsWith("SPRING") ? "SP" : t.startsWith("SUMMER") ? "SU" : t.startsWith("WINTER") ? "WI" : "";
  return s ? `${year}${s}` : `${year}XX`;
}

function parseDayDesc(raw: string): string {
  // "MW" → "MW"; "TTh" → "TR"; "MWF" → "MWF"; handles Th/Sa/Su two-letter days.
  const out: string[] = [];
  const re = /Th|Su|Sa|M|T|W|F/g;
  let m: RegExpExecArray | null;
  const map: Record<string, string> = { M: "M", T: "T", W: "W", F: "F", Th: "R", Sa: "S", Su: "U" };
  while ((m = re.exec(raw)) !== null) out.push(map[m[0]]);
  return out.join("");
}

function to24(raw: string): string {
  const m = (raw || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return "";
  let h = parseInt(m[1], 10);
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function parseCode(eventId: string): { prefix: string; number: string } | null {
  const m = (eventId || "").trim().match(/^([A-Z]+)(\d+[A-Z]*)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

async function fetchSections(): Promise<CourseSection[]> {
  // Prime a session cookie.
  const entry = await fetch(`${HOST}/selfservice/Search/Section?college=${COLLEGE}&status=Open`, {
    headers: { "User-Agent": UA },
  });
  const cookie = (entry.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

  const sections: CourseSection[] = [];
  const PAGE = 200;
  let startIndex = 0;
  let overall = Infinity;

  while (startIndex < overall) {
    const res = await fetch(`${HOST}/selfservice/Sections/Search`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Origin: HOST,
        Referer: `${HOST}/selfservice/Search/Section`,
        Cookie: cookie,
      },
      body: JSON.stringify({
        sectionSearchParameters: { college: COLLEGE, status: "Open", registrationType: "TRAD" },
        startIndex,
        length: PAGE,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} at startIndex ${startIndex}`);
    const data = ((await res.json()) as { data?: { overallCount?: number; sections?: unknown[] } }).data;
    overall = data?.overallCount ?? 0;
    const batch = (data?.sections ?? []) as Array<Record<string, unknown>>;
    if (batch.length === 0) break;

    for (const s of batch) {
      const code = parseCode(String(s.eventId ?? ""));
      if (!code) continue;
      const schedules = (s.schedules as Array<Record<string, unknown>> | null) ?? [];
      const sch = schedules[0] ?? null;
      const days = sch ? parseDayDesc(String(sch.dayDesc ?? "")) : "";
      const instrs = (s.instructors as Array<{ fullName?: string }> | null) ?? [];
      const term = termCode(s.year as number, String(s.term ?? ""));
      const total = typeof s.maximumSeats === "number" ? (s.maximumSeats as number) : null;
      const left = typeof s.seatsLeft === "number" ? (s.seatsLeft as number) : null;
      const online = !sch;

      sections.push({
        college_code: SLUG,
        term,
        course_prefix: code.prefix,
        course_number: code.number,
        course_title: String(s.eventName ?? "").trim(),
        credits: parseFloat(String(s.credits ?? "0")) || 0,
        crn: `${code.prefix}-${code.number}-${String(s.section ?? "")}`,
        days,
        start_time: sch ? to24(String(sch.startTime ?? "")) : "",
        end_time: sch ? to24(String(sch.endTime ?? "")) : "",
        start_date: "",
        location: sch ? [sch.bldgName, sch.roomId].filter(Boolean).join(" ") : online ? "Online" : "",
        campus: "Salem Community College",
        mode: online ? "online" : "in-person",
        instructor: instrs[0]?.fullName ?? null,
        seats_open: left,
        seats_total: total,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
    }
    startIndex += batch.length;
  }
  return sections;
}

async function main() {
  console.log("Salem Community College — Colleague Self-Service (Search/Section) scraper");
  console.log(`   Source: ${HOST}/selfservice/Sections/Search`);
  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const sections = await fetchSections();
  if (sections.length === 0) {
    console.log("   0 sections (offline or gated); leaving existing data untouched");
    return;
  }
  // Group by term and write one file per term.
  const byTerm = new Map<string, CourseSection[]>();
  for (const s of sections) {
    if (!byTerm.has(s.term)) byTerm.set(s.term, []);
    byTerm.get(s.term)!.push(s);
  }
  for (const [term, secs] of byTerm) {
    const outPath = path.join(COURSES_DIR, `${term}.json`);
    fs.writeFileSync(outPath, JSON.stringify(secs, null, 2) + "\n");
    console.log(`  ${term}: ${secs.length} sections → ${path.relative(process.cwd(), outPath)}`);
  }
  console.log(`\n${SLUG}: ${sections.length} total sections`);
  if (process.argv.includes("--no-import")) console.log("   (--no-import)");
}

main().catch((err) => {
  console.error("Salem scraper failed:", err);
  process.exit(1);
});
