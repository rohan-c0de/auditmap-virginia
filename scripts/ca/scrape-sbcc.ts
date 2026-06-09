/**
 * Santa Barbara City College (SBCC) course-section scraper.
 *
 * Source: SBCC's public "Class Schedule Search", an Oracle Banner 8 schedule
 * exposed through a CUSTOM ORDS PL/SQL package `pw_pub_sched` at
 *   https://banner.sbcc.edu/ords/ssb/pw_pub_sched.p_search
 * NO login, no cookies, pure HTTP. (The stock Banner `bwckschd` endpoints 500
 * on this instance — only the `pw_pub_sched` package family works here.)
 *
 * Procedures used:
 *   - pw_pub_sched.p_search        — the search form. A bare GET returns the
 *     term/level picker; POSTing `term`+`level` returns the full query form with
 *     the real subject/instructor/attribute option lists. We GET it once to read
 *     the term <select> (term code -> human label, e.g. 202730 -> "Fall 2026").
 *   - pw_pub_sched.p_listthislist  — the results listing. GET (or POST) with the
 *     full parameter set returns an HTML page with one <h3> heading per course
 *     ("ACCT 110 - Introduction to Accounting (4 Units)") followed by a section
 *     table. We parse that table with cheerio.
 *   - pw_pub_sched.p_course_popup  — referenced only as the CRN link target
 *     (vsub/vcrse/vterm/vcrn); we read the CRN out of that href, we don't fetch it.
 *
 * THE PARAMETER RECIPE (the non-obvious part). `p_listthislist` binds every
 * multi-select (`sel_subj`, `sel_ptrm`, `sel_ism`, `sel_instr`, `sel_attr`) to a
 * PL/SQL `owa_util.ident_arr`. The browser form sends, for each, a leading
 * `=dummy` (a hidden placeholder the proc skips) AND the real selected value(s).
 * To pull ALL sections we send the wildcard `%` as the real value for each:
 *     sel_subj=dummy ... sel_ptrm=dummy ... sel_attr=dummy   (the dummies)
 *     sel_subj=%  sel_ptrm=%  sel_ism=%  sel_instr=%  sel_attr=%   (the wildcards)
 * Sending only the `=dummy` (no trailing `%`) makes the proc match ZERO rows
 * (a clean empty "End of report" page, not an error) — this silently looks like
 * "the term has no classes". The proven recipe is taken from SBCC's own
 * Google-indexed result URLs. `begin_hh/end_hh` bound the meeting-time window
 * (we use the form defaults 5am-11pm, which include async/online sections too).
 *
 * One `p_listthislist` request per (term, level) returns the WHOLE term's
 * sections for that level (a few-MB page; ~1,500 credit sections for a fall
 * term). SBCC splits the schedule into three levels — Credit (CR), Noncredit
 * (NC), Adult HS/GED (AH); we fetch and merge all three so noncredit/adult-ed
 * sections aren't dropped.
 *
 * RESULTS TABLE shape (logical columns, colspan-aware):
 *   Status | I | CRN | Units | Type | M T W R F S U | Time | Location |
 *   Cap | Act | WL-Cap | WL-Act | Instructor | Date | Weeks | (link)
 * The primary row of a section carries the CRN link, Units, Cap/Act, Instructor,
 * Date, and its first meeting. A multi-meeting section (e.g. Lec + Lab) renders
 * extra rows with a blank Status/CRN (a leading colspan=4 cell) and only the
 * meeting block (Type, days, time, location). We aggregate continuation rows
 * under the active CRN. ASYNC/online meetings render the day+time block as a
 * single colspan=8 cell ("6.3 hours/week") with Location "ONLINE".
 *
 * Field mapping:
 *   - credits     = Units (e.g. "4.0" -> 4)
 *   - days        = the marked day cells (M Tu W Th F Sa Su); "" if async
 *   - start/end   = parsed from "09:35am - 10:55am"; "" if async
 *   - start_date  = the section's Date range start ("01/26-05/23" -> 2026-01-26),
 *                   year inferred from the term.
 *   - location    = the representative meeting's room ("EBS 309"); "ONLINE" kept
 *                   verbatim as the only place hint for online sections.
 *   - seats_total = Cap; seats_open = max(Cap - Act, 0).
 *   - instructor  = normalized "First Last" -> "Last, First" (matches the CA
 *                   convention); "Staff"/blank -> "Staff"/null.
 *   - prerequisite_text = the "Prerequisites:" sentence from the course's
 *                   description block (the <td class="crse desc"> before the table).
 *   - mode        = derived from Type / location / meeting pattern:
 *                   ONLINE async -> online; a meeting room of ZOOM/REMOTE -> zoom;
 *                   both in-person and online meetings -> hybrid; else in-person.
 *
 * Output: data/ca/courses/santa-barbara-city-college/<TERM>.json
 * TERM ∈ { "<year>FA", "<year>SP", "<year>SU" } (Fall 2026 -> 2026FA, etc.).
 *
 * By default scrapes every UPCOMING term the form exposes that is >= the latest
 * published term in the picker (the picker keeps a long history; we don't
 * re-scrape past terms). `--term` targets one specific term (output string e.g.
 * 2026FA, or raw SBCC code e.g. 202730). `--all-terms` scrapes every term the
 * form exposes (history included) — for backfills.
 *
 * Pure HTTP + cheerio — no Supabase, no Playwright. Idempotent: rewrites each
 * term file from scratch. NEVER writes a stub: a term that yields zero rows, or
 * whose fetch fails, is skipped and nothing is written for it.
 *
 * Usage:
 *   tsx scripts/ca/scrape-sbcc.ts                  # upcoming terms only
 *   tsx scripts/ca/scrape-sbcc.ts --term 2026FA
 *   tsx scripts/ca/scrape-sbcc.ts --term 202730    # raw SBCC term code also OK
 *   tsx scripts/ca/scrape-sbcc.ts --all-terms      # full history (backfill)
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
// cheerio 1.2 doesn't re-export the DOM node type as `cheerio.Element`; import it
// directly from domhandler (same pattern as scripts/ca/scrape-cerritos.ts).
import type { Element } from 'domhandler';

const COLLEGE_CODE = 'santa-barbara-city-college';
const CAMPUS = 'Main';
const BASE = 'https://banner.sbcc.edu/ords/ssb';
const SEARCH_URL = `${BASE}/pw_pub_sched.p_search`;
const LIST_URL = `${BASE}/pw_pub_sched.p_listthislist`;
const OUT_DIR = join(process.cwd(), 'data', 'ca', 'courses', COLLEGE_CODE);

// SBCC's three schedule levels. Each must be queried separately; merged on write.
const LEVELS = ['CR', 'NC', 'AH'] as const;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---------- output row contract ----------

interface CourseRow {
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
  mode: 'in-person' | 'online' | 'hybrid' | 'zoom';
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface TermOption {
  id: string; // raw SBCC term code e.g. "202730"
  label: string; // human label e.g. "Fall 2026"
  outTerm: string; // normalized e.g. "2026FA"
  season: 'FA' | 'SP' | 'SU';
  year: number;
}

// ---------- HTTP with retry ----------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_RETRIES = 4;

async function fetchText(url: string, init: RequestInit, label: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        // 4xx is a real error (don't retry); 5xx is transient (retry).
        if (res.status < 500 || attempt === MAX_RETRIES) throw new Error(`HTTP ${res.status} ${label}`);
        lastErr = new Error(`HTTP ${res.status} ${label}`);
      } else {
        return await res.text();
      }
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_RETRIES) break;
    }
    await sleep(700 * 2 ** attempt); // 0.7s, 1.4s, 2.8s, 5.6s
  }
  throw new Error(`${label} failed after ${MAX_RETRIES + 1} attempts: ${(lastErr as Error)?.message}`);
}

function getHtml(url: string): Promise<string> {
  return fetchText(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' } }, `GET ${url}`);
}

/**
 * Build the `p_listthislist` query string for one (term, level), all subjects.
 * Field order mirrors the live form's DOM order; each multi-select gets a leading
 * `dummy` and a trailing `%` wildcard (the proven recipe — see file header).
 */
