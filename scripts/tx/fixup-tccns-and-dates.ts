/**
 * One-off backfill: normalize already-scraped TX course data so it lands in
 * Supabase and shows credit hours, WITHOUT re-running the expensive scrapers
 * (Lone Star is an ~8h PS-Classic run; Austin ~30 min). The scrapers
 * themselves were fixed in the same PR so future cron ticks emit correct data;
 * this applies the identical transforms to the existing JSON files:
 *
 *   - dates: "08/24/2026" (MM/DD/YYYY) → "2026-08-24" (ISO). The Supabase
 *     `date` column rejects non-ISO, which silently dropped cisco/lone-star.
 *     Any start/end date that is neither ISO nor MM/DD/YYYY (e.g. an instructor
 *     name that leaked into the column) is blanked so the row still imports.
 *   - credits: 0/null → inferTccnsCredits(course_number) (TCCNS 2nd digit).
 *
 * Idempotent — re-running changes nothing once data is normalized. Frank
 * Phillips's 14 corrupted rows are recovered by re-running its (fixed) scraper,
 * not by this script (it can only blank an unrecoverable date).
 *
 * Usage: npx tsx scripts/tx/fixup-tccns-and-dates.ts [slug ...]
 */
import * as fs from "fs";
import * as path from "path";
import { inferTccnsCredits } from "../lib/tccns-credits";
import { inferCourseMode } from "../lib/course-mode";

const VALID_MODES = new Set(["in-person", "online", "hybrid", "zoom"]);

const DEFAULT_SLUGS = [
  "cisco-college",
  "lone-star-college-system",
  "austin-community-college-district",
  "grayson-college",
  "northeast-texas-community-college",
  // HCCS imports fine except for ~337 rows whose PeopleSoft "Lab Based" format
  // label leaked into `mode` (same class of bug as Lone Star's "Regular").
  "houston-community-college",
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MDY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function mdyToIso(s: string): string | null {
  const m = String(s ?? "").trim().match(MDY);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

interface Row {
  start_date?: string;
  end_date?: string;
  credits?: number | null;
  course_number?: string;
  mode?: string;
  location?: string;
  campus?: string;
  days?: string;
  [k: string]: unknown;
}

function fixRow(row: Row): boolean {
  let changed = false;
  for (const k of ["start_date", "end_date"] as const) {
    const v = row[k];
    if (typeof v === "string" && v && !ISO.test(v)) {
      const iso = mdyToIso(v);
      row[k] = iso ?? ""; // unrecoverable (e.g. a name) → blank so it imports
      changed = true;
    }
  }
  if (!row.credits || row.credits === 0) {
    const c = inferTccnsCredits(String(row.course_number ?? ""));
    if (c > 0) {
      row.credits = c;
      changed = true;
    }
  }
  // Empty/invalid mode ("" from Cisco/NTCC, a session label from Lone Star)
  // fails the import enum check — infer from location/campus/days.
  if (!row.mode || !VALID_MODES.has(row.mode)) {
    row.mode = inferCourseMode({
      location: row.location,
      campus: row.campus,
      days: row.days,
    });
    changed = true;
  }
  return changed;
}

function main() {
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SLUGS;
  for (const slug of slugs) {
    const dir = path.join(process.cwd(), "data", "tx", "courses", slug);
    if (!fs.existsSync(dir)) {
      console.log(`  ${slug}: no data dir, skipping`);
      continue;
    }
    let files = 0;
    let rowsChanged = 0;
    let total = 0;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const p = path.join(dir, f);
      const rows: Row[] = JSON.parse(fs.readFileSync(p, "utf8"));
      let fileChanged = false;
      for (const r of rows) {
        total++;
        if (fixRow(r)) {
          rowsChanged++;
          fileChanged = true;
        }
      }
      if (fileChanged) {
        fs.writeFileSync(p, JSON.stringify(rows, null, 2) + "\n");
        files++;
      }
    }
    console.log(
      `  ${slug.padEnd(40)} ${rowsChanged}/${total} rows normalized across ${files} file(s)`,
    );
  }
}

main();
