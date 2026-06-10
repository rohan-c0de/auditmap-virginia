/**
 * Imperial Valley College course-section scraper.
 *
 * Source: https://schedule.imperial.edu/  — a public Laravel/Livewire (v2) class-
 * schedule app, no login required. The term page (`?term=<code>`) server-renders
 * the entire schedule into a Livewire `wire:initial-data` blob (HTML-entity
 * encoded JSON). We fetch the HTML, extract + unescape that blob, JSON.parse it,
 * and read two parallel maps off `serverMemo.data`:
 *
 *   - `data`     : { "<term>.<crn>": <section> }   one entry per section
 *   - `meetings` : { "<term>.<crn>": [<meeting>] } one or more meeting rows per section
 *
 * Section objects carry course/subject/units/seats/instructor; meeting rows carry
 * day flags (Banner letter codes), begin/end time, building, room. We join on
 * course_id (`<term>.<crn>`).
 *
 * IMPORTANT — term codes do NOT follow a literal calendar-year mapping. The code
 * prefix is the ACADEMIC year start, e.g. "202620" = Spring 2026, "202615" =
 * Winter 2026, "202610" = Fall 2025. We therefore derive the output TERM string
 * from each option's human label ("Spring 2026" -> "2026SP"), never from the code.
 *
 * Output: data/ca/courses/imperial-valley-college/<TERM>.json
 * TERM ∈ { "<year>FA", "<year>SP", "<year>SU", "<year>WI" }.
 *
 * The dropdown exposes ~40 historical terms back to 2012. By default we scrape
 * only CURRENT + UPCOMING terms (those whose term has not yet ended as of today)
 * — that is the product-relevant set. `--all` scrapes every exposed credit term;
 * `--term` targets one specific term regardless of recency.
 *
 * Usage:
 *   tsx scripts/ca/scrape-imperial.ts            # current + upcoming credit terms
 *   tsx scripts/ca/scrape-imperial.ts --all      # every exposed credit term (incl. history)
 *   tsx scripts/ca/scrape-imperial.ts --term 2026SP
 *   tsx scripts/ca/scrape-imperial.ts --term 202620   # raw IVC code also accepted
 *
 * Pure HTTP — no Supabase, no Playwright. NEVER writes a stub: if a term yields
 * zero rows it is skipped and nothing is written for it.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const COLLEGE_CODE = 'imperial-valley-college';
const CAMPUS = 'Imperial';
const BASE_URL = 'https://schedule.imperial.edu/';
const OUT_DIR = join(process.cwd(), 'data', 'ca', 'courses', COLLEGE_CODE);

// ---------- types reflecting the embedded Livewire blob ----------

interface IvcSection {
  term_code: number;
  term_name: string;
  course_id: string;
  crn: number;
  instructional_method: string;
  modalities: string | null;
  class_format: string | null;
  subject: string;
  course_number: string;
  course_title: string;
  start_date: string;
  end_date: string;
  units: string;
  max_enrollment: number | null;
  enrollment: number | null;
  available: number | null;
  row_status: string;
  first_name: string | null;
  last_name: string | null;
}

interface IvcMeeting {
  course_id: string;
  primary_schedule_code_ind: number;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday?: string;
  begin_time: string;
  end_time: string;
  building: string;
  room: string;
}

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
  code: string; // raw IVC term code e.g. "202620"
  name: string; // human label e.g. "Spring 2026"
  outTerm: string; // normalized e.g. "2026SP"
}

// ---------- helpers ----------

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#0?34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&amp;/g, '&'); // ampersand last to avoid double-decoding
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Pull the Livewire serverMemo.data object out of a page's wire:initial-data blob. */
function extractLivewireData(html: string): any {
  const m = html.match(/wire:initial-data="([^"]*)"/);
  if (!m) throw new Error('wire:initial-data attribute not found in page');
  const decoded = decodeHtmlEntities(m[1]);
  let obj: any;
  try {
    obj = JSON.parse(decoded);
  } catch (e) {
    throw new Error(`failed to JSON.parse wire:initial-data: ${(e as Error).message}`);
  }
  const data = obj?.serverMemo?.data;
  if (!data) throw new Error('serverMemo.data missing from Livewire blob');
  return data;
}

