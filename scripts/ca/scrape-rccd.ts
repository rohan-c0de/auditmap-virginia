/**
 * scrape-rccd.ts — Riverside Community College District class schedule
 *
 * RCCD's three colleges (Riverside City, Moreno Valley, Norco) publish their
 * live schedules through a single PUBLIC SharePoint OData backend fronted by an
 * Azure App Proxy — no auth, no SSO. Each college is a SEPARATE SharePoint
 * list, which is the campus discriminator:
 *
 *   ScheduleData_RIV → riverside-city-college   (College = "Riverside")
 *   ScheduleData_MOV → moreno-valley-college     (College = "Moreno Valley")
 *   ScheduleData_NOR → norco-college             (College = "Norco")
 *
 * Endpoint (one list, one term):
 *   GET https://apps-studentrcc.msappproxy.net/schedule/_api/web/lists/
 *         getByTitle('ScheduleData_RIV')/items?$filter=Term eq '26FAL'
 *   Header: Accept: application/json;odata=nometadata
 *
 * SharePoint returns ~100 items/page and an `odata.nextLink` ($skiptoken) to
 * paginate. (The nextLink it hands back rewrites the host to apps.rccd.edu;
 * we rewrite it back to the msappproxy proxy host, which is the reliably
 * reachable one.)
 *
 * Term codes live in list ScheduleTermOptions. Observed mapping:
 *   26FAL → 2026FA   26WIN → 2026WI   26SPR → 2026SP   26SUM → 2026SU
 *
 * Field schema (SharePoint encodes spaces as _x0020_):
 *   Section_x0020_Number → CRN              Title → course title
 *   Primary_x0020_Subject → "PREFIX-NUMBER" (split on first '-')
 *   Units → credits        College → campus discriminator (already per-list)
 *   Instructor_x0020_Method_x0020_1 → modality code (LEC/LAB/OL/HYB/...)
 *   Start/End_x0020_Date/Time_x0020_1 → primary meeting date & time
 *   Day1Mon..Day1Sun (booleans) → primary meeting days
 *   Building_x0020_1 + Room_x0020_1 → location
 *   Faculty_x0020_Name_x0020_1 → instructor
 *   Total_x0020_Seats / Seats_x0020_Used → seats_total / (open = total-used)
 *   Prerequisite → prerequisite_text  ('.' placeholder = none)
 *
 * Each section may carry up to six meetings (suffixes _1.._6). We emit ONE row
 * per section using meeting 1 as the primary day/time/location, per the output
 * contract. Modality is derived from the section-level method codes so an
 * online section with no meeting-1 day/time is still classified correctly.
 *
 * Output: data/ca/courses/{slug}/{2026FA|2026SP|2026SU|2026WI}.json
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-rccd.ts
 *   npx tsx scripts/ca/scrape-rccd.ts --college norco-college --term "Fall 2026"
 */

import * as fs from "fs";
import * as path from "path";

const PROXY_HOST = "apps-studentrcc.msappproxy.net";
const API_ROOT = `https://${PROXY_HOST}/schedule/_api/web/lists`;
const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

interface CollegeSpec {
  slug: string;
  list: string; // SharePoint list title
  campus: string; // human label for the `campus` field
}

const COLLEGES: CollegeSpec[] = [
  { slug: "riverside-city-college", list: "ScheduleData_RIV", campus: "Riverside" },
  { slug: "moreno-valley-college", list: "ScheduleData_MOV", campus: "Moreno Valley" },
  { slug: "norco-college", list: "ScheduleData_NOR", campus: "Norco" },
];

interface TermSpec {
  name: string; // CLI-facing name for --term
  code: string; // SharePoint Term value
  fileTerm: string; // output filename term code
}

const TERMS: TermSpec[] = [
  { name: "Fall 2026", code: "26FAL", fileTerm: "2026FA" },
  { name: "Winter 2026", code: "26WIN", fileTerm: "2026WI" },
  { name: "Spring 2026", code: "26SPR", fileTerm: "2026SP" },
  { name: "Summer 2026", code: "26SUM", fileTerm: "2026SU" },
];

type Mode = "in-person" | "online" | "hybrid" | "zoom";

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
  mode: Mode;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

// Raw SharePoint item — only the fields we read are typed; the list carries
// many more (Day1Mon..Day6Sun, Building_1..6, etc.) accessed dynamically.
type SpItem = Record<string, unknown>;

