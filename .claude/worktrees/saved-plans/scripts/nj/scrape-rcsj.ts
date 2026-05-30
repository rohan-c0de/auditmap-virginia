/**
 * scrape-rcsj.ts — Rowan College of South Jersey cluster scraper
 *
 * RCSJ runs both campuses (Cumberland + Gloucester) on a single Jenzabar
 * CMC Portal (Anthology / Campus Nexus) instance at
 *   https://sisportal-100962.campusnexus.cloud/CMCPortal/Common/CourseSchedule.aspx
 *
 * The form's `cbCampus` dropdown distinguishes the two:
 *   5 = RCSJ-Cumberland
 *   6 = RCSJ-Gloucester
 *
 * One scraper, two college slugs. Same underlying pattern as Columbia
 * Gorge CC (scripts/or/scrape-columbia-gorge.ts) but with two campuses,
 * RCSJ-specific term labels ("2026 Fall - 15 Week" → 2026FA), and
 * multiple session-length variants bucketed into one normalized term.
 *
 * IMPORTANT: Anthology Cloud rejects Node 20+ `fetch` (HTTP/2 attempts).
 * Uses Node's built-in `https.request` (HTTP/1.1) instead. Same workaround
 * as the JICS/Jenzabar Cloud note in the auto-add-state skill.
 *
 * Also requires session priming — GET CMCPortal/ first to receive an
 * ASP.NET_SessionId cookie; otherwise CourseSchedule.aspx returns HTTP 500.
 *
 * Usage:
 *   npx tsx scripts/nj/scrape-rcsj.ts
 */

import * as https from "https";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const STATE = "nj";
const BASE_HOST = "sisportal-100962.campusnexus.cloud";
const FORM_PATH = "/CMCPortal/Common/CourseSchedule.aspx";
const ROOT_PATH = "/CMCPortal/";

interface CampusEntry {
  code: string;
  slug: string;
  campusLabel: string;
}

const CAMPUSES: CampusEntry[] = [
  { code: "5", slug: "rcsj-cumberland", campusLabel: "Cumberland" },
  { code: "6", slug: "rcsj-gloucester", campusLabel: "Gloucester" },
];

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
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface FormState {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
  terms: { id: string; label: string; term: string }[];
  cookies: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

interface H1Response {
  status: number;
  body: string;
  setCookie: string[];
}

/**
 * HTTP/1.1 request via Node's `https` module. Use this instead of `fetch`
 * — Anthology Cloud rejects fetch's default HTTP/2 attempts with 500.
 */
function request(opts: {
  method: "GET" | "POST";
  path: string;
  cookies?: string;
  body?: string;
}): Promise<H1Response> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };
    if (opts.cookies) headers.Cookie = opts.cookies;
    if (opts.method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = String(Buffer.byteLength(opts.body ?? ""));
      headers["Referer"] = `https://${BASE_HOST}${FORM_PATH}`;
    }

    const req = https.request(
      {
        method: opts.method,
        host: BASE_HOST,
        path: opts.path,
        headers,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            setCookie: (res.headers["set-cookie"] as string[]) ?? [],
          }),
        );
      },
    );
    req.on("error", reject);
    if (opts.method === "POST" && opts.body) req.write(opts.body);
    req.end();
  });
}

