/**
 * scrape-transfer-gsu.ts
 *
 * Scrapes transfer equivalency data from Georgia State University's
 * public GoSOLAR Banner SSB transfer articulation tool.
 *
 * GSU uses a classic server-rendered Banner SSB v8 system (zwsktrna package)
 * with POST-based form submissions. No authentication required.
 *
 * Flow per TCSG college:
 *   1. POST to P_find_subj_levl to get available subjects
 *   2. POST to P_find_subj_levl_classes with all subjects, all levels, all terms
 *   3. Parse the HTML <table class="datadisplaytable"> response
 *
 * Usage:
 *   npx tsx scripts/ga/scrape-transfer-gsu.ts
 *   npx tsx scripts/ga/scrape-transfer-gsu.ts --college atlanta-tech
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
// GSU Banner endpoints
// ---------------------------------------------------------------------------

const BASE = "https://www.gosolar.gsu.edu/bprod";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "Content-Type": "application/x-www-form-urlencoded",
};

// ---------------------------------------------------------------------------
// TCSG colleges → GSU SBGI codes
// Discovered by POSTing to zwsktrna.P_find_school with state_in=GA.
// Some colleges only appear under *** (deprecated name) entries.
// ---------------------------------------------------------------------------

const TCSG_COLLEGES: Record<string, { sbgi: string; name: string }> = {
  "albany-tech": { sbgi: "X05601", name: "Albany Technical College" },
  "athens-tech": { sbgi: "0462", name: "Athens Technical College" },
  "atlanta-tech": { sbgi: "5030", name: "Atlanta Technical College" },
  "augusta-tech": { sbgi: "X05599", name: "Augusta Technical College" },
  "central-ga-tech": { sbgi: "1709", name: "Central Georgia Technical College" },
  "chattahoochee-tech": { sbgi: "5441", name: "Chattahoochee Technical College" },
  "coastal-pines-tech": { sbgi: "0147", name: "Coastal Pines Technical College" },
  "columbus-tech": { sbgi: "5704", name: "Columbus Technical College" },
  "ga-northwestern-tech": { sbgi: "2860", name: "Georgia Northwestern Technical College" },
  "ga-piedmont-tech": { sbgi: "3226", name: "Georgia Piedmont Technical College" },
  "gwinnett-tech": { sbgi: "5168", name: "Gwinnett Technical College" },
  "lanier-tech": { sbgi: "140243", name: "Lanier Technical College" },
  "north-ga-tech": { sbgi: "05507", name: "North Georgia Technical College" },
  "oconee-fall-line-tech": { sbgi: "05772", name: "Oconee Fall Line Technical College" },
  "ogeechee-tech": { sbgi: "0154", name: "Ogeechee Technical College" },
  "savannah-tech": { sbgi: "3741", name: "Savannah Technical College" },
  "south-ga-tech": { sbgi: "999966", name: "South Georgia Technical College" },
  "southeastern-tech": { sbgi: "5652", name: "Southeastern Technical College" },
  "southern-crescent-tech": { sbgi: "5670", name: "Southern Crescent Technical College" },
  "southern-regional-tech": { sbgi: "3627", name: "Southern Regional Technical College" },
  "west-ga-tech": { sbgi: "3632", name: "West Georgia Technical College" },
  "wiregrass-tech": { sbgi: "4557", name: "Wiregrass Georgia Technical College" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseCourse(raw: string): { prefix: string; number: string } {
  // GSU uses "ENGL  1101" format with multiple spaces (from &nbsp;)
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^([A-Z]{2,5})\s+(\S+)$/);
  if (match) return { prefix: match[1], number: match[2] };
  return { prefix: "", number: cleaned };
}

// ---------------------------------------------------------------------------
// Step 1: Get available subjects for a school
// ---------------------------------------------------------------------------

async function getSubjects(sbgi: string): Promise<string[]> {
  const resp = await fetch(`${BASE}/zwsktrna.P_find_subj_levl`, {
    method: "POST",
    headers: HEADERS,
    body: `state_in=GA&nation_in=&sbgi_in=${sbgi}&term_in=`,
  });

  if (!resp.ok) return [];

  const html = await resp.text();
  const $ = cheerio.load(html);
  const subjects: string[] = [];

  // Subject select is a multi-select with id or name containing "sel_subj"
  $("select option").each((_, el) => {
    const val = $(el).attr("value");
    if (val && /^[A-Z]{2,5}$/.test(val)) {
      subjects.push(val);
    }
  });

  // Deduplicate (level dropdown also has option values)
  return [...new Set(subjects)];
}

// ---------------------------------------------------------------------------
// Step 2: Fetch and parse equivalency results
// ---------------------------------------------------------------------------

async function scrapeCollege(
  slug: string,
  sbgi: string,
  collegeName: string
): Promise<TransferMapping[]> {
  // Get available subjects
  const subjects = await getSubjects(sbgi);
  if (subjects.length === 0) {
    console.log(`    No subjects found (empty articulation data)`);
    return [];
  }

  // Build POST body: all subjects, all levels, all terms
  const subjectParams = subjects.map((s) => `sel_subj=${s}`).join("&");
  const body = `${subjectParams}&levl_in=US&levl_in=GS&levl_in=UA&state_in=GA&nation_in=&sbgi_in=${sbgi}&school_in=&term_in=999999`;

  const resp = await fetch(`${BASE}/zwsktrna.P_find_subj_levl_classes`, {
    method: "POST",
    headers: HEADERS,
    body,
  });

  if (!resp.ok) {
    console.log(`    HTTP ${resp.status}`);
    return [];
  }

  const html = await resp.text();
  return parseResultsTable(html);
}

/**
 * Parse the Banner datadisplaytable HTML into TransferMapping[].
 *
 * Each <tr> contains 14 cells (mix of <td> and <th>):
 *   [0] Group, [1] spacer, [2] Source Course, [3] Source Title,
 *   [4] Level, [5] spacer, [6] Min Grade, [7] Effective Terms,
 *   [8] =>, [9] spacer, [10] GSU Course, [11] GSU Title,
 *   [12] Credits, [13] spacer
 */
