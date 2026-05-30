/**
 * Scrape George Mason University VCCS Transfer Equivalency data.
 *
 * Source: https://transfermatrix.admissions.gmu.edu/
 * The "View All" option for VCCS returns all equivalencies in a single HTML
 * table — no JavaScript needed, just a GET request.
 *
 * URL: ?state=VA&school=USVCCS&course=View%20All
 *
 * Table columns:
 *   Transferring Institution:
 *     Course Number | Course Name | Credits
 *   GMU Equivalent:
 *     Course Number | Course Name | Credits
 *
 * GMU patterns:
 *   - "ACCT ----" = department elective
 *   - "GENL ----" = general elective
 *   - "UNIV XXX" + "Does Not Transfer" = no credit
 *   - "ENGL 101" = direct equivalency
 *   - "L" prefix on level (e.g., "BIOL L311") = lower-level transfer
 *
 * Merges GMU mappings into data/transfer-equiv.json alongside existing data.
 *
 * Usage:
 *   npx tsx scripts/scrape-transfer-gmu.ts
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

const GMU_URL =
  "https://transfermatrix.admissions.gmu.edu/?state=VA&school=USVCCS&course=View%20All";

async function fetchGmuData(): Promise<string> {
  console.log("Fetching all VCCS equivalencies from GMU...");
  const res = await fetch(GMU_URL);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.text();
}

function parseRows(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  // Find the results table — it's the one with "All Transferrable Courses" header
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resultsTable: any = null;
  $("table").each((_, table) => {
    const text = $(table).text();
    if (text.includes("All Transferrable Courses")) {
      resultsTable = $(table);
    }
  });

  if (!resultsTable) {
    const tables = $("table");
    if (tables.length > 0) {
      resultsTable = $(tables[tables.length - 1]);
    }
  }

  if (!resultsTable) {
    console.log("  ⚠ No results table found!");
    return [];
  }

  // Iterate data rows (skip header rows with <th>)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resultsTable.find("tr").each((_: number, row: any) => {
    const tds = $(row).find("td");
    if (tds.length < 6) return;

    const vccsRaw = $(tds[0]).text().trim();
    const vccsTitle = $(tds[1]).text().trim();
    const vccsCredits = $(tds[2]).text().trim();
    const gmuCourseRaw = $(tds[3]).text().trim();
    const gmuTitle = $(tds[4]).text().trim();
    const gmuCredits = $(tds[5]).text().trim();

    if (!vccsRaw) return;

    // Skip combo courses like "ACC 211 & ACC 212" — too complex to map
    if (vccsRaw.includes("&")) return;

    // Parse VCCS course: "ENG 111" → prefix + number
    const vccsParts = vccsRaw.match(/^([A-Z]{2,4})\s+(\S+)$/);
    if (!vccsParts) return;

    const prefix = vccsParts[1];
    const number = vccsParts[2];

    // Detect no credit: "UNIV XXX" + "Does Not Transfer"
    const noCredit =
      gmuCourseRaw.includes("UNIV XXX") ||
      gmuTitle.includes("Does Not Transfer") ||
      gmuCredits === "0";

    // Detect elective: "----" pattern (e.g., "ACCT ----", "GENL ----")
    const isElective =
      gmuCourseRaw.includes("----") ||
      gmuCourseRaw.includes("GENL") ||
      gmuTitle.toLowerCase().includes("elective");

    mappings.push({
      cc_prefix: prefix,
      cc_number: number,
      cc_course: `${prefix} ${number}`,
      cc_title: vccsTitle,
      cc_credits: vccsCredits,
      university: "gmu",
      university_name: "George Mason University",
      univ_course: noCredit ? "" : gmuCourseRaw,
      univ_title: noCredit ? "No GMU credit" : gmuTitle || gmuCourseRaw,
      univ_credits: noCredit ? "" : gmuCredits || vccsCredits,
      notes: "",
      no_credit: noCredit,
      is_elective: isElective && !noCredit,
    });
  });

  return mappings;
}

async function main() {
  console.log("GMU Transfer Equivalency Scraper\n");

  const html = await fetchGmuData();
  console.log(`  Received ${html.length} bytes of HTML`);

  const mappings = parseRows(html);

  if (mappings.length === 0) {
    console.log("⚠ No mappings found! Check if the page structure changed.");
    process.exit(1);
  }

  // Stats
  const directEquiv = mappings.filter(
    (m) => !m.no_credit && !m.is_elective
  ).length;
  const electives = mappings.filter(
    (m) => !m.no_credit && m.is_elective
  ).length;
  const noCredit = mappings.filter((m) => m.no_credit).length;
  const prefixes = new Set(mappings.map((m) => m.cc_prefix));

  console.log(`\nGMU Summary:`);
  console.log(`  Total mappings: ${mappings.length}`);
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject areas: ${prefixes.size}`);

  // Spot checks
  const eng111 = mappings.find(
    (m) => m.cc_prefix === "ENG" && m.cc_number === "111"
  );
  if (eng111) {
    console.log(
      `\n  Spot check — ENG 111: → ${eng111.univ_course} (${eng111.univ_title})`
    );
  }
  const mth263 = mappings.find(
    (m) => m.cc_prefix === "MTH" && m.cc_number === "263"
  );
  if (mth263) {
    console.log(
      `  Spot check — MTH 263: → ${mth263.univ_course} (${mth263.univ_title})`
    );
  }
  const bio101 = mappings.find(
    (m) => m.cc_prefix === "BIO" && m.cc_number === "101"
  );
  if (bio101) {
    console.log(
      `  Spot check — BIO 101: → ${bio101.univ_course} (${bio101.univ_title})`
    );
  }

  // Merge with existing data
  const outPath = path.join(process.cwd(), "data", "va", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    console.log(`\nLoaded ${existing.length} existing mappings`);
  } catch {
    console.log(`\nNo existing data found, starting fresh`);
  }

  const nonGmu = existing.filter((m) => m.university !== "gmu");
  const merged = [...nonGmu, ...mappings];

  console.log(
    `Merged: ${nonGmu.length} existing (non-GMU) + ${mappings.length} GMU = ${merged.length} total`
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`Saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
