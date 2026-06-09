/**
 * Grayson College — bespoke HTML scrape of the custom ".NET Student Planner"
 *
 * Grayson publishes its public class schedule (no auth) via a custom ASP.NET
 * "Student Planner" at:
 *
 *   https://planner.grayson.edu/Planner/CourseSearch/{termId}
 *
 * Each term renders a single ~3.3 MB HTML page containing ~650 section rows in
 * one big <table> whose <thead> columns are:
 *   Course | Name | Dates | Campus | Seats | Status | Days | Room | Time | Faculty
 *
 * Every section is a `<tr class="child">` with two anchors (section code +
 * course name) carrying `data-info='{"termId":601,"offerId":117613}'`. There is
 * NO CRN, so we synthesize one from the section code. Every data cell also
 * exposes a clean `title="Label: value"` attribute (e.g. title="Seats: 23/30",
 * title="Days: TR", title="Time: 11:00 AM - 12:30 PM") — we parse those titles,
 * which is far more robust than reaching into the responsive cell markup.
 *
 * The term dropdown (`a.dropdown-toggle` + `a.dropdown-item.gc-link`) is the
 * authoritative termId → term-name map; we read it off the page rather than
 * hardcoding term ids (which drift each registration cycle).
 *
 * Notes / gotchas discovered while building this:
 *   - The CourseSearchDetail API returns 401 — do NOT call it. All the data we
 *     need is already in the CourseSearch HTML.
 *   - Section codes look like `ACCT2301B01HY`: PREFIX(2-4 alpha) + NUMBER(4
 *     digit) + SESSION(A/B/C/D) + SECTION(2 digit) + optional MODE suffix.
 *     Only `HY` (hybrid) and `NT` (internet) appear as mode suffixes; most
 *     sections have no suffix, so mode is derived primarily from Campus/Room/
 *     Days, not the code.
 *   - Credit hours are NOT present anywhere on the page → credits = 0.
 *   - Online/async sections show Campus=Internet, Room=Internet, Days=N/A,
 *     and Time of "N/A", blank, or the placeholder "12:00 AM - 12:00 AM".
 *
 * Output: one pretty-printed JSON array per term →
 *   data/tx/courses/grayson-college/{TERMCODE}.json  (e.g. 2026SP.json)
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-grayson.ts            # all credit terms in dropdown
 *   npx tsx scripts/tx/scrape-grayson.ts --terms 601,607
 */
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
// cheerio 1.2 doesn't re-export the node types as `cheerio.*` — import directly.
import type { AnyNode } from "domhandler";

const SLUG = "grayson-college";
const STATE = "tx";
const BASE = "https://planner.grayson.edu/Planner/CourseSearch";
const OUT_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

/** "Spring 2026" → "2026SP"; "Fall 2026" → "2026FA"; "Summer 2026" → "2026SU". */
function termNameToCode(name: string): string | null {
  const m = name.match(/(Spring|Summer|Fall|Winter|Maymester|Wintermester)\s*(\d{4})/i);
  if (!m) return null;
  const season = m[1].toLowerCase();
  const year = m[2];
  let suffix: string;
  if (season.startsWith("spring") || season === "maymester") suffix = "SP";
  else if (season.startsWith("summer")) suffix = "SU";
  else if (season.startsWith("fall")) suffix = "FA";
  else suffix = "WI"; // Winter / Wintermester
  return `${year}${suffix}`;
}

/** Read the term dropdown into [{ termId, name, code }]. Skips non-credit / unmappable. */
function parseTermMenu($: cheerio.CheerioAPI): Array<{ termId: string; name: string; code: string }> {
  const out: Array<{ termId: string; name: string; code: string }> = [];
  const seen = new Set<string>();
  $("a.dropdown-toggle, a.dropdown-item").each((_i, el) => {
    const $el = $(el);
    const name = $el.text().trim();
    if (!/(Spring|Summer|Fall|Winter|mester)\s*\d{4}/i.test(name)) return;
    // termId lives in either the value="" attr (toggle) or the /…/{id} href (items)
    let termId = ($el.attr("value") || "").trim();
    if (!termId) {
      const href = $el.attr("href") || "";
      const hm = href.match(/CourseSearch\/(\d+)/);
      if (hm) termId = hm[1];
    }
    if (!termId) return;
    const code = termNameToCode(name);
    if (!code) return;
    if (seen.has(termId)) return;
    seen.add(termId);
    out.push({ termId, name, code });
  });
  return out;
}

/** Pull "value" out of a cell's title="Label: value" attribute. */
function titleValue($cell: cheerio.Cheerio<AnyNode>, label: string): string {
  const t = ($cell.attr("title") || "").trim();
  const re = new RegExp(`^${label}\\s*:\\s*`, "i");
  if (!re.test(t)) return "";
  return t.replace(re, "").trim();
}

const VALID_DAYS = new Set(["M", "T", "W", "R", "F", "S", "U"]);