interface ODataPage {
  value: SpItem[];
  "odata.nextLink"?: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** "11:10AM" → "11:10 AM"; "" / null → "". */
function normalizeTime(raw: unknown): string {
  const t = str(raw).trim();
  if (!t) return "";
  const m = t.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (!m) return t;
  return `${parseInt(m[1], 10)}:${m[2]} ${m[3].toUpperCase()}`;
}

/** "08/24/26" → "2026-08-24". Handles 2- or 4-digit years. */
function normalizeDate(raw: unknown): string {
  const d = str(raw).trim();
  if (!d) return "";
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  let year = m[3];
  if (year.length === 2) year = `20${year}`;
  return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

const DAY_FIELDS: Array<[string, string]> = [
  ["Day1Mon", "M"],
  ["Day1Tue", "Tu"],
  ["Day1Wed", "W"],
  ["Day1Thu", "Th"],
  ["Day1Fri", "F"],
  ["Day1Sat", "Sa"],
  ["Day1Sun", "Su"],
];

/** Build a days token string ("MWF", "TuTh", "") from the meeting-1 booleans. */
function deriveDays(it: SpItem): string {
  let out = "";
  for (const [field, token] of DAY_FIELDS) {
    if (it[field] === true) out += token;
  }
  return out;
}

/**
 * Derive delivery mode from the section's instructional-method codes
 * (Instructor_x0020_Method_x0020_1..6). RCCD codes:
 *   OL / OLL → online (async)     HYB / HYBO → hybrid
 *   LEC / LAB / WRK / etc.        → in-person
 * RCCD does not expose a distinct synchronous-remote ("zoom") code, so we
 * never emit "zoom" — that would be fabricated.
 */
function deriveMode(it: SpItem): Mode {
  const codes: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const c = str(it[`Instructor_x0020_Method_x0020_${i}`]).trim().toUpperCase();
    if (c) codes.push(c);
  }
  const building1 = str(it["Building_x0020_1"]).trim().toUpperCase();
  const when = str(it["When"]).trim().toUpperCase();

  const isHyb = codes.some((c) => c.includes("HYB"));
  if (isHyb) return "hybrid";

  // Pure-online: every method code is online-flavoured, or the section is
  // flagged ONLINE / parked in the "ON" (online) building with no real room.
  const onlineCode = (c: string) => c.startsWith("OL") || c === "WRKO" || c.startsWith("ONL");
  const allOnline = codes.length > 0 && codes.every(onlineCode);
  if (allOnline || when === "ONLINE" || building1 === "ON") return "online";

  return "in-person";
}

/** Join Building + Room for meeting 1 into a location label. */
function deriveLocation(it: SpItem, mode: Mode): string {
  const bld = str(it["Building_x0020_1"]).trim();
  const room = str(it["Room_x0020_1"]).trim();
  // Online sections use sentinel building "ON" / room "LINE" — not a real place.
  if (mode === "online" && (bld === "ON" || room === "LINE")) return "Online";
  const parts = [bld, room].filter(Boolean);
  return parts.join(" ");
}

const PREREQ_RE = /\b([A-Z]{2,5})-([A-Z]?\d{1,4}[A-Z]{0,2})\b/g;

/** Extract "PREFIX NUMBER" course codes from the Prerequisite text. */
function extractPrereqCourses(text: string): string[] {
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  PREREQ_RE.lastIndex = 0;
  while ((m = PREREQ_RE.exec(text)) !== null) {
    set.add(`${m[1]} ${m[2]}`);
  }
  return Array.from(set);
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(str(v));
  return Number.isFinite(n) ? n : null;
}

function rowToSection(it: SpItem, spec: CollegeSpec, term: TermSpec): CourseSection | null {
  const crn = str(it["Section_x0020_Number"]).trim();
  if (!crn) return null; // no CRN → not a real section row

  // Primary_x0020_Subject = "PREFIX-NUMBER" (e.g. "ACC-1A", "ALR-887").
  const subjectRaw = str(it["Primary_x0020_Subject"]).trim();
  const dash = subjectRaw.indexOf("-");
  let prefix = subjectRaw;
  let number = "";
  if (dash >= 0) {
    prefix = subjectRaw.slice(0, dash).trim();
    number = subjectRaw.slice(dash + 1).trim();
  }
  if (!prefix && !number) return null;

  const mode = deriveMode(it);

  const total = toNumberOrNull(it["Total_x0020_Seats"]);
  const used = toNumberOrNull(it["Seats_x0020_Used"]);
  const seatsTotal = total != null ? Math.round(total) : null;
  const seatsOpen =
    total != null && used != null ? Math.max(0, Math.round(total) - Math.round(used)) : null;

  const credits = toNumberOrNull(it["Units"]);

  // Prerequisite: '.' (and other punctuation-only strings) is a "none" sentinel.
  const prereqRaw = str(it["Prerequisite"]).trim();
  const prereqText = prereqRaw && /[A-Za-z0-9]/.test(prereqRaw) ? prereqRaw : null;
  const prereqCourses = prereqText ? extractPrereqCourses(prereqText) : [];

  const instructor = str(it["Faculty_x0020_Name_x0020_1"]).trim() || null;

  return {
    college_code: spec.slug,
    term: term.fileTerm,
    course_prefix: prefix,
    course_number: number,
    course_title: str(it["Title"]).trim(),
    credits: credits ?? 0,
    crn,
    days: deriveDays(it),
    start_time: normalizeTime(it["Start_x0020_Time_x0020_1"]),
    end_time: normalizeTime(it["End_x0020_Time_x0020_1"]),
    start_date: normalizeDate(it["Start_x0020_Date_x0020_1"]),
    location: deriveLocation(it, mode),
    campus: spec.campus,
    mode,
    instructor,
    seats_open: seatsOpen,
    seats_total: seatsTotal,
    prerequisite_text: prereqText,
    prerequisite_courses: prereqCourses,
  };
}

async function fetchJson(url: string, attempt = 1): Promise<ODataPage> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json;odata=nometadata",
        "User-Agent": UA,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as ODataPage;
    if (!Array.isArray(body.value)) throw new Error("response missing value[]");
    return body;
  } catch (err) {
    if (attempt >= 4) throw err;
    const wait = 1000 * attempt;
    console.warn(`    retry ${attempt} after error: ${(err as Error).message} (waiting ${wait}ms)`);
    await new Promise((r) => setTimeout(r, wait));
    return fetchJson(url, attempt + 1);
  }
}

