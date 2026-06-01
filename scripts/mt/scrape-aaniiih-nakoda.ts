/**
 * Aaniiih Nakoda College — Empower-XL SIS (ComSpec International) course scraper
 *
 * Aaniiih Nakoda College is a tribally-controlled community college on the
 * Fort Belknap Reservation (Harlem, MT). Its public course catalog is served
 * by an Empower-XL instance at a non-canonical subdomain:
 *
 *   GET  https://empowerweb-ancollege.empower-xl.com/fusebox.cfm?fuseaction=CourseCatalog&rpt=1
 *        → returns a hidden CSRF `token` + a term dropdown, sets JSESSIONID
 *          (Cloudflare-fronted, so a real browser User-Agent is required)
 *   POST https://empowerweb-ancollege.empower-xl.com/cfcs/courseCatalog.cfc?method=GetList
 *        with the same cookie + token + a 2-digit term code (e.g. 26SP, 26FA)
 *        → returns JSON { SUCCESS, html } where `html` is a ui-grid layout of
 *          all sections in that term
 *
 * Same ComSpec ColdFusion flow + grid columns as ak's scrape-ilisagvik.ts; the
 * only differences are the host, a 2-digit term-code format (`26SP` vs Alaska's
 * `2026FA`), and Cloudflare requiring a browser UA. Grid columns: Location,
 * Course (prefix+number+section + title), Credit/Delivery, Classroom, Schedule
 * (start date, days, time), Instructor, Offer (total seats), Available (open).
 *
 * Usage:
 *   npx tsx scripts/mt/scrape-aaniiih-nakoda.ts                 # current + future terms
 *   npx tsx scripts/mt/scrape-aaniiih-nakoda.ts --term 26FA     # single term
 *   npx tsx scripts/mt/scrape-aaniiih-nakoda.ts --all           # every term in dropdown
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "aaniiih-nakoda-college";
const STATE = "mt";
const BASE = "https://empowerweb-ancollege.empower-xl.com";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);
// Empower-XL sits behind Cloudflare bot management; a real browser UA is
// required or the form/AJAX endpoints return an empty body.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
  prerequisite_courses: never[];
}

interface FormState {
  token: string;
  cookie: string;
  terms: { code: string; label: string }[];
}

function parseSetCookie(headers: Headers): string {
  const cookies = headers.getSetCookie?.() ?? [];
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

async function loadForm(): Promise<FormState> {
  const res = await fetch(`${BASE}/fusebox.cfm?fuseaction=CourseCatalog&rpt=1`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`form fetch failed: HTTP ${res.status}`);
  const cookie = parseSetCookie(res.headers);
  const html = await res.text();
  const $ = cheerio.load(html);
  const token = $("input[name='token']").attr("value") || "";
  if (!token) throw new Error("CSRF token not found on form page");
  const terms: { code: string; label: string }[] = [];
  $("select[name='empower_global_term_id'] option").each((_, el) => {
    const code = $(el).attr("value") || "";
    const label = $(el).text().trim();
    // Empower-XL term codes are 2-digit-year + season, e.g. "26SP", "26FA".
    if (code && /^\d{2}(SP|SU|FA|WI)$/.test(code)) terms.push({ code, label });
  });
  if (terms.length === 0) throw new Error("no term options parsed from dropdown");
  return { token, cookie, terms };
}

function toStandardTerm(code: string): string {
  // Empower-XL uses 2-digit-year codes ("26SP"); the rest of the project (and
  // the audit's term checks / the UI) use 4-digit ("2026SP"). Normalize on write.
  return /^\d{2}(SP|SU|FA|WI)$/.test(code) ? `20${code}` : code;
}

function parseDays(raw: string): string {
  return raw.replace(/\s+/g, "");
}

function to24(raw: string): string {
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function parseSchedule(raw: string): {
  start_date: string;
  days: string;
  start_time: string;
  end_time: string;
} {
  const text = raw.replace(/\s+/g, " ").trim();
  let start_date = "";
  let days = "";
  let start_time = "";
  let end_time = "";

  const dateMatch = text.match(/start:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (dateMatch) {
    const [, mm, dd, yyyy] = dateMatch;
    start_date = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const daysMatch = text.match(/\b([MTWRFSU](?:\s+[MTWRFSU])*)\b(?=\s+\d{1,2}:)/);
  if (daysMatch) days = parseDays(daysMatch[1]);
  const timeMatch = text.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (timeMatch) {
    start_time = to24(timeMatch[1]);
    end_time = to24(timeMatch[2]);
  }
  return { start_date, days, start_time, end_time };
}

function inferMode(
  location: string,
  delivery: string,
): "in-person" | "online" | "hybrid" {
  const d = delivery.toLowerCase();
  const l = location.toLowerCase();
  if (d.includes("hybrid")) return "hybrid";
  if (d.includes("online") || d.includes("distance")) return "online";
  if (l === "olx" || l.includes("online")) return "online";
  return "in-person";
}

function parseCourseCell(raw: string): {
  prefix: string;
  number: string;
  section: string;
  title: string;
} | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^([A-Z]{2,5})\s+([A-Z0-9]{1,6})\s+(\S+)\s+(.+)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], section: m[3], title: m[4].trim() };
}

async function scrapeTerm(form: FormState, termCode: string): Promise<CourseSection[]> {
  const body = new URLSearchParams({
    fuseaction: "CourseCatalog",
    empower_global_term_id: termCode,
    empower_global_dept_id: "",
    empower_global_course_id: "",
    token: form.token,
    rpt: "1",
    screen_width: "1440",
  }).toString();

  const res = await fetch(`${BASE}/cfcs/courseCatalog.cfc?method=GetList`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: form.cookie,
    },
    body,
  });
  if (!res.ok) throw new Error(`POST failed for ${termCode}: HTTP ${res.status}`);
  const payload = (await res.json()) as { SUCCESS?: boolean; html?: string };
  if (!payload.SUCCESS || !payload.html) return [];

  // Replace <br> with spaces so .text() doesn't concatenate sibling values.
  const normalized = payload.html.replace(/<br\s*\/?>/gi, " ");
  const $ = cheerio.load(`<div id="r">${normalized}</div>`);
  const sections: CourseSection[] = [];

  $("#r div.ui-grid-row").each((_, row) => {
    const cols = $(row).find("> div.ui-grid-col-1, > div.ui-grid-col-2");
    if (cols.length < 8) return;

    const location = $(cols[0]).text().replace(/\s+/g, " ").trim();
    const courseRaw = $(cols[1]).text().replace(/ /g, " ").trim();
    const creditDeliveryRaw = $(cols[2]).text().replace(/ /g, " ").trim();
    const classroom = $(cols[3]).text().replace(/\s+/g, " ").trim();
    const scheduleText = $(cols[4]).text();
    const instructorEl = $(cols[5]);
    const offerStr = $(cols[6]).text().replace(/\s+/g, "").trim();
    const availStr = $(cols[7]).text().replace(/\s+/g, "").trim();

    // Skip the header row ("Location"/"Course" labels).
    if (/^Location$/i.test(location) || /^Course/i.test(courseRaw)) return;

    const course = parseCourseCell(courseRaw);
    if (!course) return;

    const creditMatch = creditDeliveryRaw.match(/(\d+(?:\.\d+)?)/);
    const credits = creditMatch ? parseFloat(creditMatch[1]) : 0;
    const deliveryMatch = creditDeliveryRaw.replace(creditMatch?.[0] ?? "", "").trim();

    const { start_date, days, start_time, end_time } = parseSchedule(scheduleText);

    const instructorText = instructorEl.text().replace(/\s+/g, " ").trim();
    const offer = parseInt(offerStr, 10);
    const avail = parseInt(availStr, 10);

    sections.push({
      college_code: SLUG,
      term: toStandardTerm(termCode),
      course_prefix: course.prefix,
      course_number: course.number,
      course_title: course.title,
      credits,
      crn: `${course.prefix}-${course.number}-${course.section}`,
      days,
      start_time,
      end_time,
      start_date,
      location: classroom || location,
      campus: location || "Fort Belknap",
      mode: inferMode(location, deliveryMatch),
      instructor: instructorText || null,
      seats_open: Number.isFinite(avail) ? avail : null,
      seats_total: Number.isFinite(offer) ? offer : null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  return sections;
}

function termYear(code: string): number {
  // "26SP" → 2026
  return 2000 + parseInt(code.slice(0, 2), 10);
}

function pickCurrentTerms(
  all: { code: string; label: string }[],
): { code: string; label: string }[] {
  // Keep the current calendar year and forward; drop prior years.
  const now = new Date(process.env.SCRAPE_NOW_ISO || "2026-06-01");
  const minYear = now.getUTCFullYear();
  return all.filter((t) => termYear(t.code) >= minYear);
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const single = termIdx >= 0 ? args[termIdx + 1] : undefined;
  const all = args.includes("--all");

  console.log("Aaniiih Nakoda College — Empower-XL SIS scraper");
  console.log(`   Source: ${BASE}`);

  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const form = await loadForm();
  console.log(`   Loaded form: ${form.terms.length} terms in dropdown`);

  let terms: { code: string; label: string }[];
  if (single) terms = [{ code: single, label: single }];
  else if (all) terms = form.terms;
  else terms = pickCurrentTerms(form.terms);

  console.log(`   Scraping ${terms.length} term(s): ${terms.map((t) => t.code).join(", ")}`);

  let grandTotal = 0;
  for (const { code, label } of terms) {
    process.stdout.write(`  ${code} (${label})... `);
    let sections: CourseSection[] = [];
    try {
      sections = await scrapeTerm(form, code);
    } catch (err) {
      console.log(`error: ${(err as Error).message}`);
      continue;
    }
    if (sections.length === 0) {
      console.log("0 sections (skipping)");
      continue;
    }
    const outPath = path.join(COURSES_DIR, `${toStandardTerm(code)}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n${SLUG}: ${grandTotal} total sections across ${terms.length} term(s)`);
}

main().catch((err) => {
  console.error("Aaniiih Nakoda scraper failed:", err);
  process.exit(1);
});