function parseResultsTable(html: string): TransferMapping[] {
  // Split by </tr> to handle multiline rows
  const tableStart = html.indexOf('CLASS="datadisplaytable"');
  if (tableStart === -1) return [];
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableEnd === -1) return [];
  const tableHtml = html.substring(tableStart, tableEnd);

  const rows = tableHtml.split("</tr>");
  const mappings: TransferMapping[] = [];

  for (const row of rows) {
    if (!row.includes("dddefault")) continue;

    // Extract all cell content (both <td> and <th>)
    const cells = [
      ...row.matchAll(/<(?:td|th)[^>]*>(.*?)<\/(?:td|th)>/gs),
    ].map((m) =>
      m[1]
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );

    if (cells.length < 12) continue;

    const srcRaw = cells[2];
    const srcTitle = cells[3];
    const minGrade = cells[6];
    const gsuRaw = cells[10];
    const gsuTitle = cells[11];
    const credits = cells[12]?.trim() || "";

    if (!srcRaw) continue;

    const src = parseCourse(srcRaw);
    if (!src.prefix) continue;

    // Detect non-transferable: NXFR XXXX / NON-TRANSFERABLE / NON TRANSFERABLE
    const noCredit =
      gsuRaw.startsWith("NXFR") ||
      gsuTitle.toUpperCase().includes("NON-TRANSFER") ||
      gsuTitle.toUpperCase().includes("NON TRANSFER") ||
      gsuTitle.toUpperCase().includes("NOT TRANSFER");

    const gsu = noCredit ? { prefix: "", number: "" } : parseCourse(gsuRaw);
    const univCourse = noCredit
      ? ""
      : `${gsu.prefix} ${gsu.number}`.trim();

    // Detect elective/general credit
    const isElective =
      !noCredit &&
      (gsu.number.includes("XXX") ||
        gsu.number.includes("xxx") ||
        gsuTitle.toUpperCase().includes("GENERAL CREDIT") ||
        gsuTitle.toUpperCase().includes("ELECTIVE"));

    // Build a clean title for elective types
    let univTitle = "";
    if (noCredit) {
      univTitle = "Does not transfer";
    } else if (gsuTitle.toUpperCase().includes("GENERAL CREDIT")) {
      univTitle = "General Credit";
    } else {
      univTitle = gsuTitle;
    }

    mappings.push({
      state: "ga",
      cc_prefix: src.prefix,
      cc_number: src.number,
      cc_course: `${src.prefix} ${src.number}`,
      cc_title: srcTitle,
      cc_credits: "",
      university: "gsu",
      university_name: "Georgia State University",
      univ_course: univCourse,
      univ_title: univTitle,
      univ_credits: credits,
      notes: minGrade ? `Min grade: ${minGrade}` : "",
      no_credit: noCredit,
      is_elective: isElective,
    });
  }

  return mappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Georgia State University — Transfer Equivalency Scraper\n");

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

  for (const [slug, { sbgi, name }] of Object.entries(colleges)) {
    collegeIndex++;
    console.log(`[${collegeIndex}/${total}] ${name} (SBGI ${sbgi}):`);

    try {
      const mappings = await scrapeCollege(slug, sbgi, name);
      console.log(`    ${mappings.length} equivalencies`);
      allMappings.push(...mappings);
    } catch (err) {
      console.log(`    Error: ${(err as Error).message}`);
    }

    // Rate limiting
    if (collegeIndex < total) {
      await sleep(500);
    }
  }

  // Deduplicate: same CC course → same GSU course (collapse level/term duplicates)
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_course}|${m.univ_course}|${m.no_credit}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(m);
    }
  }

  const transferable = deduped.filter((m) => !m.no_credit);
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

  if (deduped.length === 0) {
    console.log("\nNo mappings found!");
    process.exit(1);
  }

  // Merge with existing data (preserve non-GSU entries)
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

  const nonGsu = existing.filter((m) => m.university !== "gsu");
  const merged = [...nonGsu, ...deduped];

  console.log(
    `Merged: ${nonGsu.length} preserved + ${deduped.length} GSU = ${merged.length} total`
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
