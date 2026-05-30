/**
 * Oregon Coast Community College — WordPress HTML schedule scraper
 *
 * OCCC publishes a single HTML table per term at:
 *   https://oregoncoast.edu/{season}-{year}-course-schedule/
 * Hub at /course-schedule/ links to current terms.
 *
 * Table columns (11):
 *   [0] credits, [1] course code (e.g. AQS100), [2] section (e.g. NEWP01),
 *   [3] blank, [4] title or <h4>subject header</h4>, [5] days,
 *   [6] times, [7] location, [8] instructor, [9] delivery mode, [10] blank
 *
 * Lab sub-rows: first 3 cells blank, title contains "{COURSE}-Z{N} Lab".
 *
 * Usage:
 *   npx tsx scripts/or/scrape-oregon-coast.ts
 *   npx tsx scripts/or/scrape-oregon-coast.ts --term 2026FA
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "oregon-coast-community-college";
const STATE = "or";
const BASE = "https://oregoncoast.edu";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const SEASON_CODE: Record<string, string> = {
  fall: "FA",
  winter: "WI",
  spring: "SP",
  summer: "SU",
};

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

async function discoverTerms(): Promise<{ slug: string; term: string }[]> {
  const html = await (await fetch(`${BASE}/course-schedule/`)).text();
  const matches = [...html.matchAll(/href="https:\/\/oregoncoast\.edu\/(fall|winter|spring|summer)-(\d{4})-course-schedule\/"/g)];
  const seen = new Set<string>();
  const terms: { slug: string; term: string }[] = [];
  for (const [, season, year] of matches) {
    const slug = `${season}-${year}`;
    if (seen.has(slug)) continue;
    seen.add(slug);
    terms.push({ slug, term: `${year}${SEASON_CODE[season]}` });
  }
  return terms;
}

function parseCourseCode(raw: string): { prefix: string; number: string } | null {
  const cleaned = raw.replace(/\s+/g, "").trim();
  const m = cleaned.match(/^([A-Z]{2,5})(\d+[A-Z]?)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

function parseTime(raw: string): { start: string; end: string } {
  const cleaned = raw.replace(/–|—/g, "-").trim();
  if (!cleaned || cleaned.toLowerCase() === "n/a" || cleaned.toLowerCase() === "tbd") {
    return { start: "", end: "" };
  }
  const m = cleaned.match(/(\d{1,2}(?::\d{2})?(?:am|pm)?)\s*-\s*(\d{1,2}(?::\d{2})?(?:am|pm)?)/i);
  if (!m) return { start: "", end: "" };
  return { start: m[1].trim(), end: m[2].trim() };
}

function inferMode(delivery: string): "in-person" | "online" | "hybrid" {
  const d = delivery.toLowerCase();
  if (d.includes("hybrid") || d.includes("blended")) return "hybrid";
  if (d.includes("online") || d.includes("web") || d.includes("remote")) return "online";
  return "in-person";
}

async function scrapeTerm(slug: string, term: string): Promise<CourseSection[]> {
  const url = `${BASE}/${slug}-course-schedule/`;
  console.log(`  ${term}: fetching ${url}`);
  const html = await (await fetch(url)).text();
  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];

  $("table tbody tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 10) return;

    const credits = parseFloat($(cells[0]).text().trim()) || 0;
    const codeRaw = $(cells[1]).text().trim();
    const sectionId = $(cells[2]).text().trim();
    const titleCell = $(cells[4]);
    const titleRaw = titleCell.text().trim();
    const days = $(cells[5]).text().trim().replace(/\s+/g, " ");
    const timeRaw = $(cells[6]).text().trim();
    const location = $(cells[7]).text().trim();
    const instructor = $(cells[8]).text().trim() || null;
    const delivery = $(cells[9]).text().trim();

    // Skip subject-header rows (h4 in title cell, no code)
    if (titleCell.find("h4").length > 0 && !codeRaw) return;
    // Skip empty separator rows
    if (!codeRaw && !titleRaw) return;
    // Skip lab sub-rows (no code, title like "AQS215-Z1 Lab")
    if (!codeRaw && titleRaw) return;

    const parsed = parseCourseCode(codeRaw);
    if (!parsed) return;

    const { start, end } = parseTime(timeRaw);

    sections.push({
      college_code: SLUG,
      term,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: titleRaw,
      credits,
      crn: `${parsed.prefix}-${parsed.number}-${sectionId}`,
      days: days === "N/A" ? "" : days,
      start_time: start,
      end_time: end,
      start_date: "",
      location: location === "N/A" ? "" : location,
      campus: location.toLowerCase().includes("newport") ? "Newport" : "Newport",
      mode: inferMode(delivery),
      instructor: instructor === "TBD" ? null : instructor,
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

  console.log("🌊 Oregon Coast CC WordPress scraper");
  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const terms = await discoverTerms();
  console.log(`  Found ${terms.length} terms: ${terms.map((t) => t.term).join(", ")}`);

  const now = new Date();
  const currentYear = now.getFullYear();
  let grandTotal = 0;

  for (const { slug, term } of terms) {
    if (termFilter && term !== termFilter) continue;
    const year = parseInt(term.slice(0, 4), 10);
    if (year < currentYear) {
      console.log(`  ${term}: skipping past term`);
      continue;
    }

    const sections = await scrapeTerm(slug, term);
    if (sections.length === 0) {
      console.log(`    → 0 sections, skipping`);
      continue;
    }
    const outPath = path.join(COURSES_DIR, `${term}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`    → ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grandTotal += sections.length;
  }

  console.log(`\n✅ oregon-coast-community-college: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("❌ OCCC scraper failed:", err);
  process.exit(1);
});
