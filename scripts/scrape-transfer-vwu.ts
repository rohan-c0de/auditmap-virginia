/**
 * Scrape Virginia Wesleyan University VCCS Transfer Equivalency data.
 *
 * Source: Static HTML table at vwu.edu
 * URL: https://www.vwu.edu/enrollment-aid/transfers/vccs-course-transfer-table.php
 *
 * Single table with 6 columns (note: <tr> tags are not closed in the HTML):
 *   col[0] = VCC Department (e.g. "Accounting") — only on first row of group
 *   col[1] = VCC Course (e.g. "ACC 211")
 *   col[2] = VCC Credits
 *   col[3] = VWU Department (e.g. "Management, Business and Economics")
 *   col[4] = VWU Course (e.g. "MBE 203")
 *   col[5] = VWU Credits
 *
 * "(GE)" suffix on VWU course indicates General Education credit.
 * "Elec" in VWU course indicates elective credit.
 *
 * Merges VWU mappings into data/transfer-equiv.json alongside existing data.
 *
 * Usage:
 *   npx tsx scripts/scrape-transfer-vwu.ts
 */

import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

interface TransferMapping {
  vccs_prefix: string;
  vccs_number: string;
  vccs_course: string;
  vccs_title: string;
  vccs_credits: string;
  university: string;
  university_name: string;
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  notes: string;
  no_credit: boolean;
  is_elective: boolean;
}

const VWU_URL =
  "https://www.vwu.edu/enrollment-aid/transfers/vccs-course-transfer-table.php";

async function fetchVwuData(): Promise<string> {
  console.log("Fetching VWU VCCS transfer table...");
  const res = await fetch(VWU_URL);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.text();
}

function parseRows(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  let currentVccsDept = "";
  let currentVwuDept = "";

  $("table.table tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length < 6) return;

    // Column 0: VCC department (bold text, only on first row of group)
    const deptText = $(tds[0]).find("strong").text().trim() || $(tds[0]).text().trim();
    if (deptText) currentVccsDept = deptText;

    // Column 3: VWU department
    const vwuDeptText = $(tds[3]).find("strong").text().trim() || "";
    if (vwuDeptText) currentVwuDept = vwuDeptText;

    // Column 1: VCC course (e.g. "ACC 211")
    const vccsRaw = $(tds[1]).text().trim();
    if (!vccsRaw) return;

    // Parse VCCS course
    const vccsParts = vccsRaw.match(/^([A-Z]{2,4})\s+(\S+)/);
    if (!vccsParts) return;

    const prefix = vccsParts[1];
    const number = vccsParts[2];

    const vccsCredits = $(tds[2]).text().trim();
    const vwuCourse = $(tds[4]).text().trim();
    const vwuCredits = $(tds[5]).text().trim();

    if (!vwuCourse) return;

    // Detect elective: "Elec" in course name
    const isElective =
      vwuCourse.toLowerCase().includes("elec") ||
      vwuCourse.includes("XX");

    // Detect no credit
    const noCredit =
      vwuCourse.toLowerCase().includes("no credit") ||
      vwuCredits === "0";

    // Extract GE notation
    const hasGE = vwuCourse.includes("(GE)");
    const cleanCourse = vwuCourse.replace("(GE)", "").trim();
    const notes = hasGE ? "Fulfills General Education requirement" : "";

    mappings.push({
      vccs_prefix: prefix,
      vccs_number: number,
      vccs_course: `${prefix} ${number}`,
      vccs_title: currentVccsDept,
      vccs_credits: vccsCredits,
      university: "vwu",
      university_name: "Virginia Wesleyan University",
      univ_course: noCredit ? "" : cleanCourse,
      univ_title: noCredit
        ? "No VWU credit"
        : currentVwuDept
          ? `${currentVwuDept}: ${cleanCourse}`
          : cleanCourse,
      univ_credits: noCredit ? "" : vwuCredits || vccsCredits,
      notes,
      no_credit: noCredit,
      is_elective: isElective && !noCredit,
    });
  });

  return mappings;
}

async function main() {
  console.log("VWU Transfer Equivalency Scraper\n");

  const html = await fetchVwuData();
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
  const prefixes = new Set(mappings.map((m) => m.vccs_prefix));

  console.log(`\nVWU Summary:`);
  console.log(`  Total mappings: ${mappings.length}`);
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject areas: ${prefixes.size}`);

  // Spot checks
  const eng111 = mappings.find(
    (m) => m.vccs_prefix === "ENG" && m.vccs_number === "111"
  );
  if (eng111) {
    console.log(
      `\n  Spot check — ENG 111: → ${eng111.univ_course} (${eng111.univ_title})`
    );
  }
  const bio101 = mappings.find(
    (m) => m.vccs_prefix === "BIO" && m.vccs_number === "101"
  );
  if (bio101) {
    console.log(
      `  Spot check — BIO 101: → ${bio101.univ_course} (${bio101.univ_title})`
    );
  }

  // Merge with existing data
  const outPath = path.join(process.cwd(), "data", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    console.log(`\nLoaded ${existing.length} existing mappings`);
  } catch {
    console.log(`\nNo existing data found, starting fresh`);
  }

  const nonVwu = existing.filter((m) => m.university !== "vwu");
  const merged = [...nonVwu, ...mappings];

  console.log(
    `Merged: ${nonVwu.length} existing (non-VWU) + ${mappings.length} VWU = ${merged.length} total`
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`Saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