function buildListUrl(term: TermOption, level: string): string {
  const p = new URLSearchParams();
  p.append('TERM', term.id);
  p.append('TERM_DESC', term.label);
  p.append('sel_subj', 'dummy');
  p.append('sel_day', 'dummy');
  p.append('sel_schd', 'dummy');
  p.append('sel_camp', 'dummy');
  p.append('sel_ism', 'dummy');
  p.append('sel_sess', 'dummy');
  p.append('sel_instr', 'dummy');
  p.append('sel_ptrm', 'dummy');
  p.append('level', level);
  p.append('sel_attr', 'dummy');
  // Real wildcard values for each ident_arr-bound multi-select.
  p.append('sel_subj', '%');
  p.append('sel_crse', '');
  p.append('sel_crn', '');
  p.append('sel_title', '');
  p.append('sel_ptrm', '%');
  p.append('sel_ism', '%');
  p.append('sel_instr', '%');
  p.append('sel_attr', '%');
  // Meeting-time window: form defaults 5:00am - 11:00pm (covers async too).
  p.append('begin_hh', '5');
  p.append('begin_mi', '0');
  p.append('begin_ap', 'a');
  p.append('end_hh', '11');
  p.append('end_mi', '0');
  p.append('end_ap', 'p');
  // Filter toggles, all "no" so nothing is excluded.
  p.append('aa', 'N'); // Open classes only
  p.append('bb', 'N');
  p.append('sel_late_start', 'N');
  p.append('dd', 'N'); // Off-campus only
  p.append('ee', 'N'); // Online only
  p.append('gg', 'N'); // On-campus only
  return `${LIST_URL}?${p.toString()}`;
}

