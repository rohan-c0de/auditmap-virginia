/**
 * Fort Hays Tech | Northwest (formerly Northwest Kansas Technical College)
 * — Empower-XL course schedule scraper
 *
 * Empower Student Information System (ComSpec International, Inc.) ColdFusion
 * back end. The college rebranded to "Fort Hays Tech | Northwest" in 2024
 * (HLC-approved Change of Control), now operating at fhnw.edu. The legacy
 * `nwktc.empower-xl.com` host still serves the public course catalog and is
 * linked from `fhnw.edu/schedule-of-classes`.
 *
 * The course list is server-rendered into a ColdFusion CFC AJAX endpoint
 * (no static table on the form page):
 *   POST /cfcs/courseCatalog.cfc?method=GetList
 *   body: serialized form (token + empower_global_term_id + filters)
 *   response: { SUCCESS: true, MSG: "...", html: "<div class='ui-grid-row'>..." }
 *
 * The HTML is row-per-grid-row (NOT <table><tr>), with 9 columns per section:
 *   Location | Course (PREFIX NUMBER SEC + Title) | Credit + Delivery | Classroom | Schedule | Instructor | Total | Open | Offer
 *
 * Term codes follow YYNN where NN ∈ {SP, SU, FA} (e.g. 26FA = Fall 2026).
 *
 * Tracks GitHub issue #957.
 *
 * Usage:
 *   npx tsx scripts/ks/scrape-fhnw-empower-xl.ts
 *   npx tsx scripts/ks/scrape-fhnw-empower-xl.ts --term 26FA
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "northwest-kansas-technical-college";
const STATE = "ks";
const BASE_URL = "https://nwktc.empower-xl.com";
const FORM_URL = `${BASE_URL}/fusebox.cfm?fuseaction=CourseCatalog`;
const GETLIST_URL = `${BASE_URL}/cfcs/courseCatalog.cfc?method=GetList`;
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

function empowerTermToStandard(code: string): string {
  // e.g. "26FA" → "2026FA"
  const m = code.match(/^(\d{2})(SP|SU|FA)$/);
  if (!m) return code;
  return `20${m[1]}${m[2]}`;
}

function isCurrentOrUpcoming(stdTerm: string, refYear: number): boolean {
  // Skip past academic years; allow current FY (Aug–Jul) + next 2 academic years
  const m = stdTerm.match(/^(\d{4})(SP|SU|FA)$/);
  if (!m) return false;
  const year = parseInt(m[1], 10);
  const season = m[2];
  // Current academic year runs Aug refYear → Jul refYear+1
  // Include: refYear FA/SP/SU and refYear+1 FA/SP/SU
  if (year < refYear) return false;
  if (year > refYear + 1) return false;
  if (year === refYear && season === "SP") return false; // already past
  return true;
}

function parseTime(raw: string): { start: string; end: string } {
  const m = raw.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!m) return { start: "", end: "" };
  return { start: m[1], end: m[2] };
}

function parseStartDate(raw: string): string {
  const m = raw.match(/start:(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function inferMode(location: string, days: string, deliveryMethod: string): "in-person" | "online" | "hybrid" {
  const loc = location.toLowerCase();
  const dm = deliveryMethod.toLowerCase();
  if (dm.includes("hybrid") || loc.includes("hybrid")) return "hybrid";
  if (loc.includes("online") || dm.includes("online") || dm === "web" || loc === "tbd / tbd") return "online";
  if (days === "" && loc === "") return "online";
  return "in-person";
}

async function fetchFormPage(): Promise<{ token: string; terms: { code: string; label: string }[]; cookieJar: string }> {
  const res = await fetch(FORM_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const cookies = res.headers.getSetCookie?.() ?? [];
  const cookieJar = cookies.map((c) => c.split(";")[0]).join("; ");

  const tokenMatch = html.match(/name="token" id="token" value="([A-F0-9]{40})"/);
  if (!tokenMatch) throw new Error("Could not extract token from form page");

  const $ = cheerio.load(html);
  const terms: { code: string; label: string }[] = [];
  $('select[name="empower_global_term_id"] option').each((_, el) => {
    const val = $(el).attr("value") || "";
    const label = $(el).text().trim();
    if (/^\d{2}(SP|SU|FA)$/.test(val)) {
      terms.push({ code: val, label });
    }
  });

  return { token: tokenMatch[1], terms, cookieJar };
}

async function scrapeTerm(termCode: string, token: string, cookieJar: string): Promise<CourseSection[]> {
  const stdTerm = empowerTermToStandard(termCode);
  const formData = new URLSearchParams({
    token,
    fuseaction: "CourseCatalog",
    empower_global_term_id: termCode,
    empower_global_dept_id: "",
    empower_global_course_id: "",
    cs_descr: "",
    cs_inst_id: "",
    cs_classroom: "",
    cs_sess_id: "",
    cs_loca_id: "",
    cs_emph_id: "",
    screen_width: "1280",
    status: "1",
  });

  const res = await fetch(GETLIST_URL, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: FORM_URL,
      Cookie: cookieJar,
    },
    body: formData.toString(),
  });

  const json = (await res.json()) as { SUCCESS: boolean; MSG?: string; html?: string };
  if (!json.SUCCESS || !json.html) {
    console.log(`    ✗ ${termCode}: ${json.MSG ?? "no html in response"}`);
    return [];
  }

  // Parse the HTML grid rows. Each non-header ui-grid-row holds one section
  // (9 columns) — and the column content uses <br/> to separate sub-fields.
  const $ = cheerio.load(`<div id="root">${json.html}</div>`);
  const sections: CourseSection[] = [];

  // Top-level rows (direct children of #root)
  const rows = $("#root > div.ui-grid-row").toArray();

  for (const row of rows) {
    const $row = $(row);
    const cols = $row.children("div").toArray();
    // Skip header row (contains text "Location", "Course", etc.)
    if (cols.length < 7) continue;
    const firstColText = $(cols[0]).text().trim();
    if (firstColText === "Location" || firstColText === "") continue;
    if (cols.length === 1) continue; // Spacer / HR row

    // Column 0: Location (single character)
    const location = $(cols[0]).text().trim();
    // Column 1: Course (PREFIX  NUMBER  SECTION<br/>Title)
    const courseHtml = $(cols[1]).html() ?? "";
    const courseClean = courseHtml.replace(/&nbsp;/g, " ").replace(/<br\s*\/?>/gi, "|").replace(/<[^>]+>/g, "").trim();
    const [courseLine = "", titleLine = ""] = courseClean.split("|").map((s) => s.trim());
    const courseMatch = courseLine.match(/^([A-Z]{2,5})\s+(\S+)\s+(\S+)$/);
    if (!courseMatch) continue;
    const [, prefix, number, section] = courseMatch;
    const title = titleLine;

    // Column 2: Credits + Delivery
    const creditCol = $(cols[2]).html() ?? "";
    const creditClean = creditCol.replace(/&nbsp;/g, " ").replace(/<br\s*\/?>/gi, "|").replace(/<[^>]+>/g, "").trim();
    const [creditsRaw = "", deliveryMethod = ""] = creditClean.split("|").map((s) => s.trim());
    const credits = parseFloat(creditsRaw) || 0;

    // Column 3: Classroom
    const classroomCol = $(cols[3]).html() ?? "";
    const classroomClean = classroomCol.replace(/&nbsp;/g, " ").replace(/<br\s*\/?>/gi, " / ").replace(/<[^>]+>/g, "").trim();

    // Column 4: Schedule (start:MM/DD/YYYY<br/>DAYS<br/>TIME)
    const scheduleCol = $(cols[4]).html() ?? "";
    const scheduleClean = scheduleCol.replace(/&nbsp;/g, " ").replace(/<br\s*\/?>/gi, "|").replace(/<[^>]+>/g, "").trim();
    const scheduleParts = scheduleClean.split("|").map((s) => s.trim());
    const start_date = parseStartDate(scheduleParts.find((p) => p.startsWith("start:")) ?? "");
    const daysLine = scheduleParts.find((p) => /^[MTWRFSU]+$/.test(p)) ?? "";
    const timeLine = scheduleParts.find((p) => /\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(p)) ?? "";
    const { start: start_time, end: end_time } = parseTime(timeLine);

    // Column 5: Instructor
    const instructor = $(cols[5]).find("span.inst a").first().text().trim() || $(cols[5]).text().trim() || null;

    // Column 6: Seats total, Column 7: Seats open (filled)
    const seatsTotalRaw = $(cols[6]).text().trim();
    const seatsFilledRaw = $(cols[7]).text().trim();
    const seats_total = seatsTotalRaw ? parseInt(seatsTotalRaw, 10) : null;
    const filled = seatsFilledRaw ? parseInt(seatsFilledRaw, 10) : null;
    const seats_open = seats_total !== null && filled !== null ? Math.max(0, seats_total - filled) : null;

    sections.push({
      college_code: SLUG,
      term: stdTerm,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits,
      crn: `${prefix}-${number}-${section}`,
      days: daysLine,
      start_time,
      end_time,
      start_date,
      location: classroomClean,
      campus: location || "Main",
      mode: inferMode(classroomClean, daysLine, deliveryMethod),
      instructor: instructor === "" ? null : instructor,
      seats_open,
      seats_total,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termFilter = termIdx >= 0 ? args[termIdx + 1] : undefined;

  console.log("🏔️  Fort Hays Tech | Northwest (Empower-XL) scraper");
  console.log(`   Source: ${BASE_URL}/`);

  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const { token, terms, cookieJar } = await fetchFormPage();
  console.log(`   Token acquired; ${terms.length} terms found`);

  const refYear = new Date().getUTCFullYear(); // 4-digit
  // Filter to current/upcoming terms only (drops already-ended terms)
  const targetTerms = termFilter
    ? terms.filter((t) => t.code === termFilter)
    : terms.filter((t) => isCurrentOrUpcoming(empowerTermToStandard(t.code), refYear));

  console.log(`   Target: ${targetTerms.map((t) => `${t.code} (${t.label})`).join(", ") || "(none)"}`);

  let grandTotal = 0;
  for (const { code, label } of targetTerms) {
    const sections = await scrapeTerm(code, token, cookieJar);
    if (sections.length === 0) {
      console.log(`    → 0 sections (${label} / ${code})`);
      continue;
    }
    const stdTerm = empowerTermToStandard(code);
    const outPath = path.join(COURSES_DIR, `${stdTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`    ✓ ${stdTerm}: ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ ${SLUG}: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("❌ FHNW scraper failed:", err);
  process.exit(1);
});
