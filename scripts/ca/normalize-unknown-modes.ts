/**
 * One-time migration: replace `mode: "unknown"` in CA course files with a
 * delivery mode inferred from each row's location/days/time.
 *
 * scrape-4cd / scrape-sdccd / scrape-wvm emit "unknown" when the SIS doesn't
 * expose an instruction-mode field. "unknown" isn't in CourseSectionSchema's
 * enum, so >5% of such rows aborted the import and these colleges showed 0
 * sections on prod (contra-costa, diablo-valley, los-medanos, san-diego ×3,
 * west-valley). This rewrites only the "unknown" rows; rows the scraper
 * already classified are left untouched.
 *
 * Idempotent (no "unknown" left after a run). The scrapers' own deriveMode
 * fallbacks should adopt inferDeliveryMode too so re-scrapes stay clean —
 * tracked as a follow-up (needs live re-scrape to verify).
 *
 * Usage:  npx tsx scripts/ca/normalize-unknown-modes.ts
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { inferDeliveryMode } from "../lib/infer-delivery-mode";

const COURSES_ROOT = join(process.cwd(), "data", "ca", "courses");

interface Row {
  mode?: string;
  location?: string | null;
  days?: string | null;
  start_time?: string | null;
}

function main() {
  let filesChanged = 0;
  let rowsChanged = 0;
  const into: Record<string, number> = {};
  const byCollege: Record<string, number> = {};

  for (const college of readdirSync(COURSES_ROOT)) {
    const dir = join(COURSES_ROOT, college);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const path = join(dir, file);
      const rows = JSON.parse(readFileSync(path, "utf8")) as Row[];
      let changed = false;
      for (const r of rows) {
        if (r.mode === "unknown") {
          const m = inferDeliveryMode(r);
          r.mode = m;
          into[m] = (into[m] ?? 0) + 1;
          byCollege[college] = (byCollege[college] ?? 0) + 1;
          rowsChanged++;
          changed = true;
        }
      }
      if (changed) {
        writeFileSync(path, JSON.stringify(rows, null, 2) + "\n");
        filesChanged++;
      }
    }
  }

  console.log("CA unknown-mode inference");
  console.log(`  files rewritten: ${filesChanged}`);
  console.log(`  rows reclassified: ${rowsChanged}`);
  console.log(`  inferred into: ${JSON.stringify(into)}`);
  console.log("  by college:");
  for (const [c, n] of Object.entries(byCollege).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${n.toString().padStart(5)}  ${c}`);
  }
  console.log("\nDone.");
}

main();

export {};