/**
 * Map an IVC term label to the output TERM string.
 * "Fall 2026" -> "2026FA", "Spring 2026" -> "2026SP",
 * "Summer 2026" -> "2026SU", "Winter 2026" -> "2026WI".
 */
function termLabelToOutput(name: string): string | null {
  const m = name.match(/^(Fall|Spring|Summer|Winter)\s+(\d{4})/i);
  if (!m) return null;
  const season = m[1].toLowerCase();
  const year = m[2];
  const suffix =
    season === 'fall' ? 'FA' : season === 'spring' ? 'SP' : season === 'summer' ? 'SU' : 'WI';
  return `${year}${suffix}`;
}

/**
 * Approximate calendar END date of an IVC term, derived from its label, used to
 * decide whether a term is still "current/upcoming" (end >= today). Generous
 * end-of-season bounds so an in-progress term always counts as current:
 *   Winter -> Feb 28 of year, Spring -> Jun 30, Summer -> Aug 31, Fall -> Dec 31.
 */
function approxTermEnd(name: string): Date | null {
  const m = name.match(/^(Fall|Spring|Summer|Winter)\s+(\d{4})/i);
  if (!m) return null;
  const season = m[1].toLowerCase();
  const year = Number.parseInt(m[2], 10);
  // month is 0-indexed; pick the last day of the season's final month.
  if (season === 'winter') return new Date(year, 1, 28); // end Feb
  if (season === 'spring') return new Date(year, 5, 30); // end Jun
  if (season === 'summer') return new Date(year, 7, 31); // end Aug
  return new Date(year, 11, 31); // fall: end Dec
}

/** True if the term has not yet fully ended as of `now` (current or upcoming). */
function isCurrentOrUpcoming(t: TermOption, now: Date): boolean {
  const end = approxTermEnd(t.name);
  if (!end) return false;
  return end.getTime() >= now.getTime();
}

// Credit terms use a term-code suffix of 10 (Fall), 15 (Winter), 20 (Spring),
// 30 (Summer). The "+2" variants (12/17/22/32) are the Non-Credit schedule and
// are excluded. NOTE: the blob's `noncredit_indicator` field is NOT a clean 0/1
// flag — Winter credit terms carry "5", Spring "0", etc. — so we rely on the
// code suffix plus the "Non Credit" label, never that field.
const CREDIT_SUFFIXES = new Set(['10', '15', '20', '30']);

function isCreditTermCode(code: string, name: string): boolean {
  if (/non\s*credit/i.test(name)) return false;
  return CREDIT_SUFFIXES.has(code.slice(-2));
}

/** Read available CREDIT term options from the searchForm in the root page blob. */
function readTermOptions(rootData: any): TermOption[] {
  const terms: any[] = rootData?.searchForm?.terms ?? [];
  const out: TermOption[] = [];
  for (const t of terms) {
    const code = String(t.term_code);
    const name = String(t.term_name);
    if (!isCreditTermCode(code, name)) continue;
    const outTerm = termLabelToOutput(name);
    if (!outTerm) continue; // skip anything that doesn't parse to a real term
    out.push({ code, name, outTerm });
  }
  return out;
}

function parseCredits(units: string): number {
  const n = Number.parseFloat(units);
  return Number.isFinite(n) ? n : 0;
}