function parseCookies(setCookieHeaders: string[]): string {
  return setCookieHeaders
    .map((h) => h.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

/**
 * RCSJ labels are "<year> <Season> - <NN> Week ..." or "<year> <Season>-<NN>...".
 * Normalize to {yyyy}{SP|SU|FA}; ignore session length so all variants of the
 * same calendar term collapse into one file.
 * Returns "" for non-standard cohort terms ("2026 Auto Tech Session 1 Cohort 39").
 */
function rcsjLabelToTerm(label: string): string {
  const m = label.match(/(\d{4})\s+(Spring|Summer|Fall|Winter)\b/i);
  if (!m) return "";
  const year = m[1];
  const season = m[2].toLowerCase();
  if (season === "spring") return `${year}SP`;
  if (season === "summer") return `${year}SU`;
  if (season === "fall") return `${year}FA`;
  if (season === "winter") return `${year}WI`;
  return "";
}

async function loadForm(): Promise<FormState> {
  // 1. Prime ASP.NET_SessionId via portal root
  const root = await request({ method: "GET", path: ROOT_PATH });
  const sessionCookies = parseCookies(root.setCookie);
  if (!sessionCookies) {
    throw new Error(`Failed to prime CMCPortal session — root returned ${root.status}`);
  }

  // 2. GET the form
  const formRes = await request({
    method: "GET",
    path: FORM_PATH,
    cookies: sessionCookies,
  });
  if (formRes.status !== 200) {
    throw new Error(`Form GET returned ${formRes.status}`);
  }
  const cookies = [sessionCookies, parseCookies(formRes.setCookie)]
    .filter(Boolean)
    .join("; ");

  const $ = cheerio.load(formRes.body);
  const viewState = $('input[name="__VIEWSTATE"]').val() as string;
  const viewStateGenerator = $('input[name="__VIEWSTATEGENERATOR"]').val() as string;
  const eventValidation = $('input[name="__EVENTVALIDATION"]').val() as string;

  if (!viewState) {
    throw new Error("Failed to extract __VIEWSTATE from form GET");
  }

  const terms: { id: string; label: string; term: string }[] = [];
  $('#_ctl0_PlaceHolderMain__ctl0_cbTerm option').each((_, el) => {
    const id = $(el).attr("value") || "";
    const label = $(el).text().trim();
    if (!id || id === "-1") return;
    const term = rcsjLabelToTerm(label);
    if (!term) return;
    terms.push({ id, label, term });
  });

  return { viewState, viewStateGenerator, eventValidation, terms, cookies };
}

async function scrapeCampusTerm(
  form: FormState,
  campus: CampusEntry,
  termId: string,
  termCode: string,
): Promise<CourseSection[]> {
  const body = new URLSearchParams({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: form.viewState,
    __VIEWSTATEGENERATOR: form.viewStateGenerator,
    __EVENTVALIDATION: form.eventValidation,
    "_ctl0:PlaceHolderMain:_ctl0:cbCampus": campus.code,
    "_ctl0:PlaceHolderMain:_ctl0:cbTerm": termId,
    "_ctl0:PlaceHolderMain:_ctl0:cbDept": "-1",
    "_ctl0:PlaceHolderMain:_ctl0:cbCourseType": "-1",
    "_ctl0:PlaceHolderMain:_ctl0:cbCourseAttribute": "-1",
    "_ctl0:PlaceHolderMain:_ctl0:cbLowTime": "0",
    "_ctl0:PlaceHolderMain:_ctl0:cbHighTime": "23",
    "_ctl0:PlaceHolderMain:_ctl0:btnSearch": "Search",
  }).toString();

  const res = await request({
    method: "POST",
    path: FORM_PATH,
    cookies: form.cookies,
    body,
  });

  if (res.status !== 200) {
    throw new Error(`POST returned ${res.status}`);
  }

  const $ = cheerio.load(res.body);
  const sections: CourseSection[] = [];

  $("#CourseList tbody tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 11) return;

    const codeRaw = $(cells[0]).find("[id*=lblCourseCode]").text().trim();
    const title = $(cells[1]).text().trim();
    const section = $(cells[2]).text().trim();
    const dateRange = $(cells[3]).text().replace(/\s+/g, " ").trim();
    const credits = parseFloat($(cells[4]).text().trim()) || 0;
    const instructor = $(cells[6]).text().trim() || null;
    const delivery = $(cells[7]).text().trim();
    const availability = $(cells[10]).text().trim();

    // RCSJ codes are "FRSH 101" (with optional space) — CGCC is "HEC226" (no space).
    const codeMatch = codeRaw.match(/^([A-Z]{2,5})\s*(\d+[A-Z]?)$/);
    if (!codeMatch) return;

    const startDateMatch = dateRange.match(/^(\d{1,2}\/\d{1,2}\/\d{4})/);
    const startDate = startDateMatch ? startDateMatch[1] : "";

    const availMatch = availability.match(/(\d+)\s+of\s+(\d+)/);
    const seatsOpen = availMatch ? parseInt(availMatch[1], 10) : null;
    const seatsTotal = availMatch ? parseInt(availMatch[2], 10) : null;

    const d = delivery.toLowerCase();
    const mode: "in-person" | "online" | "hybrid" =
      d.includes("hybrid") || d.includes("blended")
        ? "hybrid"
        : d.includes("online") || d.includes("zoom") || d.includes("remote")
          ? "online"
          : "in-person";

    sections.push({
      college_code: campus.slug,
      term: termCode,
      course_prefix: codeMatch[1],
      course_number: codeMatch[2],
      course_title: title,
      credits,
      crn: `${codeMatch[1]}-${codeMatch[2]}-${section}`,
      days: "",
      start_time: "",
      end_time: "",
      start_date: startDate,
      location: "",
      campus: campus.campusLabel,
      mode,
      instructor,
      seats_open: seatsOpen,
      seats_total: seatsTotal,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  return sections;
}

async function main() {
  console.log("🎓 Rowan College of South Jersey (RCSJ) — Jenzabar CMC Portal scraper");

  const form = await loadForm();
  console.log(`  Discovered ${form.terms.length} valid term variants (skipping cohort-only terms)`);

  const currentYear = new Date().getFullYear();
  const totalsByCampus: Record<string, Record<string, number>> = {};

  for (const campus of CAMPUSES) {
    const dir = path.join(process.cwd(), "data", STATE, "courses", campus.slug);
    fs.mkdirSync(dir, { recursive: true });
    totalsByCampus[campus.slug] = {};

    const buckets: Record<string, CourseSection[]> = {};

    for (const { id, label, term } of form.terms) {
      const year = parseInt(term.slice(0, 4), 10);
      if (year < currentYear) continue;

      // Each search may invalidate VIEWSTATE — refetch the form per (campus, term).
      const fresh = await loadForm();
      try {
        const sections = await scrapeCampusTerm(fresh, campus, id, term);
        if (!buckets[term]) buckets[term] = [];
        buckets[term].push(...sections);
        console.log(`  [${campus.slug}] ${label} → ${sections.length} sections (bucket ${term})`);
      } catch (err) {
        console.error(`  [${campus.slug}] ${label}: ERROR ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    for (const [term, sections] of Object.entries(buckets)) {
      if (sections.length === 0) continue;
      // De-dupe across session-length variants.
      const seen = new Set<string>();
      const deduped: CourseSection[] = [];
      for (const s of sections) {
        const key = `${s.crn}|${s.start_date}|${s.instructor}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(s);
      }
      const outPath = path.join(process.cwd(), "data", STATE, "courses", campus.slug, `${term}.json`);
      fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2) + "\n");
      console.log(`  ✓ ${campus.slug} ${term}: ${deduped.length} sections (deduped from ${sections.length}) → ${path.relative(process.cwd(), outPath)}`);
      totalsByCampus[campus.slug][term] = deduped.length;
    }
  }

  console.log("");
  let grandTotal = 0;
  for (const campus of CAMPUSES) {
    const t = totalsByCampus[campus.slug];
    const sum = Object.values(t).reduce((a, b) => a + b, 0);
    console.log(`  ${campus.slug}: ${sum} sections across ${Object.keys(t).length} terms`);
    grandTotal += sum;
  }
  console.log(`\n✅ RCSJ cluster total: ${grandTotal} sections across 2 campuses`);
}

main().catch((err) => {
  console.error("❌ RCSJ scraper failed:", err);
  process.exit(1);
});
