/**
 * Cerritos College course-section scraper.
 *
 * Source: https://secure.cerritos.edu/schedule/ — "Schedule+", a bespoke public
 * Perl/CGI class-schedule app, NO login required. The flow is three HTTP POSTs:
 *
 *   1. GET  /schedule/            — the search form. Carries the Term checkbox
 *      options (value = numeric term id, label e.g. "2026 Fall"), the Types
 *      options (O Open / C Closed / W Wait List / S Stop / X Cancelled /
 *      T Tentative), and the ~79 Depts checkboxes (value = subject code, e.g.
 *      "ART"; the single oddball "A&P" must be URL-encoded, never HTML-entity).
 *
 *   2. POST /schedule/courses.cgi  (ViewDepartments) with Terms + Types +
 *      Sessions=all + one Depts value -> an HTML list of that department's
 *      courses, each exposed as a `Courses` checkbox value "<SUBJ>:<NUM>"
 *      (e.g. "ART:100", "MATH:110A"). Also carries hidden db=PRD.
 *
 *   3. POST /schedule/classes.cgi  (ViewCourses) with Terms + Types +
 *      Sessions=all + db=PRD + the department's `Courses` values -> the section
 *      rows. Each course renders as an <h2> heading
 *      "<SUBJ>  <NUM> <Title> &nbsp;&nbsp; <X.0> Units" followed by a
 *      <table class="class"> whose data rows hold, in order:
 *        Class(CRN, in the cell `title`/text) | start time | end time |
 *        Days (tokens M Tu W Th F Sa Su joined by &nbsp;) | Room |
 *        Seats(available) | Wait | Status | Instructor | Type(Lecture/Lab/...) |
 *        Hours(contact hrs — NOT capacity) | Course Materials | textbook flag.
 *      A "<SUBJ><NUM>descl" <div> before the table holds the full catalog
 *      description, whose lead "Recommendation:/Prerequisite:" sentence we keep
 *      as prerequisite_text when present.
 *
 * SEATS: the section view exposes only *available* seats, never total capacity,
 * so seats_open is populated and seats_total is left null (we never fabricate).
 *
 * MODE: derived from the Room cell + meeting pattern — "ONLINE" with no days/time
 * = online; rooms containing "ZOOM"/"REMOTE" = zoom; a section that has both an
 * in-person meeting and an online/arranged meeting = hybrid; otherwise in-person.
 *
 * TERM codes are opaque numeric ids (Summer 2026 = 1266, Fall 2026 = 1269); we
 * derive the output TERM string from each option's human label
 * ("2026 Fall" -> "2026FA", "Spring 2026" -> "2026SP", "Summer 2026" -> "2026SU").
 *
 * Output: data/ca/courses/cerritos-college/<TERM>.json
 * TERM ∈ { "<year>FA", "<year>SP", "<year>SU" }.
 *
 * By default scrapes every term the form currently exposes (these are already
 * just the current + upcoming terms — the app drops past terms). `--term`
 * targets one specific term (output string e.g. 2026FA, or raw id e.g. 1269).
 *
 * Usage:
 *   tsx scripts/ca/scrape-cerritos.ts            # all exposed (current+upcoming) terms
 *   tsx scripts/ca/scrape-cerritos.ts --term 2026FA
 *   tsx scripts/ca/scrape-cerritos.ts --term 1269   # raw Cerritos term id also accepted
 *
 * Pure HTTP + cheerio — no Supabase, no Playwright. Idempotent: rewrites the
 * term file from scratch each run. NEVER writes a stub: if a term yields zero
 * rows it is skipped and nothing is written for it.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
// cheerio 1.2 doesn't re-export the DOM node type as `cheerio.Element`; import it
// directly from domhandler (same pattern as scripts/tx/scrape-austin.ts).
import type { Element } from 'domhandler';

const COLLEGE_CODE = 'cerritos-college';
const CAMPUS = 'Norwalk';
const BASE = 'https://secure.cerritos.edu/schedule';
const ROOT_URL = `${BASE}/`;
const COURSES_URL = `${BASE}/courses.cgi`;
const CLASSES_URL = `${BASE}/classes.cgi`;
const OUT_DIR = join(process.cwd(), 'data', 'ca', 'courses', COLLEGE_CODE);

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Types we include: all "real" enrollable statuses. We deliberately drop
// Cancelled (X) and Tentative (T) sections so they never reach students.
const INCLUDE_TYPES = ['O', 'C', 'W', 'S'];

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
  id: string; // raw Cerritos term id e.g. "1269"
  label: string; // human label e.g. "2026 Fall"
  outTerm: string; // normalized e.g. "2026FA"
}

// ---------- HTTP ----------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * fetch with retry. The Schedule+ CGI occasionally drops a connection mid-run
 * ("fetch failed" / TypeError) under the ~160 sequential requests a full scrape
 * makes — without retry, one blip silently drops an entire department's data.
 * Retries up to MAX_RETRIES with exponential backoff on network errors and 5xx.
 */
