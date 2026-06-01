/**
 * scrape-transfer-scsu.ts
 *
 * Scrapes Southern Connecticut State University's transfer course equivalency
 * tool (Banner-based custom form) to extract CT State CC -> SCSU mappings.
 *
 * SCSU's tool is at ssb-prod.ec.southernct.edu and uses a custom PL/SQL
 * form (scsu_transfer.p_student_request / p_display_request) rather than
 * the standard Banner bysktreq form.
 *
 * Key difference: SCSU does not have a merged "CT State Community College"
 * entry. It lists the 12 former individual community colleges by their
 * pre-merger names. We scrape each one and merge into a single dataset,
 * deduplicating courses that appear identically across campuses (since
 * CT State uses common course numbering).
 *
 * Form fields:
 *   - institution: text value like "Capital Community College"
 *   - semester: text value like "Fall 2025"
 *   - subject: optional text filter (leave blank for all)
 *   - course_number: optional text filter (leave blank for all)
 *
 * POST to scsu_transfer.p_display_request returns an HTML table:
 *   Subject | Number | Course Title | Credits (CC side)
 *   <spacer>
 *   Subject | Number | Course Title | Credits (SCSU side)
 *
 * Usage:
 *   npx tsx scripts/ct/scrape-transfer-scsu.ts
 *   npx tsx scripts/ct/scrape-transfer-scsu.ts --no-import
 *   npx tsx scripts/ct/scrape-transfer-scsu.ts --inst="Capital Community College"
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FORM_URL =
  "https://ssb-prod.ec.southernct.edu/PROD/scsu_transfer.p_student_request";
const RESULTS_URL =
  "https://ssb-prod.ec.southernct.edu/PROD/scsu_transfer.p_display_request";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// The 12 CT community colleges as they appear in SCSU's institution dropdown.
// These are the pre-merger names; all are now part of CT State Community College.
const CT_COMMUNITY_COLLEGES: string[] = [
  "Asnuntuck Community Coll",
  "Capital Community College",
  "Gateway Community College",
  "Housatonic Community College",
  "Manchester Community College",
  "Middlesex Community College",
  "Naugatuck Valley Comm. Coll",
  "Northwestern Comm. College",
  "Norwalk Community College",
  "Quinebaug Valley Comm Col",
  "Three Rivers Community College",
  "Tunxis Community College",
];

// Use the most recent Fall semester for the broadest coverage.
const DEFAULT_SEMESTER = "Fall 2025";

const DELAY_MS = 1500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function retryFetch(
  url: string,
  label: string,
  opts: RequestInit = {},
  attempts = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: {
          "User-Agent": UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...(opts.headers || {}),
        },
      });
      if (res.ok) return res.text();
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        console.error(`  ${label}: HTTP ${res.status}`);
        return "";
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

// ---------------------------------------------------------------------------
// Semester detection
// ---------------------------------------------------------------------------

async function getLatestSemester(): Promise<string> {
  try {
    const html = await retryFetch(FORM_URL, "scsu-form");
    const $ = cheerio.load(html);
    const firstOption = $('select[name="semester"] option').first().attr("value");
    if (firstOption) {
      console.log(`  Latest semester from form: ${firstOption}`);
      return firstOption;
    }
  } catch {
    // fall through to default
  }
  console.log(`  Using default semester: ${DEFAULT_SEMESTER}`);
  return DEFAULT_SEMESTER;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse the SCSU transfer results table.
 *
 * Table structure (9 columns across two logical sides):
 *   CC Side: Subject | Number | Course Title | Credits
 *   Spacer column (width=5%)
 *   SCSU Side: Subject | Number | Course Title | Credits
 */
function parseResultsTable(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  // Find the main data table. The table has a header row with
  // institution names, then a column header row, then data rows.
  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 8) return;

    const ccPrefix = $(cells[0]).text().trim();
    const ccNumber = $(cells[1]).text().trim();
    const ccTitle = $(cells[2]).text().trim();
    const ccCredits = $(cells[3]).text().trim();
    // cells[4] is the spacer column
    const univPrefix = $(cells[5]).text().trim();
    const univNumber = $(cells[6]).text().trim();
    const univTitle = $(cells[7]).text().trim();
    const univCredits = cells.length >= 9 ? $(cells[8]).text().trim() : "";

    // Skip header rows and rows without course data
    if (!ccPrefix || !ccNumber) return;
    if (ccPrefix === "Subject" || ccPrefix === "Course") return;
    // Skip rows that are institution name headers
    if (cells.length < 8) return;
    // Verify it looks like a course prefix (2-5 uppercase letters)
    if (!/^[A-Z]{2,5}$/.test(ccPrefix)) return;

    const univCourse =
      univPrefix && univNumber ? `${univPrefix} ${univNumber}` : "";

    // Detect no-credit / elective
    const noCredit =
      univCredits === "0" ||
      univTitle.toUpperCase().includes("NOT ACCEPTABLE") ||
      univTitle.toUpperCase().includes("NO CREDIT") ||
      univTitle.toUpperCase().includes("NOT TRANSFERABLE") ||
      (!univPrefix && !univNumber);

    const isElective =
      univNumber === "000" ||
      univNumber === "0000" ||
      univTitle.toUpperCase().includes("ELECTIVE") ||
      univPrefix === "ELEC" ||
      univPrefix === "ELE";

    mappings.push({
      cc_prefix: ccPrefix,
      cc_number: ccNumber,
      cc_course: `${ccPrefix} ${ccNumber}`,
      cc_title: ccTitle,
      cc_credits: ccCredits,
      university: "scsu",
      university_name: "Southern Connecticut State University",
      univ_course: noCredit ? "" : univCourse,
      univ_title: noCredit
        ? univTitle || "No SCSU credit"
        : univTitle,
      univ_credits: univCredits,
      notes: "",
      no_credit: noCredit,
      is_elective: isElective,
    });
  });

  return mappings;
}

