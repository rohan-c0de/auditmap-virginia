/**
 * scrape-ccsf.ts — City College of San Francisco class schedule
 *
 * CCSF publishes its full class schedule as a public, server-rendered
 * Drupal Views page at https://www.ccsf.edu/courses (view id
 * `courses-page-class-schedule`). No login, no SSO. The page renders an
 * HTML table of sections — 25 sections per page — and accepts GET
 * exposed-filter params:
 *
 *   field_term_target_id   term taxonomy id (e.g. Fall 2026 = 5876486)
 *   field_subject_target_id[]  subject taxonomy id(s) — optional
 *   field_crn_value        single CRN — optional
 *   page                   0-indexed pager
 *
 * Term taxonomy ids are read live from the term <select> on /courses at
 * runtime (they shift each catalog cycle), so this scraper never hardcodes
 * a stale id. Observed at build time: Fall 2026=5876486, Summer 2026=5876296,
 * Spring 2026=5876136.
 *
 * Table structure (per section = a pair of <tr>):
 *   <tr class="course-data">              the visible row
 *     td.views-field-field-crn            CRN
 *     td.views-field-field-subject-code   subject code  -> course_prefix
 *     td.views-field-field-course-id      course number -> course_number
 *     td.views-field-field-section        section
 *     td.views-field-title                title
 *     td.views-field-field-units          units -> credits
 *     td.views-field-field-dates          meeting day-wrapper week + time + dates
 *     td.views-field-field-instructors    instructor link(s)
 *     td.views-field-field-campus-taxonomy campus
 *     td.views-field-nothing              modality icon (title="Class taught …")
 *   <tr class="course-additional-data hidden">  catalog description / location
 *
 * Meeting cell: a <div class="week"> with 7 <div class="day-wrapper"> in fixed
 * positional order Su Mo Tu We Th Fr Sa; the meeting days carry the `active`
 * class. Time is "9:10am-10:25am" (or <div class="tba">Asynchronous</div> for
 * online async). Dates are "08/20-12/22" (no year — derived from the term).
 *
 * CCSF does NOT publish live seat counts anywhere on the page, so
 * seats_open / seats_total are always null. Prerequisites are likewise not
 * exposed on the schedule page, so prerequisite_text=null / [].
 *
 * Output: data/ca/courses/city-college-of-san-francisco/{2026FA|2026SU|2026SP}.json
 *
 * Usage:
 *   tsx scripts/ca/scrape-ccsf.ts                # all upcoming terms found live
 *   tsx scripts/ca/scrape-ccsf.ts --term 2026FA  # single term
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import * as fs from "fs";
import * as path from "path";

const ORIGIN = "https://www.ccsf.edu";
const BASE = `${ORIGIN}/courses`;
const COLLEGE_CODE = "city-college-of-san-francisco";
const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses", COLLEGE_CODE);

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
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

// Maps a CCSF term label (from the live <select>) to our internal file term.
const TERM_LABEL_TO_FILE: Array<{ re: RegExp; suffix: "FA" | "SP" | "SU" }> = [
  { re: /\bfall\b/i, suffix: "FA" },
  { re: /\bspring\b/i, suffix: "SP" },
  { re: /\bsummer\b/i, suffix: "SU" },
];

function labelToFileTerm(label: string): string | null {
  const yearMatch = label.match(/\b(20\d{2})\b/);
  if (!yearMatch) return null;
  const year = yearMatch[1];
  for (const { re, suffix } of TERM_LABEL_TO_FILE) {
    if (re.test(label)) return `${year}${suffix}`;
  }
  return null;
}

// Positional day order in the .week day-wrapper grid → our day tokens.
const DAY_TOKENS = ["Su", "M", "Tu", "W", "Th", "F", "Sa"] as const;

async function fetchHtml(url: string, attempt = 1): Promise<string> {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (err) {
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  }
}

interface TermOption {
  id: string;
  label: string;
  fileTerm: string;
}

/** Read the term <select> on /courses to get live taxonomy ids + labels. */
async function discoverTerms(): Promise<TermOption[]> {
  const html = await fetchHtml(`${BASE}`);
  const $ = cheerio.load(html);
  const select = $('select[name="field_term_target_id"]').first();
  if (select.length === 0) {
    throw new Error("Could not find term <select> on /courses — page layout changed");
  }
  const terms: TermOption[] = [];
  select.find("option").each((_, opt) => {
    const id = ($(opt).attr("value") ?? "").trim();
    const label = $(opt).text().trim();
    if (!/^\d+$/.test(id)) return; // skip "All"
    const fileTerm = labelToFileTerm(label);
    if (fileTerm) terms.push({ id, label, fileTerm });
  });
  return terms;
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** "9:10am" → "9:10 AM" */
function normalizeTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (!m) return null;
  return `${m[1]}:${m[2]} ${m[3].toUpperCase()}`;
}

