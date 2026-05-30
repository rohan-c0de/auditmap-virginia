/**
 * Salish Kootenai College — static HTML class-list scraper
 *
 * SKC publishes per-term class schedules as static HTML tables at:
 *   https://www.skc.edu/registrar/{term}-class-list/
 *
 * Terms: fall, winter, spring, summer (quarter system).
 *
 * The table has class="class-table" with columns:
 *   Code | Title | Delivery Method | Instructor | Bldg | Rm | Times | Days | Credits | Prereqs | Comment
 *
 * The "Code" cell format: "PREFIX NUMBER  SECTION  SEQ  STATUS"
 * e.g. "ACSC 103  0    01   PA"
 *
 * Usage:
 *   npx tsx scripts/mt/scrape-skc.ts                     # all terms
 *   npx tsx scripts/mt/scrape-skc.ts --term fall         # single term
 *   npx tsx scripts/mt/scrape-skc.ts --no-import
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "salish-kootenai-college";
const STATE = "mt";
const BASE_URL = "https://www.skc.edu/registrar";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

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

interface TermConfig {
  slug: string;
  label: string;
  url: string;
}

function getTermConfigs(): TermConfig[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const terms: TermConfig[] = [];

  // SKC uses quarters: Fall (Sep-Dec), Winter (Jan-Mar), Spring (Apr-Jun), Summer (Jul-Aug)
  // Scrape current + upcoming terms
  if (month >= 1 && month <= 3) {
    terms.push(
      { slug: `${year}WI`, label: `Winter ${year}`, url: `${BASE_URL}/winter-class-list/` },
      { slug: `${year}SP`, label: `Spring ${year}`, url: `${BASE_URL}/spring-class-list/` },
      { slug: `${year}SU`, label: `Summer ${year}`, url: `${BASE_URL}/summer-class-list/` },
    );
  } else if (month >= 4 && month <= 6) {
    terms.push(
      { slug: `${year}SP`, label: `Spring ${year}`, url: `${BASE_URL}/spring-class-list/` },
      { slug: `${year}SU`, label: `Summer ${year}`, url: `${BASE_URL}/summer-class-list/` },
      { slug: `${year}FA`, label: `Fall ${year}`, url: `${BASE_URL}/fall-class-list/` },
    );
  } else if (month >= 7 && month <= 8) {
    terms.push(
      { slug: `${year}SU`, label: `Summer ${year}`, url: `${BASE_URL}/summer-class-list/` },
      { slug: `${year}FA`, label: `Fall ${year}`, url: `${BASE_URL}/fall-class-list/` },
      { slug: `${year + 1}WI`, label: `Winter ${year + 1}`, url: `${BASE_URL}/winter-class-list/` },
    );
  } else {
    terms.push(
      { slug: `${year}FA`, label: `Fall ${year}`, url: `${BASE_URL}/fall-class-list/` },
      { slug: `${year + 1}WI`, label: `Winter ${year + 1}`, url: `${BASE_URL}/winter-class-list/` },
      { slug: `${year + 1}SP`, label: `Spring ${year + 1}`, url: `${BASE_URL}/spring-class-list/` },
    );
  }

  return terms;
}

function parseDeliveryMode(method: string): CourseMode {
  const m = method.toLowerCase();
  if (m.includes("online") && m.includes("ftf")) return "hybrid";
  if (m.includes("hybrid") || m.includes("hyb")) return "hybrid";
  if (m.includes("online") || m.includes("ola")) return "online";
  if (m.includes("zoom") || m.includes("remote")) return "zoom";
  return "in-person";
}

function parseTimeRange(times: string): { start: string; end: string } {
  const match = times.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!match) return { start: "", end: "" };
  return { start: match[1].trim(), end: match[2].trim() };
}

function parseCourseCode(code: string): { prefix: string; number: string; section: string } | null {
  // Format: "ACSC 103  0    01   PA" → prefix=ACSC, number=103, section/seq ignored
  const parts = code.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return {
    prefix: parts[0],
    number: parts[1],
    section: parts.length >= 4 ? parts[3] : parts[2] || "01",
  };
}

async function scrapeTerm(term: TermConfig): Promise<CourseSection[]> {
  const res = await fetch(term.url);
  if (!res.ok) {
    console.warn(`  ⚠ ${term.label}: HTTP ${res.status}`);
    return [];
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const rows = $("table.class-table tbody tr");

  if (rows.length === 0) {
    console.log(`  ${term.label}: no rows found (page may not be published yet)`);
    return [];
  }

  const sections: CourseSection[] = [];

  rows.each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 10) return;

    const getText = (i: number) => {
      const cell = cells.eq(i);
      cell.find("strong").remove();
      return cell.text().trim();
    };

    const codeRaw = getText(0);
    const parsed = parseCourseCode(codeRaw);
    if (!parsed) return;

    const title = getText(1);
    const deliveryMethod = getText(2);
    const instructor = getText(3) || null;
    const building = getText(4);
    const room = getText(5);
    const timesRaw = getText(6);
    const days = getText(7);
    const credits = parseFloat(getText(8)) || 0;
    const prereqRaw = getText(9);

    const { start, end } = parseTimeRange(timesRaw);
    const mode = parseDeliveryMode(deliveryMethod);
    const location = building && room ? `${building} ${room}` : building || "";

    sections.push({
      college_code: SLUG,
      term: term.slug,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: title,
      credits,
      crn: `${parsed.prefix}-${parsed.number}-${parsed.section}`,
      days: days || "",
      start_time: start,
      end_time: end,
      start_date: "",
      location,
      campus: "Main",
      mode,
      instructor,
      seats_open: null,
      seats_total: null,
      prerequisite_text: prereqRaw === "#" ? "Prerequisites required (see catalog)" : prereqRaw || null,
      prerequisite_courses: [],
    });
  });

  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termFilter = termIdx >= 0 ? args[termIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("🏔️  Salish Kootenai College scraper");
  console.log(`   Source: ${BASE_URL}/{term}-class-list/`);

  const allTerms = getTermConfigs();
  const terms = termFilter
    ? allTerms.filter((t) => t.slug.toLowerCase().includes(termFilter.toLowerCase()) || t.label.toLowerCase().includes(termFilter.toLowerCase()))
    : allTerms;

  if (terms.length === 0) {
    console.error(`No matching term for filter: ${termFilter}`);
    process.exit(1);
  }

  fs.mkdirSync(COURSES_DIR, { recursive: true });

  let grandTotal = 0;

  for (const term of terms) {
    console.log(`\n  Scraping ${term.label} (${term.url})...`);
    const sections = await scrapeTerm(term);

    if (sections.length === 0) {
      console.log(`  → 0 sections, skipping file write`);
      continue;
    }

    const outPath = path.join(COURSES_DIR, `${term.slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  → ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ salish-kootenai-college: ${grandTotal} total sections`);

  if (noImport) {
    console.log("   (--no-import: skipping Supabase import)");
  }
}

main().catch((err) => {
  console.error("❌ SKC scraper failed:", err);
  process.exit(1);
});
