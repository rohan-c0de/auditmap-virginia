/**
 * Nebraska Indian Community College — Empower SIS (ComSpec) scraper
 *
 * NICC runs Empower XL at empower.thenicc.edu — the same platform as
 * Ilisagvik College (AK). The course catalog is publicly accessible:
 *
 *   GET  https://empower.thenicc.edu/fusebox.cfm?fuseaction=CourseCatalog&rpt=1
 *        → CSRF token + term list + JSESSIONID cookie
 *   POST https://empower.thenicc.edu/cfcs/courseCatalog.cfc?method=GetList
 *        → JSON { SUCCESS, html } with a ui-grid of all sections
 *
 * Adapted from scripts/ak/scrape-ilisagvik.ts with host + campus changes.
 *
 * Usage:
 *   npx tsx scripts/ne/scrape-nicc.ts
 *   npx tsx scripts/ne/scrape-nicc.ts --term 2026FA
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "nebraska-indian-community-college";
const STATE = "ne";
const BASE = "https://empower.thenicc.edu";
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
  const res = await fetch(
    `${BASE}/fusebox.cfm?fuseaction=CourseCatalog&rpt=1`,
    { headers: { "User-Agent": "Mozilla/5.0 (CCPath/1.0)" } },
  );
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
    if (code && /^\d{4}(SP|SU|FA|WI)$/.test(code)) terms.push({ code, label });
  });
  return { token, cookie, terms };
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

function inferMode(location: string, delivery: string): "in-person" | "online" | "hybrid" {
  const d = delivery.toLowerCase();
  const l = location.toLowerCase();
  if (d.includes("hybrid")) return "hybrid";
  if (d.includes("online") || d.includes("distance") || d.includes("canvas")) return "online";
  if (l === "olx" || l.includes("online") || l.includes("canvas")) return "online";
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
    empower_global_course_id: "",
    token: form.token,
    screen_width: "1920",
  }).toString();

  const res = await fetch(
    `${BASE}/cfcs/courseCatalog.cfc?method=GetList`,
    {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (CCPath/1.0)",
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: form.cookie,
      },
      body,
    },
  );
  if (!res.ok) throw new Error(`POST failed for ${termCode}: HTTP ${res.status}`);
  const payload = (await res.json()) as { SUCCESS?: boolean; html?: string };
  if (!payload.SUCCESS || !payload.html) return [];

  const normalized = payload.html.replace(/<br\s*\/?>/gi, " ");
  const $ = cheerio.load(`<div id="r">${normalized}</div>`);
  const sections: CourseSection[] = [];

  $("#r > div.ui-grid-row").each((_, row) => {
    const cols = $(row).find("> div.ui-grid-col-1, > div.ui-grid-col-2");
    if (cols.length < 8) return;

    const location = $(cols[0]).text().replace(/\s+/g, " ").trim();
    const courseRaw = $(cols[1]).text().replace(/ /g, " ").trim();
    const creditDeliveryRaw = $(cols[2]).text().replace(/ /g, " ").trim();
    const classroom = $(cols[3]).text().replace(/\s+/g, " ").trim();
    const scheduleText = $(cols[4]).text();
    const instructorEl = $(cols[5]);
    const offerStr = $(cols[6]).text().replace(/\s+/g, "").trim();
    const availStr = $(cols[7]).text().replace(/\s+/g, "").trim();

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
      term: termCode,
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
      campus: location || "Macy",
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

function pickCurrentTerms(all: { code: string; label: string }[]): { code: string; label: string }[] {
  const now = new Date(process.env.SCRAPE_NOW_ISO || "2026-05-31");
  const year = now.getUTCFullYear();
  return all.filter((t) => {
    const ty = parseInt(t.code.slice(0, 4), 10);
    return ty >= year;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const single = termIdx >= 0 ? args[termIdx + 1] : undefined;
  const all = args.includes("--all");

  console.log("Nebraska Indian Community College — Empower SIS scraper");
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
    const outPath = path.join(COURSES_DIR, `${code}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n${SLUG}: ${grandTotal} total sections across ${terms.length} term(s)`);
}

main().catch((err) => {
  console.error("NICC scraper failed:", err);
  process.exit(1);
});
