/**
 * Allen Community College — ASP.NET WebForms scraper
 *
 * Allen runs a legacy ASP.NET WebForms course-schedule page at
 * `https://web.allencc.edu/portal/asp/schedule.aspx`. The form requires
 * a __VIEWSTATE + __VIEWSTATEGENERATOR + __EVENTVALIDATION round-trip
 * (GET form → extract hidden fields → POST with selected term).
 *
 * Notable quirks:
 *  - `syr` is the academic-year-ending year (e.g. 2027 = AY 2026-2027).
 *    Combined with `sess` (FA / SP / SU), each (syr, sess) pair maps to
 *    one calendar term:
 *      syr=2027, sess=FA → Fall 2026
 *      syr=2027, sess=SP → Spring 2027
 *      syr=2027, sess=SU → Summer 2027
 *  - The submit button is named `btnSendFeedback` (misleading — it IS the
 *    "Search for Sections" button).
 *  - Section rows are malformed HTML — a course-header `<TR>` is followed
 *    by section `<TD>` rows that don't open a fresh `<TR>` until the next
 *    course-header. We split on `</TR>` and pair each section-row with
 *    the most-recent course header.
 *  - Days encoded as a 7-char string `UMTWRFS` with `-` for non-meeting
 *    days (so `-M-W-F-` = MWF, `--T-R--` = TR).
 *
 * Tracks GitHub issue #957.
 *
 * Usage:
 *   npx tsx scripts/ks/scrape-allen.ts
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "allen-county-community-college";
const STATE = "ks";
const FORM_URL = "https://web.allencc.edu/portal/asp/schedule.aspx";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

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
  prerequisite_courses: string[];
}

interface HiddenFields {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
}

const SESS_TO_SUFFIX: Record<string, string> = { FA: "FA", SP: "SP", SU: "SU" };

// syr is AY-ending. (syr, sess) → standard term YYYY{FA|SP|SU}.
function buildStdTerm(syr: number, sess: string): string {
  if (sess === "FA") return `${syr - 1}FA`;
  if (sess === "SP") return `${syr}SP`;
  if (sess === "SU") return `${syr}SU`;
  return `${syr}XX`;
}

function decodeDays(raw: string): string {
  // UMTWRFS positional. "-" = not meeting.
  // Map indexes 0..6 → "U M T W R F S"
  const pos = ["U", "M", "T", "W", "R", "F", "S"];
  let out = "";
  for (let i = 0; i < raw.length && i < 7; i++) {
    if (raw[i] !== "-" && raw[i] === pos[i]) out += pos[i];
  }
  if (out === "" && raw.includes("-")) return "";
  return out;
}

function parseTime(raw: string): { start: string; end: string } {
  const m = raw.match(/(\d{1,2}:\d{2}\s?(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s?(?:AM|PM))/i);
  if (!m) return { start: "", end: "" };
  return { start: m[1].toUpperCase(), end: m[2].toUpperCase() };
}

function parseDates(raw: string): { start_date: string } {
  // e.g. "08/18/2025-12/10/2025"
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*\d{2}\/\d{2}\/\d{4}/);
  if (!m) return { start_date: "" };
  return { start_date: `${m[3]}-${m[1]}-${m[2]}` };
}

function inferMode(campus: string, days: string): "in-person" | "online" | "hybrid" {
  const c = campus.toLowerCase();
  if (c.includes("hybrid") || c === "hyb") return "hybrid";
  if (c.includes("online") || c === "onl" || days === "") return "online";
  return "in-person";
}

async function fetchHidden(): Promise<{ fields: HiddenFields; cookieJar: string }> {
  const res = await fetch(FORM_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const cookies = res.headers.getSetCookie?.() ?? [];
  const cookieJar = cookies.map((c) => c.split(";")[0]).join("; ");

  const getField = (name: string): string => {
    const m = html.match(new RegExp(`name="${name}"[^>]*value="([^"]+)"`));
    if (!m) throw new Error(`Missing hidden field ${name} on form page`);
    return m[1];
  };

  return {
    fields: {
      viewState: getField("__VIEWSTATE"),
      viewStateGenerator: getField("__VIEWSTATEGENERATOR"),
      eventValidation: getField("__EVENTVALIDATION"),
    },
    cookieJar,
  };
}

async function searchTerm(
  syr: number,
  sess: string,
  fields: HiddenFields,
  cookieJar: string,
): Promise<string> {
  const body = new URLSearchParams({
    __VIEWSTATE: fields.viewState,
    __VIEWSTATEGENERATOR: fields.viewStateGenerator,
    __EVENTVALIDATION: fields.eventValidation,
    syr: String(syr),
    sess,
    dept: "ALL",
    instr: "ALL",
    mdays: "ALL",
    btime: "ALL",
    campus: "both",
    btnSendFeedback: "Send Request",
  });
  const res = await fetch(FORM_URL, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: FORM_URL,
      Origin: "https://web.allencc.edu",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: cookieJar,
    },
    body: body.toString(),
  });
  return await res.text();
}

function parseResults(html: string, stdTerm: string): CourseSection[] {
  // Split on </TR> and walk each fragment. Track the most-recent course
  // header (PREFIX###  +  Title) to attach to subsequent section rows.
  const fragments = html.split(/<\/TR>/i);
  let currentPrefix = "";
  let currentNumber = "";
  let currentTitle = "";
  const sections: CourseSection[] = [];

  for (const frag of fragments) {
    // Course header? e.g. "<TR><TD><B>AGR101</B></TD><TD ColSpan=8 Align=Left><B>Agriculture Orientation </B></TD>"
    const headerMatch = frag.match(/<TD><B>([A-Z]{2,5})(\d{3}[A-Z]?)<\/B><\/TD><TD\s+ColSpan=8\s+Align=Left><B>([^<]+)<\/B>/i);
    if (headerMatch) {
      currentPrefix = headerMatch[1];
      currentNumber = headerMatch[2];
      currentTitle = headerMatch[3].trim();
      continue;
    }

    if (!currentPrefix) continue;

    // Section row: <TD>&nbsp;</TD><TD bgcolor=...>SEC</TD><TD>CREDITS</TD><TD>TIME</TD><TD>DAYS</TD><TD>CAMPUS</TD><TD>ROOM</TD><TD>INST</TD><TD><span...>DATES</span></TD><TD ...>REG/ENR
    // Use cheerio for resilient parsing.
    if (!/<TD\s+bgcolor=/i.test(frag)) continue;
    const $ = cheerio.load(`<table>${frag}</table>`);
    const tds = $("td").toArray();
    if (tds.length < 9) continue;

    // Section is in the 2nd td (after the &nbsp; spacer)
    const section = $(tds[1]).text().trim();
    const creditsRaw = $(tds[2]).text().trim();
    const credits = parseFloat(creditsRaw) || 0;
    const timeRaw = $(tds[3]).text().trim();
    const daysRaw = $(tds[4]).text().trim();
    const campus = $(tds[5]).text().trim();
    const room = $(tds[6]).text().trim();
    const instructor = $(tds[7]).text().trim() || null;
    const datesRaw = $(tds[8]).text().trim();
    const enrollment = $(tds[9])?.text().trim() ?? "";

    const days = decodeDays(daysRaw);
    const { start, end } = parseTime(timeRaw);
    const { start_date } = parseDates(datesRaw);

    let seats_total: number | null = null;
    let seats_open: number | null = null;
    const enrM = enrollment.match(/(\d+)\s*\/\s*(\d+)/);
    if (enrM) {
      const reg = parseInt(enrM[1], 10);
      seats_total = parseInt(enrM[2], 10);
      seats_open = Math.max(0, seats_total - reg);
    }

    sections.push({
      college_code: SLUG,
      term: stdTerm,
      course_prefix: currentPrefix,
      course_number: currentNumber,
      course_title: currentTitle,
      credits,
      crn: `${currentPrefix}-${currentNumber}-${section}`,
      days,
      start_time: start,
      end_time: end,
      start_date,
      location: room,
      campus,
      mode: inferMode(campus, days),
      instructor,
      seats_open,
      seats_total,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  return sections;
}

function isCurrentOrUpcoming(stdTerm: string, refYear: number): boolean {
  const m = stdTerm.match(/^(\d{4})(SP|SU|FA)$/);
  if (!m) return false;
  const year = parseInt(m[1], 10);
  const season = m[2];
  if (year < refYear) return false;
  if (year > refYear + 1) return false;
  if (year === refYear && season === "SP") return false;
  return true;
}

async function main() {
  console.log("🌾 Allen Community College scraper");
  console.log(`   Source: ${FORM_URL}`);

  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const refYear = new Date().getUTCFullYear();
  const candidates: { syr: number; sess: string; stdTerm: string }[] = [];
  // Iterate AY 2026, 2027 (syr=2026 covers FA-25/SP-26/SU-26; syr=2027 covers FA-26/SP-27/SU-27)
  for (let syr = refYear; syr <= refYear + 2; syr++) {
    for (const sess of ["FA", "SP", "SU"]) {
      const stdTerm = buildStdTerm(syr, sess);
      if (isCurrentOrUpcoming(stdTerm, refYear)) {
        candidates.push({ syr, sess, stdTerm });
      }
    }
  }

  console.log(`   Target terms: ${candidates.map((c) => `${c.syr}/${c.sess} → ${c.stdTerm}`).join(", ")}`);

  let grandTotal = 0;
  for (const { syr, sess, stdTerm } of candidates) {
    const { fields, cookieJar } = await fetchHidden(); // fresh viewstate per request
    const html = await searchTerm(syr, sess, fields, cookieJar);
    const sections = parseResults(html, stdTerm);
    if (sections.length === 0) {
      console.log(`    → 0 sections (${syr}/${sess} → ${stdTerm})`);
      continue;
    }
    const outPath = path.join(COURSES_DIR, `${stdTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`    ✓ ${stdTerm}: ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ ${SLUG}: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("❌ Allen scraper failed:", err);
  process.exit(1);
});
