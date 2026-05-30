/**
 * Scrape Old Dominion University VCCS Transfer Equivalency data.
 *
 * Source: https://courses.odu.edu/equivalency/
 * Uses the backend AJAX endpoint table_content.php which returns all VCCS
 * equivalencies as HTML table rows in a single request. No browser needed!
 *
 * Table columns (per row):
 *   1. Checkbox (skip)
 *   2. VCCS Course # (e.g. "ENG 111")
 *   3. VCCS Course Name
 *   4. Credits
 *   5. ODU Equivalent Course # (e.g. "ENGL 110")
 *   6. ODU Equivalent Course Name
 *   7. ODU Equivalent Credits
 *
 * Merges ODU mappings into data/transfer-equiv.json alongside existing data.
 *
 * Usage:
 *   npx tsx scripts/scrape-transfer-odu.ts
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

const TABLE_CONTENT_URL =
  "https://courses.odu.edu/equivalency/table_content.php";

async function fetchOduData(): Promise<string> {
  console.log("Fetching all VCCS equivalencies from ODU backend...");
  const res = await fetch(TABLE_CONTENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "school_id=00VCCS",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.text();
}

function parseRows(html: string): TransferMapping[] {
  // Wrap in a table so cheerio can parse it properly
  const $ = cheerio.load(`<table>${html}</table>`);
  const mappings: TransferMapping[] = [];

  $("tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length < 6) return;

    // The HTML has a quirk: the first <td> (checkbox) doesn't always close
    // properly before the next <td>. Cheerio handles this, but the cell
    // indices may shift. We look for the pattern:
    //   td[0] = checkbox (contains <input>)
    //   td[1] = VCCS Course # (e.g. "ACC 100")
    //   td[2] = VCCS Course Name
    //   td[3] = Credits
    //   td[4] = ODU Equivalent Course #
    //   td[5] = ODU Equivalent Course Name
    //   td[6] = ODU Equivalent Credits (may be empty)

    // Find the first td that looks like a course number (has letters + numbers)
    let offset = 0;
    const firstText = $(tds[0]).text().trim();
    if (firstText.match(/^[A-Z]{2,4}\s+\d/)) {
      offset = 0; // No checkbox column or it was merged
    } else {
      offset = 1; // Skip checkbox
    }

    const vccsRaw = $(tds[offset]).text().trim();
    const vccsTitle = $(tds[offset + 1])
      .text()
      .trim();
    const vccsCredits = $(tds[offset + 2])
      .text()
      .trim();
    const oduCourseRaw = $(tds[offset + 3])
      .text()
      .trim();
    const oduTitle = $(tds[offset + 4])
      .text()
      .trim()
      .replace(/<BR>/gi, "");
    const oduCredits =
      tds.length > offset + 5
        ? $(tds[offset + 5])
            .text()
            .trim()
        : "";

    if (!vccsRaw) return;

    // Parse VCCS course: "ENG 111" → prefix="ENG", number="111"
    const vccsParts = vccsRaw.match(/^([A-Z]{2,4})\s+(\S+)$/);
    if (!vccsParts) return;

    const prefix = vccsParts[1];
    const number = vccsParts[2];

    // Detect elective: patterns like "ENGL 1ELE", "XXXX XELE", "1ELE", "2ELE"
    const isElective =
      oduCourseRaw.includes("ELE") ||
      oduCourseRaw.includes("XELE") ||
      oduTitle.toLowerCase() === "elective";

    // Detect no credit
    const noCredit =
      oduCourseRaw.toUpperCase().includes("NO CREDIT") ||
      oduTitle.toUpperCase().includes("NO CREDIT") ||
      oduCourseRaw.toUpperCase().includes("NOCR") ||
      (!oduCourseRaw && !oduTitle);

    mappings.push({
      cc_prefix: prefix,
      cc_number: number,
      cc_course: `${prefix} ${number}`,
      cc_title: vccsTitle,
      cc_credits: vccsCredits,
      university: "odu",
      university_name: "Old Dominion University",
      univ_course: noCredit ? "" : oduCourseRaw,
      univ_title: noCredit ? "No ODU credit" : oduTitle || oduCourseRaw,
      univ_credits: noCredit ? "" : oduCredits || vccsCredits,
      notes: "",
      no_credit: noCredit,
      is_elective: isElective,
    });
  });

  return mappings;
}

async function main() {
  console.log("ODU Transfer Equivalency Scraper\n");

  const html = await fetchOduData();
  console.log(`  Received ${html.length} bytes of HTML`);

  const mappings = parseRows(html);

  if (mappings.length === 0) {
    console.log("⚠ No mappings found! Check if the endpoint changed.");
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

  console.log(`\nODU Summary:`);
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

  const nonOdu = existing.filter((m) => m.university !== "odu");
  const merged = [...nonOdu, ...mappings];

  console.log(
    `Merged: ${nonOdu.length} existing (non-ODU) + ${mappings.length} ODU = ${merged.length} total`
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`Saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
