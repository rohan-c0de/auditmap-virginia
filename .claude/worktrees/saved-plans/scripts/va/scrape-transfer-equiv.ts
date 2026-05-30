/**
 * Scrape Virginia Tech VCCS Transfer Equivalency data.
 *
 * Source: https://transferguide.registrar.vt.edu/VCCS-Equivalencies/VCCS-Equivalencies-2025.html
 *
 * Outputs: data/transfer-equiv.json
 *
 * Usage:
 *   npx tsx scripts/scrape-transfer-equiv.ts
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

const VT_URL =
  "https://transferguide.registrar.vt.edu/VCCS-Equivalencies/VCCS-Equivalencies-2025.html";

/**
 * Parse a VCCS course number string like "ACC 211" into prefix + number.
 * Handles edge cases like "BUS 147 + 226", "BLD 101, 102 & 111".
 */
function parseVccsCourse(raw: string): { prefix: string; number: string } {
  const trimmed = raw.trim();
  // Match standard pattern: PREFIX NUMBER (e.g., "ACC 211")
  const match = trimmed.match(/^([A-Z]{2,4})\s+(\S.*)$/);
  if (match) {
    return { prefix: match[1], number: match[2].trim() };
  }
  return { prefix: "", number: trimmed };
}

async function scrapeVirginiaTech(): Promise<TransferMapping[]> {
  console.log(`Fetching ${VT_URL}...`);
  const res = await fetch(VT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const html = await res.text();
  console.log(`Fetched ${(html.length / 1024).toFixed(0)} KB`);

  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  // Find all table rows (skip header rows)
  const rows = $("table tr");
  let skippedHeaders = 0;

  rows.each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 6) {
      // This is likely a header row or section separator
      skippedHeaders++;
      return;
    }

    const vccsCourseRaw = $(cells[0]).text().trim();
    const vccsTitle = $(cells[1]).text().trim();
    const vccsCredits = $(cells[2]).text().trim();
    const vtCourseRaw = $(cells[3]).text().trim();
    const vtTitle = $(cells[4]).text().trim();
    const vtCredits = $(cells[5]).text().trim();
    const notes = cells.length >= 7 ? $(cells[6]).text().trim() : "";

    // Skip empty rows
    if (!vccsCourseRaw && !vccsTitle) return;

    // Check for "NO VIRGINIA TECH CREDIT"
    const noCredit =
      vtCourseRaw.toUpperCase().includes("NO VIRGINIA TECH CREDIT") ||
      vtCourseRaw.toUpperCase().includes("NO VT CREDIT") ||
      vtTitle.toUpperCase().includes("NO VIRGINIA TECH CREDIT") ||
      vtTitle.toUpperCase().includes("NO CREDIT");

    // Check if it's an elective mapping (contains XXX)
    const isElective = vtCourseRaw.includes("XXX");

    const { prefix, number } = parseVccsCourse(vccsCourseRaw);

    // Skip if we couldn't parse a prefix
    if (!prefix) return;

    mappings.push({
      cc_prefix: prefix,
      cc_number: number,
      cc_course: vccsCourseRaw,
      cc_title: vccsTitle,
      cc_credits: vccsCredits,
      university: "vt",
      university_name: "Virginia Tech",
      univ_course: noCredit ? "" : vtCourseRaw,
      univ_title: noCredit ? "No Virginia Tech credit" : vtTitle,
      univ_credits: noCredit ? "" : vtCredits,
      notes,
      no_credit: noCredit,
      is_elective: isElective,
    });
  });

  console.log(
    `Parsed ${mappings.length} mappings (skipped ${skippedHeaders} header/separator rows)`
  );

  return mappings;
}

async function main() {
  console.log("Transfer Equivalency Scraper\n");

  const vtMappings = await scrapeVirginiaTech();

  // Stats
  const directEquiv = vtMappings.filter(
    (m) => !m.no_credit && !m.is_elective
  ).length;
  const electives = vtMappings.filter(
    (m) => !m.no_credit && m.is_elective
  ).length;
  const noCredit = vtMappings.filter((m) => m.no_credit).length;
  const prefixes = new Set(vtMappings.map((m) => m.cc_prefix));

  console.log(`\nSummary:`);
  console.log(`  Total mappings: ${vtMappings.length}`);
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject areas: ${prefixes.size}`);

  // Spot checks
  const eng111 = vtMappings.find(
    (m) => m.cc_prefix === "ENG" && m.cc_number === "111"
  );
  if (eng111) {
    console.log(
      `\n  Spot check — ENG 111: → ${eng111.univ_course} (${eng111.univ_title})`
    );
  }

  const acc211 = vtMappings.find(
    (m) => m.cc_prefix === "ACC" && m.cc_number === "211"
  );
  if (acc211) {
    console.log(
      `  Spot check — ACC 211: → ${acc211.univ_course} (${acc211.univ_title})`
    );
  }

  // Save
  const outPath = path.join(process.cwd(), "data", "va", "transfer-equiv.json");
  let existing: Record<string, unknown>[] = [];
  try { existing = JSON.parse(fs.readFileSync(outPath, "utf-8")); } catch { /* first run */ }
  const nonVt = existing.filter((m: Record<string, unknown>) => m.university !== "vt");
  const merged = [...nonVt, ...vtMappings];
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\nSaved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
