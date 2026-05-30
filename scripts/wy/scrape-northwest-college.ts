/**
 * Northwest College (Powell, WY) — bespoke JSON-API scraper
 *
 * NWC's Colleague Self-Service (my.nwc.edu) is SSO-gated, but the college
 * runs a public Vue course-and-syllabi search app at
 * area10.nwc.edu/nwcforms/syllabi/ backed by an unauthenticated JSON REST
 * API. No auth, no CORS block — returns full section records.
 *
 * Endpoints (all GET, no params except term):
 *   /nwcforms/Syllabi/GetCurrentTerm   → "26/FA"
 *   /nwcforms/Syllabi/GetTermsJson     → [{ dataValue: "26/FA", dataText: "Fall 2026", ... }]
 *   /nwcforms/Syllabi/GetScheduleDownload?term=26/FA → [ section, ... ]
 *
 * Section fields used: SEC_SUBJECT, SEC_COURSE_NO, SEC_SHORT_TITLE,
 *   SEC_MIN_CRED, SEC_NAME, SEC_TERM, SEC_LOCATION, MEET_INFO1,
 *   SEC_MEETING_INFO (for start date), FAC1, ACTIVE_COUNT, SEC_CAPACITY,
 *   CRS_DESC (carries inline "Prerequisite: ..." text).
 *
 * Term code mapping: "26/FA" → "2026FA", "26/SP" → "2026SP", "26/SU" → "2026SU".
 * Only current-and-future terms are written (past terms dropped).
 */
import * as fs from "fs";
import * as path from "path";

const BASE = "https://area10.nwc.edu/nwcforms/Syllabi";
const SLUG = "northwest-college";
const STATE = "wy";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface NwcSection {
  SEC_SUBJECT: string;
  SEC_COURSE_NO: string;
  SEC_NO: string;
  SEC_SHORT_TITLE: string;
  SEC_MIN_CRED: number | null;
  SEC_NAME: string;
  SEC_SYNONYM: string;
  SEC_TERM: string;
  SEC_LOCATION: string;
  MEET_INFO1: string | null;
  SEC_MEETING_INFO: string | null;
  BLDGROOM1: string | null;
  METHOD1: string | null;
  FAC1: string | null;
  ACTIVE_COUNT: number | null;
  SEC_CAPACITY: number | null;
  CRS_DESC: string | null;
}

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

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json, */*" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return (await r.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return (await r.text()).trim();
}

/** "26/FA" → "2026FA". */
function mapTermCode(secTerm: string): string {
  const m = secTerm.match(/^(\d{2})\/([A-Z]{2})$/);
  if (!m) return secTerm.replace("/", "");
  return `20${m[1]}${m[2]}`;
}

/** Parse "TTh 9:25AM-10:40AM" → { days, start, end }. */
function parseMeetingInfo(info: string | null): { days: string; start: string; end: string } {
  if (!info) return { days: "", start: "", end: "" };
  const m = info.match(/^([MTWThFSaSu]+)\s+([\d:]+[AP]M)-([\d:]+[AP]M)/i);
  if (!m) return { days: "", start: "", end: "" };
  // Tokenize the day string greedily by longest-match (Th/Sa/Su before
  // single letters) so "TTh" → ["T","Th"], not "T T h".
  const tokens: string[] = [];
  let rest = m[1];
  while (rest.length) {
    const two = rest.slice(0, 2);
    if (two === "Th" || two === "Sa" || two === "Su") {
      tokens.push(two);
      rest = rest.slice(2);
    } else {
      tokens.push(rest[0]);
      rest = rest.slice(1);
    }
  }
  return { days: tokens.join(" "), start: m[2].toUpperCase(), end: m[3].toUpperCase() };
}