const MAX_RETRIES = 4;

async function fetchWithRetry(url: string, init: RequestInit, label: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        // 4xx is a real error (don't retry); 5xx is transient (retry).
        if (res.status < 500 || attempt === MAX_RETRIES) {
          throw new Error(`HTTP ${res.status} ${label}`);
        }
        lastErr = new Error(`HTTP ${res.status} ${label}`);
      } else {
        return await res.text();
      }
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_RETRIES) break;
    }
    await sleep(500 * 2 ** attempt); // 0.5s, 1s, 2s, 4s
  }
  throw new Error(`${label} failed after ${MAX_RETRIES + 1} attempts: ${(lastErr as Error)?.message}`);
}

async function getHtml(url: string): Promise<string> {
  return fetchWithRetry(
    url,
    { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' } },
    `GET ${url}`,
  );
}

async function postForm(url: string, fields: Array<[string, string]>): Promise<string> {
  // Schedule+ posts multipart/form-data (enctype on the search form). FormData
  // sends multipart, which the CGI accepts for all three steps. Each retry
  // rebuilds the FormData since a consumed body stream can't be reused.
  const buildBody = () => {
    const fd = new FormData();
    for (const [k, v] of fields) fd.append(k, v);
    return fd;
  };
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
        body: buildBody(),
      });
      if (!res.ok) {
        if (res.status < 500 || attempt === MAX_RETRIES) throw new Error(`HTTP ${res.status} POST ${url}`);
        lastErr = new Error(`HTTP ${res.status} POST ${url}`);
      } else {
        return await res.text();
      }
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_RETRIES) break;
    }
    await sleep(500 * 2 ** attempt);
  }
  throw new Error(`POST ${url} failed after ${MAX_RETRIES + 1} attempts: ${(lastErr as Error)?.message}`);
}

// ---------- term + dept discovery ----------

/**
 * Map a Cerritos term label to the output TERM string.
 * Labels appear as "2026 Fall" (year first) but we also tolerate "Fall 2026".
 */
function termLabelToOutput(label: string): string | null {
  const m = label.match(/(?:(\d{4})\s+)?(Fall|Spring|Summer|Winter)(?:\s+(\d{4}))?/i);
  if (!m) return null;
  const year = m[1] || m[3];
  if (!year) return null;
  const season = m[2].toLowerCase();
  const suffix =
    season === 'fall' ? 'FA' : season === 'spring' ? 'SP' : season === 'summer' ? 'SU' : 'WI';
  return `${year}${suffix}`;
}

function parseTermOptions($: cheerio.CheerioAPI): TermOption[] {
  const out: TermOption[] = [];
  $('input[name="Terms"]').each((_, el) => {
    const id = ($(el).attr('value') || '').trim();
    if (!id) return;
    // Label is the text node immediately following the checkbox.
    const label = $(el).parent().text().replace(/ /g, ' ').trim();
    const outTerm = termLabelToOutput(label);
    if (!outTerm) return;
    out.push({ id, label: label.replace(/\s+/g, ' '), outTerm });
  });
  return out;
}

