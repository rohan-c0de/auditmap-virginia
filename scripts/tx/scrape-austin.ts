/**
 * Austin Community College District — bespoke HTML scrape
 *
 * ACC publishes its public credit class schedule through a custom PHP app at
 * `https://www6.austincc.edu/schedule/`. There is no JSON API and no SIS guest
 * portal — the schedule is rendered server-side as one HTML page per
 * (term × discipline). We browse each discipline within each chosen term:
 *
 *   /schedule/index.php?op=browse&opclass=<OPCLASS>&term=<TERM>&disciplineid=<DID>&yr=<RY>&ct=CC
 *
 * Discovery (all from the schedule landing page, which IS the discipline
 * directory):
 *   - TERMS come from the "Credit Terms" links, e.g. term=226F000 (Fall 2026),
 *     226S000 (Spring 2026), 226U000 (Summer 2026), 227S000 (Spring 2027),
 *     227U000 (Summer 2027). We scrape every credit term the landing page lists.
 *   - DISCIPLINES come from the discipline directory <li><a> links, each of
 *     which carries its own opclass + disciplineid + reporting-year (yr). Most
 *     use opclass=ViewSched; a handful of interdisciplinary tracks reuse
 *     disciplineid=TFIND under opclass=ViewSched_ADS / _AMS / _GLS / _inds /
 *     _MAS / _PAC. We preserve each link's opclass verbatim — using the wrong
 *     opclass (e.g. ViewSched_Base) returns a filtered subset (83 vs 200 rows
 *     for Accounting), so we never rewrite it.
 *   - We swap only `term` into each discipline link to fetch that discipline in
 *     a different term; opclass/disciplineid/yr stay as the directory gives them.
 *
 * Page structure (parsed with cheerio, not regex):
 *   - Courses are <h4><a …coursedetails…>ACCT 2301 Principles of Accounting I…</a>
 *   - Section meetings are <table class="section_line_odd|even"> — each table is
 *     exactly ONE <tr> = one meeting line. A section's FIRST meeting line carries
 *     the synonym (CRN) in column 4 and the section number in column 6; any
 *     immediately-following tables with an EMPTY synonym column are additional
 *     meeting patterns (Lab/secondary) of that SAME section, which we merge.
 *   - Session date ranges come from <p class="teach_term">16 Week Session: …</p>
 *     but each row also carries its own begin/end dates, so we read those.
 *   Column map (0-based, after stripping tags):
 *     [0] seats available   [1] status (R/B/D/P)   [2] flag (+/baseline)
 *     [3] [enrolled/capacity/waitlist]   [4] synonym (CRN)   [5] type (Lec/Lab/DIL)
 *     [6] section number   [7] campus (linked)   [8] building   [9] room
 *     [10] days   [11] time "1:30pm- 2:50pm"   [12] begin date   [13] end date
 *     [14..] Syllabus / Textbooks / Register links (optional)
 *
 * Not available in this view (left null / default): instructor name, credit
 * hours, and prerequisites — none appear in the schedule table. Credits default
 * to 0 and instructor to null per the shared CourseSection contract.
 *
 * Output: data/tx/courses/austin-community-college-district/<TERMCODE>.json,
 * grouped by term, matching every other state's CourseSection schema.
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-austin.ts                       # all terms, all disciplines
 *   npx tsx scripts/tx/scrape-austin.ts --max-disciplines=3   # smoke test
 *   npx tsx scripts/tx/scrape-austin.ts --term=226S000        # one term only
 */
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
// cheerio 1.2 doesn't re-export the node types as `cheerio.*` — import directly.
import type { AnyNode, Element } from "domhandler";

const SLUG = "austin-community-college-district";
const STATE = "tx";
const BASE = "https://www6.austincc.edu/schedule/";
const LANDING = `${BASE}index.php`;
const OUT_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type CourseMode = "in-person" | "online" | "hybrid" | "zoom";

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
  mode: CourseMode;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** "226F000" → "2026FA"; "226S000" → "2026SP"; "226U000" → "2026SU"; "227S000" → "2027SP". */