/** Extract first date from "08/27/2026-12/17/2026 Lecture ...". */
function parseStartDate(meetingInfo: string | null): string {
  if (!meetingInfo) return "";
  const m = meetingInfo.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Pull "Prerequisite: ..." sentence(s) from a course description. */
function parsePrereq(desc: string | null): { text: string | null; courses: string[] } {
  if (!desc) return { text: null, courses: [] };
  const m = desc.match(/Prerequisite[s]?:\s*([^.]+(?:\.[^.]*)?)/i);
  if (!m) return { text: null, courses: [] };
  const text = m[1].trim().replace(/\s+/g, " ");
  const courses: string[] = [];
  const re = /([A-Z]{2,4})[-\s*]?(\d{3,4}[A-Z]*)/g;
  let cm;
  while ((cm = re.exec(text)) !== null) courses.push(`${cm[1]} ${cm[2]}`);
  return { text, courses };
}

function determineMode(location: string, method: string | null, meetingInfo: string | null): string {
  const loc = (location || "").toLowerCase();
  const mi = (meetingInfo || "").toLowerCase();
  if (loc.includes("onl") || mi.includes("online") || method === "WWW") return "online";
  return "in-person";
}

async function main() {
  console.log("🏔️  Northwest College (NWC) JSON-API scraper");
  const currentTerm = await fetchText(`${BASE}/GetCurrentTerm`);
  console.log(`   Current term: ${currentTerm}`);

  const terms = await fetchJson<Array<{ dataValue: string; dataText: string; termEnd: string }>>(
    `${BASE}/GetTermsJson`,
  );
  // Keep current + future terms only (termEnd >= now). Use string compare on
  // the YY/SEASON code is unreliable; rely on termEnd date.
  const futureTerms = terms.filter((t) => {
    const end = t.termEnd?.slice(0, 10);
    return end && end >= "2026-05-01"; // keep Spring 2026 onward
  });
  console.log(`   Terms to scrape: ${futureTerms.map((t) => t.dataValue).join(", ")}`);

  let grandTotal = 0;
  for (const term of futureTerms) {
    const raw = await fetchJson<NwcSection[]>(
      `${BASE}/GetScheduleDownload?term=${encodeURIComponent(term.dataValue)}`,
    );
    if (!raw.length) {
      console.log(`   ${term.dataValue}: 0 sections, skipping`);
      continue;
    }

    const sections: CourseSection[] = raw.map((s) => {
      const meeting = parseMeetingInfo(s.MEET_INFO1);
      const prereq = parsePrereq(s.CRS_DESC);
      return {
        college_code: SLUG,
        term: mapTermCode(s.SEC_TERM),
        course_prefix: s.SEC_SUBJECT,
        course_number: s.SEC_COURSE_NO,
        course_title: s.SEC_SHORT_TITLE,
        credits: s.SEC_MIN_CRED ?? 0,
        crn: s.SEC_SYNONYM || s.SEC_NAME,
        days: meeting.days,
        start_time: meeting.start,
        end_time: meeting.end,
        start_date: parseStartDate(s.SEC_MEETING_INFO),
        location: s.BLDGROOM1 || s.SEC_LOCATION || "",
        campus: s.SEC_LOCATION || "",
        mode: determineMode(s.SEC_LOCATION, s.METHOD1, s.SEC_MEETING_INFO),
        instructor: s.FAC1 && s.FAC1 !== "Staff" ? s.FAC1 : null,
        seats_open:
          s.SEC_CAPACITY != null && s.ACTIVE_COUNT != null
            ? s.SEC_CAPACITY - s.ACTIVE_COUNT
            : null,
        seats_total: s.SEC_CAPACITY ?? null,
        prerequisite_text: prereq.text,
        prerequisite_courses: prereq.courses,
      };
    });

    const fileTermCode = mapTermCode(term.dataValue);
    const outDir = path.join(process.cwd(), "data", STATE, "courses", SLUG);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${fileTermCode}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    const withPrereq = sections.filter((s) => s.prerequisite_text).length;
    console.log(
      `   ${term.dataValue} → ${fileTermCode}.json: ${sections.length} sections (${withPrereq} with prereqs)`,
    );
    grandTotal += sections.length;
  }

  console.log(`\n✅ Done — ${grandTotal} sections for Northwest College.`);
}

main().catch((err) => {
  console.error("❌ NWC scraper failed:", err);
  process.exit(1);
});