/**
 * Grayson days look like "TR", "MW, RF" (multi-meeting), "N/A", "N\\A", or "".
 * Collapse to the union of distinct valid day letters, preserving MTWRFSU order.
 */
function normalizeDays(raw: string): string {
  if (!raw) return "";
  const up = raw.toUpperCase();
  if (up.includes("N/A") || up.includes("N\\A") || up.includes("TBA")) return "";
  const present = new Set<string>();
  for (const ch of up) if (VALID_DAYS.has(ch)) present.add(ch);
  return ["M", "T", "W", "R", "F", "S", "U"].filter((d) => present.has(d)).join("");
}

/**
 * "11:00 AM - 12:30 PM" → { start, end }. Handles the async placeholder
 * "12:00 AM - 12:00 AM" and "N/A"/blank by returning empty strings.
 */
function parseTime(raw: string): { start: string; end: string } {
  if (!raw) return { start: "", end: "" };
  const m = raw.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!m) return { start: "", end: "" };
  const start = m[1].replace(/\s+/g, " ").trim();
  const end = m[2].replace(/\s+/g, " ").trim();
  // "12:00 AM - 12:00 AM" is the planner's stand-in for an async / no-time section.
  if (start === end) return { start: "", end: "" };
  return { start, end };
}

/** "Jan 20 - Mar 12" → "Jan 20" (start date only, as a free-text token). */
function parseStartDate(raw: string): string {
  if (!raw) return "";
  const first = raw.split(/\s*-\s*/)[0] ?? "";
  return first.trim();
}

const ISO_MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
/**
 * Normalize a "Mon DD" Student-Planner date to ISO YYYY-MM-DD using the term's
 * year (termCode "2026FA" → 2026). The Supabase courses table types start_date
 * as `date`, so a bare "Aug 17" is rejected at import — must be ISO or "".
 */
function toIsoDate(raw: string, termCode: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw; // already ISO
  const m = raw.trim().match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})$/);
  const mon = m ? ISO_MONTHS[m[1].slice(0, 3).toLowerCase()] : undefined;
  const year = termCode.slice(0, 4);
  if (!m || !mon || !/^\d{4}$/.test(year)) return "";
  return `${year}-${mon}-${m[2].padStart(2, "0")}`;
}

/** "23/30" → { open: 30-23=7, total: 30 }. */
function parseSeats(raw: string): { open: number | null; total: number | null } {
  const m = raw.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return { open: null, total: null };
  const enrolled = parseInt(m[1], 10);
  const total = parseInt(m[2], 10);
  if (!Number.isFinite(total)) return { open: null, total: null };
  const open = Number.isFinite(enrolled) ? Math.max(0, total - enrolled) : null;
  return { open, total };
}

/**
 * Decide delivery mode. The section-code suffix only sometimes encodes it
 * (HY=hybrid, NT=internet), so we lean on the campus/room/days signals.
 *   - hybrid  : code ends in HY (some scheduled meetings + online component)
 *   - online  : Internet campus/room, or no meeting days at all
 *   - zoom    : explicit "zoom" anywhere
 *   - in-person otherwise
 */
function classifyMode(opts: {
  code: string;
  campus: string;
  room: string;
  days: string;
}): CourseMode {
  const blob = `${opts.campus} ${opts.room}`.toLowerCase();
  if (/zoom/.test(blob)) return "zoom";
  if (/(^|[^A-Z])HY$/i.test(opts.code)) return "hybrid";
  if (/internet|online|web|distance/.test(blob)) return "online";
  // No meeting days AND no physical campus/room → genuinely online/async.
  // (Clinicals, labs and practicums — e.g. RNSG, CSME — have a real Main-campus
  //  room and a time block but no fixed weekday; those stay in-person.)
  const hasPhysical =
    !!opts.room ||
    (!!opts.campus && !/internet|online|web|tba|n\/a|n\\a/i.test(opts.campus));
  if (!opts.days && !hasPhysical) return "online";
  return "in-person";
}

