/**
 * One-time migration: canonicalize term filenames for the colleges that are
 * FULLY INVISIBLE because none of their course files use a canonical term code.
 *
 * Scope is deliberately narrow — only colleges with ZERO canonical
 * (`YYYYSP|SU|FA`) term files. These are entirely hidden from course search
 * today (their data imports under terms like `FL26`/`26-FAL`/`2026-02` that
 * getCurrentTerm/search never query). Colleges that already have at least one
 * canonical term are left untouched: their current-term search already works,
 * and their extra odd files (winter, summer sub-sessions) carry merge/clobber
 * risks that belong in the separate importer-level fix.
 *
 * For each in-scope college:
 *   - group its files by the canonical term resolved from row start_dates
 *     (scripts/lib/canonical-term.ts)
 *   - merge all rows mapping to the same canonical term (dedup by CRN — handles
 *     e.g. schoolcraft's 2026-02 + 2026-03 both resolving to 2026SU)
 *   - rewrite each row's `term` to canonical, write `{canonical}.json`, delete
 *     the original files
 *   - files whose term can't be confidently resolved are LEFT ALONE and
 *     reported, never guessed.
 *
 * Idempotent. Usage:  npx tsx scripts/normalize-invisible-terms.ts
 */
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CANONICAL_TERM, resolveCanonicalTerm, type TermSection } from "./lib/canonical-term";

const DATA = join(process.cwd(), "data");

interface Row extends TermSection {
  crn?: string;
  term?: string;
}

function main() {
  const states = readdirSync(DATA).filter((s) => existsSync(join(DATA, s, "courses")) && statSync(join(DATA, s, "courses")).isDirectory());

  let collegesFixed = 0;
  let filesWritten = 0;
  let filesDeleted = 0;
  const skipped: string[] = [];
  let rowsBefore = 0;
  let rowsAfter = 0;

  for (const state of states) {
    const coursesDir = join(DATA, state, "courses");
    for (const college of readdirSync(coursesDir)) {
      const dir = join(coursesDir, college);
      if (!statSync(dir).isDirectory()) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      const stems = files.map((f) => f.replace(/\.json$/, ""));
      // In scope only if NO canonical term file exists.
      if (stems.some((s) => CANONICAL_TERM.test(s))) continue;
      if (files.length === 0) continue;

      // Resolve each file -> canonical term, grouping rows.
      const groups = new Map<string, Map<string, Row>>(); // term -> crn -> row
      const sourceFiles: string[] = [];
      let collegeRowsBefore = 0;
      let resolvedAll = true;

      for (const file of files) {
        const stem = file.replace(/\.json$/, "");
        const path = join(dir, file);
        const rows = JSON.parse(readFileSync(path, "utf8")) as Row[];
        collegeRowsBefore += rows.length;
        const canonical = resolveCanonicalTerm(stem, rows);
        if (!canonical) {
          skipped.push(`${state}/${college}/${file} (unresolved)`);
          resolvedAll = false;
          continue;
        }
        let bucket = groups.get(canonical);
        if (!bucket) {
          bucket = new Map();
          groups.set(canonical, bucket);
        }
        rows.forEach((r, i) => {
          r.term = canonical;
          // Dedup key: prefer CRN; fall back to a positional key so rows
          // without a CRN are never collapsed together.
          const key = r.crn && String(r.crn).trim() ? String(r.crn) : `${file}#${i}`;
          bucket!.set(key, r);
        });
        sourceFiles.push(file);
      }

      if (groups.size === 0) continue; // nothing resolved; leave college as-is

      // Write canonical files, then delete the originals we consumed.
      let collegeRowsAfter = 0;
      for (const [term, bucket] of groups) {
        const merged = [...bucket.values()];
        collegeRowsAfter += merged.length;
        writeFileSync(join(dir, `${term}.json`), JSON.stringify(merged, null, 2) + "\n");
        filesWritten++;
      }
      for (const file of sourceFiles) {
        // Don't delete a source file if it happens to equal a just-written
        // canonical name (can't happen here since in-scope files are all
        // non-canonical, but guard anyway).
        const stem = file.replace(/\.json$/, "");
        if (!groups.has(stem)) {
          rmSync(join(dir, file));
          filesDeleted++;
        }
      }

      collegesFixed++;
      rowsBefore += collegeRowsBefore;
      rowsAfter += collegeRowsAfter;
      const lost = collegeRowsBefore - (resolvedAll ? collegeRowsAfter : collegeRowsAfter); // informational
      const terms = [...groups.keys()].sort().join(",");
      console.log(`  ${state}/${college}: ${sourceFiles.join(",")} -> [${terms}] (${collegeRowsBefore} rows${lost && resolvedAll ? `, dedup -${lost}` : ""})`);
    }
  }

  console.log("");
  console.log(`Canonicalize invisible-college terms`);
  console.log(`  colleges fixed:  ${collegesFixed}`);
  console.log(`  files written:   ${filesWritten}`);
  console.log(`  files deleted:   ${filesDeleted}`);
  console.log(`  rows in:  ${rowsBefore}`);
  console.log(`  rows out: ${rowsAfter} (delta from CRN-dedup: ${rowsAfter - rowsBefore})`);
  if (skipped.length) {
    console.log(`\n  LEFT ALONE (term unresolved — not guessed):`);
    for (const s of skipped) console.log(`    - ${s}`);
  }
  console.log(`\nDone.`);
}

main();

export {};
