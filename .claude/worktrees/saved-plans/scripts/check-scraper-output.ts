/**
 * Dry-run validator for existing scraper output.
 *
 * Runs the same schemas the import scripts now enforce against every JSON
 * file under `data/{state}/...`. Flags (state, college, term) combinations
 * that would exceed the 5% failure threshold and abort on import.
 *
 * Usage:
 *   npx tsx scripts/check-scraper-output.ts          # all states
 *   npx tsx scripts/check-scraper-output.ts --state va
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getAllStates } from "../lib/states/registry";
import {
  CourseSectionSchema,
  TransferMappingSchema,
  MAX_INVALID_RATIO,
  validateRows,
  isTransferHeaderRow,
} from "../lib/schemas";

const ROOT = resolve(__dirname, "..");
const args = process.argv.slice(2);
const stateIdx = args.indexOf("--state");
const onlyState = stateIdx >= 0 ? args[stateIdx + 1] : null;

const states = getAllStates()
  .map((s) => s.slug)
  .filter((s) => !onlyState || s === onlyState);

let wouldAbort = 0;
let totalBad = 0;

for (const state of states) {
  const coursesDir = resolve(ROOT, "data", state, "courses");
  if (existsSync(coursesDir)) {
    for (const college of readdirSync(coursesDir)) {
      const dir = resolve(coursesDir, college);
      if (!statSync(dir).isDirectory()) continue;
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        const term = file.replace(".json", "");
        const rows = JSON.parse(readFileSync(resolve(dir, file), "utf8"));
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const v = validateRows(rows, CourseSectionSchema, (r, i) => {
          const x = r as Record<string, unknown>;
          return `${college}/${term} CRN ${x.crn ?? i}`;
        });
        const ratio = v.invalid.length / rows.length;
        if (v.invalid.length > 0) {
          totalBad += v.invalid.length;
          const flag = ratio > MAX_INVALID_RATIO ? "ABORT" : "warn ";
          if (ratio > MAX_INVALID_RATIO) wouldAbort++;
          console.log(
            `${flag} ${state}/${college}/${term}: ${v.invalid.length}/${rows.length} bad (${(ratio * 100).toFixed(1)}%)`
          );
          for (const bad of v.invalid.slice(0, 3)) {
            console.log(`       ${bad.identity}: ${bad.errors.join("; ")}`);
          }
        }
      }
    }
  }

  const transferPath = resolve(ROOT, "data", state, "transfer-equiv.json");
  if (existsSync(transferPath)) {
    const all = JSON.parse(readFileSync(transferPath, "utf8"));
    if (Array.isArray(all) && all.length > 0) {
      const data = all.filter((m: Record<string, unknown>) => !isTransferHeaderRow(m));
      if (data.length > 0) {
        const v = validateRows(data, TransferMappingSchema, (r, i) => {
          const x = r as Record<string, unknown>;
          return `${x.cc_course ?? i} -> ${x.university ?? "?"}`;
        });
        const ratio = v.invalid.length / data.length;
        if (v.invalid.length > 0) {
          totalBad += v.invalid.length;
          const flag = ratio > MAX_INVALID_RATIO ? "ABORT" : "warn ";
          if (ratio > MAX_INVALID_RATIO) wouldAbort++;
          console.log(
            `${flag} ${state}/transfer-equiv: ${v.invalid.length}/${data.length} bad (${(ratio * 100).toFixed(1)}%)`
          );
          for (const bad of v.invalid.slice(0, 3)) {
            console.log(`       ${bad.identity}: ${bad.errors.join("; ")}`);
          }
        }
      }
    }
  }
}

console.log(
  `\n${totalBad} invalid row(s) total. ${wouldAbort} (state, college, term) combination(s) would abort on import.`
);
if (wouldAbort > 0) process.exit(1);