function rowToSection(
  $: cheerio.CheerioAPI,
  $r: cheerio.Cheerio<AnyNode>,
  termCode: string
): CourseSection | null {
  const $courseCell = $r.find('td[title^="Course:"]').first();
  const code = titleValue($courseCell, "Course");
  if (!code) return null;
  const m = code.match(/^([A-Z]{2,4})(\d{4})(.*)$/);
  if (!m) return null;
  const prefix = m[1];
  const number = m[2];
  const tail = (m[3] || "").trim(); // e.g. "B01HY" → session+section(+mode)

  // course title: the second anchor / the Name: cell
  const title = titleValue($r.find('td[title^="Name:"]').first(), "Name");

  const datesRaw = titleValue($r.find('td[title^="Dates:"]').first(), "Dates");
  const campus = titleValue($r.find('td[title^="Campus:"]').first(), "Campus");
  const seatsRaw = titleValue($r.find('td[title^="Seats:"]').first(), "Seats");
  const daysRaw = titleValue($r.find('td[title^="Days:"]').first(), "Days");
  const room = titleValue($r.find('td[title^="Room:"]').first(), "Room");
  const timeRaw = titleValue($r.find('td[title^="Time:"]').first(), "Time");
  // The instructor column header is "Instructor" but the cell title is "Faculty:".
  const instructorRaw =
    titleValue($r.find('td[title^="Faculty:"]').first(), "Faculty") ||
    titleValue($r.find('td[title^="Instructor:"]').first(), "Instructor");

  const days = normalizeDays(daysRaw);
  const { start, end } = parseTime(timeRaw);
  const { open, total } = parseSeats(seatsRaw);
  const mode = classifyMode({ code, campus, room, days });

  // CRN: spec says synthesize `${prefix}-${number}-${sectionNum}`. The tail
  // (e.g. "B01HY") IS the section designator, so use the whole code's tail.
  const crn = `${prefix}-${number}-${tail || "0"}`;

  // location: prefer the specific room when it's a real room; fall back to campus.
  const roomClean = /n\/a|n\\a|^\s*$/i.test(room) ? "" : room;
  const location = roomClean || campus;

  return {
    college_code: SLUG,
    term: termCode,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits: 0, // not published anywhere in the Student Planner HTML
    crn,
    days,
    start_time: start,
    end_time: end,
    start_date: toIsoDate(parseStartDate(datesRaw), termCode),
    location,
    campus,
    mode,
    instructor: instructorRaw || null,
    seats_open: open,
    seats_total: total,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

async function fetchHtml(url: string): Promise<string> {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html" },
      });
      if (res.status >= 500 && res.status < 600) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} (non-retryable)`);
      return await res.text();
    } catch (e) {
      attempt++;
      const msg = e instanceof Error ? e.message : String(e);
      // Only retry transient 5xx / network errors, up to 3 times.
      if (attempt > 3 || /non-retryable/.test(msg)) throw e;
      console.log(`   ⚠️  ${msg} — retry ${attempt}/3 …`);
      await sleep(2000 * attempt);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const termsArg = args.find((a) => a.startsWith("--terms"))?.split(/[=\s]/)[1];
  const forcedTerms = termsArg ? termsArg.split(",").map((s) => s.trim()) : null;

  console.log(`🐎 Grayson College — Student Planner HTML scrape`);
  console.log(`   ${BASE}/{termId}`);

  // Load any one term page to read the authoritative term dropdown. Use the
  // first forced term if provided, else 601 (the planner's default landing).
  const seedTerm = forcedTerms?.[0] ?? "601";
  const seedHtml = await fetchHtml(`${BASE}/${seedTerm}`);
  const $seed = cheerio.load(seedHtml);
  let terms = parseTermMenu($seed);

  if (forcedTerms) {
    terms = terms.filter((t) => forcedTerms.includes(t.termId));
    // include any forced id the menu didn't surface, code unknown → skip-with-warn later
    for (const id of forcedTerms) {
      if (!terms.some((t) => t.termId === id)) {
        console.log(`   ⚠️  forced term ${id} not in dropdown — skipping (no term name)`);
      }
    }
  }

  console.log(
    `   terms: ${terms.map((t) => `${t.termId}→${t.name} (${t.code})`).join(", ") || "(none)"}`
  );
  if (terms.length === 0) {
    throw new Error("No mappable terms found in the planner dropdown.");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Multiple display terms can map to the same code (rare); merge them.
  const byCode = new Map<string, CourseSection[]>();
  const summary: Array<{ termId: string; name: string; code: string; sections: number }> = [];

  for (const t of terms) {
    // reuse the already-fetched seed page when it's the same term
    const html = t.termId === seedTerm ? seedHtml : await fetchHtml(`${BASE}/${t.termId}`);
    const $ = cheerio.load(html);
    const rows = $("tr.child");
    let n = 0;
    let skipped = 0;
    rows.each((_i, el) => {
      const sec = rowToSection($, $(el), t.code);
      if (!sec) {
        skipped++;
        return;
      }
      if (!byCode.has(t.code)) byCode.set(t.code, []);
      byCode.get(t.code)!.push(sec);
      n++;
    });
    summary.push({ termId: t.termId, name: t.name, code: t.code, sections: n });
    console.log(
      `   ${t.termId} ${t.name}: ${n} sections${skipped ? ` (${skipped} unparseable rows skipped)` : ""}`
    );
    if (t.termId !== seedTerm) await sleep(750); // gentle pacing between term pages
  }

  let grandTotal = 0;
  for (const [code, sections] of [...byCode.entries()].sort()) {
    const outFile = path.join(OUT_DIR, `${code}.json`);
    fs.writeFileSync(outFile, JSON.stringify(sections, null, 2) + "\n");
    console.log(`   ✓ ${code}: ${sections.length} sections → ${outFile}`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ ${grandTotal} sections across ${byCode.size} term file(s).`);
}

main().catch((e) => {
  console.error("❌ Grayson scraper failed:", e);
  process.exit(1);
});
