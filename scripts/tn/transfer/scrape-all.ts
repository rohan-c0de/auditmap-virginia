/**
 * scrape-all.ts
 *
 * Orchestrator for TN transfer equivalency scrapers. Runs all university
 * adapters sequentially and produces a merged, deduplicated
 * data/tn/transfer-equiv.json file.
 *
 * Each adapter (UTK, APSU, MTSU, etc.) can also be run individually;
 * they all merge into the same JSON file. This orchestrator exists so
 * you can refresh all universities in one shot.
 *
 * Usage:
 *   npx tsx scripts/tn/transfer/scrape-all.ts
 *   npx tsx scripts/tn/transfer/scrape-all.ts --no-import    # skip Supabase import
 *   npx tsx scripts/tn/transfer/scrape-all.ts --only utk,mtsu  # subset
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

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

// Available adapters — each is a standalone script that writes its own
// university's mappings into data/tn/transfer-equiv.json (merging with
// existing data from other universities).
const ADAPTERS: { slug: string; script: string; name: string }[] = [
  { slug: "utk", script: "scrape-utk.ts", name: "University of Tennessee Knoxville" },
  { slug: "apsu", script: "scrape-apsu.ts", name: "Austin Peay State University" },
  { slug: "mtsu", script: "scrape-mtsu.ts", name: "Middle Tennessee State University" },
  { slug: "utm", script: "scrape-utm.ts", name: "University of Tennessee at Martin" },
  { slug: "ttu", script: "scrape-ttu.ts", name: "Tennessee Technological University" },
  // Auth-gated (no public tool):
  // { slug: "etsu", script: "scrape-etsu.ts", name: "East Tennessee State University" },
  // { slug: "tsu", script: "scrape-tsu.ts", name: "Tennessee State University" },
  // PDF-only (lower priority):
  // { slug: "memphis", script: "scrape-memphis.ts", name: "University of Memphis" },
  // Banner Extensibility (complex, future):
  // { slug: "utc", script: "scrape-utc.ts", name: "University of Tennessee at Chattanooga" },
];

function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");
  const onlyIdx = args.indexOf("--only");
  const onlySlugs = onlyIdx >= 0 ? args[onlyIdx + 1]?.split(",") : null;

  const targets = onlySlugs
    ? ADAPTERS.filter((a) => onlySlugs.includes(a.slug))
    : ADAPTERS;

  if (targets.length === 0) {
    console.error("No matching adapters found.");
    process.exit(1);
  }

  console.log(`TN Transfer Equivalency — Full Scrape`);
  console.log(`  Adapters: ${targets.map((a) => a.slug).join(", ")}`);
  console.log(`  Import: ${noImport ? "SKIP" : "YES"}\n`);

  const scriptDir = path.join(process.cwd(), "scripts", "tn", "transfer");
  const results: { slug: string; status: "ok" | "fail"; count: number; error?: string }[] = [];

  // Run each adapter sequentially — each one merges into the shared JSON file
  // We pass --no-import to individual adapters so we only import once at the end
  for (const adapter of targets) {
    const scriptPath = path.join(scriptDir, adapter.script);

    // Check the script exists
    if (!fs.existsSync(scriptPath)) {
      console.log(`  ${adapter.slug}: SKIP (${adapter.script} not found)`);
      results.push({ slug: adapter.slug, status: "fail", count: 0, error: "script not found" });
      continue;
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`  Running ${adapter.slug} (${adapter.name})...`);
    console.log(`${"=".repeat(60)}\n`);

    const startTime = Date.now();
    try {
      execSync(`npx tsx ${scriptPath} --no-import`, {
        stdio: "inherit",
        timeout: 10 * 60 * 1000, // 10 minute timeout per adapter
        cwd: process.cwd(),
      });

      // Count mappings for this university in the output file
      const outPath = path.join(process.cwd(), "data", "tn", "transfer-equiv.json");
      let count = 0;
      try {
        const all: TransferMapping[] = JSON.parse(fs.readFileSync(outPath, "utf-8"));
        count = all.filter((m) => m.university === adapter.slug).length;
      } catch { /* file may not exist yet */ }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n  ${adapter.slug}: OK — ${count} mappings (${elapsed}s)`);
      results.push({ slug: adapter.slug, status: "ok", count });
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`\n  ${adapter.slug}: FAILED (${elapsed}s) — ${errorMsg}`);
      results.push({ slug: adapter.slug, status: "fail", count: 0, error: errorMsg });
      // Continue — one broken adapter shouldn't block the rest
    }
  }

  // --- Final summary ---
  console.log(`\n${"=".repeat(60)}`);
  console.log("  SUMMARY");
  console.log(`${"=".repeat(60)}`);

  let totalMappings = 0;
  for (const r of results) {
    const icon = r.status === "ok" ? "✓" : "✗";
    const detail = r.status === "ok" ? `${r.count} mappings` : `FAILED: ${r.error}`;
    console.log(`  ${icon} ${r.slug}: ${detail}`);
    totalMappings += r.count;
  }

  // Read final file for total count
  const outPath = path.join(process.cwd(), "data", "tn", "transfer-equiv.json");
  let fileTotal = 0;
  try {
    const all: TransferMapping[] = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    fileTotal = all.length;
  } catch { /* ok */ }

  console.log(`\n  Total in file: ${fileTotal} mappings`);
  console.log(`  From this run: ${totalMappings} mappings`);

  // --- Supabase import (once, at the end) ---
  if (!noImport && results.some((r) => r.status === "ok")) {
    console.log("\n  Importing to Supabase...");
    try {
      execSync(`npx tsx -e "import { importTransfersToSupabase } from './scripts/lib/supabase-import'; importTransfersToSupabase('tn').then(n => console.log('  Imported', n, 'rows'))"`, {
        stdio: "inherit",
        timeout: 60 * 1000,
        cwd: process.cwd(),
      });
    } catch (err) {
      console.error("  Supabase import failed:", err);
    }
  }

  // Exit with error if all adapters failed
  if (results.every((r) => r.status === "fail")) {
    process.exit(1);
  }
}

main();
