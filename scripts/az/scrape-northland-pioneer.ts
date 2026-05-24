/**
 * Northland Pioneer College — Jenzabar CMC Portal (ASP.NET WebForms) scraper
 *
 * NPC's orchestrator-detected platform was "acalog" (catalog/programs only),
 * but re-probing surfaced a public course-schedule page at:
 *   https://my.npc.edu/CMCPortal/Common/CourseSchedule.aspx
 *
 * Same Jenzabar CMC Portal pattern as Columbia Gorge CC in OR — needs a GET
 * to harvest VIEWSTATE, then a POST with VIEWSTATE + search criteria. Term
 * labels differ from CGCC ("Fall Semester 2026" vs CGCC's "2026-27 Fall
 * Term"), so the label-to-standardized-term converter is NPC-specific. The
 * Campus dropdown has one option (5 = MAIN Campus, the only campus).
 *
 * Result row HTML (12 cells, same shape as CGCC):
 *   [0]  span#lblCourseCode       — "AAS101" (no space)
 *   [1]  course title
 *   [2]  section
 *   [3]  span#DateRange_CourseList — "8/24/2026 to 12/10/2026"
 *   [4]  credits
 *   [5]  meetings stub
 *   [6]  instructor
 *   [7]  delivery method (Face-to-Face / Online / etc.)
 *   [8]  course attribute
 *   [9]  class comment
 *   [10] availability — "23 of 30"
 *   [11] "Click for Details"
 *
 * Term codes are NPC-internal IDs (166=Summer, 184=Spring, 186=Fall as of
 * 2026-05). Discovered fresh from the form each run.
 *
 * Usage:
 *   npx tsx scripts/az/scrape-northland-pioneer.ts
 *   npx tsx scripts/az/scrape-northland-pioneer.ts --no-import
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "northland-pioneer-college";
const STATE = "az";
const BASE = "https://my.npc.edu";
const FORM_URL = `${BASE}/CMCPortal/Common/CourseSchedule.aspx`;
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);
const CAMPUS_NAME = "MAIN Campus";
// The Campus dropdown has only this value as a non-placeholder option.
const CAMPUS_ID = "5";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

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

function parseCookies(setCookieHeaders: string[]): string {
  return setCookieHeaders.map((h) => h.split(";")[0]).filter(Boolean).join("; ");
}

/** "Fall Semester 2026" → "2026FA", "Spring Semester 2026" → "2026SP",
 *  "Summer Session 2026" → "2026SU". */
function npcLabelToTerm(label: string): string {
  const m = label.match(/(Fall|Winter|Spring|Summer)\s+(Semester|Session|Term)\s+(\d{4})/i);
  if (!m) return "";
  const seasonCode: Record<string, string> = {
    fall: "FA", winter: "WI", spring: "SP", summer: "SU",
  };
  const code = seasonCode[m[1].toLowerCase()];
  if (!code) return "";
  return `${m[3]}${code}`;
}

async function loadForm(): Promise<FormState> {
  const res = await fetch(FORM_URL, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });
  const html = await res.text();
  const cookies = parseCookies(res.headers.getSetCookie?.() ?? []);
  const $ = cheerio.load(html);

  const viewState = $('input[name="__VIEWSTATE"]').val() as string;
  const viewStateGenerator = $('input[name="__VIEWSTATEGENERATOR"]').val() as string;
  const eventValidation = $('input[name="__EVENTVALIDATION"]').val() as string;

  const terms: { id: string; label: string; term: string }[] = [];
  $('select[name$="cbTerm"] option').each((_, el) => {
    const id = $(el).attr("value") || "";
    const label = $(el).text().trim();
    if (!id || id === "-1") return;
    const term = npcLabelToTerm(label);
    if (!term) return;
    terms.push({ id, label, term });
  });

  return { viewState, viewStateGenerator, eventValidation, terms, cookies };
}

async function scrapeTerm(
  form: FormState,
  termId: string,
  termCode: string,
): Promise<CourseSection[]> {
  const body = new URLSearchParams({
    __VIEWSTATE: form.viewState,
    __VIEWSTATEGENERATOR: form.viewStateGenerator,
    __EVENTVALIDATION: form.eventValidation,
    "_ctl0:PlaceHolderMain:_ctl0:cbCampus": CAMPUS_ID,
    "_ctl0:PlaceHolderMain:_ctl0:cbTerm": termId,
    "_ctl0:PlaceHolderMain:_ctl0:cbDept": "-1",
    "_ctl0:PlaceHolderMain:_ctl0:cbLowTime": "0",
    "_ctl0:PlaceHolderMain:_ctl0:cbHighTime": "23",
    "_ctl0:PlaceHolderMain:_ctl0:btnSearch": "Search",
  });

  const res = await fetch(FORM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.5",
      Cookie: form.cookies,
    },
    body: body.toString(),
  });
  const html = await res.text();
  const $ = cheerio.load(html);
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

    const codeMatch = codeRaw.match(/^([A-Z]{2,5})(\d+[A-Z]?)$/);
    if (!codeMatch) return;

    // "8/24/2026 to 12/10/2026" → ISO "2026-08-24"
    const startDateMatch = dateRange.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const startDate = startDateMatch
      ? `${startDateMatch[3]}-${startDateMatch[1].padStart(2, "0")}-${startDateMatch[2].padStart(2, "0")}`
      : "";

    const availMatch = availability.match(/(\d+)\s+of\s+(\d+)/);
    const seatsOpen = availMatch ? parseInt(availMatch[1], 10) : null;
    const seatsTotal = availMatch ? parseInt(availMatch[2], 10) : null;

    const d = delivery.toLowerCase();
    const mode: "in-person" | "online" | "hybrid" =
      d.includes("hybrid") || d.includes("blended")
        ? "hybrid"
        : d.includes("online") || d.includes("zoom") || d.includes("remote") || d.includes("distance")
          ? "online"
          : "in-person";

    sections.push({
      college_code: SLUG,
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
      campus: CAMPUS_NAME,
      mode,
      instructor: instructor && !/^TBD$/i.test(instructor) && !/^Staff$/i.test(instructor) ? instructor : null,
      seats_open: seatsOpen,
      seats_total: seatsTotal,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  return sections;
}

async function main() {
  console.log("🌵 Northland Pioneer College Jenzabar CMC Portal scraper");
  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const form = await loadForm();
  console.log(`  Found ${form.terms.length} terms: ${form.terms.map((t) => `${t.label} (${t.id} → ${t.term})`).join(", ")}`);

  const now = new Date();
  const currentYear = now.getFullYear();
  let grandTotal = 0;

  for (const { id, label, term } of form.terms) {
    const year = parseInt(term.slice(0, 4), 10);
    if (year < currentYear) {
      console.log(`  ${label}: skipping past term`);
      continue;
    }

    // Each search may invalidate VIEWSTATE — refetch the form per term.
    const fresh = await loadForm();
    const sections = await scrapeTerm(fresh, id, term);

    if (sections.length === 0) {
      console.log(`  ${label}: 0 sections`);
      continue;
    }

    const outPath = path.join(COURSES_DIR, `${term}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  ${label}: ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ ${SLUG}: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("❌ NPC scraper failed:", err);
  process.exit(1);
});
