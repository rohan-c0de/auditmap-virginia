/**
 * Treasure Valley Community College — ColdFusion course-search scraper
 *
 * TVCC publishes a publicly accessible course search at:
 *   https://resources.tvcc.cc/coursesearch/
 *
 * The search accepts POST requests with yrterm + optional Disciplines filter.
 * Results are an HTML table with columns:
 *   Course Code | Name | Instructor | Credits | Status | Schedule | Time | Location
 *
 * Term codes use YYYYNN where NN is the quarter within the academic year:
 *   10 = Summer, 20 = Fall, 30 = Winter, 40 = Spring
 *
 * Usage:
 *   npx tsx scripts/or/scrape-tvcc.ts                  # all active terms
 *   npx tsx scripts/or/scrape-tvcc.ts --term 202620    # single term
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "treasure-valley-community-college";
const STATE = "or";
const BASE_URL = "https://resources.tvcc.cc/coursesearch";
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
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

function tvccTermToStandard(yrterm: string): string {
  const year = parseInt(yrterm.slice(0, 4), 10);
  const quarter = yrterm.slice(4, 6);
  switch (quarter) {
    case "10": return `${year}SU`;
    case "20": return `${year}FA`;
    case "30": return `${year}WI`;
    case "40": return `${year}SP`;
    default: return `${year}XX`;
  }
}

function parseTime(raw: string): { start: string; end: string } {
  const m = raw.match(/(\d{1,2}:\d{2}(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}(?:AM|PM))/i);
  if (!m) return { start: "", end: "" };
  return { start: m[1], end: m[2] };
}

function parseCourseCode(raw: string): { prefix: string; number: string; section: string } | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^([A-Z]{2,4})\s+(\S+)\s+([A-Z0-9]{1,4})$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], section: m[3] };
}

function inferMode(location: string, days: string, title: string): "in-person" | "online" | "hybrid" {
  const loc = location.toLowerCase();
  const t = title.toLowerCase();
  if (t.includes("hybrid") || loc.includes("hybrid")) return "hybrid";
  if (loc === "web" || loc.includes("online") || (days === "" && loc === "")) return "online";
  return "in-person";
}

async function discoverTerms(): Promise<{ code: string; label: string }[]> {
  const res = await fetch(`${BASE_URL}/searchForm.cfm?yrterm=202620`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const terms: { code: string; label: string }[] = [];
  $("select[name='yrterm'] option").each((_, el) => {
    const val = $(el).attr("value") || "";
    const label = $(el).text().trim();
    if (val && /^\d{6}$/.test(val)) {
      terms.push({ code: val, label });
    }
  });

  return terms;
}

async function scrapeTerm(yrterm: string): Promise<CourseSection[]> {
  const stdTerm = tvccTermToStandard(yrterm);
  console.log(`  Scraping ${yrterm} → ${stdTerm}...`);

  const res = await fetch(`${BASE_URL}/index.cfm`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `yrterm=${yrterm}&srt=CRS_CDE&pageheader=Y&Disciplines=`,
  });

  const html = await res.text();
  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];

  $("tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 8) return;

    const codeRaw = $(cells[0]).text().replace(/ /g, " ").trim();
    const parsed = parseCourseCode(codeRaw);
    if (!parsed) return;

    const title = $(cells[1]).text().replace(/ /g, " ").trim();
    const instructor = $(cells[2]).text().replace(/ /g, " ").trim() || null;
    const creditsRaw = $(cells[3]).text().replace(/ /g, " ").trim();
    const credits = parseFloat(creditsRaw) || 0;
    const days = $(cells[5]).text().replace(/ /g, " ").trim();
    const timeRaw = $(cells[6]).text().replace(/ /g, " ").trim();
    const location = $(cells[7]).text().replace(/ /g, " ").trim();

    const { start, end } = parseTime(timeRaw);
    const mode = inferMode(location, days, title);

    sections.push({
      college_code: SLUG,
      term: stdTerm,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: title,
      credits,
      crn: `${parsed.prefix}-${parsed.number}-${parsed.section}`,
      days,
      start_time: start,
      end_time: end,
      start_date: "",
      location,
      campus: location.includes("Caldwell") ? "Caldwell Center" : "Ontario Campus",
      mode,
      instructor,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termFilter = termIdx >= 0 ? args[termIdx + 1] : undefined;

  console.log("🏔️  Treasure Valley Community College scraper");
  console.log(`   Source: ${BASE_URL}/`);

  fs.mkdirSync(COURSES_DIR, { recursive: true });

  let terms: { code: string; label: string }[];
  if (termFilter) {
    terms = [{ code: termFilter, label: termFilter }];
  } else {
    terms = await discoverTerms();
    console.log(`  Found ${terms.length} terms: ${terms.map(t => `${t.label} (${t.code})`).join(", ")}`);
  }

  let grandTotal = 0;

  for (const { code, label } of terms) {
    const sections = await scrapeTerm(code);
    if (sections.length === 0) {
      console.log(`    → 0 sections (${label}), skipping`);
      continue;
    }

    const stdTerm = tvccTermToStandard(code);
    const outPath = path.join(COURSES_DIR, `${stdTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`    → ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ treasure-valley-community-college: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("❌ TVCC scraper failed:", err);
  process.exit(1);
});