function parseDeptCodes($: cheerio.CheerioAPI): string[] {
  const codes = new Set<string>();
  $('input[name="Depts"]').each((_, el) => {
    const v = ($(el).attr('value') || '').trim();
    if (v) codes.add(v); // cheerio already decodes &amp; -> "A&P"
  });
  return Array.from(codes);
}

// ---------- step 2: department course list ----------

async function fetchDeptCourses(term: TermOption, dept: string): Promise<string[]> {
  const fields: Array<[string, string]> = [
    ['Terms', term.id],
    ['Sessions', 'all'],
    ['Depts', dept], // FormData encodes "A&P" correctly on the wire
    ['ViewDepartments', 'View Departments'],
  ];
  for (const t of INCLUDE_TYPES) fields.push(['Types', t]);

  const html = await postForm(COURSES_URL, fields);
  const $ = cheerio.load(html);
  const courses: string[] = [];
  $('input[name="Courses"]').each((_, el) => {
    const v = ($(el).attr('value') || '').trim();
    if (v && v.includes(':')) courses.push(v);
  });
  return courses;
}

// ---------- step 3: section rows for a set of courses ----------

function parseUnits(headingText: string): number {
  // "ART  100 Introduction to World Art   3.0 Units"
  const m = headingText.match(/([\d.]+)\s*Units?\b/i);
  if (!m) return 0;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : 0;
}

/** Parse the <h2> course heading into { prefix, number, title }. */
function parseHeading(headingText: string): { prefix: string; number: string; title: string } | null {
  // Heading shape: "<SUBJ>  <NUM> <Title> &nbsp;&nbsp; <X.X> Units" — but Adult-Ed
  // / non-credit courses carry NO unit number ("... &nbsp;&nbsp;   Units"). Strip
  // only a trailing "<digits> Units" clause; a bare "Units" with no number is left
  // for the title split to discard. Collapse whitespace first.
  let cleaned = headingText.replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/\s*[\d.]+\s*Units?\b.*$/i, '').replace(/\s*Units?\b.*$/i, '').trim();
  // SUBJ = leading letters (may contain &, e.g. A&P). NUM = next token, which may
  // be any of:
  //   100, 110A, 115L, 283L        — classic numbering (optional trailing letter)
  //   11.08, 42.03A                — Adult-Ed decimal numbering
  //   C1000, C1000E                — California Common Course Numbering (C-ID),
  //                                  where the number leads with a letter.
  // Pattern: optional leading letter(s), required digits, optional ".dd" decimal,
  // optional trailing letter(s). The course number must contain at least one digit.
  const m = cleaned.match(/^([A-Za-z&]+)\s+([A-Za-z]*[0-9]+(?:\.[0-9]+)?[A-Za-z]*)\s+(.*)$/);
  if (!m) return null;
  const title = m[3].trim();
  if (!title) return null;
  return { prefix: m[1].trim(), number: m[2].trim(), title };
}