// ---------- term discovery ----------

// SBCC term codes encode the term as YYYYNN (30=Fall, 50=Spring, 10/15=Summer,
// e.g. 202730 -> Fall 2026, 202650 -> Spring 2026). We don't derive the calendar
// year from the code, though — the human label is authoritative (see below) and
// avoids the off-by-one academic-year anchor; the code is used only as the
// opaque query key.

/**
 * Parse a human term label ("Fall 2026", "Summer I 2022") -> output TERM string.
 * This is the authoritative path (the label carries the real calendar year);
 * the numeric-code derivation above is only a cross-check / fallback.
 */
function termLabelToOutput(label: string): { outTerm: string; season: 'FA' | 'SP' | 'SU'; year: number } | null {
  const m = label.match(/(Fall|Spring|Summer)(?:\s+(?:I|II))?\s+(\d{4})/i);
  if (!m) return null; // Winter/intersession not modeled
  const season = m[1].toLowerCase();
  const year = Number.parseInt(m[2], 10);
  const out =
    season === 'fall' ? 'FA' : season === 'spring' ? 'SP' : 'SU';
  return { outTerm: `${year}${out}`, season: out, year };
}

function parseTermOptions(html: string): TermOption[] {
  const $ = cheerio.load(html);
  const out: TermOption[] = [];
  const seen = new Set<string>();
  $('select[name="term"] option').each((_, el) => {
    const id = ($(el).attr('value') || '').trim();
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    if (!id || !label) return;
    const parsed = termLabelToOutput(label);
    if (!parsed) return; // skip non FA/SP/SU
    if (seen.has(parsed.outTerm)) return; // collapse "Summer I/II" of a year
    seen.add(parsed.outTerm);
    out.push({ id, label, outTerm: parsed.outTerm, season: parsed.season, year: parsed.year });
  });
  return out;
}

// ---------- value parsing helpers ----------

const MONTHS_PER_SEASON: Record<'FA' | 'SP' | 'SU', number[]> = {
  // Months in which a section's date range may legitimately start.
  SP: [1, 2, 3, 4, 5],
  SU: [5, 6, 7, 8],
  FA: [8, 9, 10, 11, 12],
};

function parseUnits(text: string): number {
  const m = text.match(/([\d.]+)/);
  if (!m) return 0;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : 0;
}