/** "HH:MM:SS" -> "h:mm AM/PM"; empty/zero -> "". */
function formatTime(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  let h = Number.parseInt(m[1], 10);
  const min = m[2];
  if (h === 0 && min === '00') return ''; // 00:00:00 sentinel = no real time (async/online)
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${min} ${ampm}`;
}

/** Banner day flags on a meeting row -> ordered token string "MTuWThFSaSu". */
function daysToTokens(mt: IvcMeeting): string {
  const tokens: string[] = [];
  const has = (v?: string) => !!(v && v.trim());
  if (has(mt.monday)) tokens.push('M');
  if (has(mt.tuesday)) tokens.push('Tu');
  if (has(mt.wednesday)) tokens.push('W');
  if (has(mt.thursday)) tokens.push('Th');
  if (has(mt.friday)) tokens.push('F');
  if (has(mt.saturday)) tokens.push('Sa');
  if (has(mt.sunday)) tokens.push('Su');
  return tokens.join('');
}

/**
 * Map IVC instructional_method to output mode.
 *   OL = Online (async)              -> online
 *   HY = Hybrid                       -> hybrid
 *   HF = HyFlex                       -> hybrid
 *   RT = Remote / Simultaneous online -> zoom
 *   TR = Traditional / in person      -> in-person
 * Falls back to in-person for unknown codes.
 */
function mapMode(section: IvcSection): CourseRow['mode'] {
  const method = (section.instructional_method || '').toUpperCase();
  const modalities = (section.modalities || '').toUpperCase();
  if (method === 'OL') return 'online';
  if (method === 'RT') return 'zoom';
  if (method === 'HY' || method === 'HF') return 'hybrid';
  if (method === 'TR') return 'in-person';
  // fallbacks if method code is unexpected
  if (modalities.includes('ONLINE')) return 'online';
  return 'in-person';
}

function buildInstructor(section: IvcSection): string | null {
  const last = (section.last_name || '').trim();
  const first = (section.first_name || '').trim();
  if (!last && !first) return null;
  if (last && first) return `${last}, ${first}`;
  return last || first;
}

function buildLocation(mt: IvcMeeting | null): string {
  if (!mt) return '';
  const bldg = (mt.building || '').trim();
  const room = (mt.room || '').trim();
  if (bldg && room) return `${bldg} ${room}`;
  return bldg || room;
}

/**
 * Choose the representative meeting for a section's days/time/location.
 * Prefer a meeting that has actual day flags + a real (non-00:00) begin time;
 * otherwise the primary meeting; otherwise the first.
 */
function pickMeeting(meetings: IvcMeeting[]): IvcMeeting | null {
  if (!meetings || meetings.length === 0) return null;
  const withTime = meetings.filter(
    (mt) => daysToTokens(mt) !== '' && formatTime(mt.begin_time) !== '',
  );
  if (withTime.length) {
    const primary = withTime.find((mt) => mt.primary_schedule_code_ind === 1);
    return primary || withTime[0];
  }
  const primary = meetings.find((mt) => mt.primary_schedule_code_ind === 1);
  return primary || meetings[0];
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- core scrape of one term ----------

async function scrapeTerm(term: TermOption): Promise<CourseRow[]> {
  const url = `${BASE_URL}?term=${term.code}`;
  const html = await fetchHtml(url);
  const data = extractLivewireData(html);

  const sections: Record<string, IvcSection> = data.data ?? {};
  const meetingsMap: Record<string, IvcMeeting[]> = data.meetings ?? {};

  const sectionKeys = Object.keys(sections);
  const rows: CourseRow[] = [];

  for (const key of sectionKeys) {
    const sec = sections[key];
    if (!sec || typeof sec !== 'object') continue;
    // Guard: only keep rows whose term_code matches the requested credit term.
    // (We only ever fetch a credit-term URL, so a code match is sufficient.)
    if (String(sec.term_code) !== term.code) continue;

    const meetings = meetingsMap[sec.course_id] ?? [];
    const mt = pickMeeting(meetings);

    const row: CourseRow = {
      college_code: COLLEGE_CODE,
      term: term.outTerm,
      course_prefix: (sec.subject || '').trim(),
      course_number: (sec.course_number || '').trim(),
      course_title: (sec.course_title || '').trim(),
      credits: parseCredits(sec.units),
      crn: String(sec.crn),
      days: mt ? daysToTokens(mt) : '',
      start_time: mt ? formatTime(mt.begin_time) : '',
      end_time: mt ? formatTime(mt.end_time) : '',
      start_date: (sec.start_date || '').trim(),
      location: buildLocation(mt),
      campus: CAMPUS,
      mode: mapMode(sec),
      instructor: buildInstructor(sec),
      seats_open: toNum(sec.available),
      seats_total: toNum(sec.max_enrollment),
      prerequisite_text: null,
      prerequisite_courses: [],
    };

    // Minimum viability: must have a real CRN, subject and course number.
    if (!row.crn || row.crn === 'NaN' || !row.course_prefix || !row.course_number) continue;

    rows.push(row);
  }

  // Stable ordering: subject, then course number, then CRN.
  rows.sort(
    (a, b) =>
      a.course_prefix.localeCompare(b.course_prefix) ||
      a.course_number.localeCompare(b.course_number) ||
      a.crn.localeCompare(b.crn),
  );

  return rows;
}

function writeRows(outTerm: string, rows: CourseRow[]): string {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${outTerm}.json`);
  writeFileSync(outPath, JSON.stringify(rows, null, 2) + '\n', 'utf8');
  return outPath;
}

