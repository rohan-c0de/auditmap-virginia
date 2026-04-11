/**
 * scrape-transfer.ts
 *
 * Scrapes transfer equivalency data for Vermont (CCV -> VT universities).
 *
 * Two data sources:
 *   1. CollegeTransfer.Net OData API — CCV (sender 3079) to out-of-state
 *      universities that happen to be in the API. Currently no VT receivers
 *      exist, so this source yields zero VT-relevant mappings but is wired
 *      up for the future.
 *   2. UVM Banner form (primary source) — the public transfer credit guide
 *      at aisweb1.uvm.edu that shows how CCV courses transfer to UVM.
 *      Two-step POST: select state VT, then select CCV (sbgi_code=3286).
 *      Returns a big HTML table with ~300 course equivalencies.
 *
 * Results from both sources are merged and deduplicated by
 * (cc_prefix, cc_number, university).
 *
 * Usage:
 *   npx tsx scripts/vt/scrape-transfer.ts
 *   npx tsx scripts/vt/scrape-transfer.ts --no-import   # skip Supabase
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import {
  scrapeCollegeTransfer,
  type TransferMapping,
  type ScrapeOptions,
} from "../lib/scrape-collegetransfer.js";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** CCV's CollegeTransfer.Net sender ID */
const CCV_SENDER_ID = 3079;

/**
 * CollegeTransfer.Net targets. Currently no Vermont universities are in the
 * API as receivers, but if they appear in the future we can add them here.
 * The OData API has CCV -> out-of-state schools (Southern Indiana, Penn State,
 * etc.) which aren't relevant for VT transfer guides.
 */
const CT_TARGETS: ScrapeOptions[] = [
  // No VT receivers found in the OData API as of 2026-04.
  // Uncomment and add entries if VT universities appear:
  // {
  //   senderId: CCV_SENDER_ID,
  //   receiverId: ???,
  //   universitySlug: "uvm",
  //   universityName: "University of Vermont",
  //   state: "vt",
  // },
];

/** UVM Banner form endpoints */
const UVM_BASE = "https://aisweb1.uvm.edu/pls/owa_prod";
const UVM_SELECT_INST_URL = `${UVM_BASE}/hwwkwags.P_Select_Inst`;

/** CCV's Banner institution code at UVM */
const CCV_SBGI_CODE = "3286";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
        return ""; // 4xx — skip
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

// ---------------------------------------------------------------------------
// UVM Banner form scraper
// ---------------------------------------------------------------------------

/**
 * Parse CCV's transfer equivalency table from UVM's Banner form response.
 *
 * Table structure (11 columns):
 *   0: (empty)
 *   1: CCV course code (e.g., "ACC 1010")
 *   2: CCV course title (e.g., "Computerized Accounting")
 *   3: (empty)
 *   4: UVM 3-digit equivalent (old numbering, usually " --- ")
 *   5: UVM 3-digit title (old, usually " --- ")
 *   6: (empty)
 *   7: UVM 4-digit equivalent (new numbering, e.g., "BUS 1XXX")
 *   8: UVM 4-digit title (e.g., "1000 Level BUS")
 *   9: (empty)
 *  10: Catamount Core (gen ed designations like "AH2,WIL1")
 *
 * Data rows have a background-color style attribute. Separator rows have
 * a height=15 td.
 */
