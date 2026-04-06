/**
 * scrape-transfer-uga.ts
 *
 * Scrapes transfer equivalency data from the University of Georgia's
 * public transfer equivalency tool for all TCSG colleges.
 *
 * UGA uses a Slate/Technolutions-based tool with a public REST API:
 *   - School lookup: GET /manage/service/lookup?type=school&q=...
 *   - Equivalencies: GET /portal/transfer-equivalency?cmd=search&ceeb=...
 *
 * All results are returned in a single HTML page per college (no pagination).
 * No authentication required.
 *
 * Usage:
 *   npx tsx scripts/ga/scrape-transfer-uga.ts
 *   npx tsx scripts/ga/scrape-transfer-uga.ts --college atlanta-tech
 */

import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransferMapping {
  state: string;
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

// ---------------------------------------------------------------------------
// TCSG colleges → CEEB codes (used by UGA's Slate system)
// CEEB codes discovered via: GET /manage/service/lookup?type=school&q=...
// ---------------------------------------------------------------------------

const TCSG_COLLEGES: Record<string, { ceeb: string; name: string }> = {
  "albany-tech":            { ceeb: "003921", name: "Albany Technical College" },
  "athens-tech":            { ceeb: "000462", name: "Athens Technical College" },
  "atlanta-tech":           { ceeb: "005030", name: "Atlanta Technical College" },
  "augusta-tech":           { ceeb: "002620", name: "Augusta Technical College" },
  "central-ga-tech":        { ceeb: "001709", name: "Central Georgia Tech College" },
  "chattahoochee-tech":     { ceeb: "005441", name: "Chattahoochee Tech College" },
  "coastal-pines-tech":     { ceeb: "004172", name: "Coastal Pines Technical College" },
  "columbus-tech":          { ceeb: "005704", name: "Columbus Technical College" },
  "ga-northwestern-tech":   { ceeb: "002860", name: "Georgia Northwestern Tech College" },
  "ga-piedmont-tech":       { ceeb: "003226", name: "Georgia Piedmont Technical College" },
  "gwinnett-tech":          { ceeb: "005168", name: "Gwinnett Technical College" },
  "lanier-tech":            { ceeb: "130352", name: "Lanier Technical College" },
  "north-ga-tech":          { ceeb: "005507", name: "North Georgia Tech College" },
  "oconee-fall-line-tech":  { ceeb: "005772", name: "Oconee Fall Line Tech College" },
  "ogeechee-tech":          { ceeb: "000154", name: "Ogeechee Technical College" },
  "savannah-tech":          { ceeb: "003741", name: "Savannah Tech College" },
  "south-ga-tech":          { ceeb: "006555", name: "South Georgia Technical College" },
  "southeastern-tech":      { ceeb: "005652", name: "Southeastern Technical College" },
  "southern-crescent-tech": { ceeb: "005670", name: "Southern Crescent Tech College" },
  "southern-regional-tech": { ceeb: "007058", name: "Southern Regional Tech College" },
  "west-ga-tech":           { ceeb: "006342", name: "West Georgia Technical College" },
  "wiregrass-tech":         { ceeb: "004557", name: "Wiregrass Georgia Tech College" },
};

const BASE_URL = "https://apply.uga.edu/portal/transfer-equivalency";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse a UGA course code like "ENGL 1101" into prefix + number.
 * Transfer courses from TCSG have no space (e.g., "ENGL1101").
 * UGA courses have a space (e.g., "ENGL 1101").
 */
function parseCourse(raw: string): { prefix: string; number: string } {
  const cleaned = raw.trim();
  // Try "PREFIX NUMBER" format first (UGA style)
  const spaceMatch = cleaned.match(/^([A-Z]{2,5})\s+(\S+)$/);
  if (spaceMatch) return { prefix: spaceMatch[1], number: spaceMatch[2] };
  // Try no-space format (TCSG style: "ENGL1101")
  const noSpaceMatch = cleaned.match(/^([A-Z]{2,5})(\d\S*)$/);
  if (noSpaceMatch) return { prefix: noSpaceMatch[1], number: noSpaceMatch[2] };
  return { prefix: "", number: cleaned };
}

/**
 * Determine if a UGA course is elective credit.
 * Patterns:
 *   - "DEPT 1GXX" or "DEPT 1GXXL" — General Ed Core Elective
 *   - "DEPT 1TXX" or "DEPT 1TXXL" — Transfer Elective
 */
function isElectiveCourse(ugaCourse: string): boolean {
  return /[GT]XX/i.test(ugaCourse);
}

// ---------------------------------------------------------------------------
// Scraping
// ---------------------------------------------------------------------------

/**
 * Fetch and parse transfer equivalencies for one TCSG college from UGA.
 */
async function scrapeCollege(
  slug: string,
  ceeb: string,
  collegeName: string
): Promise<TransferMapping[]> {
  const url = `${BASE_URL}?cmd=search&ceeb=${ceeb}`;
  const resp = await fetch(url, { headers: HEADERS });

  if (!resp.ok) {
    console.log(`  ⚠ HTTP ${resp.status} for ${collegeName} (CEEB ${ceeb})`);
    return [];
  }

  const html = await resp.text();
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  // Parse the equivalency table: 2 visible columns per row
  // Col 1: Transfer course (no space, e.g., "ENGL1101")
  // Col 2: UGA course (e.g., "ENGL 1101") or "Not Transferrable"
  $("table.searchable tbody tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length < 2) return;

    const ccRaw = $(tds[0]).text().trim();
    const ugaRaw = $(tds[1]).text().trim();

    if (!ccRaw || !ugaRaw) return;

    const cc = parseCourse(ccRaw);
    if (!cc.prefix || !cc.number) return;

    // Detect "Not Transferrable" (UGA uses double-r spelling)
    const noCredit =
      ugaRaw.toLowerCase().includes("not transfer") ||
      ugaRaw.toLowerCase().includes("no credit");

    const uga = noCredit ? { prefix: "", number: "" } : parseCourse(ugaRaw);
    const isElective = !noCredit && isElectiveCourse(ugaRaw);

    const univCourse = noCredit ? "" : `${uga.prefix} ${uga.number}`.trim();

    // Determine title based on type
    let univTitle = "";
    if (noCredit) {
      univTitle = "Not transferable";
    } else if (isElective && ugaRaw.includes("GXX")) {
      univTitle = "General Education Core Elective";
    } else if (isElective && ugaRaw.includes("TXX")) {
      univTitle = "Transfer Elective";
    }
    // UGA doesn't provide course titles in this tool — only codes

    mappings.push({
      state: "ga",
      cc_prefix: cc.prefix,
      cc_number: cc.number,
      cc_course: `${cc.prefix} ${cc.number}`,
      cc_title: "", // Not provided by UGA tool
      cc_credits: "",
      university: "uga",
      university_name: "University of Georgia",
      univ_course: univCourse,
      univ_title: univTitle,
      univ_credits: "",
      notes: "",
      no_credit: noCredit,
      is_elective: isElective,
    });
  });

  return mappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("University of Georgia — Transfer Equivalency Scraper\n");

  // Parse CLI args
  const args = process.argv.slice(2);
  let targetCollege: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--college" && args[i + 1]) {
      targetCollege = args[i + 1];
    }
  }

  const colleges = targetCollege
    ? { [targetCollege]: TCSG_COLLEGES[targetCollege] }
    : TCSG_COLLEGES;

  if (targetCollege && !TCSG_COLLEGES[targetCollege]) {
    console.error(`Unknown college: ${targetCollege}`);
    console.error(`Valid: ${Object.keys(TCSG_COLLEGES).join(", ")}`);
    process.exit(1);
  }

  const allMappings: TransferMapping[] = [];
  let collegeIndex = 0;
  const total = Object.keys(colleges).length;

  for (const [slug, { ceeb, name }] of Object.entries(colleges)) {
    collegeIndex++;
    console.log(`[${collegeIndex}/${total}] ${name} (CEEB ${ceeb}):`);

    const mappings = await scrapeCollege(slug, ceeb, name);
    console.log(`  ${mappings.length} equivalencies`);

    allMappings.push(...mappings);

    // Rate limiting
    if (collegeIndex < total) {
      await sleep(300);
    }
  }

  // Deduplicate across colleges (same CC course → same UGA course)
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_course}|${m.univ_course}|${m.no_credit}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(m);
    }
  }

  // Filter out no-credit
  const transferable = deduped.filter((m) => !m.no_credit);

  // Stats
  const directCount = transferable.filter((m) => !m.is_elective).length;
  const electiveCount = transferable.filter((m) => m.is_elective).length;
  const noCreditCount = deduped.filter((m) => m.no_credit).length;

  console.log(`\nSummary:`);
  console.log(`  Raw equivalencies: ${allMappings.length}`);
  console.log(`  After dedup: ${deduped.length}`);
  console.log(`  Transferable: ${transferable.length}`);
  console.log(`    Direct equivalencies: ${directCount}`);
  console.log(`    Elective credit: ${electiveCount}`);
  console.log(`  Not transferable: ${noCreditCount}`);

  // Spot checks
  const eng1101 = transferable.find(
    (m) => m.cc_prefix === "ENGL" && m.cc_number === "1101"
  );
  if (eng1101) {
    console.log(
      `\n  Spot check — ENGL 1101: → ${eng1101.univ_course} (${eng1101.univ_title || "direct"})`
    );
  }
  const math1111 = transferable.find(
    (m) => m.cc_prefix === "MATH" && m.cc_number === "1111"
  );
  if (math1111) {
    console.log(
      `  Spot check — MATH 1111: → ${math1111.univ_course} (${math1111.univ_title || "direct"})`
    );
  }

  if (transferable.length === 0) {
    console.log(
      "\n⚠ No transferable mappings found! Check if the tool changed."
    );
    process.exit(1);
  }

  // Merge with existing data (preserve gatech and other non-UGA entries)
  const outPath = path.join(
    process.cwd(),
    "data",
    "ga",
    "transfer-equiv.json"
  );
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    if (existing.length > 0) {
      console.log(`\nLoaded ${existing.length} existing mappings`);
    }
  } catch {
    // No existing file
  }

  // Remove old UGA entries, keep everything else (e.g., gatech)
  const nonUga = existing.filter((m) => m.university !== "uga");
  const merged = [...nonUga, ...deduped];

  console.log(
    `Merged: ${nonUga.length} preserved + ${deduped.length} UGA = ${merged.length} total`
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Saved to ${outPath}`);

  // Import to Supabase
  try {
    const imported = await importTransfersToSupabase("ga");
    if (imported > 0) {
      console.log(`Imported ${imported} rows to Supabase`);
    }
  } catch (err) {
    console.log(`Supabase import skipped: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