// ---------- CLI ----------

function parseArgs(argv: string[]): { termFilter: string | null; all: boolean } {
  let termFilter: string | null = null;
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--term') {
      termFilter = argv[i + 1] ?? null;
      i++;
    } else if (argv[i].startsWith('--term=')) {
      termFilter = argv[i].slice('--term='.length);
    } else if (argv[i] === '--all') {
      all = true;
    }
  }
  return { termFilter, all };
}

/** Match a --term filter against either the output TERM string or the raw IVC code. */
function termMatchesFilter(t: TermOption, filter: string): boolean {
  const f = filter.trim().toUpperCase();
  return t.outTerm.toUpperCase() === f || t.code === filter.trim();
}

async function main() {
  const { termFilter, all } = parseArgs(process.argv.slice(2));

  console.log(`[imperial] loading term list from ${BASE_URL}`);
  const rootHtml = await fetchHtml(BASE_URL);
  const rootData = extractLivewireData(rootHtml);
  let terms = readTermOptions(rootData);

  if (terms.length === 0) {
    console.error('[imperial] no credit terms found in dropdown — aborting, nothing written.');
    process.exitCode = 1;
    return;
  }

  console.log(`[imperial] ${terms.length} credit terms exposed (newest: ${terms[0]?.name}).`);

  if (termFilter) {
    // Explicit term wins over any recency default.
    terms = terms.filter((t) => termMatchesFilter(t, termFilter));
    if (terms.length === 0) {
      console.error(`[imperial] --term ${termFilter} matched no exposed credit term — aborting.`);
      process.exitCode = 1;
      return;
    }
  } else if (!all) {
    // Default: only current + upcoming terms (the product-relevant set).
    const now = new Date();
    const recent = terms.filter((t) => isCurrentOrUpcoming(t, now));
    if (recent.length === 0) {
      // Fallback: site hasn't published anything current/upcoming — take the newest
      // term it does expose so we still ship the freshest available schedule.
      terms = [terms[0]];
      console.warn(
        `[imperial] no current/upcoming term found; falling back to newest exposed term: ${terms[0].name}`,
      );
    } else {
      terms = recent;
    }
  }

  console.log(
    `[imperial] scraping: ${terms.map((t) => `${t.name} (${t.code} -> ${t.outTerm})`).join(', ')}`,
  );

  const summary: { term: string; count: number; path: string }[] = [];

  for (const term of terms) {
    try {
      console.log(`[imperial] scraping ${term.name} (${term.code}) ...`);
      const rows = await scrapeTerm(term);
      if (rows.length === 0) {
        console.warn(`[imperial] ${term.name}: 0 rows parsed — skipping (no stub written).`);
        continue;
      }
      const outPath = writeRows(term.outTerm, rows);
      console.log(`[imperial] ${term.name}: wrote ${rows.length} sections -> ${outPath}`);
      summary.push({ term: term.outTerm, count: rows.length, path: outPath });
    } catch (e) {
      // Per hard rule: on failure leave existing data untouched, write nothing.
      console.error(`[imperial] ${term.name} FAILED: ${(e as Error).message} — nothing written.`);
    }
  }

  console.log('\n[imperial] DONE');
  for (const s of summary) console.log(`  ${s.term}: ${s.count} sections`);
  if (summary.length === 0) {
    console.error('[imperial] no terms produced data.');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('[imperial] fatal:', e);
  process.exitCode = 1;
});