function parseUvmEquivalencyTable(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  // Find the main data table by its caption
  const table = $('table caption:contains("Community College of Vermont")')
    .closest("table");

  if (!table.length) {
    console.log("  WARNING: Could not find CCV equivalency table in UVM response");
    return mappings;
  }

  table.find("tr[style]").each((_, row) => {
    const style = $(row).attr("style") || "";
    // Data rows have background-color in their style
    if (!style.includes("background-color")) return;

    const cells = $(row).find("td");
    if (cells.length < 9) return;

    // Extract CCV course info
    const ccCourseRaw = $(cells[1]).text().trim();
    const ccTitle = $(cells[2]).text().trim();

    if (!ccCourseRaw) return;

    // Parse CCV course code: "ACC 1010" -> prefix="ACC", number="1010"
    const ccMatch = ccCourseRaw.match(/^([A-Z]{2,6})\s+(\d{3,4}[A-Z]?)$/);
    if (!ccMatch) return;

    const ccPrefix = ccMatch[1];
    const ccNumber = ccMatch[2];

    // Prefer 4-digit (new) equivalency over 3-digit (old)
    let univCourse = $(cells[7]).text().trim();
    let univTitle = $(cells[8]).text().trim();

    // Fall back to 3-digit if 4-digit is empty/missing
    if (!univCourse || univCourse === "---") {
      const old3Course = $(cells[4]).text().trim();
      const old3Title = $(cells[5]).text().trim();
      if (old3Course && old3Course !== "---") {
        univCourse = old3Course;
        univTitle = old3Title;
      }
    }

    // Clean up " --- " entries
    if (univCourse === "---") univCourse = "";
    if (univTitle === "---") univTitle = "";

    // No equivalent found at all
    if (!univCourse) return;

    // Catamount Core (gen ed) designations
    const catamountCore = cells.length >= 11
      ? $(cells[10]).text().trim()
      : "";

    // Detect elective (generic course numbers like 1XXX, 2XXX, XXXX)
    const isElective =
      univCourse.includes("XXX") ||
      univCourse.includes("xxx") ||
      univTitle.toLowerCase().includes("elective") ||
      univTitle.toLowerCase().includes("transfer course") ||
      univTitle.match(/^\d{4} Level/) !== null;

    // Build notes
    const notesParts: string[] = [];
    if (catamountCore) {
      notesParts.push(`Catamount Core: ${catamountCore}`);
    }
    const notes = notesParts.join("; ");

    mappings.push({
      state: "vt",
      cc_prefix: ccPrefix,
      cc_number: ccNumber,
      cc_course: `${ccPrefix} ${ccNumber}`,
      cc_title: ccTitle,
      cc_credits: "",
      university: "uvm",
      university_name: "University of Vermont",
      univ_course: univCourse,
      univ_title: univTitle,
      univ_credits: "",
      notes,
      no_credit: false,
      is_elective: isElective,
    });
  });

  return mappings;
}

/**
 * Scrape UVM's Banner transfer credit guide for CCV equivalencies.
 *
 * Flow:
 *   1. POST stat_code=VT to get institution dropdown (verifies the form works)
 *   2. POST sbgi_code=3286&inst_code=VT to get the full equivalency table
 */
