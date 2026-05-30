/**
 * Scrape Catawba College transfer equivalency data.
 *
 * Source: https://catawba.edu/transfer/transferrable-courses/
 * Standard HTML table with ~800 course equivalency rows.
 *
 * Columns: Transfer Course | Transfer Title | Transfer Credits |
 *          Catawba Course | Catawba Title | Catawba Credits | Attribute
 *
 * Merges mappings into data/nc/transfer-equiv.json.
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-transfer-catawba.ts
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

const URL = "https://catawba.edu/transfer/transferrable-courses/";
const UNIVERSITY_SLUG = "catawba";
const UNIVERSITY_NAME = "Catawba College";

async function scrape(): Promise<TransferMapping[]> {
  console.log(`Fetching ${URL}...`);
  const resp = await fetch(URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();
  console.log(`Got ${html.length} bytes`);

  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  // Find the main table — look for rows with course data
  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 5) return; // skip header or malformed rows

    const transferCourse = $(cells[0]).text().trim();
    const transferTitle = $(cells[1]).text().trim();
    const transferCredits = $(cells[2]).text().trim();
    const catawbaCourse = $(cells[3]).text().trim();
    const catawbaTitle = $(cells[4]).text().trim();
    const catawbaCredits = cells.length > 5 ? $(cells[5]).text().trim() : "";
    const attribute = cells.length > 6 ? $(cells[6]).text().trim() : "";

    // Parse prefix and number from transfer course (e.g., "ACC 120")
    const match = transferCourse.match(/^([A-Z]{2,4})\s+(\d{3}[A-Z]?)$/);
    if (!match) return; // skip section headers or invalid rows

    const [, prefix, number] = match;
    const ccCourse = `${prefix} ${number}`;

    const isElective = /elective|0001|0002|0003/i.test(catawbaCourse);
    const noCredit = /no equivalent|no credit|not accepted/i.test(catawbaCourse) ||
                     /no equivalent|no credit|not accepted/i.test(catawbaTitle);

    const notes = attribute || "";

    mappings.push({
      cc_prefix: prefix,
      cc_number: number,
      cc_course: ccCourse,
      cc_title: transferTitle,
      cc_credits: transferCredits,
      university: UNIVERSITY_SLUG,
      university_name: UNIVERSITY_NAME,
      univ_course: noCredit ? "" : catawbaCourse,
      univ_title: noCredit ? "" : catawbaTitle,
      univ_credits: catawbaCredits,
      notes: noCredit ? `No equivalent at ${UNIVERSITY_NAME}` : notes,
      no_credit: noCredit,
      is_elective: isElective,
    });
  });

  return mappings;
}

async function main() {
  const mappings = await scrape();
  console.log(`Scraped ${mappings.length} Catawba College transfer mappings`);

  if (mappings.length === 0) {
    console.error("No mappings found — page structure may have changed");
    process.exit(1);
  }

  // Load existing data
  const dataPath = path.resolve(__dirname, "../../data/nc/transfer-equiv.json");
  const existing: TransferMapping[] = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

  // Remove old Catawba entries
  const filtered = existing.filter((m) => m.university !== UNIVERSITY_SLUG);
  const merged = [...filtered, ...mappings];

  fs.writeFileSync(dataPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Wrote ${merged.length} total mappings (was ${existing.length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
