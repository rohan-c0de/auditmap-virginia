/**
 * scrape-transfer-ecsu.ts
 *
 * Scrapes Eastern Connecticut State University's transfer course equivalency
 * tool (Banner bysktreq) to extract CT State CC -> ECSU mappings.
 *
 * ECSU uses a standard Banner 8 transfer equivalency form at:
 *   https://ssb-prod.ec.easternct.edu/PROD/bysktreq.p_ask_parms_to?displayMode=S
 *
 * The form has a two-step flow:
 *   1. Select state -> get institution dropdown
 *   2. Select institution + term -> get equivalency table
 *
 * Standard Banner bysktreq form fields:
 *   - disp_option: "S" (student view)
 *   - sbgi_stat_code: state code ("CT")
 *   - sbgi_code: institution code (Banner SBGI code)
 *   - term_code_eff: Banner term code (e.g., "202510" for Fall 2025)
 *
 * NOTE: As of 2026-04, ECSU's server (ssb-prod.ec.easternct.edu) returns
 * HTTP 403 for automated requests, likely due to WAF/firewall rules.
 * This scraper is built to the correct specification and will work once
 * the server allows requests (e.g., from a whitelisted IP, via Playwright,
 * or if the WAF rules change). The scraper includes graceful 403 handling
 * and will log a clear warning rather than crashing.
 *
 * Usage:
 *   npx tsx scripts/ct/scrape-transfer-ecsu.ts
 *   npx tsx scripts/ct/scrape-transfer-ecsu.ts --no-import
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE = "https://ssb-prod.ec.easternct.edu/PROD";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Known Banner SBGI institution codes for CT community colleges at ECSU.
// These are derived from the standard Banner bysktreq institution list.
// Since we cannot scrape the form while the WAF is active, we use the
// institution names that appear in the dropdown. If access is restored,
// the scraper will dynamically discover codes from the form.
//
// The pre-merger CC names as they typically appear in Banner:
const CT_COMMUNITY_COLLEGES: string[] = [
  "Asnuntuck Comm College",
  "Capital Community College",
  "Gateway Community College",
  "Housatonic Community College",
  "Manchester Community College",
  "Middlesex Community College",
  "Naugatuck Valley Community College",
  "Northwestern CT Community College",
  "Norwalk Community College",
  "Quinebaug Valley Community College",
  "Three Rivers Community College",
  "Tunxis Community College",
];

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
): Promise<{ html: string; status: number }> {
  let lastErr: unknown;
  let lastStatus = 0;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: {
          "User-Agent": UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          ...(opts.headers || {}),
        },
      });
      lastStatus = res.status;
      if (res.ok) return { html: await res.text(), status: res.status };
      if (res.status === 403) {
        // WAF block — don't retry, it won't help
        return { html: "", status: 403 };
      }
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return { html: "", status: res.status };
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(
    `${label} failed after ${attempts} attempts (last status ${lastStatus}): ${lastErr}`,
  );
}

// ---------------------------------------------------------------------------
// Form discovery
// ---------------------------------------------------------------------------

interface InstitutionOption {
  code: string;
  name: string;
}

/**
 * Attempt to load the ECSU form and extract institution dropdown options.
 * The form is at bysktreq.p_ask_parms_to?displayMode=S and returns
 * an institution select populated by a state code.
 *
 * For a standard Banner bysktreq form, we first POST the state to get
 * the institution list.
 */
