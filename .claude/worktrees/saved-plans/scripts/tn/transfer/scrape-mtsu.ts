/**
 * scrape-mtsu.ts
 *
 * Scrapes Middle Tennessee State University's public transfer equivalency
 * tool at w1.mtsu.edu/transfer-equivalencies/ to extract CC → MTSU mappings
 * for all 13 TBR community colleges.
 *
 * MTSU's tool is a custom PHP app (not Banner) with a simple URL hierarchy:
 *   /transfer-equivalencies/TN           → institution list for Tennessee
 *   /transfer-equivalencies/TN/{code}    → full equivalency table for that CC
 *
 * Each institution page dumps all equivalencies in a single
 * <table id="transferTable"> with 4 columns:
 *   Transfer Course | Transfer Title | MTSU Course | MTSU Title
 *
 * No auth, no CSRF, no pagination (DataTables client-side only).
 * CORS is enabled (Access-Control-Allow-Origin: *).
 *
 * Usage:
 *   npx tsx scripts/tn/transfer/scrape-mtsu.ts
 *   npx tsx scripts/tn/transfer/scrape-mtsu.ts --no-import
 *   npx tsx scripts/tn/transfer/scrape-mtsu.ts --inst=000319   # single institution
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { importTransfersToSupabase } from "../../lib/supabase-import";

const BASE = "https://w1.mtsu.edu/transfer-equivalencies";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Same 13 TBR CC codes as scrape-utk.ts. MTSU uses the same opaque
// Banner institution IDs.
const TBR_COLLEGES: Record<string, string> = {
  "000319": "Pellissippi State Community College",
  "001084": "Chattanooga State Community College",
  "002848": "Cleveland State Community College",
  "001081": "Columbia State Community College",
  "007323": "Dyersburg State Community College",
  "002266": "Jackson State Community College",
  "001543": "Motlow State Community College",
  "000850": "Nashville State Community College",
  "000453": "Northeast State Community College",
  "001656": "Roane State Community College",
  "000274": "Southwest Tennessee Community College",
  "001881": "Volunteer State Community College",
  "001893": "Walters State Community College",
};

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
  attempts = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (res.ok) return res.text();
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
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
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse institution list from the /transfer-equivalencies/TN page.
 * Returns array of { code, name } extracted from table links.
 */
function parseInstitutionList(
  html: string,
): Array<{ code: string; name: string }> {
  const $ = cheerio.load(html);
  const institutions: Array<{ code: string; name: string }> = [];
  // Links look like: <a href="/transfer-equivalencies/TN/000319">Pellissippi...</a>
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/\/transfer-equivalencies\/TN\/(\d{6})\/?$/);
    if (m) {
      institutions.push({
        code: m[1],
        name: $(el).text().trim(),
      });
    }
  });
  return institutions;
}

/**
 * Parse the equivalency table from a /transfer-equivalencies/TN/{code} page.
 *
 * Table structure (4 columns):
 *   0: Transfer Course  (e.g., "ACC 1211")
 *   1: Transfer Title   (e.g., "Prin Acct I")
 *   2: MTSU Course      (e.g., " ACTG 2110" — note leading space)
 *   3: MTSU Title       (e.g., "Principles of Accounting I")
 */