/** "09:35am" -> "9:35 AM"; "" / unparseable -> "". */
function formatTime(raw: string): string {
  const s = raw.replace(/\s+/g, '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})\s*([ap])m?$/i);
  if (!m) return '';
  let h = Number.parseInt(m[1], 10);
  const min = m[2];
  const mer = m[3].toLowerCase();
  if (mer === 'p' && h !== 12) h += 12;
  if (mer === 'a' && h === 12) h = 0;
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${min} ${mer === 'p' ? 'PM' : 'AM'}`;
}

/**
 * Resolve the section's start date from the "MM/DD-MM/DD" range plus the term's
 * calendar year/season. SBCC date cells carry no year, so we infer it: the start
 * month maps onto the term's plausible months; a December start in a Fall term is
 * year Y, a January start in a Spring term is year Y, etc. Summer that spills into
 * the next calendar year never happens, so this is unambiguous.
 */
function resolveStartDate(range: string, term: TermOption): string {
  const m = range.match(/(\d{1,2})\/(\d{1,2})\b/);
  if (!m) return '';
  const mo = Number.parseInt(m[1], 10);
  const day = Number.parseInt(m[2], 10);
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return '';
  // Year inference: for all three seasons the start month falls within the same
  // calendar year as `term.year` (Spring Jan-May of year Y, Summer May-Aug of
  // year Y, Fall Aug-Dec of year Y). The plausible-month guard just drops a
  // garbled cell rather than emit a wrong date.
  const plausible = MONTHS_PER_SEASON[term.season];
  if (!plausible.includes(mo)) {
    // Tolerate a 1-month spillover (e.g. a late-start Fall section beginning in
    // early Jan of the next year, or a Spring section listed from late Dec).
    if (term.season === 'FA' && mo === 1) {
      return `${term.year + 1}-01-${String(day).padStart(2, '0')}`;
    }
    return ''; // unexpected — don't fabricate a date
  }
  return `${term.year}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toIntOrNull(s: string): number | null {
  const t = s.replace(/\s+/g, ' ').trim();
  const m = t.match(/-?\d+/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize an SBCC instructor string ("Jennifer  Maupin", "Eva  Schmidt") to the
 * CA "Last, First" convention. Multi-word first/middle names are folded into the
 * "First" part; a single token stays as-is; "Staff"/"TBA"/blank -> "Staff"/null.
 */
function normalizeInstructor(raw: string): string | null {
  const s = raw.replace(/\s+/g, ' ').replace(/&nbsp;/g, ' ').trim();
  if (!s) return null;
  if (/^(staff|tba|to be announced|to be determined)$/i.test(s)) return 'Staff';
  // Multiple instructors separated by "/" or ";" — keep as-is (rare), but try to
  // flip a clean single "First Last".
  if (/[\/;,]/.test(s)) return s; // already comma'd or multi -> leave
  const parts = s.split(' ').filter(Boolean);
  if (parts.length < 2) return s;
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(' ');
  return `${last}, ${first}`;
}

const DAY_CELL_TO_TOKEN: Record<string, string> = {
  M: 'M',
  T: 'Tu',
  W: 'W',
  R: 'Th',
  F: 'F',
  S: 'Sa',
  U: 'Su',
};

/** Pull "Prerequisites:" / "Prerequisite:" sentence from a course-description block. */
function extractPrereqText(descText: string): string | null {
  const t = descText.replace(/\s+/g, ' ').trim();
  // The description block lists labelled clauses separated by <BR> (collapsed to
  // spaces here). Capture the Prerequisite(s) clause up to the next labelled clause
  // — the boundary list must include EVERY label that can follow a prereq, or the
  // capture bleeds into the next clause (e.g. "...measures.Concurrent Corequisite:").
  const m = t.match(
    /Prerequisites?:\s*(.*?)(?=\s*(?:Concurrent\b|Corequisites?:|Course Advisor|Advisor|Recommended Prep|Limitation|Hours:|Transfer Information:|SBCC General|Grading Options:|$))/i,
  );
  if (!m) return null;
  const body = m[1].replace(/\s+/g, ' ').trim();
  if (!body) return null;
  return `Prerequisites: ${body}`;
}

// ---------- table parsing ----------

interface MeetingRow {
  type: string; // Lec / Lab / ...
  days: string; // token string e.g. "MW"
  startTime: string;
  endTime: string;
  room: string;
  isAsync: boolean; // colspan=8 "X hours/week" meeting (no day/time)
}

interface SectionAccum {
  crn: string;
  units: number;
  cap: number | null;
  act: number | null;
  instructor: string | null;
  startDate: string;
  meetings: MeetingRow[];
}

interface LogicalCell {
  col: number; // starting logical column index
  span: number; // colspan (>1 spans multiple logical columns)
  text: string;
  $td: cheerio.Cheerio<Element>;
}

/**
 * Read one results <tr> into an ordered list of logical cells.
 * colspan-aware: a colspan=N cell occupies N logical columns; we record it at its
 * starting index and advance the cursor by N.
 */
function readLogicalCells($: cheerio.CheerioAPI, tr: Element): LogicalCell[] {
  const cells: LogicalCell[] = [];
  let col = 0;
  $(tr)
    .find('> td')
    .each((_, td) => {
      const $td = $(td);
      const span = Number.parseInt($td.attr('colspan') || '1', 10) || 1;
      const text = $td.text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      cells.push({ col, span, text, $td });
      col += span;
    });
  return cells;
}

// Logical column indices (see file header). Column 0 = Status, 1 = info icon —
// neither is read, so they're not named here.
const C_CRN = 2;
const C_UNITS = 3;
const C_TYPE = 4;
const C_DAY_FIRST = 5; // M..U occupy 5..11
const C_TIME = 12;
const C_LOCATION = 13;
const C_CAP = 14;
const C_ACT = 15;
const C_INSTR = 18;
const C_DATE = 19;

/** Build a MeetingRow from a row's logical cells (handles async colspan=8). */
function parseMeeting(cells: LogicalCell[]): MeetingRow | null {
  const byCol = new Map<number, { text: string; $td: cheerio.Cheerio<Element> }>();
  for (const c of cells) byCol.set(c.col, { text: c.text, $td: c.$td });

  const type = (byCol.get(C_TYPE)?.text || '').trim();
  // Async case: a single cell spanning the day+time block (a colspan=8 cell whose
  // text is "X hours/week"). Detect by a "hours/week" / "hours" token in a cell
  // that starts within the day-block column range.
  const asyncCell = cells.find((c) => /hours?\/?\s*week|hours?\b/i.test(c.text) && c.col >= C_TYPE && c.col < C_TIME);
  // Room/location always sits at C_LOCATION.
  const room = (byCol.get(C_LOCATION)?.text || '').trim();

  // Day tokens: read cols 5..11 if present as separate cells.
  let days = '';
  for (let i = 0; i < 7; i++) {
    const cell = byCol.get(C_DAY_FIRST + i);
    if (!cell) continue;
    const letter = cell.text.trim().toUpperCase();
    if (DAY_CELL_TO_TOKEN[letter]) days += DAY_CELL_TO_TOKEN[letter];
  }

  const timeText = (byCol.get(C_TIME)?.text || '').trim();
  let startTime = '';
  let endTime = '';
  const tm = timeText.match(/(\d{1,2}:\d{2}\s*[ap]m?)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m?)/i);
  if (tm) {
    startTime = formatTime(tm[1]);
    endTime = formatTime(tm[2]);
  }

  const isAsync = !!asyncCell && !days && !startTime;

  // A row that carries neither a meeting block nor a room is not a meeting.
  if (!type && !days && !startTime && !room && !isAsync) return null;

  return { type, days, startTime, endTime, room, isAsync };
}

function deriveMode(meetings: MeetingRow[]): CourseRow['mode'] {
  const rooms = meetings.map((m) => m.room.toUpperCase());
  const anyZoom = rooms.some((r) => /ZOOM|REMOTE/.test(r));
  const anyOnlineRoom = rooms.some((r) => /^ONLINE\b|^OL\b|WEB/.test(r));
  const anyAsync = meetings.some((m) => m.isAsync);
  const anyInPerson = meetings.some(
    (m) => !m.isAsync && (m.days || m.startTime) && !/^ONLINE\b|ZOOM|REMOTE|^TBA\b|^ARR/.test(m.room.trim().toUpperCase()),
  );

  if (anyInPerson && (anyOnlineRoom || anyAsync || anyZoom)) return 'hybrid';
  if (anyZoom && !anyInPerson) return 'zoom';
  if ((anyOnlineRoom || anyAsync) && !anyInPerson) return 'online';
  if (anyInPerson) return 'in-person';
  return 'online'; // fully arranged, no in-person signal
}

interface CourseMeta {
  prefix: string;
  number: string;
  title: string;
  credits: number;
  prereq: string | null;
}

/** Parse an <h3> heading "ACCT 110 - Introduction to Accounting (4 Units)". */
function parseHeading(text: string): { prefix: string; number: string; title: string; credits: number } | null {
  const t = text.replace(/\s+/g, ' ').trim();
  // <SUBJ> <NUM> - <Title> (<units> Units)
  const m = t.match(/^([A-Z&]+)\s+([A-Za-z]*\d+[A-Za-z]*)\s*-\s*(.+?)\s*(?:\(([\d.]+)\s*Units?\))?$/i);
  if (!m) return null;
  const title = m[3].trim();
  if (!title) return null;
  return {
    prefix: m[1].trim().toUpperCase(),
    number: m[2].trim().toUpperCase(),
    title,
    credits: m[4] ? parseUnits(m[4]) : 0,
  };
}

/** Turn one accumulated section + its course meta into an output row. */
function sectionToRow(sec: SectionAccum, meta: CourseMeta, term: TermOption): CourseRow | null {
  if (!sec.crn || !meta.prefix || !meta.number) return null;
  // Representative meeting: prefer one with day tokens + a time; else first with a
  // room; else first.
  const withTime = sec.meetings.filter((m) => m.days && m.startTime);
  const primary = withTime[0] || sec.meetings.find((m) => m.room) || sec.meetings[0] || null;

  const cap = sec.cap;
  const act = sec.act;
  const seatsTotal = cap;
  const seatsOpen = cap != null && act != null ? Math.max(cap - act, 0) : null;

  return {
    college_code: COLLEGE_CODE,
    term: term.outTerm,
    course_prefix: meta.prefix,
    course_number: meta.number,
    course_title: meta.title,
    credits: sec.units || meta.credits,
    crn: sec.crn,
    days: primary ? primary.days : '',
    start_time: primary ? primary.startTime : '',
    end_time: primary ? primary.endTime : '',
    start_date: sec.startDate,
    location: primary ? primary.room : '',
    campus: CAMPUS,
    mode: deriveMode(
      sec.meetings.length ? sec.meetings : [{ type: '', days: '', startTime: '', endTime: '', room: '', isAsync: true }],
    ),
    instructor: sec.instructor,
    seats_open: seatsOpen,
    seats_total: seatsTotal,
    prerequisite_text: meta.prereq,
    prerequisite_courses: [],
  };
}

/**
 * Parse a full p_listthislist results page into rows.
 *
 * The ENTIRE listing is one big <table>: a flat, ordered sequence of <tr> rows we
 * walk as a state machine. Row classes drive the transitions:
 *   - `subject_header`           -> a subject group header (ignored)
 *   - `new crse` (carries <h3>)  -> starts a new COURSE; sets prefix/number/title/units
 *   - `crse desc`                -> the current course's description (prereq lives here)
 *   - `column_header_*`          -> the per-course grid header (skipped)
 *   - `default1`/`default2`      -> SECTION data rows. A row whose CRN column holds
 *                                   a p_course_popup link STARTS a new section; a row
 *                                   without one is a CONTINUATION meeting (Lec+Lab,
 *                                   extra meeting pattern) of the active section.
 * We flush each accumulated section to a row when the next section/course starts.
 */
function parseResultsPage(html: string, term: TermOption): CourseRow[] {
  const $ = cheerio.load(html);
  const rows: CourseRow[] = [];

  // Find the big listing table (the one with the most rows / the CRN links).
  let big: Element | null = null;
  let maxRows = 0;
  $('table').each((_, t) => {
    const n = $(t).find('tr').length;
    if (n > maxRows && $(t).find('a[href*="p_course_popup"]').length > 0) {
      maxRows = n;
      big = t as Element;
    }
  });
  if (!big) return rows;

  let meta: CourseMeta | null = null;
  let current: SectionAccum | null = null;

  const flush = () => {
    if (current && meta) {
      const row = sectionToRow(current, meta, term);
      if (row) rows.push(row);
    }
    current = null;
  };

  $(big)
    .find('> tbody > tr, > tr')
    .each((_, tr) => {
      const $tr = $(tr);
      const firstClass = ($tr.find('> td').first().attr('class') || '').toLowerCase();

      // Course heading row: flush the prior section, start a new course.
      if ($tr.find('h3').length) {
        flush();
        meta = null;
        const parsed = parseHeading($tr.find('h3').first().text());
        if (parsed) meta = { ...parsed, prereq: null };
        return;
      }
      // Subject-group header / per-course grid header: structural, skip.
      if (/subject_header|column_header/.test(firstClass)) return;
      // Course description row: capture the prereq onto the active course meta.
      if (/crse\s*desc/.test(firstClass)) {
        if (meta) meta.prereq = extractPrereqText($tr.text());
        return;
      }
      // Otherwise it's a data row (default1/default2) — only meaningful with a
      // current course.
      if (!meta) return;

      const cells = readLogicalCells($, tr as Element);
      if (cells.length === 0) return;
      const byCol = new Map<number, string>();
      for (const c of cells) byCol.set(c.col, c.text);

      // Section start? CRN column holds a numeric CRN (inside a p_course_popup
      // link). Continuation rows lead with a colspan=4 blank, so C_CRN is empty.
      // CRITICAL: a real CRN cell is a single column (span === 1). "Special Note"
      // rows ("CRN X requires additional registration in CRN <link>Y</link>") put
      // a p_course_popup link inside a colspan=20 cell that also starts at col 2 —
      // we must NOT treat those as a section, or we'd emit a bogus empty CRN that
      // collides with the real section's CRN.
      const crnCell = cells.find((c) => c.col === C_CRN);
      const crnIsRealCell = !!crnCell && crnCell.span === 1;
      const crnLinkText = crnIsRealCell ? crnCell!.$td.find('a[href*="p_course_popup"]').first().text() : '';
      const crnText = crnIsRealCell ? (byCol.get(C_CRN) || '').trim() : '';
      const crn =
        /\d{4,}/.test(crnLinkText) ? (crnLinkText.match(/\d{4,}/) || [''])[0]
        : /^\d{4,}$/.test(crnText) ? crnText
        : '';

      if (crn) {
        flush(); // close the previous section
        const meeting = parseMeeting(cells);
        current = {
          crn,
          units: parseUnits(byCol.get(C_UNITS) || '') || meta.credits,
          cap: toIntOrNull(byCol.get(C_CAP) || ''),
          act: toIntOrNull(byCol.get(C_ACT) || ''),
          instructor: normalizeInstructor(byCol.get(C_INSTR) || ''),
          startDate: resolveStartDate(byCol.get(C_DATE) || '', term),
          meetings: meeting ? [meeting] : [],
        };
      } else if (current) {
        // Continuation meeting row for the active section.
        const meeting = parseMeeting(cells);
        if (meeting) current.meetings.push(meeting);
        if (!current.startDate) {
          const d = resolveStartDate(byCol.get(C_DATE) || '', term);
          if (d) current.startDate = d;
        }
        if (!current.instructor) {
          const instr = normalizeInstructor(byCol.get(C_INSTR) || '');
          if (instr) current.instructor = instr;
        }
      }
    });

  flush(); // last section on the page

  return rows;
}

// ---------- per-term orchestration ----------

async function scrapeTerm(term: TermOption): Promise<CourseRow[]> {
  const all: CourseRow[] = [];
  const seen = new Set<string>(); // dedupe by CRN within a term (across levels)
  let anyLevelSucceeded = false;
  const failedLevels: string[] = [];

  for (const level of LEVELS) {
    const url = buildListUrl(term, level);
    let html: string;
    try {
      html = await getHtml(url);
    } catch (e) {
      console.warn(`[sbcc]   ${term.outTerm} level=${level}: fetch failed (${(e as Error).message})`);
      failedLevels.push(level);
      continue;
    }
    if (/Internal Server Error/i.test(html) && !/Class Schedule Search Results/i.test(html)) {
      console.warn(`[sbcc]   ${term.outTerm} level=${level}: server error page`);
      failedLevels.push(level);
      continue;
    }
    anyLevelSucceeded = true;
    const rows = parseResultsPage(html, term);
    let added = 0;
    for (const r of rows) {
      const key = `${r.crn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(r);
      added++;
    }
    console.log(`[sbcc]   ${term.outTerm} level=${level}: ${rows.length} parsed -> ${added} new`);
    await sleep(800); // be polite between large page fetches
  }

  // Data-integrity gate: if no level fetched at all, fail the term (write nothing).
  if (!anyLevelSucceeded) {
    throw new Error(`all levels failed for ${term.outTerm} (${failedLevels.join(', ')})`);
  }
  // A level fetch that errored after others succeeded would silently drop that
  // level's sections. Refuse to write a partial term so we never overwrite a good
  // prior file with an incomplete one.
  if (failedLevels.length > 0) {
    throw new Error(
      `level(s) ${failedLevels.join(', ')} failed for ${term.outTerm}; refusing to write a partial file — re-run to retry`,
    );
  }

  all.sort(
    (a, b) =>
      a.course_prefix.localeCompare(b.course_prefix) ||
      a.course_number.localeCompare(b.course_number, undefined, { numeric: true }) ||
      a.crn.localeCompare(b.crn),
  );
  return all;
}

function writeRows(outTerm: string, rows: CourseRow[]): string {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${outTerm}.json`);
  writeFileSync(outPath, JSON.stringify(rows, null, 2) + '\n', 'utf8');
  return outPath;
}

// ---------- term selection ----------

/**
 * Choose which terms to scrape. By default we want the "upcoming" terms: the
 * latest published term plus any that share its year or are later (so a run in
 * spring picks up the already-published summer + fall). The picker lists terms
 * newest-first, so the first FA/SP/SU options ARE the upcoming ones; we keep the
 * top few rather than re-scraping a decade of history.
 */
function selectUpcomingTerms(terms: TermOption[]): TermOption[] {
  if (terms.length === 0) return [];
  // The list is newest-first. The "current/upcoming" window = the newest term's
  // year and the year before it (covers an in-progress academic year's three
  // terms). Keep terms whose year >= (newestYear - 1).
  const newestYear = Math.max(...terms.map((t) => t.year));
  return terms.filter((t) => t.year >= newestYear - 1);
}

// ---------- CLI ----------

function parseArgs(argv: string[]): { termFilter: string | null; allTerms: boolean } {
  let termFilter: string | null = null;
  let allTerms = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--term') {
      termFilter = argv[i + 1] ?? null;
      i++;
    } else if (argv[i].startsWith('--term=')) {
      termFilter = argv[i].slice('--term='.length);
    } else if (argv[i] === '--all-terms') {
      allTerms = true;
    }
  }
  return { termFilter, allTerms };
}

function termMatchesFilter(t: TermOption, filter: string): boolean {
  const f = filter.trim().toUpperCase();
  return t.outTerm.toUpperCase() === f || t.id === filter.trim();
}

async function main() {
  const { termFilter, allTerms } = parseArgs(process.argv.slice(2));

  console.log(`[sbcc] loading search form from ${SEARCH_URL}`);
  const formHtml = await getHtml(SEARCH_URL);
  let terms = parseTermOptions(formHtml);

  if (terms.length === 0) {
    console.error('[sbcc] no terms parsed from the search form — aborting, nothing written.');
    process.exitCode = 1;
    return;
  }
  console.log(`[sbcc] ${terms.length} FA/SP/SU term(s) exposed (newest first): ${terms.slice(0, 6).map((t) => `${t.label}=${t.id}->${t.outTerm}`).join(', ')}...`);

  if (termFilter) {
    terms = terms.filter((t) => termMatchesFilter(t, termFilter));
    if (terms.length === 0) {
      console.error(`[sbcc] --term ${termFilter} matched no exposed term — aborting.`);
      process.exitCode = 1;
      return;
    }
  } else if (!allTerms) {
    terms = selectUpcomingTerms(terms);
  }

  console.log(`[sbcc] scraping ${terms.length} term(s): ${terms.map((t) => t.outTerm).join(', ')}`);

  const summary: { term: string; count: number }[] = [];
  for (const term of terms) {
    console.log(`\n[sbcc] === ${term.label} (${term.id} -> ${term.outTerm}) ===`);
    try {
      const rows = await scrapeTerm(term);
      if (rows.length === 0) {
        console.warn(`[sbcc] ${term.outTerm}: 0 sections parsed — skipping (no stub written).`);
        continue;
      }
      const outPath = writeRows(term.outTerm, rows);
      console.log(`[sbcc] ${term.outTerm}: wrote ${rows.length} sections -> ${outPath}`);
      summary.push({ term: term.outTerm, count: rows.length });
    } catch (e) {
      console.error(`[sbcc] ${term.outTerm} FAILED: ${(e as Error).message} — nothing written.`);
    }
  }

  console.log('\n[sbcc] DONE');
  for (const s of summary) console.log(`  ${s.term}: ${s.count} sections`);
  if (summary.length === 0) {
    console.error('[sbcc] no terms produced data.');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('[sbcc] fatal:', e);
  process.exitCode = 1;
});
