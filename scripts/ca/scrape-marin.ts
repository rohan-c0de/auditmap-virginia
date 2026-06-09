/**
 * scrape-marin.ts — College of Marin class schedule scraper
 *
 * College of Marin publishes a public, unauthenticated class search built as a
 * classic ASP.NET WebForms app (no login):
 *
 *   https://netapps.marin.edu/Apps/Directory/ScheduleSearch.aspx
 *
 * The page is heavy (~5 MB __VIEWSTATE). The flow is a pure-HTTP postback:
 *   1. GET the search page, parse the hidden __VIEWSTATE / __VIEWSTATEGENERATOR
 *      / __EVENTVALIDATION fields and the term option values (cheerio).
 *   2. POST back per term carrying the viewstate + selected term + "All
 *      Subjects" (0000) + the imgbtnSearch image-button trigger (.x/.y).
 *   3. Parse the returned results GridView (#MainContent_grdSchedule) into
 *      sections.
 *
 * "All Subjects" (cboSubject=0000) returns the complete set for a term in one
 * postback — verified complete against per-subject searches (all CRNs present),
 * so we avoid 65 individual subject POSTs (each carries the 2.3 MB viewstate).
 *
 * Results grid columns (13):
 *   [0] Term  [1] Section (CRN)  [2] Course ("ENGL 150 - Title")  [3] Level
 *   [4] Credit Units  [5] TextBooks  [6] Dates ("08/22/26-12/11/26")
 *   [7] Days  [8] Time  [9] Campus  [10] Room  [11] Type (LEC/LAB/CLAS)
 *   [12] Instructor
 *
 * A section with multiple weekly meetings spans multiple <tr> rows: the first
 * row carries the term/CRN/course; continuation rows have an empty Term cell
 * and repeat the CRN, contributing additional days/time/room. We group by CRN
 * and merge meeting info across rows.
 *
 * Seat counts are not published anywhere in this app (neither the grid nor the
 * SectionInfo detail popup), so seats_open / seats_total are null. Days/time
 * are frequently blank for early-published terms (room/time not yet assigned);
 * that is the real source state and we store "" rather than fabricating.
 *
 * Mode is derived from the Campus column: "Online Asynchronous" → online,
 * "Hybrid" → hybrid, otherwise in-person.
 *
 * Output: data/ca/courses/college-of-marin/{2026SP|2026SU|2026FA}.json
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-marin.ts                 # all published terms
 *   npx tsx scripts/ca/scrape-marin.ts --term 2026FA   # one term (file code,
 *                                                       # or "Fall 2026", "202680")
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SEARCH_URL =
  "https://netapps.marin.edu/Apps/Directory/ScheduleSearch.aspx";
const COLLEGE_SLUG = "college-of-marin";
const DATA_DIR = path.join(
  process.cwd(),
  "data",
  "ca",
  "courses",
  COLLEGE_SLUG,
);

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

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

// Banner-style file-term code → marin term option value.
const FILE_TERM_TO_OPTION: Record<string, string> = {
  "2026SP": "202640", // Spring 2026 (if/when published — pattern: SP=40)
  "2026SU": "202660", // Summer 2026
  "2026FA": "202680", // Fall 2026
};

// marin term option value → file-term code (canonical mapping, confirmed live).
const OPTION_TO_FILE_TERM: Record<string, string> = {
  "202640": "2026SP",
  "202660": "2026SU",
  "202680": "2026FA",
};

// Human term label → file-term code, for the --term flag.
function labelToFileTerm(label: string): string | null {
  const m = label.trim().match(/^(Spring|Summer|Fall|Winter)\s+(\d{4})$/i);
  if (!m) return null;
  const seasonMap: Record<string, string> = {
    spring: "SP",
    summer: "SU",
    fall: "FA",
    winter: "WI",
  };
  const code = seasonMap[m[1].toLowerCase()];
  if (!code) return null;
  return `${m[2]}${code}`;
}

/** Normalize a --term argument to a file-term code (e.g. "2026FA"). */
function normalizeTermArg(arg: string): string | null {
  const a = arg.trim();
  if (/^\d{4}(SP|SU|FA|WI)$/i.test(a)) return a.toUpperCase();
  if (OPTION_TO_FILE_TERM[a]) return OPTION_TO_FILE_TERM[a]; // raw option value
  const fromLabel = labelToFileTerm(a);
  if (fromLabel) return fromLabel;
  return null;
}

