/**
 * Scrape High Point University transfer equivalency data.
 *
 * Source: https://www.highpoint.edu/admissions/transfer-admissions/
 * Ninja Tables WordPress plugin (table_id: 36123), server-rendered HTML.
 *
 * Columns: NCCC Courses | HPU Courses | Core
 *
 * The "NCCC Courses" column contains both the course code and title
 * in a single cell (e.g., "ACC 120 Principles of Financial Accounting").
 * Some rows are section headers (just a subject name, no course code).
 *
 * Merges mappings into data/nc/transfer-equiv.json.
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-transfer-hpu.ts
 */

import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

interface TransferMapping {
  cc_prefix: string;
  cc_number: string;
  cc_course: string;
  cc_title: string;
  cc_credits: string;
  university: string;
  university_name: string;
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  notes: string;
  no_credit: boolean;
  is_elective: boolean;
}

const URL = "https://www.highpoint.edu/admissions/transfer-admissions/";
const UNIVERSITY_SLUG = "high-point";
const UNIVERSITY_NAME = "High Point University";

async function scrape(): Promise<TransferMapping[]> {
  console.log(`Fetching ${URL}...`);
  const resp = await fetch(URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();
  console.log(`Got ${html.length} bytes`);

  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  // The Ninja Tables plugin renders a footable — look for the table rows
  // Try multiple selectors for Ninja Tables output
  const tableSelectors = [
    "#footable_36123 tbody tr",
    ".ninja_table_wrapper table tbody tr",
    "table.ninja_footable tbody tr",
    "table tbody tr",
  ];

  let rows: cheerio.Cheerio<cheerio.Element> | null = null;
  for (const sel of tableSelectors) {
    const found = $(sel);
    if (found.length > 10) {
      rows = found;
      console.log(`Found ${found.length} rows using selector: ${sel}`);
      break;
    }
  }

  if (!rows || rows.length === 0) {
    // Try extracting from inline JSON data
    console.log("No table rows found in HTML, trying inline JSON...");
    const scriptContent = $("script").map((_, el) => $(el).html()).get().join("\n");
    const jsonMatch = scriptContent.match(/window\['ninja_table_instance_0'\]\s*=\s*(\{[\s\S]*?\});\s*(?:window|<\/script>)/);
    if (jsonMatch) {
      return parseFromJson(jsonMatch[1]);
    }
    console.error("Could not find table data in page");
    return [];
  }

  rows.each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;

    const ncccRaw = $(cells[0]).text().trim();
    const hpuCourse = $(cells[1]).text().trim();
    const core = cells.length > 2 ? $(cells[2]).text().trim() : "";

    // Parse course code from the NCCC column
    // Format: "ACC 120 Principles of Financial Accounting"
    // Or combined: "COM 110 Intro to Communication & COM 231 Public Speaking"
    const courseMatch = ncccRaw.match(/^([A-Z]{2,4})\s+(\d{3}[A-Z]?)\s+(.+)$/);
    if (!courseMatch) return; // skip section headers

    const [, prefix, number, title] = courseMatch;
    const ccCourse = `${prefix} ${number}`;

    const isElective = /elective/i.test(hpuCourse);
    const noCredit = /no credit|no equivalent|not accepted/i.test(hpuCourse);

    const notes = core ? `Core: ${core}` : "";

    mappings.push({
      cc_prefix: prefix,
      cc_number: number,
      cc_course: ccCourse,
      cc_title: title.trim(),
      cc_credits: "",
      university: UNIVERSITY_SLUG,
      university_name: UNIVERSITY_NAME,
      univ_course: noCredit ? "" : hpuCourse,
      univ_title: "",
      univ_credits: "",
      notes,
      no_credit: noCredit,
      is_elective: isElective,
    });
  });

  return mappings;
}

function parseFromJson(jsonStr: string): TransferMapping[] {
  try {
    const config = JSON.parse(jsonStr);
    const rows = config.rows || config.data || [];
    console.log(`Parsing ${rows.length} rows from inline JSON`);

    const mappings: TransferMapping[] = [];
    for (const row of rows) {
      const ncccRaw = (row.nccccourses || row["NCCC Courses"] || "").replace(/<[^>]+>/g, "").trim();
      const hpuCourse = (row.hpucourses || row["HPU Courses"] || "").replace(/<[^>]+>/g, "").trim();
      const core = (row.core || row["Core"] || "").replace(/<[^>]+>/g, "").trim();

      const courseMatch = ncccRaw.match(/^([A-Z]{2,4})\s+(\d{3}[A-Z]?)\s+(.+)$/);
      if (!courseMatch) continue;

      const [, prefix, number, title] = courseMatch;

      const isElective = /elective/i.test(hpuCourse);
      const noCredit = /no credit|no equivalent|not accepted/i.test(hpuCourse);
      const notes = core ? `Core: ${core}` : "";

      mappings.push({
        cc_prefix: prefix,
        cc_number: number,
        cc_course: `${prefix} ${number}`,
        cc_title: title.trim(),
        cc_credits: "",
        university: UNIVERSITY_SLUG,
        university_name: UNIVERSITY_NAME,
        univ_course: noCredit ? "" : hpuCourse,
        univ_title: "",
        univ_credits: "",
        notes,
        no_credit: noCredit,
        is_elective: isElective,
      });
    }
    return mappings;
  } catch (e) {
    console.error("Failed to parse JSON:", e);
    return [];
  }
}

async function main() {
  const mappings = await scrape();
  console.log(`Scraped ${mappings.length} High Point University transfer mappings`);

  if (mappings.length === 0) {
    console.error("No mappings found — page structure may have changed");
    process.exit(1);
  }

  // Load existing data
  const dataPath = path.resolve(__dirname, "../../data/nc/transfer-equiv.json");
  const existing: TransferMapping[] = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

  // Remove old HPU entries
  const filtered = existing.filter((m) => m.university !== UNIVERSITY_SLUG);
  const merged = [...filtered, ...mappings];

  fs.writeFileSync(dataPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Wrote ${merged.length} total mappings (was ${existing.length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