function parseEquivalencyTable(html: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  const table = $("#transferTable, table").first();
  if (!table.length) return mappings;

  table.find("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return;

    const ccCourseRaw = $(cells[0]).text().trim();
    const ccTitle = $(cells[1]).text().trim();
    const mtsuCourseRaw = $(cells[2]).text().trim();
    const mtsuTitle = $(cells[3]).text().trim();

    if (!ccCourseRaw) return;

    // Parse CC course: "ACC 1211" → prefix="ACC", number="1211"
    const ccMatch = ccCourseRaw.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\b/);
    if (!ccMatch) return;

    const prefix = ccMatch[1];
    const number = ccMatch[2];

    // Parse MTSU course for elective / no-credit detection
    const noCredit =
      mtsuCourseRaw.toUpperCase().includes("NO CREDIT") ||
      mtsuCourseRaw.toUpperCase().includes("NOT TRANSFERABLE") ||
      (!mtsuCourseRaw && !mtsuTitle);

    // MTSU uses "EL" suffix for lower-division elective, "EU" for upper-division
    const isElective =
      /\bEL\b|\bEU\b|\bELEC\b/i.test(mtsuCourseRaw) ||
      /elective/i.test(mtsuTitle);

    mappings.push({
      cc_prefix: prefix,
      cc_number: number,
      cc_course: `${prefix} ${number}`,
      cc_title: ccTitle,
      cc_credits: "",
      university: "mtsu",
      university_name: "Middle Tennessee State University",
      univ_course: noCredit ? "" : mtsuCourseRaw,
      univ_title: noCredit ? "No MTSU credit" : mtsuTitle,
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
  const args = process.argv.slice(2);
  const instArg = args.find((a) => a.startsWith("--inst="))?.split("=")[1];
  const noImport = args.includes("--no-import");

  console.log("MTSU Transfer Course Equivalency Scraper");
  console.log(`  Source: ${BASE}\n`);

  // --- Step 1: institution list ---
  console.log("[1/2] Fetching Tennessee institution list...");
  const listHtml = await retryFetch(`${BASE}/TN`, "institution-list");
  const allInstitutions = parseInstitutionList(listHtml);
  console.log(`  Found ${allInstitutions.length} Tennessee institutions`);

  // Filter to TBR CCs
  let targets: Array<{ code: string; name: string }>;
  if (instArg) {
    const inst = allInstitutions.find((i) => i.code === instArg);
    if (!inst) {
      // Try from hardcoded list
      targets = [{ code: instArg, name: TBR_COLLEGES[instArg] || instArg }];
    } else {
      targets = [inst];
    }
  } else {
    targets = allInstitutions.filter((i) => i.code in TBR_COLLEGES);
    console.log(`  Filtered to ${targets.length} TBR community colleges:`);
    for (const t of targets) {
      console.log(`    ${t.code} — ${t.name}`);
    }
  }

  // --- Step 2: equivalencies per institution ---
  console.log(
    `\n[2/2] Fetching equivalencies for ${targets.length} colleges...`,
  );
  const allMappings: TransferMapping[] = [];
  let totalRows = 0;

  for (const inst of targets) {
    console.log(`\n  ${inst.name} (${inst.code})...`);
    const html = await retryFetch(
      `${BASE}/TN/${inst.code}`,
      `equiv(${inst.code})`,
    );

    if (!html) {
      console.log(`    Empty response, skipping`);
      continue;
    }

    const mappings = parseEquivalencyTable(html);
    console.log(`    ${mappings.length} mappings`);
    allMappings.push(...mappings);
    totalRows += mappings.length;

    if (targets.length > 1) await sleep(DELAY_MS);
  }

  console.log(`\n  Total raw mappings: ${totalRows}`);

  // --- Deduplicate ---
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }
  console.log(`  After dedup: ${deduped.length} unique mappings`);

  // --- Stats ---
  const directEquiv = deduped.filter(
    (m) => !m.no_credit && !m.is_elective,
  ).length;
  const electives = deduped.filter(
    (m) => !m.no_credit && m.is_elective,
  ).length;
  const noCredit = deduped.filter((m) => m.no_credit).length;
  const prefixes = new Set(deduped.map((m) => m.cc_prefix));

  console.log("\nSummary:");
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject prefixes: ${prefixes.size}`);

  // Spot checks
  const engl1010 = deduped.find(
    (m) => m.cc_prefix === "ENGL" && m.cc_number === "1010",
  );
  if (engl1010) {
    console.log(
      `\n  Spot check — ENGL 1010: → ${engl1010.univ_course} (${engl1010.univ_title})`,
    );
  }
  const math1530 = deduped.find(
    (m) => m.cc_prefix === "MATH" && m.cc_number === "1530",
  );
  if (math1530) {
    console.log(
      `  Spot check — MATH 1530: → ${math1530.univ_course} (${math1530.univ_title})`,
    );
  }

  // --- Write (merge with existing) ---
  const outDir = path.join(process.cwd(), "data", "tn");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "transfer-equiv.json");

  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch {
    /* first run */
  }
  const nonMtsu = existing.filter((m) => m.university !== "mtsu");
  const merged = [...nonMtsu, ...deduped];
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\n✓ Wrote ${deduped.length} MTSU mappings to ${outPath}`);
  console.log(`  Total in file (all universities): ${merged.length}`);

  // --- Supabase import ---
  if (!noImport) {
    await importTransfersToSupabase("tn");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