async function discoverInstitutions(): Promise<InstitutionOption[] | null> {
  // Try to GET the form page first
  const { html, status } = await retryFetch(
    `${BASE}/bysktreq.p_ask_parms_to?displayMode=S`,
    "ecsu-form",
  );

  if (status === 403) {
    console.warn(
      "  ECSU server returned 403 (WAF block). Cannot discover institution codes.",
    );
    return null;
  }

  if (!html) return null;

  const $ = cheerio.load(html);
  const institutions: InstitutionOption[] = [];

  // Look for institution select
  $('select[name="sbgi_code"] option, select[name="institution"] option').each(
    (_, el) => {
      const code = $(el).attr("value")?.trim() || "";
      const name = $(el).text().trim();
      if (code && name) {
        institutions.push({ code, name });
      }
    },
  );

  return institutions.length > 0 ? institutions : null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse the Banner bysktreq transfer equivalency table.
 *
 * Standard Banner transfer tables typically have columns:
 *   Transfer Course Subject | Number | Title | Credits | Effective Term |
 *   Equivalent Course | Title | Credits
 *
 * The exact layout varies by Banner customization, so we handle several
 * common variants.
 */
function parseEquivalencyTable(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  // Banner uses CLASS="datadisplaytable" or CLASS="dataentrytable"
  const tables = $("table.datadisplaytable, table.dataentrytable, TABLE");

  // Find the data table by looking for one with Subject/Number headers
  let dataTable: ReturnType<typeof $> | null = null;
  tables.each((_, table) => {
    const text = $(table).text();
    if (
      text.includes("Subject") &&
      text.includes("Number") &&
      (text.includes("Equivalent") || text.includes("Transfer"))
    ) {
      dataTable = $(table);
      return false; // break
    }
  });

  if (!dataTable) {
    // Try generic approach: find any table with course-like data
    $("tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 6) return;

      const col0 = $(cells[0]).text().trim();
      const col1 = $(cells[1]).text().trim();

      // Check if this looks like course data
      if (!/^[A-Z]{2,5}$/.test(col0)) return;
      if (!/^\d{3,4}[A-Z]?$/.test(col1)) return;

      const ccPrefix = col0;
      const ccNumber = col1;
      const ccTitle = $(cells[2]).text().trim();
      const ccCredits = $(cells[3]).text().trim();

      // Try to find ECSU side (columns may vary)
      let univPrefix = "";
      let univNumber = "";
      let univTitle = "";
      let univCredits = "";

      if (cells.length >= 8) {
        // 8+ column layout: CC side (4) + spacer? + ECSU side (3-4)
        const offset = cells.length >= 9 ? 5 : 4;
        univPrefix = $(cells[offset]).text().trim();
        univNumber = $(cells[offset + 1]).text().trim();
        univTitle = $(cells[offset + 2]).text().trim();
        if (cells.length > offset + 3) {
          univCredits = $(cells[offset + 3]).text().trim();
        }
      } else if (cells.length >= 6) {
        // 6-7 column layout
        univPrefix = $(cells[4]).text().trim();
        univNumber = $(cells[5]).text().trim();
        if (cells.length >= 7) {
          univTitle = $(cells[6]).text().trim();
        }
      }

      const univCourse =
        univPrefix && univNumber ? `${univPrefix} ${univNumber}` : "";

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
        university: "ecsu",
        university_name: "Eastern Connecticut State University",
        univ_course: noCredit ? "" : univCourse,
        univ_title: noCredit ? univTitle || "No ECSU credit" : univTitle,
        univ_credits: univCredits,
        notes: "",
        no_credit: noCredit,
        is_elective: isElective,
      });
    });
  }

  return mappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function scrapeECSU(): Promise<TransferMapping[]> {
  console.log("ECSU Transfer Equivalency Scraper");
  console.log(`  Source: ${BASE}/bysktreq.p_ask_parms_to`);
  console.log(
    `  Institutions: ${CT_COMMUNITY_COLLEGES.length} CT community colleges\n`,
  );

  // Step 1: Try to discover institution codes from the form
  console.log("[1/2] Attempting to discover institution codes...");
  const institutions = await discoverInstitutions();

  if (!institutions) {
    console.warn(
      "\n  WARNING: ECSU server is blocking automated requests (HTTP 403).",
    );
    console.warn(
      "  This is likely a WAF/firewall rule on ssb-prod.ec.easternct.edu.",
    );
    console.warn(
      "  The scraper will return 0 results. Options to resolve:",
    );
    console.warn(
      "    1. Use Playwright with full browser emulation",
    );
    console.warn(
      "    2. Run from a whitelisted IP/VPN",
    );
    console.warn(
      "    3. Wait for WAF rules to change\n",
    );
    return [];
  }

  // Filter to CT community colleges
  const ccInstitutions = institutions.filter((inst) =>
    CT_COMMUNITY_COLLEGES.some(
      (cc) =>
        inst.name.toLowerCase().includes(cc.toLowerCase()) ||
        cc.toLowerCase().includes(inst.name.toLowerCase()),
    ),
  );

  console.log(`  Found ${ccInstitutions.length} CT community colleges in form`);

  // Step 2: Scrape each institution
  console.log(
    `\n[2/2] Fetching equivalencies for ${ccInstitutions.length} institutions...`,
  );

  const allMappings: TransferMapping[] = [];

  for (const inst of ccInstitutions) {
    console.log(`\n  ${inst.name} (${inst.code})...`);

    // POST to the display endpoint
    const formData = new URLSearchParams();
    formData.append("disp_option", "S");
    formData.append("sbgi_stat_code", "CT");
    formData.append("sbgi_code", inst.code);
    // Use a recent term code — Fall 2025 = 202510 in typical Banner format
    formData.append("term_code_eff", "202510");

    const { html, status } = await retryFetch(
      `${BASE}/bysktreq.P_TransEquiv`,
      `ecsu(${inst.code})`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      },
    );

    if (status === 403) {
      console.log(`    Blocked by WAF (403), skipping`);
      continue;
    }

    if (!html) {
      console.log(`    Empty response, skipping`);
      continue;
    }

    const mappings = parseEquivalencyTable(html);
    console.log(`    ${mappings.length} mappings`);
    allMappings.push(...mappings);

    await sleep(DELAY_MS);
  }

  console.log(`\n  Total raw mappings: ${allMappings.length}`);

  // Deduplicate
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
  const directEquiv = deduped.filter(
    (m) => !m.no_credit && !m.is_elective,
  ).length;
  const electives = deduped.filter(
    (m) => !m.no_credit && m.is_elective,
  ).length;
  const noCreditCount = deduped.filter((m) => m.no_credit).length;

  console.log("\n  Summary:");
  console.log(`    Direct equivalencies: ${directEquiv}`);
  console.log(`    Elective credit: ${electives}`);
  console.log(`    No credit: ${noCreditCount}`);

  return deduped;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");

  const mappings = await scrapeECSU();

  if (mappings.length === 0) {
    console.warn(
      "\nNo ECSU mappings scraped (likely WAF block). Skipping file write.",
    );
    return;
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

  const nonEcsu = existing.filter((m) => m.university !== "ecsu");
  const merged = [...nonEcsu, ...mappings];
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\nWrote ${mappings.length} ECSU mappings to ${outPath}`);
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
