/**
 * scrape-ntc.ts — Northcentral Technical College course scraper.
 *
 * NTC runs Drupal 10 with a public faceted course search at:
 *   https://www.ntc.edu/academics-training/courses/search?f[0]=term:{TERM_ID}&page={N}
 *
 * The search renders 100 section rows per page as SSR HTML — no JavaScript,
 * no auth, no CSRF. Each page contains N course articles (variable), each
 * with 1+ section table rows.
 *
 * Usage:
 *   npx tsx scripts/wi/scrape-ntc.ts
 *   npx tsx scripts/wi/scrape-ntc.ts --term 2590
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SLUG = "northcentral-technical-college";
const STATE = "wi";
const BASE_URL = "https://www.ntc.edu/academics-training/courses/search";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const TERMS: Record<string, string> = {
  "2590": "2026FA",
  "2591": "2026SU",
};

const DAYS_MAP: Record<string, string> = {
  monday: "M",
  tuesday: "T",
  wednesday: "W",
  thursday: "R",
  friday: "F",
  saturday: "S",
  sunday: "U",
};

interface Section {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  section: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string;
  location: string;
  campus: string;
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

function parseDays(meetingText: string): string {
  const days: string[] = [];
  const lower = meetingText.toLowerCase();
  for (const [day, abbr] of Object.entries(DAYS_MAP)) {
    if (lower.includes(day)) days.push(abbr);
  }
  return days.join("");
}

function parseTime(meetingText: string): { start: string; end: string } {
  const match = meetingText.match(
    /(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i
  );
  if (match) {
    return { start: match[1].trim(), end: match[2].trim() };
  }
  return { start: "", end: "" };
}

function parseInstructor(meetingText: string): string | null {
  const lines = meetingText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (
      /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(line) &&
      !/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Online|Campus|Building)/i.test(line)
    ) {
      return line;
    }
  }
  const match = meetingText.match(
    /(?:PM|AM)\s+\S+[^A-Z]*?\s+([A-Z][a-z]+ [A-Z][a-z]+)/
  );
  if (match) return match[1];
  return null;
}

function parseMode(modeText: string): string {
  const lower = modeText.toLowerCase();
  if (lower.includes("online") && lower.includes("in-person")) return "hybrid";
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("online")) return "online";
  if (lower.includes("in-person")) return "in-person";
  if (lower.includes("zoom") || lower.includes("virtual")) return "online";
  return "in-person";
}

async function fetchPage(termId: string, page: number): Promise<string> {
  const url = `${BASE_URL}?f%5B0%5D=term%3A${termId}&page=${page}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.text();
}

function parsePage(
  html: string,
  termCode: string
): { sections: Section[]; total: number } {
  const $ = cheerio.load(html);
  const sections: Section[] = [];

  const displayingText = $("body").text().match(/Displaying \d+ - \d+ of (\d+)/);
  const total = displayingText ? parseInt(displayingText[1]) : 0;

  $("article.course-result").each((_, article) => {
    const $art = $(article);

    const titleLink = $art.find("h2 a").first();
    const courseTitle = titleLink.text().trim();
    const courseIdLink = $art.find("h2 a").last();
    const courseId = courseIdLink.text().trim();

    const creditsMatch = $art.text().match(/(\d+(?:\.\d+)?)\s*credits?/i);
    const credits = creditsMatch ? parseFloat(creditsMatch[1]) : 0;

    const prefix = courseId.slice(0, 3);
    const number = courseId.slice(3);

    $art.find("table tbody tr, table tr").each((rowIdx, row) => {
      const $row = $(row);
      const tds = $row.find("td");
      if (tds.length < 8) return;

      const sectionRaw = $(tds[0]).text().trim();
      const sectionMatch = sectionRaw.match(/#?(\S+)/);
      const sectionCode = sectionMatch ? sectionMatch[1] : sectionRaw;

      const statusText = $(tds[1]).text().trim();
      if (statusText.toLowerCase() === "cancelled") return;

      const dateRaw = $(tds[2]).text().replace(/\s+/g, " ").trim();
      const dateMatch = dateRaw.match(
        /(\d{2}\/\d{2}\/\d{4})\s*[–-]\s*(\d{2}\/\d{2}\/\d{4})/
      );
      let startDate = "";
      let endDate = "";
      if (dateMatch) {
        const [m1, d1, y1] = dateMatch[1].split("/");
        startDate = `${y1}-${m1}-${d1}`;
        const [m2, d2, y2] = dateMatch[2].split("/");
        endDate = `${y2}-${m2}-${d2}`;
      }

      const modeRaw = $(tds[4]).text().trim();
      const mode = parseMode(modeRaw);

      const campus = $(tds[5]).text().trim();

      const meetingRaw = $(tds[6]).text().replace(/\s+/g, " ").trim();
      const days = parseDays(meetingRaw);
      const { start: startTime, end: endTime } = parseTime(meetingRaw);
      const instructor = parseInstructor($(tds[6]).text());

      const location = campus || (mode === "online" ? "Online" : "");

      sections.push({
        college_code: SLUG,
        term: termCode,
        course_prefix: prefix,
        course_number: number,
        course_title: courseTitle,
        credits,
        crn: `${courseId}-${sectionCode}`,
        section: sectionCode,
        days,
        start_time: startTime,
        end_time: endTime,
        start_date: startDate,
        end_date: endDate,
        location,
        campus,
        mode,
        instructor,
        seats_open: null,
        seats_total: null,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
    });
  });

  return { sections, total };
}

async function scrapeTerm(termId: string, termCode: string): Promise<Section[]> {
  console.log(`  Scraping term ${termCode} (ID ${termId})...`);
  const allSections: Section[] = [];

  const firstHtml = await fetchPage(termId, 0);
  const { sections: firstSections, total } = parsePage(firstHtml, termCode);
  allSections.push(...firstSections);

  const totalPages = Math.ceil(total / 100);
  console.log(`    ${total} total section rows, ${totalPages} pages`);

  for (let page = 1; page < totalPages; page++) {
    await new Promise((r) => setTimeout(r, 500));
    const html = await fetchPage(termId, page);
    const { sections } = parsePage(html, termCode);
    allSections.push(...sections);
    if ((page + 1) % 5 === 0) {
      console.log(`    page ${page + 1}/${totalPages} — ${allSections.length} sections so far`);
    }
  }

  console.log(`    Done: ${allSections.length} sections`);
  return allSections;
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termFilter = termIdx >= 0 ? args[termIdx + 1] : undefined;

  console.log("NTC (Northcentral Technical College) course scraper");
  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const termsToScrape = termFilter
    ? { [termFilter]: TERMS[termFilter] || `TERM${termFilter}` }
    : TERMS;

  let grandTotal = 0;
  for (const [termId, termCode] of Object.entries(termsToScrape)) {
    const sections = await scrapeTerm(termId, termCode);
    if (sections.length > 0) {
      const outPath = path.join(COURSES_DIR, `${termCode}.json`);
      fs.writeFileSync(outPath, JSON.stringify(sections, null, 2));
      console.log(`    Written ${sections.length} sections to ${outPath}`);
      grandTotal += sections.length;
    } else {
      console.log(`    No sections found for ${termCode}`);
    }
  }

  console.log(`\n  Total: ${grandTotal} sections`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