// ---------------------------------------------------------------------------
// Scraping
// ---------------------------------------------------------------------------

async function scrapeInstitution(
  institution: string,
  semester: string,
): Promise<TransferMapping[]> {
  const formData = new URLSearchParams();
  formData.append("institution", institution);
  formData.append("semester", semester);
  formData.append("subject", "");
  formData.append("course_number", "");

  const html = await retryFetch(RESULTS_URL, `scsu(${institution})`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });

  if (!html) return [];

  return parseResultsTable(html);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function scrapeSCSU(): Promise<TransferMapping[]> {
  console.log("SCSU Transfer Equivalency Scraper");
  console.log(`  Source: ${RESULTS_URL}`);
  console.log(`  Institutions: ${CT_COMMUNITY_COLLEGES.length} CT community colleges\n`);

  // Get the latest semester from the form
  const semester = await getLatestSemester();

  console.log(`\nFetching equivalencies for ${CT_COMMUNITY_COLLEGES.length} institutions...`);

  const allMappings: TransferMapping[] = [];

  for (const institution of CT_COMMUNITY_COLLEGES) {
    console.log(`\n  ${institution}...`);
    const mappings = await scrapeInstitution(institution, semester);
    console.log(`    ${mappings.length} mappings`);
    allMappings.push(...mappings);

    if (CT_COMMUNITY_COLLEGES.length > 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n  Total raw mappings: ${allMappings.length}`);

  // Deduplicate — CT State uses common course numbering, so the same course
  // appears identically across multiple former campuses. Dedup by
  // (cc_prefix, cc_number, univ_course).
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }
  console.log(`  After dedup: ${deduped.length} unique mappings`);

  // Stats
  const directEquiv = deduped.filter((m) => !m.no_credit && !m.is_elective).length;
  const electives = deduped.filter((m) => !m.no_credit && m.is_elective).length;
  const noCreditCount = deduped.filter((m) => m.no_credit).length;
  const prefixes = new Set(deduped.map((m) => m.cc_prefix));

  console.log("\n  Summary:");
  console.log(`    Direct equivalencies: ${directEquiv}`);
  console.log(`    Elective credit: ${electives}`);
  console.log(`    No credit: ${noCreditCount}`);
  console.log(`    Subject prefixes: ${prefixes.size}`);

  // Spot checks
  const eng101 = deduped.find(
    (m) => m.cc_prefix === "ENG" && m.cc_number === "101",
  );
  if (eng101) {
    console.log(
      `\n  Spot check — ENG 101: -> ${eng101.univ_course} (${eng101.univ_title})`,
    );
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");
  const instArg = args.find((a) => a.startsWith("--inst="))?.split("=").slice(1).join("=");

  let mappings: TransferMapping[];

  if (instArg) {
    // Single institution test mode
    console.log(`SCSU Transfer — Single institution test: ${instArg}\n`);
    const semester = await getLatestSemester();
    mappings = await scrapeInstitution(instArg, semester);
    console.log(`  ${mappings.length} mappings`);
  } else {
    mappings = await scrapeSCSU();
  }

  if (mappings.length === 0) {
    console.error("\nNo mappings found! Check if the SCSU form changed.");
    process.exit(1);
  }

  // Write to data file (merge with existing)
  const outDir = path.join(process.cwd(), "data", "ct");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "transfer-equiv.json");

  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch {
    /* first run */
  }

  const nonScsu = existing.filter((m) => m.university !== "scsu");
  const merged = [...nonScsu, ...mappings];
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\nWrote ${mappings.length} SCSU mappings to ${outPath}`);
  console.log(`  Total in file (all universities): ${merged.length}`);

  // Supabase import
  if (!noImport) {
    try {
      await importTransfersToSupabase("ct");
    } catch (err) {
      console.log(`Supabase import skipped: ${(err as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
