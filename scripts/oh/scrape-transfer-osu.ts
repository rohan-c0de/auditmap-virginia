/**
 * scrape-transfer-osu.ts
 *
 * Downloads Ohio State University's public "Quick Equivalencies" Excel
 * file and converts it into transfer-equiv.json mappings for Ohio CCs.
 *
 * The file is a single GET, no auth, ~4.4 MB, updated monthly by OSU's
 * registrar. Contains ~106K rows from sending institutions worldwide;
 * we filter to the 22 Ohio CCs in our institutions.json.
 *
 * Source: https://registrar.osu.edu/media/1wul1ydz/osu-quick-equivalencies-2926.xlsx
 *
 * Usage:
 *   npx tsx scripts/oh/scrape-transfer-osu.ts
 *   npx tsx scripts/oh/scrape-transfer-osu.ts --no-import
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

interface TransferMapping {
  state: string;
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

const XLSX_URL =
  "https://registrar.osu.edu/media/1wul1ydz/osu-quick-equivalencies-2926.xlsx";
const DATA_DIR = path.join(process.cwd(), "data", "oh");
const OUT_FILE = path.join(DATA_DIR, "transfer-equiv.json");
const INST_FILE = path.join(DATA_DIR, "institutions.json");

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseCourse(code: string): { prefix: string; number: string } | null {
  const m = code.trim().match(/^([A-Z]{2,8})\s+(\d{3,4}[A-Z]?)$/);
  return m ? { prefix: m[1], number: m[2] } : null;
}

function isElective(course: string): boolean {
  const lc = course.toLowerCase();
  return (
    lc.includes("special") ||
    lc.includes("elective") ||
    course.includes("XX") ||
    course.includes("---")
  );
}

// OSU truncates some school names — map to our slugs
const NAME_OVERRIDES: Record<string, string> = {
  "Cuyahoga Comm College": "cuyahoga-community-college-district",
  "Lorain County Comm Coll": "lorain-county-community-college",
  "Northwest State Comm Coll": "northwest-state-community-college",
  "Southern State Comm Coll": "southern-state-community-college",
  "Central Ohio Tech College": "central-ohio-technical-college",
  "James A Rhodes State College": "james-a-rhodes-state-college",
  "Cincinnati State Tech & Comm Coll": "cincinnati-state-technical-and-community-college",
  "Washington State Comm Coll": "washington-state-community-college",
};

// False positives: these schools match our slugs by substring but are NOT Ohio CCs
const EXCLUDE_SCHOOLS = new Set([
  "Lewis-Clark State College",
  "Unity College",
  "Columbus State University",
  "Lakeland University",
]);

async function main() {
  const skipImport = process.argv.includes("--no-import");

  console.log("OSU Quick Equivalencies — Ohio Transfer Equivalencies\n");

  // 1. Download the Excel file
  console.log(`Downloading ${XLSX_URL} ...`);
  const resp = await fetch(XLSX_URL);
  if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  console.log(`  ${(buf.length / 1024).toFixed(0)} KB downloaded\n`);

  // 2. Parse Excel
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as (string | number | undefined)[][];
  console.log(`  ${rows.length} total rows\n`);

  // 3. Load our OH institutions
  const ourInsts: { id: string; name: string }[] = JSON.parse(
    fs.readFileSync(INST_FILE, "utf8"),
  );
  const ourSlugs = new Set(ourInsts.map((i) => i.id));

  // 4. Match Excel school names to our slugs
  const schoolNames = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    schoolNames.add((rows[i][0] || "").toString());
  }

  const matchedSchools = new Map<string, string>(); // Excel name → our slug
  for (const name of Array.from(schoolNames)) {
    if (EXCLUDE_SCHOOLS.has(name)) continue;

    // Check override first
    if (NAME_OVERRIDES[name]) {
      const slug = NAME_OVERRIDES[name];
      if (ourSlugs.has(slug)) {
        matchedSchools.set(name, slug);
        continue;
      }
    }

    const slug = slugify(name);
    if (ourSlugs.has(slug)) {
      matchedSchools.set(name, slug);
      continue;
    }

    // Try partial match — only when our slug contains the Excel slug
    // (avoids false positives like Lewis-Clark matching clark-state)
    for (const ourSlug of Array.from(ourSlugs)) {
      if (ourSlug.includes(slug) && slug.length > 5) {
        matchedSchools.set(name, ourSlug);
        break;
      }
    }
  }

  console.log(`Matched ${matchedSchools.size} OH CCs:\n`);

  // 5. Build transfer mappings
  // Headers: SCHOOL NAME, SOURCE, source course_TITLE, TARGET, effdate, target course_TITLE
  const mappings: TransferMapping[] = [];
  const byCC = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const schoolName = (row[0] || "").toString();
    const ccSlug = matchedSchools.get(schoolName);
    if (!ccSlug) continue;

    const source = (row[1] || "").toString().trim();
    const sourceTitle = (row[2] || "").toString().trim();
    const target = (row[3] || "").toString().trim();
    const targetTitle = (row[5] || "").toString().trim();

    if (!source || !target) continue;

    // Parse CC course from SOURCE — take first course if multi
    const ccParsed = parseCourse(source.split(/\s{2,}/)[0]);
    if (!ccParsed) continue;

    // Parse OSU course from TARGET — may have multiple separated by whitespace
    const targetParts = target.split(/\s{2,}/);
    const osuParsed = parseCourse(targetParts[0]);
    const univCourse = osuParsed
      ? `${osuParsed.prefix} ${osuParsed.number}`
      : targetParts[0];

    const elective = isElective(target);
    const noCredit =
      target.toLowerCase().includes("no credit") ||
      target.toLowerCase().includes("does not transfer");

    mappings.push({
      state: "oh",
      cc_prefix: ccParsed.prefix,
      cc_number: ccParsed.number,
      cc_course: `${ccParsed.prefix} ${ccParsed.number}`,
      cc_title: sourceTitle,
      cc_credits: "",
      university: "osu",
      university_name: "The Ohio State University",
      univ_course: univCourse,
      univ_title: targetTitle === "intentionally left blank" ? "" : targetTitle,
      univ_credits: "",
      notes: `[${ccSlug}]`,
      no_credit: noCredit,
      is_elective: elective,
    });

    byCC.set(ccSlug, (byCC.get(ccSlug) || 0) + 1);
  }

  // 6. Summary
  const transferable = mappings.filter((m) => !m.no_credit);
  const direct = transferable.filter((m) => !m.is_elective).length;
  const elective = transferable.filter((m) => m.is_elective).length;

  for (const [slug, count] of Array.from(byCC.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slug}: ${count} mappings`);
  }

  console.log("\n=== Summary ===");
  console.log(`  OSU mappings: ${mappings.length}`);
  console.log(`  Transferable: ${transferable.length}`);
  console.log(`    Direct equivalencies: ${direct}`);
  console.log(`    Elective credit: ${elective}`);
  console.log(`  No credit: ${mappings.length - transferable.length}`);
  console.log(`  Unique CCs: ${byCC.size}`);

  // 7. Merge with existing data
  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(OUT_FILE, "utf-8"));
  } catch {
    // empty or missing
  }
  const nonOSU = existing.filter((m) => m.university !== "osu");
  const merged = [...nonOSU, ...mappings];
  console.log(`  Preserved from other sources: ${nonOSU.length}`);
  console.log(`  Total merged: ${merged.length}`);

  // 8. Write
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nSaved ${merged.length} mappings → ${OUT_FILE}`);

  // 9. Supabase import
  if (!skipImport) {
    console.log("\nImporting to Supabase...");
    await importTransfersToSupabase("oh");
    console.log("  Done.");
  } else {
    console.log("\nSkipping Supabase import (--no-import).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