async function scrapeUvmBanner(): Promise<TransferMapping[]> {
  console.log("UVM Banner Transfer Credit Guide:");
  console.log(`  URL: ${UVM_SELECT_INST_URL}`);

  // Step 1: POST to get institutions for Vermont
  console.log("  [1/2] Selecting state VT...");
  const instHtml = await retryFetch(
    UVM_SELECT_INST_URL,
    "uvm-state-select",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "stat_code=VT&natn_code=&inst_code=",
    },
  );

  if (!instHtml) {
    console.log("  ERROR: Empty response from state selection");
    return [];
  }

  // Verify CCV is in the institution list
  const $inst = cheerio.load(instHtml);
  const ccvOption = $inst(`select[name="sbgi_code"] option[value="${CCV_SBGI_CODE}"]`);
  if (!ccvOption.length) {
    console.log(`  WARNING: CCV (code ${CCV_SBGI_CODE}) not found in institution list`);
    // Try to proceed anyway
  } else {
    console.log(`  Found CCV: ${ccvOption.text().trim()} (code ${CCV_SBGI_CODE})`);
  }

  // Step 2: POST with CCV selected to get equivalency table
  console.log("  [2/2] Fetching CCV equivalencies...");
  await sleep(500); // Brief pause between requests

  const equivHtml = await retryFetch(
    UVM_SELECT_INST_URL,
    "uvm-ccv-equiv",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `sbgi_code=${CCV_SBGI_CODE}&inst_code=VT`,
    },
  );

  if (!equivHtml) {
    console.log("  ERROR: Empty response from equivalency request");
    return [];
  }

  console.log(`  Response size: ${(equivHtml.length / 1024).toFixed(0)} KB`);

  const mappings = parseUvmEquivalencyTable(equivHtml);
  console.log(`  Parsed ${mappings.length} course equivalencies`);

  return mappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");

  console.log("Vermont Transfer Equivalency Scraper\n");
  console.log("Source: Community College of Vermont (CCV)\n");

  const allMappings: TransferMapping[] = [];

  // --- Source 1: CollegeTransfer.Net OData API ---
  if (CT_TARGETS.length > 0) {
    console.log("--- CollegeTransfer.Net OData API ---\n");
    for (const target of CT_TARGETS) {
      console.log(`  ${target.universityName} (CT.net ID ${target.receiverId}):`);
      const mappings = await scrapeCollegeTransfer(target);
      allMappings.push(...mappings);
      console.log("");
    }
  } else {
    console.log("--- CollegeTransfer.Net: No VT university receivers found in API ---\n");
  }

  // --- Source 2: UVM Banner Transfer Credit Guide ---
  console.log("--- UVM Banner Transfer Credit Guide ---\n");
  const uvmMappings = await scrapeUvmBanner();
  allMappings.push(...uvmMappings);
  console.log("");

  // --- Deduplicate ---
  // Key by (cc_prefix, cc_number, university) — keep first occurrence
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }

  // Filter out no-credit entries for stats
  const transferable = deduped.filter((m) => !m.no_credit);

  // --- Stats ---
  const byUniv = new Map<string, number>();
  for (const m of transferable) {
    byUniv.set(m.university, (byUniv.get(m.university) || 0) + 1);
  }

  console.log("Summary:");
  console.log(`  Total mappings: ${deduped.length}`);
  console.log(`  Transferable: ${transferable.length}`);
  for (const [univ, count] of byUniv) {
    console.log(`    ${univ}: ${count}`);
  }
  console.log(
    `  Direct equivalencies: ${transferable.filter((m) => !m.is_elective).length}`,
  );
  console.log(
    `  Elective credit: ${transferable.filter((m) => m.is_elective).length}`,
  );
  console.log(
    `  No transfer: ${deduped.filter((m) => m.no_credit).length}`,
  );

  // --- Spot checks ---
  const eng1061 = transferable.find(
    (m) => m.cc_prefix === "ENG" && m.cc_number === "1061" && m.university === "uvm",
  );
  if (eng1061) {
    console.log(
      `\n  Spot check -- ENG 1061 -> UVM: ${eng1061.univ_course} (${eng1061.univ_title})`,
    );
  }
  const bio1011 = transferable.find(
    (m) => m.cc_prefix === "BIO" && m.cc_number === "1011" && m.university === "uvm",
  );
  if (bio1011) {
    console.log(
      `  Spot check -- BIO 1011 -> UVM: ${bio1011.univ_course} (${bio1011.univ_title})`,
    );
  }
  const mat1041 = transferable.find(
    (m) => m.cc_prefix === "MAT" && m.cc_number === "1041" && m.university === "uvm",
  );
  if (mat1041) {
    console.log(
      `  Spot check -- MAT 1041 -> UVM: ${mat1041.univ_course} (${mat1041.univ_title})`,
    );
  }

  if (transferable.length === 0) {
    console.log(
      "\nWARNING: No transferable mappings found! Check if the API/form changed.",
    );
    process.exit(1);
  }

  // --- Write output ---
  const outDir = path.join(process.cwd(), "data", "vt");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "transfer-equiv.json");

  // Merge with any existing data (preserve non-UVM entries if any)
  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch {
    /* first run */
  }
  const universitySlugSet = new Set(["uvm", ...CT_TARGETS.map((t) => t.universitySlug)]);
  const preserved = existing.filter((m) => !universitySlugSet.has(m.university));
  const merged = [...preserved, ...deduped];

  if (preserved.length > 0) {
    console.log(
      `\nMerged: ${preserved.length} preserved + ${deduped.length} new = ${merged.length} total`,
    );
  }

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nWrote ${deduped.length} mappings to ${outPath}`);
  console.log(`Total in file: ${merged.length}`);

  // --- Supabase import ---
  if (!noImport) {
    try {
      const imported = await importTransfersToSupabase("vt");
      if (imported > 0) {
        console.log(`Imported ${imported} rows to Supabase`);
      }
    } catch (err) {
      console.log(`Supabase import skipped: ${(err as Error).message}`);
    }
  } else {
    console.log("Supabase import skipped (--no-import)");
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
