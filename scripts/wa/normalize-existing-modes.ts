/**
 * One-time migration: normalize the `mode` field of already-scraped WA course
 * files to the canonical enum.
 *
 * Context: scrape-ctclink.ts used to write the raw ctcLink instruction-mode
 * description ("Online Asynchronous", "Hybrid", "In Person", ...) straight into
 * `mode`. The import schema only accepts "in-person" | "online" | "hybrid" |
 * "zoom", so 100% of WA rows failed validation and WA imported 0 sections. The
 * scraper is now fixed (normalizeCtclinkMode), but the ~130 files already on
 * disk still carry raw values. This rewrites them in place using the exact same
 * normalizer so the existing scrape can land without a full re-scrape.
 *
 * Idempotent: a file whose modes are already canonical is left byte-identical
 * and reported as "unchanged". Safe to re-run.
 *
 * Usage:  npx tsx scripts/wa/normalize-existing-modes.ts
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeCtclinkMode } from "./scrape-ctclink";

const COURSES_ROOT = join(process.cwd(), "data", "wa", "courses");
const CANONICAL = new Set(["in-person", "online", "hybrid", "zoom"]);

function walkJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkJsonFiles(full));
    else if (entry.endsWith(".json")) out.push(full);
  }
  return out;
}

function main() {
  const files = walkJsonFiles(COURSES_ROOT);
  let changedFiles = 0;
  let changedRows = 0;
  let totalRows = 0;
  const beforeCounts: Record<string, number> = {};
  const afterCounts: Record<string, number> = {};

  for (const file of files) {
    const rows = JSON.parse(readFileSync(file, "utf8")) as Array<{ mode?: string }>;
    let fileChanged = false;
    for (const row of rows) {
      totalRows++;
      const before = row.mode ?? "";
      beforeCounts[before] = (beforeCounts[before] ?? 0) + 1;
      const after = normalizeCtclinkMode(before);
      afterCounts[after] = (afterCounts[after] ?? 0) + 1;
      if (before !== after) {
        row.mode = after;
        fileChanged = true;
        changedRows++;
      }
    }
    if (fileChanged) {
      // Preserve the repo's 2-space pretty-print + trailing newline.
      writeFileSync(file, JSON.stringify(rows, null, 2) + "\n");
      changedFiles++;
    }
  }

  console.log(`WA mode normalization`);
  console.log(`  files scanned:  ${files.length}`);
  console.log(`  files rewritten: ${changedFiles}`);
  console.log(`  rows total:     ${totalRows}`);
  console.log(`  rows changed:   ${changedRows}`);
  console.log("");
  console.log("  before (raw) -> count:");
  for (const [k, v] of Object.entries(beforeCounts).sort((a, b) => b[1] - a[1])) {
    const flag = CANONICAL.has(k) ? "" : "  (non-canonical)";
    console.log(`    ${v.toString().padStart(7)}  ${k || "(empty)"}${flag}`);
  }
  console.log("");
  console.log("  after (canonical) -> count:");
  for (const [k, v] of Object.entries(afterCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${v.toString().padStart(7)}  ${k}`);
  }

  const stillBad = Object.keys(afterCounts).filter((m) => !CANONICAL.has(m));
  if (stillBad.length > 0) {
    console.error(`\nFAIL — non-canonical modes remain: ${stillBad.join(", ")}`);
    process.exit(1);
  }
  console.log(`\nOK — all modes are canonical.`);
}

main();

export {};