/** "12:30pm" / "8:45am" -> "12:30 PM" / "8:45 AM"; blank -> "". */
function formatTime(raw: string): string {
  const s = raw.replace(/ /g, ' ').trim();
  if (!s) return '';
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
 * Days cell -> token string. Cerritos already emits exactly the tokens we want
 * (M Tu W Th F Sa Su), separated by &nbsp;. We just strip whitespace/nbsp and
 * re-concatenate. Anything that isn't a known token (e.g. "ARR") -> "".
 */
const DAY_TOKENS = new Set(['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su']);
function parseDays(cellText: string): string {
  const parts = cellText.replace(/ /g, ' ').trim().split(/\s+/).filter(Boolean);
  const tokens = parts.filter((p) => DAY_TOKENS.has(p));
  return tokens.join('');
}

/** "8/17/2026" -> "2026-08-17"; blank/unparseable -> "". */
function isoDate(mdy: string): string {
  const m = mdy.replace(/ /g, ' ').trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function toIntOrNull(s: string): number | null {
  const t = s.replace(/ /g, ' ').trim();
  if (t === '') return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

/** Pull the lead "Recommendation:/Prerequisite:/Corequisite:" sentence, if any. */
function extractPrereqText($: cheerio.CheerioAPI, prefix: string, number: string): string | null {
  // The long description div id is "<SUBJ><NUM>descl" (e.g. "ART100descl").
  // Use an attribute selector (not #id) so subject codes containing "&" (A&P)
  // don't break the CSS selector.
  const id = `${prefix}${number}descl`;
  const div = $('div').filter((_, el) => $(el).attr('id') === id).first();
  let text = div.length ? div.text() : '';
  text = text.replace(/ /g, ' ').replace(/\(Less\)|\(More\)|\(Expand All\)/gi, '').trim();
  if (!text) return null;
  // Keep only a leading requirement clause, up to the first sentence break,
  // when the description opens with one of these labels.
  const m = text.match(/^(Prerequisite|Corequisite|Recommendation|Recommended Preparation|Advisory)\b[^.]*\.?/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

/**
 * Derive the output mode for a section.
 *
 * The section's last-cell flag ("Hybrid Course"/"Online Course") is the
 * AUTHORITATIVE modality, since a hybrid section's meeting row is visually
 * identical to an in-person one. We honor it first:
 *   - "Hybrid Course" -> hybrid
 *   - "Online Course" -> online, UNLESS a meeting row is a REMOTE/ZOOM room,
 *     in which case it's a synchronous remote class -> zoom.
 * With no modality flag we fall back to the room/day pattern:
 *   - a real in-person room with days/time -> in-person
 *   - ZOOM/REMOTE room -> zoom
 *   - ONLINE room / fully-arranged with no signal -> online.
 */
function deriveMode(
  modalityFlag: '' | 'hybrid' | 'online',
  meetings: Array<{ room: string; days: string; hasTime: boolean }>,
): CourseRow['mode'] {
  const rooms = meetings.map((m) => m.room.toUpperCase());
  const anyZoom = rooms.some((r) => /ZOOM|REMOTE/.test(r));
  const anyOnlineRoom = rooms.some((r) => /ONLINE/.test(r));
  const anyInPerson = meetings.some(
    (m) => (m.days || m.hasTime) && !/^ONLINE$|^ARR|ZOOM|REMOTE|^TBA$/i.test(m.room.trim()),
  );

  if (modalityFlag === 'hybrid') return 'hybrid';
  if (modalityFlag === 'online') return anyZoom ? 'zoom' : 'online';

  // No explicit flag: infer from rooms/days.
  if (anyInPerson && (anyOnlineRoom || anyZoom)) return 'hybrid';
  if (anyZoom && !anyInPerson) return 'zoom';
  if (anyOnlineRoom && !anyInPerson) return 'online';
  if (anyInPerson) return 'in-person';
  return 'online'; // fully arranged, no signal -> async online
}

interface MeetingRow {
  startTime: string;
  endTime: string;
  days: string;
  room: string;
  hasTime: boolean;
}

/**
 * Parse one <table class="class"> for a single course into section rows.
 * A section is one CRN; some sections span multiple meeting rows (extra rows
 * have a blank CRN cell and additional days/room). We aggregate consecutive
 * meeting rows under the active CRN.
 */
function parseCourseTable(
  $: cheerio.CheerioAPI,
  table: Element,
  meta: { prefix: string; number: string; title: string; credits: number; prereq: string | null },
  term: TermOption,
): CourseRow[] {
  const rows: CourseRow[] = [];

  // Group raw rows into sections keyed by CRN.
  interface Section {
    crn: string;
    instructor: string | null;
    seatsOpen: number | null;
    startDate: string;
    modalityFlag: '' | 'hybrid' | 'online';
    meetings: MeetingRow[];
  }
  const sections: Section[] = [];
  let current: Section | null = null;
  let sessionStartDate = '';

  $(table)
    .find('> tbody > tr, > tr')
    .each((_, tr) => {
      const $tr = $(tr);
      // Session header row carries the date range "(8/17/2026 - 12/18/2026)".
      const sessHead = $tr.find('td.sess1head');
      if (sessHead.length) {
        const m = sessHead.text().match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (m) sessionStartDate = isoDate(m[1]);
        return;
      }

      const tds = $tr.find('> td');
      if (tds.length < 9) return; // not a data row (header / note / spacer)

      const firstTd = $(tds[0]);
      // CRN lives in the first cell's `title` attr (and text). Classes use
      // td.sess1 / td.sess1nbr2 for the number column.
      const crnTitle = (firstTd.attr('title') || '').trim();
      const crnText = firstTd.text().replace(/ /g, ' ').trim();
      const crn = /^\d+$/.test(crnTitle) ? crnTitle : /^\d+$/.test(crnText) ? crnText : '';

      // Column layout (data row):
      //  0 Class(CRN) | 1 start | 2 end | 3 Days | 4 Room | 5 Seats | 6 Wait |
      //  7 Status | 8 Instructor | 9 Type | 10 Hours | ...
      const startTime = formatTime($(tds[1]).text());
      const endTime = formatTime($(tds[2]).text());
      const days = parseDays($(tds[3]).text());
      const room = $(tds[4]).text().replace(/ /g, ' ').replace(/\*/g, '').trim();
      const seatsOpen = toIntOrNull($(tds[5]).text());
      const instrCell = $(tds[8]);
      let instructor: string | null = instrCell.text().replace(/ /g, ' ').trim();
      if (!instructor || /^staff$/i.test(instructor)) instructor = instructor && /staff/i.test(instructor) ? 'Staff' : null;

      // Authoritative per-section modality lives in the LAST cell (the textbook/
      // cost-flag column), e.g. "Hybrid Course Not Low Cost or Zero Cost (Y)",
      // "Online Course Zero Cost Textbooks E", or just "Zero Cost Textbooks E"
      // (in-person). The meeting-row days/room don't reveal hybrid on their own
      // (a hybrid section's row looks identical to an in-person one), so this
      // flag is the only reliable signal. We scan the whole row text for it.
      const rowText = $tr.text();
      let modalityFlag: '' | 'hybrid' | 'online' = '';
      if (/\bHybrid Course\b/i.test(rowText)) modalityFlag = 'hybrid';
      else if (/\bOnline Course\b/i.test(rowText)) modalityFlag = 'online';

      const meeting: MeetingRow = {
        startTime,
        endTime,
        days,
        room,
        hasTime: !!startTime,
      };

      if (crn) {
        // New section.
        current = {
          crn,
          instructor: instructor || null,
          seatsOpen,
          startDate: sessionStartDate,
          modalityFlag,
          meetings: [meeting],
        };
        sections.push(current);
      } else if (current) {
        // Continuation meeting row for the active section.
        current.meetings.push(meeting);
        if (!current.instructor && instructor) current.instructor = instructor;
        if (!current.modalityFlag && modalityFlag) current.modalityFlag = modalityFlag;
      }
    });

  for (const sec of sections) {
    if (!sec.crn) continue;
    // Pick the representative meeting: prefer one with day tokens + a time.
    const withTime = sec.meetings.filter((m) => m.days && m.hasTime);
    const primary = withTime[0] || sec.meetings.find((m) => m.days) || sec.meetings[0];

    // Location = the representative meeting's room (e.g. "FA133"); "ONLINE" is
    // kept verbatim since it is the only place hint the source gives for those.
    const location = primary ? primary.room : '';

    const row: CourseRow = {
      college_code: COLLEGE_CODE,
      term: term.outTerm,
      course_prefix: meta.prefix,
      course_number: meta.number,
      course_title: meta.title,
      credits: meta.credits,
      crn: sec.crn,
      days: primary ? primary.days : '',
      start_time: primary ? primary.startTime : '',
      end_time: primary ? primary.endTime : '',
      start_date: sec.startDate,
      location,
      campus: CAMPUS,
      mode: deriveMode(sec.modalityFlag, sec.meetings),
      instructor: sec.instructor,
      seats_open: sec.seatsOpen,
      seats_total: null, // section view exposes available seats only, never capacity
      prerequisite_text: meta.prereq,
      prerequisite_courses: [],
    };

    if (!row.course_prefix || !row.course_number || !row.crn) continue;
    rows.push(row);
  }

  return rows;
}

async function fetchSectionsForCourses(term: TermOption, courses: string[]): Promise<CourseRow[]> {
  if (courses.length === 0) return [];
  const fields: Array<[string, string]> = [
    ['Terms', term.id],
    ['Sessions', 'all'],
    ['db', 'PRD'],
    ['ViewCourses', 'View Courses'],
  ];
  for (const t of INCLUDE_TYPES) fields.push(['Types', t]);
  for (const c of courses) fields.push(['Courses', c]);

  const html = await postForm(CLASSES_URL, fields);
  const $ = cheerio.load(html);

  const rows: CourseRow[] = [];
  // Each course = an <h2> heading followed by its table.class. Walk headings.
  $('h2').each((_, h2) => {
    const headingText = $(h2).text().replace(/ /g, ' ').trim();
    const parsed = parseHeading(headingText);
    if (!parsed) return; // e.g. "No courses selected" or section headers
    const credits = parseUnits(headingText);
    const prereq = extractPrereqText($, parsed.prefix, parsed.number);

    // The course's section table is the next table.class after this heading.
    const table = $(h2).nextAll('table.class').first()[0]
      || $(h2).parent().nextAll().find('table.class').first()[0]
      || $(h2).nextUntil('h2').find('table.class').first()[0];
    if (!table) {
      // Fall back: search forward in document order for the nearest table.class
      // that comes before the next h2.
      let node: Element | null = null;
      const all = $('table.class').toArray();
      const h2Index = $('*').index(h2);
      for (const t of all) {
        if ($('*').index(t) > h2Index) {
          node = t;
          break;
        }
      }
      if (!node) return;
      rows.push(...parseCourseTable($, node, { ...parsed, credits, prereq }, term));
      return;
    }
    rows.push(...parseCourseTable($, table, { ...parsed, credits, prereq }, term));
  });

  return rows;
}

// ---------- per-term orchestration ----------

async function scrapeTerm(term: TermOption, depts: string[]): Promise<CourseRow[]> {
  const all: CourseRow[] = [];
  const seen = new Set<string>(); // dedupe by CRN within a term
  const failedDepts: string[] = [];

  for (const dept of depts) {
    let courses: string[];
    try {
      courses = await fetchDeptCourses(term, dept);
    } catch (e) {
      console.warn(`[cerritos]   dept ${dept}: course list failed (${(e as Error).message}) — recording failure`);
      failedDepts.push(dept);
      continue;
    }
    if (courses.length === 0) {
      continue;
    }

    // classes.cgi accepts the whole department's course list in one POST; chunk
    // defensively in case a very large dept ever overflows.
    const CHUNK = 80;
    let deptRows = 0;
    let deptFailed = false;
    for (let i = 0; i < courses.length; i += CHUNK) {
      const slice = courses.slice(i, i + CHUNK);
      let rows: CourseRow[];
      try {
        rows = await fetchSectionsForCourses(term, slice);
      } catch (e) {
        console.warn(
          `[cerritos]   dept ${dept} [${i}-${i + slice.length}]: sections failed (${(e as Error).message}) — recording failure`,
        );
        deptFailed = true;
        continue;
      }
      for (const r of rows) {
        const key = `${term.outTerm}|${r.crn}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(r);
        deptRows++;
      }
    }
    if (deptFailed) failedDepts.push(dept);
    console.log(`[cerritos]   dept ${dept}: ${courses.length} courses -> ${deptRows} sections`);
  }

  // Data-integrity gate: a few departments failing every retry would silently
  // ship an incomplete term. Refuse to write such a term so we never overwrite a
  // good prior file with a partial one. (Even with retries, transient drops are
  // rare; a clean re-run resolves them.)
  if (failedDepts.length > 0) {
    throw new Error(
      `${failedDepts.length} department(s) failed all retries (${failedDepts.join(', ')}); refusing to write a partial ${term.outTerm} file — re-run to retry`,
    );
  }

  // Stable ordering: subject, number, CRN.
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

// ---------- CLI ----------

function parseArgs(argv: string[]): { termFilter: string | null; deptFilter: string | null } {
  let termFilter: string | null = null;
  let deptFilter: string | null = null; // debug: restrict to one department code
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--term') {
      termFilter = argv[i + 1] ?? null;
      i++;
    } else if (argv[i].startsWith('--term=')) {
      termFilter = argv[i].slice('--term='.length);
    } else if (argv[i] === '--dept') {
      deptFilter = argv[i + 1] ?? null;
      i++;
    } else if (argv[i].startsWith('--dept=')) {
      deptFilter = argv[i].slice('--dept='.length);
    }
  }
  return { termFilter, deptFilter };
}

function termMatchesFilter(t: TermOption, filter: string): boolean {
  const f = filter.trim().toUpperCase();
  return t.outTerm.toUpperCase() === f || t.id === filter.trim();
}

async function main() {
  const { termFilter, deptFilter } = parseArgs(process.argv.slice(2));

  console.log(`[cerritos] loading search form from ${ROOT_URL}`);
  const rootHtml = await getHtml(ROOT_URL);
  const $root = cheerio.load(rootHtml);

  let terms = parseTermOptions($root);
  let depts = parseDeptCodes($root);

  if (terms.length === 0) {
    console.error('[cerritos] no terms found on the search form — aborting, nothing written.');
    process.exitCode = 1;
    return;
  }
  if (depts.length === 0) {
    console.error('[cerritos] no departments found on the search form — aborting, nothing written.');
    process.exitCode = 1;
    return;
  }

  console.log(
    `[cerritos] ${terms.length} term(s) exposed: ${terms.map((t) => `${t.label} (${t.id} -> ${t.outTerm})`).join(', ')}`,
  );
  console.log(`[cerritos] ${depts.length} departments: ${depts.join(', ')}`);

  if (termFilter) {
    terms = terms.filter((t) => termMatchesFilter(t, termFilter));
    if (terms.length === 0) {
      console.error(`[cerritos] --term ${termFilter} matched no exposed term — aborting.`);
      process.exitCode = 1;
      return;
    }
  }

  // --dept is a DEBUG filter only. It restricts the scrape to one department and
  // does NOT write a term file (writing one dept would be a partial-term stub,
  // which the data invariants forbid). Use it to validate parsing, then run the
  // full scrape (no --dept) to produce the committed file.
  if (deptFilter) {
    const d = deptFilter.trim().toUpperCase();
    depts = depts.filter((x) => x.toUpperCase() === d);
    if (depts.length === 0) {
      console.error(`[cerritos] --dept ${deptFilter} matched no department — aborting.`);
      process.exitCode = 1;
      return;
    }
    console.log(`[cerritos] DEBUG --dept ${depts[0]}: scraping one department, NOT writing any file.`);
    for (const term of terms) {
      const rows = await scrapeTerm(term, depts);
      console.log(`[cerritos] DEBUG ${term.outTerm} ${depts[0]}: ${rows.length} sections`);
      console.log(JSON.stringify(rows.slice(0, 3), null, 2));
    }
    return;
  }

  const summary: { term: string; count: number; path: string }[] = [];

  for (const term of terms) {
    console.log(`\n[cerritos] === scraping ${term.label} (${term.id} -> ${term.outTerm}) ===`);
    try {
      const rows = await scrapeTerm(term, depts);
      if (rows.length === 0) {
        console.warn(`[cerritos] ${term.outTerm}: 0 sections parsed — skipping (no stub written).`);
        continue;
      }
      const outPath = writeRows(term.outTerm, rows);
      console.log(`[cerritos] ${term.outTerm}: wrote ${rows.length} sections -> ${outPath}`);
      summary.push({ term: term.outTerm, count: rows.length, path: outPath });
    } catch (e) {
      // Hard rule: on failure leave existing data untouched, write nothing.
      console.error(`[cerritos] ${term.outTerm} FAILED: ${(e as Error).message} — nothing written.`);
    }
  }

  console.log('\n[cerritos] DONE');
  for (const s of summary) console.log(`  ${s.term}: ${s.count} sections`);
  if (summary.length === 0) {
    console.error('[cerritos] no terms produced data.');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('[cerritos] fatal:', e);
  process.exitCode = 1;
});