/** Force any nextLink back onto the reachable proxy host. */
function rewriteHost(url: string): string {
  return url.replace(/^https:\/\/[^/]+/i, `https://${PROXY_HOST}`);
}

/** Page through one list+term, returning every item. */
async function fetchListTerm(spec: CollegeSpec, term: TermSpec): Promise<SpItem[]> {
  const first =
    `${API_ROOT}/getByTitle('${spec.list}')/items` +
    `?$filter=${encodeURIComponent(`Term eq '${term.code}'`)}&$top=100`;
  const items: SpItem[] = [];
  let url: string | undefined = first;
  let page = 0;
  while (url) {
    const body: ODataPage = await fetchJson(url);
    items.push(...body.value);
    page++;
    if (page % 10 === 0) {
      console.log(`    …${items.length} items so far (page ${page})`);
    }
    const next = body["odata.nextLink"];
    url = next ? rewriteHost(next) : undefined;
  }
  return items;
}

function dedupeByCrn(sections: CourseSection[]): CourseSection[] {
  const seen = new Set<string>();
  const out: CourseSection[] = [];
  for (const s of sections) {
    if (seen.has(s.crn)) continue;
    seen.add(s.crn);
    out.push(s);
  }
  return out;
}

function getArg(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);

  const collegeFilter = getArg(args, "--college");
  const termFilter = getArg(args, "--term");

  const colleges = collegeFilter
    ? COLLEGES.filter((c) => c.slug === collegeFilter)
    : COLLEGES;
  if (colleges.length === 0) {
    console.error(
      `Unknown --college "${collegeFilter}". Valid: ${COLLEGES.map((c) => c.slug).join(", ")}`,
    );
    process.exit(1);
  }

  const terms = termFilter
    ? TERMS.filter((t) => t.name === termFilter || t.fileTerm === termFilter || t.code === termFilter)
    : TERMS;
  if (terms.length === 0) {
    console.error(
      `Unknown --term "${termFilter}". Valid: ${TERMS.map((t) => t.name).join(", ")}`,
    );
    process.exit(1);
  }

  let totalWritten = 0;
  for (const college of colleges) {
    console.log(`\n=== ${college.campus} (${college.list}) ===`);
    for (const term of terms) {
      process.stdout.write(`  ${term.name} [${term.code}] … `);
      let rawItems: SpItem[];
      try {
        rawItems = await fetchListTerm(college, term);
      } catch (err) {
        console.error(
          `\n  ! ${college.slug} ${term.name}: fetch failed (${(err as Error).message}) — leaving existing data untouched`,
        );
        continue;
      }
      console.log(`fetched ${rawItems.length} items`);

      const sections: CourseSection[] = [];
      for (const it of rawItems) {
        const sec = rowToSection(it, college, term);
        if (sec) sections.push(sec);
      }
      const deduped = dedupeByCrn(sections);

      if (deduped.length === 0) {
        // Skip 0-section terms entirely — never write an empty/stub file.
        console.log(`    0 sections → skipped (no file written)`);
        continue;
      }

      const dir = path.join(DATA_DIR, college.slug);
      fs.mkdirSync(dir, { recursive: true });
      const outPath = path.join(dir, `${term.fileTerm}.json`);
      fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2) + "\n");
      const removed = sections.length - deduped.length;
      console.log(
        `    ${deduped.length} sections${removed > 0 ? ` (-${removed} dupe CRNs)` : ""} → ${outPath}`,
      );
      totalWritten += deduped.length;
    }
  }

  console.log(`\nDone. ${totalWritten} sections written across all colleges/terms.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
