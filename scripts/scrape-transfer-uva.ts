/**
 * Scrape University of Virginia (Arts & Sciences) VCCS Transfer Equivalency data.
 *
 * Source: UVA Transfer of Credit Analyzer (server-rendered HTML)
 * URL: https://ascs8.eservices.virginia.edu/AsEquivs/Home/EquivsShow?schoolId=1001975
 *
 * VCCS schoolId = 1001975 (discovered from Kendo UI dropdown data).
 *
 * Table has 3 columns per data row:
 *   col[0] = Transfer Course (e.g. "ACC   211")
 *   col[1] = UVA Credit (e.g. "COMM   2010  \n4.00" or "(no    credit)")
 *   col[2] = Attributes (e.g. "HS", "WL", "CMP", "LS", etc.)
 *
 * Some rows have empty col[1] = no credit. Course and credits are combined
 * in one cell separated by whitespace/newlines.
 *
 * Merges UVA mappings into data/transfer-equiv.json alongside existing data.
 *
 * Usage:
 *   npx tsx scripts/scrape-transfer-uva.ts
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

const UVA_URL =
  "https://ascs8.eservices.virginia.edu/AsEquivs/Home/EquivsShow?schoolId=1001975";

async function fetchUvaData(): Promise<string> {
  console.log("Fetching UVA VCCS transfer equivalencies...");
  const res = await fetch(UVA_URL);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.text();
}

/**
 * Normalize whitespace: collapse multiple spaces/nbsp into single space.
 */
function norm(s: string): string {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse UVA credit cell: "COMM   2010  \n4.00" → { course: "COMM 2010", credits: "4.00" }
 * Also handles: "(no    credit)", empty, "1000T", etc.
 */
function parseUvaCredit(raw: string): {
  course: string;
  credits: string;
  noCredit: boolean;
} {
  const text = norm(raw);

  if (!text || text === "(no credit)") {
    return { course: "", credits: "", noCredit: true };
  }

  // Pattern: "DEPT COURSE CREDITS" e.g. "COMM 2010 4.00" or "BIOL 1006T 3.00"
  const match = text.match(
    /^([A-Z]{2,5})\s+(\S+)\s+(\d+\.\d+)$/
  );
  if (match) {
    return {
      course: `${match[1]} ${match[2]}`,
      credits: match[3],
      noCredit: false,
    };
  }

  // Pattern without credits: "COMM 2010"
  const match2 = text.match(/^([A-Z]{2,5})\s+(\S+)$/);
  if (match2) {
    return {
      course: `${match2[1]} ${match2[2]}`,
      credits: "",
      noCredit: false,
    };
  }

  // Fallback: return as-is
  return { course: text, credits: "", noCredit: false };
}

function parseRows(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];
  const seen = new Set<string>(); // Deduplicate

  $("tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length < 2) return;

    // Skip header/separator rows
    const firstTd = $(tds[0]).attr("id");
    if (firstTd === "content") return;
    const colspan = $(tds[0]).attr("colspan");
    if (colspan) return;

    // Column 0: Transfer course "ACC   211"
    const vccsRaw = norm($(tds[0]).text());
    if (!vccsRaw) return;

    // Parse VCCS course
    const vccsParts = vccsRaw.match(/^([A-Z]{2,4})\s+(\S+)$/);
    if (!vccsParts) return;

    const prefix = vccsParts[1];
    const number = vccsParts[2];

    // Column 1: UVA credit "COMM 2010 \n 4.00" or "(no credit)" or empty
    const uvaRaw = $(tds[1]).text();
    const { course, credits, noCredit } = parseUvaCredit(uvaRaw);

    // Column 2: Attributes (optional)
    const attributes = tds.length >= 3 ? norm($(tds[2]).text()) : "";

    // Deduplicate: same VCCS course → same UVA course
    const dedupeKey = `${prefix}-${number}-${course}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    // Detect elective: "T" suffix on course number (e.g. "1000T", "2000T")
    const isElective = course.includes("T") && /\d+T$/.test(course);

    mappings.push({
      vccs_prefix: prefix,
      vccs_number: number,
      vccs_course: `${prefix} ${number}`,
      vccs_title: "",
      vccs_credits: credits || "",
      university: "uva",
      university_name: "University of Virginia",
      univ_course: noCredit ? "" : course,
      univ_title: noCredit ? "No UVA credit" : course,
      univ_credits: noCredit ? "" : credits,
      notes: attributes,
      no_credit: noCredit,
      is_elective: isElective && !noCredit,
    });
  });

  return mappings;
}

async function main() {
  console.log("UVA Transfer Equivalency Scraper\n");

  const html = await fetchUvaData();
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

  console.log(`\nUVA Summary:`);
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
      `\n  Spot check — ENG 111: → ${eng111.univ_course} (credits: ${eng111.univ_credits})`
    );
  }
  const mth263 = mappings.find(
    (m) => m.vccs_prefix === "MTH" && m.vccs_number === "263"
  );
  if (mth263) {
    console.log(
      `  Spot check — MTH 263: → ${mth263.univ_course} (credits: ${mth263.univ_credits})`
    );
  }
  const bio101 = mappings.find(
    (m) => m.vccs_prefix === "BIO" && m.vccs_number === "101"
  );
  if (bio101) {
    console.log(
      `  Spot check — BIO 101: → ${bio101.univ_course} (credits: ${bio101.univ_credits})`
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

  const nonUva = existing.filter((m) => m.university !== "uva");
  const merged = [...nonUva, ...mappings];

  console.log(
    `Merged: ${nonUva.length} existing (non-UVA) + ${mappings.length} UVA = ${merged.length} total`
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`Saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