function termCodeToFile(term: string): string | null {
  // ACC term codes are 7 chars: "22" + <Y> + <SEASON> + "000", where <Y> is the
  // last digit of the calendar year (giving 202<Y>) and SEASON ∈ {F,S,U}.
  // Observed:
  //   226F000 Fall 2026 · 226S000 Spring 2026 · 226U000 Summer 2026
  //   227S000 Spring 2027 · 227U000 Summer 2027
  const m = term.match(/^22(\d)([FSU])000$/);
  if (!m) return null;
  const year = `202${m[1]}`;
  const season: Record<string, string> = { F: "FA", S: "SP", U: "SU" };
  const s = season[m[2]];
  if (!s) return null;
  return `${year}${s}`;
}

/**
 * ACC's `yr` query param is the academic-year tail (the spring/summer calendar
 * year of the academic year the term belongs to). Empirically: Fall 2026 →
 * yr=2027, Spring 2027 → yr=2027, Spring 2026 → yr=2026, Summer 2026 → yr=2026.
 * So Fall maps to year+1; Spring/Summer map to the same year. Used only as a
 * fallback when the directory link omits the value.
 */
function deriveReportingYear(term: string): string {
  const f = termCodeToFile(term);
  if (!f) return "";
  const year = parseInt(f.slice(0, 4), 10);
  const season = f.slice(4);
  return String(season === "FA" ? year + 1 : year);
}

interface DisciplineLink {
  opclass: string;
  disciplineid: string;
  yr: string;
  name: string;
}

interface TermLink {
  term: string;
  label: string;
}