/** "08/20" + term year → "2026-08-20" */
function normalizeDate(mmdd: string, year: number): string | null {
  const m = mmdd.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

interface MeetingInfo {
  days: string;
  startTime: string;
  endTime: string;
  startDate: string;
}

/**
 * Parse the first meeting block from a dates cell. CCSF renders one or more
 * <li> meeting blocks; we use the first (the canonical schedule). Days are
 * read positionally from the .week grid; "" when async/TBA.
 */
function parseMeeting(
  $: cheerio.CheerioAPI,
  cell: cheerio.Cheerio<AnyNode>,
  year: number
): MeetingInfo {
  const firstLi = cell.find("li").first();
  const scope = firstLi.length ? firstLi : cell;

  // Days: positional active day-wrappers.
  const dayTokens: string[] = [];
  scope
    .find(".week .day-wrapper")
    .toArray()
    .forEach((dw, idx) => {
      if ($(dw).hasClass("active") && idx < DAY_TOKENS.length) {
        dayTokens.push(DAY_TOKENS[idx]);
      }
    });
  const days = dayTokens.join("");

  // Time range.
  let startTime = "";
  let endTime = "";
  const timeText = cleanText(scope.find(".course-time-range").first().text());
  const rangeMatch = timeText.match(
    /(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)/i
  );
  if (rangeMatch) {
    startTime = normalizeTime(rangeMatch[1]) ?? "";
    endTime = normalizeTime(rangeMatch[2]) ?? "";
  }

  // Start date from "08/20-12/22".
  let startDate = "";
  const datesText = cleanText(scope.find(".start-end-dates").first().text());
  const dm = datesText.match(/(\d{1,2}\/\d{1,2})\s*-\s*(\d{1,2}\/\d{1,2})/);
  if (dm) {
    startDate = normalizeDate(dm[1], year) ?? "";
  }

  return { days, startTime, endTime, startDate };
}

/** Derive mode from the modality icon's title attribute in the row. */
function parseMode(tdNothing: cheerio.Cheerio<AnyNode>, campus: string): Mode {
  const title = (tdNothing.find("[title]").attr("title") ?? "").toLowerCase();
  if (title.includes("online")) {
    return title.includes("hybrid") ? "hybrid" : "online";
  }
  if (title.includes("hybrid")) return "hybrid";
  if (title.includes("in person") || title.includes("in-person")) return "in-person";
  // Fallback to campus text.
  if (/online/i.test(campus)) return "online";
  return "in-person";
}

function parseInstructor($: cheerio.CheerioAPI, cell: cheerio.Cheerio<AnyNode>): string | null {
  const names: string[] = [];
  cell
    .find(".field--name-field-name a, .field--name-field-name")
    .toArray()
    .forEach((el) => {
      const t = cleanText($(el).text());
      if (t && !names.includes(t)) names.push(t);
    });
  if (names.length === 0) {
    // Some rows have no instructor link; treat "Staff"/blank as null.
    return null;
  }
  return names.join("; ");
}

function tdText($: cheerio.CheerioAPI, $tr: cheerio.Cheerio<AnyNode>, cls: string): string {
  return cleanText($tr.find(`td.views-field-${cls} .td-container`).first().text());
}

function parsePage(html: string, term: string, year: number): CourseSection[] {
  const $ = cheerio.load(html);
  const out: CourseSection[] = [];

  $("tr.course-data").each((_, tr) => {
    const $tr = $(tr);

    const crn = tdText($, $tr, "field-crn");
    if (!/^\d+$/.test(crn)) return; // skip non-data rows

    const prefix = tdText($, $tr, "field-subject-code");
    const number = tdText($, $tr, "field-course-id");
    const section = tdText($, $tr, "field-section");
    const title = tdText($, $tr, "title");

    // Units cell contains a "Units" label div followed by the number.
    const unitsRaw = tdText($, $tr, "field-units").replace(/units/i, "").trim();
    const credits = parseFloat(unitsRaw);

    const campus = tdText($, $tr, "field-campus-taxonomy") || "";

    const datesCell = $tr.find("td.views-field-field-dates").first();
    const meeting = parseMeeting($, datesCell, year);

    const instructor = parseInstructor(
      $,
      $tr.find("td.views-field-field-instructors").first()
    );

    const mode = parseMode($tr.find("td.views-field-nothing").first(), campus);

    if (!prefix || !number || !crn) return; // require core identifiers

    out.push({
      college_code: COLLEGE_CODE,
      term,
      course_prefix: prefix.toUpperCase(),
      course_number: number,
      course_title: title || `${prefix} ${number}`,
      credits: Number.isFinite(credits) ? credits : 0,
      crn,
      days: meeting.days,
      start_time: meeting.startTime,
      end_time: meeting.endTime,
      start_date: meeting.startDate,
      location: campus, // CCSF only exposes campus-level location, no room
      campus,
      mode,
      instructor,
      seats_open: null, // CCSF does not publish live seats
      seats_total: null,
      prerequisite_text: null, // not exposed on the schedule page
      prerequisite_courses: [],
    });
  });

  return out;
}

async function scrapeTerm(term: TermOption): Promise<CourseSection[]> {
  const year = parseInt(term.fileTerm.slice(0, 4), 10);
  const sections: CourseSection[] = [];
  const seenCrn = new Set<string>();
  let page = 0;
  const MAX_PAGES = 1000; // safety cap; CCSF terms are well under this
  let emptyStreak = 0;

  while (page < MAX_PAGES) {
    const url = `${BASE}?field_term_target_id=${term.id}&page=${page}`;
    const html = await fetchHtml(url);
    const pageRows = parsePage(html, term.fileTerm, year);

    if (pageRows.length === 0) {
      // One empty page means we've run off the end.
      emptyStreak++;
      if (emptyStreak >= 1) break;
    } else {
      emptyStreak = 0;
      for (const row of pageRows) {
        // Dedupe defensively across pages by CRN.
        if (seenCrn.has(row.crn)) continue;
        seenCrn.add(row.crn);
        sections.push(row);
      }
    }

    if (page % 10 === 0) {
      process.stdout.write(
        `  [${term.fileTerm}] page ${page} → running total ${sections.length}\n`
      );
    }
    page++;
    await new Promise((r) => setTimeout(r, 250)); // polite throttle
  }

  return sections;
}

async function main() {
  const argv = process.argv.slice(2);
  const termArgIdx = argv.indexOf("--term");
  const termFilter = termArgIdx >= 0 ? argv[termArgIdx + 1] : null;

  console.log("Discovering live CCSF terms from /courses term <select>…");
  const allTerms = await discoverTerms();
  if (allTerms.length === 0) {
    throw new Error("No usable terms discovered from /courses — aborting (nothing written).");
  }
  console.log(
    "Discovered terms: " +
      allTerms.map((t) => `${t.fileTerm} (${t.label} = ${t.id})`).join(", ")
  );

  const terms = termFilter
    ? allTerms.filter((t) => t.fileTerm === termFilter)
    : allTerms;

  if (terms.length === 0) {
    throw new Error(
      `--term ${termFilter} not found among live terms: ${allTerms
        .map((t) => t.fileTerm)
        .join(", ")}`
    );
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const summary: Array<{ term: string; count: number }> = [];

  for (const term of terms) {
    console.log(`\n=== Scraping ${term.fileTerm} (${term.label}, id=${term.id}) ===`);
    const sections = await scrapeTerm(term);

    if (sections.length === 0) {
      console.error(
        `!! ${term.fileTerm}: zero sections scraped — NOT writing a file (no stub data).`
      );
      continue;
    }

    const outPath = path.join(DATA_DIR, `${term.fileTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`   wrote ${sections.length} sections → ${outPath}`);

    // Verify the file re-reads with a real CRN/title and correct college_code.
    const reread = JSON.parse(fs.readFileSync(outPath, "utf-8")) as CourseSection[];
    const sample = reread[0];
    if (
      !Array.isArray(reread) ||
      reread.length !== sections.length ||
      sample.college_code !== COLLEGE_CODE ||
      !sample.crn ||
      !sample.course_title
    ) {
      throw new Error(`Verification failed for ${outPath} — file is malformed.`);
    }
    console.log(
      `   verified: ${reread.length} rows, sample CRN ${sample.crn} ` +
        `${sample.course_prefix} ${sample.course_number} "${sample.course_title}"`
    );
    summary.push({ term: term.fileTerm, count: sections.length });
  }

  console.log("\n=== SUMMARY ===");
  for (const s of summary) console.log(`  ${s.term}: ${s.count} sections`);
  if (summary.length === 0) {
    throw new Error("No terms produced data — nothing written.");
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
