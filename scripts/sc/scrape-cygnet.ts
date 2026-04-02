/**
 * scrape-cygnet.ts
 *
 * Scrapes course section data from Greenville Technical College which uses
 * an Ellucian Cygnet-based course schedule at cygnet.gvltec.edu.
 * Requires Playwright since the form requires JavaScript execution.
 *
 * Usage:
 *   npx tsx scripts/sc/scrape-cygnet.ts
 *   npx tsx scripts/sc/scrape-cygnet.ts --term "Fall 2026"
 */

import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";

const URL = "https://cygnet.gvltec.edu/courselist/courselist.cfm";
const SLUG = "greenville";

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

function termNameToCode(termName: string): string {
  const yearMatch = termName.match(/(\d{4})/);
  const seasonMatch = termName.match(/(spring|summer|fall)/i);
  if (!yearMatch || !seasonMatch) return "2026FA";
  const season = seasonMatch[1].toLowerCase();
  const code = season === "spring" ? "SP" : season === "summer" ? "SU" : "FA";
  return `${yearMatch[1]}${code}`;
}

function detectMode(method: string, location: string): CourseMode {
  const m = (method + " " + location).toLowerCase();
  if (m.includes("online") || m.includes("internet") || m.includes("web")) {
    if (m.includes("hybrid") || m.includes("blended")) return "hybrid";
    return "online";
  }
  if (m.includes("zoom") || m.includes("virtual")) return "zoom";
  if (m.includes("hybrid") || m.includes("blended")) return "hybrid";
  if (m.includes("flex")) return "hybrid";
  return "in-person";
}

function parseDays(mo: string, tu: string, we: string, th: string, fr: string, sa: string, su: string): string {
  const days: string[] = [];
  if (mo && mo !== " ") days.push("M");
  if (tu && tu !== " ") days.push("Tu");
  if (we && we !== " ") days.push("W");
  if (th && th !== " ") days.push("Th");
  if (fr && fr !== " ") days.push("F");
  if (sa && sa !== " ") days.push("Sa");
  if (su && su !== " ") days.push("Su");
  return days.join(" ");
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termName = termIdx >= 0 ? args[termIdx + 1] : "Fall 2026";
  const termCode = termNameToCode(termName);

  // Map term name to Cygnet term code format (e.g., "2026FA")
  const cygnetTerm = termCode; // Same format

  console.log(`Scraping Greenville Tech (Cygnet) for ${termName} (${cygnetTerm})...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);

    // Select term
    await page.selectOption('select[name="selTerm"]', cygnetTerm);
    // Select "All Locations"
    await page.selectOption('select[name="selLoc"]', "All Locations");
    // Submit
    await page.click('input[type="submit"][value="Submit"]');
    await page.waitForTimeout(5000);

    // Wait for table to load
    await page.waitForSelector("table", { timeout: 15000 }).catch(() => {});

    // Extract table data
    const rows = await page.evaluate(() => {
      const tables = document.querySelectorAll("table");
      // Find the data table (the one with course data)
      for (const table of tables) {
        const trs = table.querySelectorAll("tr");
        if (trs.length < 5) continue;

        const data: string[][] = [];
        for (const tr of trs) {
          const cells = tr.querySelectorAll("td");
          if (cells.length >= 10) {
            data.push(Array.from(cells).map((c) => c.textContent?.trim() || ""));
          }
        }
        if (data.length > 0) return data;
      }
      return [];
    });

    console.log(`  Found ${rows.length} data rows`);

    if (rows.length === 0) {
      // Try getting page content for debugging
      const html = await page.content();
      console.log(`  Page length: ${html.length}`);
      // Check if there's data in a different format
      const allText = await page.evaluate(() => document.body?.innerText?.slice(0, 500));
      console.log(`  Page text: ${allText}`);
      await browser.close();
      return;
    }

    // Parse rows into CourseSection objects
    // Expected columns based on headers:
    // Section, (Title implied), Hours, Method, Start Time, End Time, Mo, Tu, We, Th, Fr, Sa, Su, Start Date, End Date, Instructor, Location, Status
    const sections: CourseSection[] = [];

    for (const cells of rows) {
      if (cells.length < 15) continue;

      const sectionField = cells[0]; // e.g., "ACC-101-01"
      const title = cells[1];
      const credits = parseFloat(cells[2]) || 0;
      const method = cells[3];
      const startTime = cells[4];
      const endTime = cells[5];
      const mo = cells[6];
      const tu = cells[7];
      const we = cells[8];
      const th = cells[9];
      const fr = cells[10];
      const sa = cells[11];
      const su = cells[12];
      const startDate = cells[13];
      const instructor = cells[15] || null;
      const location = cells[16] || "";

      // Parse section field: "ACC-101-01" → prefix=ACC, number=101, CRN=01
      const sectionMatch = sectionField.match(/^([A-Z]{2,4})-(\d{3}[A-Z]?)-(.+)$/);
      if (!sectionMatch) continue;

      const [, prefix, number, crn] = sectionMatch;

      sections.push({
        college_code: SLUG,
        term: termCode,
        course_prefix: prefix,
        course_number: number,
        course_title: title,
        credits,
        crn,
        days: parseDays(mo, tu, we, th, fr, sa, su),
        start_time: startTime,
        end_time: endTime,
        start_date: startDate,
        location,
        campus: location,
        mode: detectMode(method, location),
        instructor: instructor && instructor !== "" ? instructor : null,
        seats_open: null,
        seats_total: null,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
    }

    console.log(`  Parsed ${sections.length} course sections`);

    if (sections.length > 0) {
      const outDir = path.join(process.cwd(), "data", "sc", "courses", SLUG);
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, `${termCode}.json`);
      fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
      console.log(`  Written to ${outPath}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