async function fetchHtml(url: string): Promise<string> {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status >= 500 && res.status < 600) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} (non-retryable)`);
      return await res.text();
    } catch (e) {
      attempt++;
      const msg = e instanceof Error ? e.message : String(e);
      // Only retry transient 5xx / network errors a few times.
      if (attempt > 3 || msg.includes("non-retryable")) throw e;
      await sleep(1500 * attempt);
    }
  }
}

/**
 * Parse the schedule landing page (the discipline directory). Returns the list
 * of credit terms and the discipline links (with their own opclass/yr).
 */
function parseLanding(html: string): {
  terms: TermLink[];
  disciplines: DisciplineLink[];
} {
  const $ = cheerio.load(html);
  const terms: TermLink[] = [];
  const seenTerm = new Set<string>();
  const disciplines: DisciplineLink[] = [];
  const seenDisc = new Set<string>();

  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href.includes("op=browse")) return;
    const label = $(el).text().trim();

    // Discipline directory link: has disciplineid + opclass (+ yr). Term codes are
    // 7 chars: "22" + year-digit + season-letter + "000" (e.g. 226F000). NOTE the
    // `yr` reporting-year value may be empty on the no-discipline browse landing
    // (rendered as `yr=&ct=CC`); it is populated only on the bare-root directory.
    // We capture it when present and otherwise derive it from the term, since the
    // schedule rows themselves don't depend on a correct yr.
    const dm = href.match(
      /opclass=(ViewSched[A-Za-z_]*)&term=(22\d[FSU]000)&disciplineid=([A-Z0-9]+)&yr=(\d{0,4})/
    );
    if (dm) {
      const key = `${dm[1]}|${dm[3]}`;
      if (!seenDisc.has(key)) {
        seenDisc.add(key);
        disciplines.push({
          opclass: dm[1],
          disciplineid: dm[3],
          yr: dm[4] || deriveReportingYear(dm[2]),
          name: label,
        });
      }
      // Also register the term that appears on directory links.
      if (!seenTerm.has(dm[2])) {
        seenTerm.add(dm[2]);
      }
      return;
    }

    // "Credit Terms" link: top-level term selector, opclass=ViewSched (no
    // disciplineid). These give us the human label (e.g. "Fall 2026").
    const tm = href.match(/opclass=ViewSched&term=(22\d[FSU]000)&ct=CC&snid=/);
    if (tm) {
      if (!seenTerm.has(tm[1])) {
        seenTerm.add(tm[1]);
      }
      // Always record/update the friendly label for this term.
      const existing = terms.find((t) => t.term === tm[1]);
      if (existing) {
        if (label) existing.label = label;
      } else {
        terms.push({ term: tm[1], label: label || tm[1] });
      }
    }
  });

  // If the friendly "Credit Terms" list didn't enumerate every term that shows
  // up on directory links, fall back to the directory-link term set so we don't
  // silently miss a term.
  for (const t of seenTerm) {
    if (!terms.find((x) => x.term === t)) {
      terms.push({ term: t, label: t });
    }
  }

  return { terms, disciplines };
}

/** Clean a table cell's inner HTML to plain text. */
function cellText($: cheerio.CheerioAPI, td: AnyNode): string {
  return $(td)
    .text()
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse "1:30pm- 2:50pm" → { start, end }. Returns blanks if not a time range. */
function parseTime(raw: string): { start: string; end: string } {
  const s = raw.replace(/\s+/g, " ").trim();
  const m = s.match(/(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
  if (!m) return { start: "", end: "" };
  const norm = (x: string) => x.replace(/\s+/g, "").toLowerCase();
  return { start: norm(m[1]), end: norm(m[2]) };
}

/** ACC campus location-id → friendly name (for the `campus` field). */
const CAMPUS_NAMES: Record<string, string> = {
  CYP: "Cypress Creek Campus",
  EVC: "Eastview Campus",
  EGN: "Elgin Campus",
  HYS: "Hays Campus",
  HLC: "Highland Campus",
  LKH: "Lakeway Campus",
  NRG: "Northridge Campus",
  RGC: "Rio Grande Campus",
  RVS: "Riverside Campus",
  RRC: "Round Rock Campus",
  SGC: "San Gabriel Campus",
  SAC: "South Austin Campus",
  ONL: "Online",
  DIL: "Distance Learning",
  HYD: "Hybrid",
  DLS: "Synchronous Virtual",
  DLC: "Distance Learning",
  LKT: "Lakeway Campus",
};

/**
 * Decide delivery mode from a section's location tokens (campus/building/room).
 * ACC's campus codes encode the modality:
 *   DLS = Distance Learning Synchronous (scheduled Zoom) → "zoom"
 *   HYD = Hybrid → "hybrid"
 *   ONL / DIL = fully online / Distance Learning (async) → "online"
 *   anything else (CYP/HLC/RRC/…) = a physical campus → "in-person"
 */
function classifyMode(
  locationTokens: string[],
  days: string,
  hasRoom: boolean
): CourseMode {
  const c = locationTokens.join(" ").toUpperCase();
  if (/\bHYD\b|HYBRID/.test(c)) return "hybrid";
  if (/\bDLS\b|ZOOM|SYNCHRON/.test(c)) return "zoom";
  if (/\bONL\b|\bDIL\b|\bDL\b/.test(c)) return "online";
  // Defensive: a physical-campus row with no room and no meeting days is most
  // likely a distance section we didn't catch by code — treat as online.
  if (!hasRoom && days.trim().length === 0 && locationTokens.length === 0) {
    return "online";
  }
  return "in-person";
}

/** Read one <table class="section_line_*"> into its single row of cell texts. */
function readSectionRow($: cheerio.CheerioAPI, table: AnyNode): string[] | null {
  const tr = $(table).find("tr").first();
  if (!tr.length) return null;
  const tds = tr.find("td").toArray();
  if (tds.length < 6) return null;
  return tds.map((td) => cellText($, td));
}

/** Is this a fresh section (has a 5-digit synonym in col 4)? */
function isPrimaryRow(cells: string[]): boolean {
  return /^\d{4,6}$/.test((cells[4] || "").trim());
}

const LINK_LABELS = new Set(["syllabus", "textbooks", "register", "bookstore"]);
const DATE_RE = /^[A-Z][a-z]{2}\s+\d{1,2}$/; // "Jan 20"
const TIME_RE = /\d{1,2}:\d{2}\s*[ap]m\s*-\s*\d{1,2}:\d{2}\s*[ap]m/i;
const DAYS_RE = /^(?:M|T|W|R|F|S|U|Th|Tu|Sa|Su|MW|TTh|MWF|MTWThF?|MTWTh|TWThF?)$/;

interface Meeting {
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string;
  /** Tokens between the section column and the days/time block: campus/bldg/room. */
  locationTokens: string[];
}

/**
 * Extract the meeting fields from one section row, robust to the variable middle.
 *
 * ACC renders two primary-row layouts that differ ONLY by whether a `room`
 * column is present:
 *   on-campus (14 data cols): …§ section | campus | building | room | days | time | start | end
 *   online    (13 data cols): …§ section | campus | building | days | time | start | end
 * For pure-async online rows the days/time cells are empty. The trailing
 * Syllabus/Textbooks/Register links are optional. Rather than index from the
 * left (which breaks on the missing room column), we trim trailing link/empty
 * cells, then read the meeting block from the RIGHT: the last two data cells are
 * always start/end dates, preceded by time then days. Everything between the
 * section column (index 6) and the days cell is the location.
 */
const ISO_MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
/**
 * Normalize a schedule date to ISO YYYY-MM-DD. ACC prints dates as "Aug 24"
 * (no year); the year comes from the term-file code ("2026FA" → 2026). The
 * Supabase courses table types start_date as `date`, so a bare "Aug 24" is
 * rejected at import — every start_date must be ISO or "".
 */
function toIsoDate(raw: string, termFile: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw; // already ISO
  const m = raw.trim().match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})$/);
  const mon = m ? ISO_MONTHS[m[1].slice(0, 3).toLowerCase()] : undefined;
  const year = termFile.slice(0, 4);
  if (!m || !mon || !/^\d{4}$/.test(year)) return "";
  return `${year}-${mon}-${m[2].padStart(2, "0")}`;
}

function extractMeeting(cells: string[]): Meeting {
  // Trim trailing link columns and empties.
  let end = cells.length;
  while (
    end > 0 &&
    (cells[end - 1] === "" || LINK_LABELS.has(cells[end - 1].toLowerCase()))
  ) {
    end--;
  }
  const data = cells.slice(0, end);

  let start_date = "";
  let end_date = "";
  let start_time = "";
  let end_time = "";
  let days = "";
  let cut = data.length; // index where the location tokens stop

  // Find the date pair at the tail. The last two date-shaped cells are
  // start/end; the time (if any) sits just before, and days just before that.
  const dateIdxs: number[] = [];
  for (let i = data.length - 1; i >= 7 && dateIdxs.length < 2; i--) {
    if (DATE_RE.test(data[i])) dateIdxs.unshift(i);
    else if (dateIdxs.length > 0) break; // dates are contiguous at the tail
  }
  if (dateIdxs.length === 2) {
    start_date = data[dateIdxs[0]];
    end_date = data[dateIdxs[1]];
    cut = dateIdxs[0];
    // Cell immediately before start_date may be a time range.
    let i = dateIdxs[0] - 1;
    if (i >= 7 && TIME_RE.test(data[i])) {
      const t = parseTime(data[i]);
      start_time = t.start;
      end_time = t.end;
      cut = i;
      i--;
    }
    // Cell before the time may be the day pattern.
    if (i >= 7 && DAYS_RE.test(data[i].replace(/\s+/g, ""))) {
      days = data[i].replace(/\s+/g, "");
      cut = i;
      i--;
    }
  } else if (dateIdxs.length === 1) {
    start_date = data[dateIdxs[0]];
    cut = dateIdxs[0];
  }

  const locationTokens = data.slice(7, cut).map((x) => x.trim()).filter(Boolean);
  return { days, start_time, end_time, start_date, end_date, locationTokens };
}

interface CourseHeading {
  prefix: string;
  number: string;
  title: string;
}

function parseHeading(text: string): CourseHeading | null {
  const t = text.replace(/\s+/g, " ").trim();
  const m = t.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+(.*)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], title: m[3].trim() };
}

/**
 * Parse one discipline page into CourseSection[]. Walks the document in order so
 * each <table.section_line> is attributed to the most recent course <h4>.
 */
function parseDisciplinePage(html: string, termFile: string): CourseSection[] {
  const $ = cheerio.load(html);
  const out: CourseSection[] = [];

  let curCourse: CourseHeading | null = null;
  let lastSection: CourseSection | null = null;

  // Walk every relevant node in document order. We select h4 course headings
  // and section_line tables together and dispatch by tag.
  const nodes = $("h4, table.section_line_odd, table.section_line_even").toArray();

  for (const node of nodes) {
    const tag = (node as Element).tagName || (node as Element).name;
    if (tag === "h4") {
      // Only course headings carry a coursedetails anchor.
      const a = $(node).find('a[href*="coursedetails"]').first();
      if (!a.length) continue;
      const h = parseHeading(a.text());
      if (h) curCourse = h;
      continue;
    }

    // section_line table
    if (!curCourse) continue;
    const c = readSectionRow($, node);
    if (!c) continue;

    if (isPrimaryRow(c)) {
      // New section.
      const synonym = (c[4] || "").trim();
      const type = (c[5] || "").trim();
      const sectionNo = (c[6] || "").trim();
      const m = extractMeeting(c);

      // locationTokens are [campus, building, room?] — the campus code is the
      // first token (3-letter code or ONL/DIL/DLS), the rest are building/room.
      const campusCode = m.locationTokens[0] || "";
      const building = m.locationTokens[1] || "";
      const room = m.locationTokens.slice(2).join(" ");

      const seats = parseEnroll(c[3] || "");
      const mode = classifyMode(m.locationTokens, m.days, room.length > 0);

      const campusName =
        CAMPUS_NAMES[campusCode] ||
        CAMPUS_NAMES[building] ||
        campusCode ||
        building ||
        "";
      const location = m.locationTokens.join(" ") || campusName;

      const crn =
        synonym ||
        `${curCourse.prefix}-${curCourse.number}-${sectionNo || type || "NA"}`;

      const sec: CourseSection = {
        college_code: SLUG,
        term: termFile,
        course_prefix: curCourse.prefix,
        course_number: curCourse.number,
        course_title: curCourse.title,
        credits: 0, // not published in the schedule table view
        crn,
        days: m.days,
        start_time: m.start_time,
        end_time: m.end_time,
        start_date: toIsoDate(m.start_date, termFile),
        location,
        campus: campusName,
        mode,
        instructor: null, // not published in the schedule table view
        seats_open: seats.open,
        seats_total: seats.total,
        prerequisite_text: null,
        prerequisite_courses: [],
      };
      out.push(sec);
      lastSection = sec;
    } else if (lastSection) {
      // Follow-on meeting line (Lab / secondary pattern) of the current section.
      // Only one meeting is surfaced per the CourseSection contract, so we fill
      // the primary's days/time from a follow-on row ONLY when the primary had
      // none (e.g. the lecture line was online with no time but the lab meets).
      const m = extractMeeting(c);
      if (m.days && !lastSection.days) lastSection.days = m.days;
      if (m.start_time && !lastSection.start_time) {
        lastSection.start_time = m.start_time;
        lastSection.end_time = m.end_time;
      }
    }
  }

  return out;
}

/**
 * Parse the enrollment bracket → {open, total}. ACC uses two shapes:
 *   "[15/24/0]"  enrolled / capacity / waitlist
 *   "[18/24]"    enrolled / capacity (no waitlist column)
 * In both, the first number is enrolled and the second is the seat capacity.
 */
function parseEnroll(raw: string): { open: number | null; total: number | null } {
  const m = raw.match(/\[\s*(\d+)\s*\/\s*(\d+)(?:\s*\/\s*\d+)?\s*\]/);
  if (!m) return { open: null, total: null };
  const enrolled = parseInt(m[1], 10);
  const capacity = parseInt(m[2], 10);
  if (!Number.isFinite(capacity)) return { open: null, total: null };
  const open = Math.max(0, capacity - (Number.isFinite(enrolled) ? enrolled : 0));
  return { open, total: capacity };
}

function buildDisciplineUrl(d: DisciplineLink, term: string): string {
  const qs = new URLSearchParams({
    op: "browse",
    opclass: d.opclass,
    term,
    disciplineid: d.disciplineid,
    yr: d.yr,
    ct: "CC",
  });
  return `${LANDING}?${qs.toString()}`;
}

function dedupeKey(s: CourseSection): string {
  // crn is the synonym for real sections (globally unique per term); fall back
  // to the composite for synthetic ones.
  return `${s.term}|${s.crn}|${s.course_prefix}-${s.course_number}`;
}

async function main() {
  const args = process.argv.slice(2);
  const maxDisc = numArg(args, "--max-disciplines");
  const onlyTerm = strArg(args, "--term");

  console.log("🤘 Austin Community College District — schedule HTML sweep");
  console.log(`   landing: ${BASE}`);

  // The bare schedule root is the discipline directory; it renders fully-formed
  // links (populated `yr`) and the friendly "Credit Terms" labels. The
  // no-discipline browse URL works too but omits the `yr` value.
  const landingHtml = await fetchHtml(BASE);
  let { terms, disciplines } = parseLanding(landingHtml);

  if (onlyTerm) {
    terms = terms.filter((t) => t.term === onlyTerm);
  }
  if (maxDisc) {
    disciplines = disciplines.slice(0, maxDisc);
  }

  // Keep only terms that map to a known YEAR+SEASON file code.
  const usableTerms = terms.filter((t) => termCodeToFile(t.term));
  console.log(
    `   terms: ${usableTerms
      .map((t) => `${t.term}(${termCodeToFile(t.term)})`)
      .join(", ")}`
  );
  console.log(`   disciplines: ${disciplines.length}`);

  const byTerm = new Map<string, Map<string, CourseSection>>();

  for (const t of usableTerms) {
    const termFile = termCodeToFile(t.term)!;
    if (!byTerm.has(termFile)) byTerm.set(termFile, new Map());
    const bucket = byTerm.get(termFile)!;

    let done = 0;
    for (const d of disciplines) {
      const url = buildDisciplineUrl(d, t.term);
      let html: string;
      try {
        html = await fetchHtml(url);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`   ⚠️  ${t.term}/${d.disciplineid} (${d.opclass}): ${msg}`);
        continue;
      }
      const secs = parseDisciplinePage(html, termFile);
      for (const s of secs) bucket.set(dedupeKey(s), s);
      done++;
      if (done % 20 === 0 || done === disciplines.length) {
        console.log(
          `   [${termFile}] ${done}/${disciplines.length} disciplines · ${bucket.size} sections so far`
        );
      }
      await sleep(250); // gentle pacing between requests
    }
    console.log(`   [${termFile}] complete: ${bucket.size} sections`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let grand = 0;
  const summary: Array<{ term: string; sections: number }> = [];
  for (const [term, m] of [...byTerm.entries()].sort()) {
    const sections = [...m.values()];
    if (sections.length === 0) {
      console.log(`   (skip ${term}: 0 sections — leaving any existing file untouched)`);
      continue;
    }
    const outFile = path.join(OUT_DIR, `${term}.json`);
    fs.writeFileSync(outFile, JSON.stringify(sections, null, 2) + "\n");
    console.log(`   ✓ ${term}: ${sections.length} sections → ${outFile}`);
    summary.push({ term, sections: sections.length });
    grand += sections.length;
  }
  console.log(`\n✅ ${grand} sections across ${summary.length} terms.`);
}

function numArg(args: string[], flag: string): number | undefined {
  const v = args.find((a) => a.startsWith(`${flag}=`))?.split("=")[1];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function strArg(args: string[], flag: string): string | undefined {
  return args.find((a) => a.startsWith(`${flag}=`))?.split("=")[1];
}

main().catch((e) => {
  console.error("❌ Austin scraper failed:", e);
  process.exit(1);
});