interface ViewState {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
  terms: { option: string; label: string }[];
}

/** GET the search page, extract hidden fields + available term options. */
async function fetchSearchPage(cookieJar: string[]): Promise<ViewState> {
  const res = await fetch(SEARCH_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET search page failed: HTTP ${res.status}`);
  captureCookies(res, cookieJar);
  const html = await res.text();
  const $ = cheerio.load(html);

  const hidden = (name: string): string =>
    $(`input[name="${name}"]`).attr("value") ?? "";

  const viewState = hidden("__VIEWSTATE");
  const viewStateGenerator = hidden("__VIEWSTATEGENERATOR");
  const eventValidation = hidden("__EVENTVALIDATION");
  if (!viewState || !eventValidation) {
    throw new Error("Could not parse __VIEWSTATE / __EVENTVALIDATION");
  }

  const terms: { option: string; label: string }[] = [];
  $('select[name="ctl00$MainContent$cboTerm"] option').each((_, el) => {
    const option = ($(el).attr("value") ?? "").trim();
    const label = $(el).text().trim();
    if (option && option !== "000000") terms.push({ option, label }); // skip "All Terms"
  });

  return { viewState, viewStateGenerator, eventValidation, terms };
}

function captureCookies(res: Response, jar: string[]): void {
  // Node fetch exposes set-cookie via getSetCookie() on Headers.
  const anyHeaders = res.headers as unknown as {
    getSetCookie?: () => string[];
  };
  const setCookies = anyHeaders.getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const pair = c.split(";")[0];
    if (!pair) continue;
    const name = pair.split("=")[0];
    // replace any existing cookie of the same name
    const idx = jar.findIndex((x) => x.split("=")[0] === name);
    if (idx >= 0) jar[idx] = pair;
    else jar.push(pair);
  }
}

/** POST the search form for one term, return the results HTML. */
async function postSearch(
  vs: ViewState,
  termOption: string,
  cookieJar: string[],
): Promise<string> {
  const body = new URLSearchParams();
  body.set("__EVENTTARGET", "");
  body.set("__EVENTARGUMENT", "");
  body.set("__VIEWSTATE", vs.viewState);
  body.set("__VIEWSTATEGENERATOR", vs.viewStateGenerator);
  body.set("__EVENTVALIDATION", vs.eventValidation);
  body.set("ctl00$MainContent$cboTerm", termOption);
  body.set("ctl00$MainContent$cboCampus", "0000"); // All Campuses
  body.set("ctl00$MainContent$cboSession", "0"); // All Sessions
  body.set("ctl00$MainContent$cboAttribute", "0"); // All Options
  body.set("ctl00$MainContent$cboSubject", "0000"); // All Subjects
  body.set("ctl00$MainContent$imgbtnSearch.x", "10"); // image-button click
  body.set("ctl00$MainContent$imgbtnSearch.y", "10");

  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      ...HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: SEARCH_URL,
      Cookie: cookieJar.join("; "),
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`POST search failed: HTTP ${res.status}`);
  captureCookies(res, cookieJar);
  return res.text();
}

/** "08/22/26-12/11/26" → "2026-08-22" (start date, ISO). */
function parseStartDate(raw: string): string {
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!m) return "";
  let year = m[3];
  if (year.length === 2) year = `20${year}`;
  return `${year}-${m[1]}-${m[2]}`;
}

/** "ENGL 150 - Critical Thinking" → { prefix, number, title }. */
function parseCourse(
  raw: string,
): { prefix: string; number: string; title: string } | null {
  const m = raw.match(/^([A-Z]+)\s+([A-Z0-9]+)\s*-\s*(.+)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], title: m[3].trim() };
}

/**
 * Normalize the Days cell into space-free schema tokens.
 * Marin renders days like "MW", "TuTh", "MWF", "M/W", "M W". We re-tokenize to
 * the canonical M Tu W Th F Sa Su set and join with no separator.
 */
function normalizeDays(raw: string): string {
  const cleaned = raw.replace(/&nbsp;/g, " ").trim();
  if (!cleaned) return "";
  const tokens: string[] = [];
  let i = 0;
  const s = cleaned.replace(/[^A-Za-z]/g, ""); // drop separators like / , space
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    if (two === "Tu" || two === "Th" || two === "Sa" || two === "Su") {
      tokens.push(two);
      i += 2;
      continue;
    }
    const one = s[i].toUpperCase();
    if (one === "M") tokens.push("M");
    else if (one === "W") tokens.push("W");
    else if (one === "F") tokens.push("F");
    else if (one === "T") tokens.push("Tu"); // bare T → Tuesday
    else if (one === "S") tokens.push("Sa"); // bare S → Saturday
    i += 1;
  }
  return tokens.join("");
}

/** Normalize a clock time like "11:00AM" / "11:00 am" → "11:00 AM". */
function normalizeTime(raw: string): string {
  const m = raw
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?$/);
  if (!m) return raw.trim();
  return `${parseInt(m[1], 10)}:${m[2]} ${m[3].toUpperCase()}M`;
}

/** Split a time range "11:00AM-12:20PM" → { start, end }. */
function parseTimeRange(raw: string): { start: string; end: string } {
  const cleaned = raw.replace(/&nbsp;/g, " ").trim();
  if (!cleaned || /tba|arr|arrange/i.test(cleaned)) {
    return { start: "", end: "" };
  }
  const parts = cleaned.split(/\s*[-–]\s*/);
  if (parts.length !== 2) return { start: "", end: "" };
  return { start: normalizeTime(parts[0]), end: normalizeTime(parts[1]) };
}

function deriveMode(campus: string, room: string): Mode {
  const c = campus.toLowerCase();
  const r = room.toLowerCase();
  if (c.includes("hybrid")) return "hybrid";
  if (c.includes("online") || r.includes("online")) return "online";
  return "in-person";
}

function cellText($: cheerio.CheerioAPI, td: cheerio.Element): string {
  return $(td).text().replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

interface RawRow {
  term: string;
  crn: string;
  course: string;
  credits: string;
  dateRange: string;
  days: string;
  time: string;
  campus: string;
  room: string;
  instructor: string;
}

/** Parse the GridView into raw rows (one per <tr>, including continuation rows). */
function parseGrid(html: string): RawRow[] {
  const $ = cheerio.load(html);
  const grid = $("#MainContent_grdSchedule");
  if (grid.length === 0) return [];
  const out: RawRow[] = [];
  grid.find("tr").each((_, tr) => {
    const tds = $(tr).children("td").toArray();
    if (tds.length < 13) return; // header row has <th>, skip
    out.push({
      term: cellText($, tds[0]),
      crn: cellText($, tds[1]),
      course: cellText($, tds[2]),
      credits: cellText($, tds[4]),
      dateRange: cellText($, tds[6]),
      days: cellText($, tds[7]),
      time: cellText($, tds[8]),
      campus: cellText($, tds[9]),
      room: cellText($, tds[10]),
      instructor: cellText($, tds[12]),
    });
  });
  return out;
}

interface MeetingAgg {
  daysSet: string[]; // ordered unique day-tokens
  starts: string[];
  ends: string[];
  rooms: string[];
  campuses: string[];
  instructors: string[];
}

/** Build CourseSections by grouping raw rows on CRN and merging meeting info. */
function buildSections(rows: RawRow[], fileTerm: string): CourseSection[] {
  // Group: CRN → { firstRow, aggregated meetings }
  const order: string[] = [];
  const byCrn = new Map<
    string,
    { first: RawRow; agg: MeetingAgg }
  >();

  for (const row of rows) {
    if (!row.crn) continue;
    let entry = byCrn.get(row.crn);
    if (!entry) {
      entry = {
        first: row,
        agg: {
          daysSet: [],
          starts: [],
          ends: [],
          rooms: [],
          campuses: [],
          instructors: [],
        },
      };
      byCrn.set(row.crn, entry);
      order.push(row.crn);
    }
    // Merge meeting fields from every row (first + continuation).
    const days = normalizeDays(row.days);
    if (days && !entry.agg.daysSet.includes(days)) entry.agg.daysSet.push(days);
    const { start, end } = parseTimeRange(row.time);
    if (start) entry.agg.starts.push(start);
    if (end) entry.agg.ends.push(end);
    if (row.room && !entry.agg.rooms.includes(row.room))
      entry.agg.rooms.push(row.room);
    if (row.campus && !entry.agg.campuses.includes(row.campus))
      entry.agg.campuses.push(row.campus);
    if (row.instructor && !entry.agg.instructors.includes(row.instructor))
      entry.agg.instructors.push(row.instructor);
  }

  const sections: CourseSection[] = [];
  for (const crn of order) {
    const { first, agg } = byCrn.get(crn)!;
    const parsed = parseCourse(first.course);
    if (!parsed) continue; // skip rows whose course code can't be read

    const creditsNum = Number.parseFloat(first.credits);
    const campus =
      agg.campuses[0] ?? first.campus ?? "";
    const room = agg.rooms.join("; ");
    const location = [
      agg.campuses.length ? agg.campuses.join("; ") : "",
      room,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    const instructor =
      agg.instructors.length > 0 ? agg.instructors.join("; ") : null;

    sections.push({
      college_code: COLLEGE_SLUG,
      term: fileTerm,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: parsed.title,
      credits: Number.isFinite(creditsNum) ? creditsNum : 0,
      crn,
      days: agg.daysSet.join(""),
      start_time: agg.starts[0] ?? "",
      end_time: agg.ends[0] ?? "",
      start_date: parseStartDate(first.dateRange),
      location: location || campus,
      campus,
      mode: deriveMode(campus, room),
      instructor,
      seats_open: null, // not published by College of Marin
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }
  return sections;
}

function parseArgs(argv: string[]): { term?: string } {
  const out: { term?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--term" && argv[i + 1]) {
      out.term = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cookieJar: string[] = [];

  console.log("Fetching College of Marin schedule search page...");
  const vs = await fetchSearchPage(cookieJar);
  console.log(
    `  viewstate ${(vs.viewState.length / 1024).toFixed(0)} KB; ` +
      `terms: ${vs.terms.map((t) => `${t.label}=${t.option}`).join(", ")}`,
  );

  // Resolve which terms to scrape.
  let targetTerms = vs.terms;
  if (args.term) {
    const wantFile = normalizeTermArg(args.term);
    if (!wantFile) {
      throw new Error(
        `Unrecognized --term "${args.term}". Use e.g. 2026FA, "Fall 2026", or 202680.`,
      );
    }
    const wantOption = FILE_TERM_TO_OPTION[wantFile];
    targetTerms = vs.terms.filter(
      (t) => OPTION_TO_FILE_TERM[t.option] === wantFile || t.option === wantOption,
    );
    if (targetTerms.length === 0) {
      throw new Error(
        `Term ${wantFile} is not currently published by College of Marin ` +
          `(available: ${vs.terms.map((t) => t.label).join(", ")}).`,
      );
    }
  }

  let wroteAny = false;
  for (const term of targetTerms) {
    const fileTerm = OPTION_TO_FILE_TERM[term.option];
    if (!fileTerm) {
      console.warn(`  ! unknown term option ${term.option} (${term.label}); skipping`);
      continue;
    }
    console.log(`\n${term.label} (${term.option} → ${fileTerm})`);
    const html = await postSearch(vs, term.option, cookieJar);
    const rawRows = parseGrid(html);
    console.log(`  grid rows: ${rawRows.length}`);
    const sections = buildSections(rawRows, fileTerm);
    console.log(`  distinct sections (by CRN): ${sections.length}`);

    if (sections.length === 0) {
      console.warn(`  ! no sections parsed for ${fileTerm}; writing nothing`);
      continue;
    }

    fs.mkdirSync(DATA_DIR, { recursive: true });
    const outPath = path.join(DATA_DIR, `${fileTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    wroteAny = true;
    const sample = sections.find((s) => s.days) ?? sections[0];
    console.log(
      `  wrote ${outPath} (${sections.length} sections)\n` +
        `  sample: ${sample.course_prefix} ${sample.course_number} "${sample.course_title}" ` +
        `CRN ${sample.crn} [${sample.mode}] days="${sample.days}" ` +
        `${sample.start_time || "—"}-${sample.end_time || "—"}`,
    );
  }

  if (!wroteAny) {
    console.error("No data written.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
