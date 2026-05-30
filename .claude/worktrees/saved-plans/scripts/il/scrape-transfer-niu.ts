/**
 * scrape-transfer-niu.ts
 *
 * Fetches all transfer equivalencies from Northern Illinois University's
 * public CEMG (Course Equivalencies and Major Guides) JSON API.
 *
 * One unauthenticated GET to /CEMG/PubAPI/CourseEquivRead returns ~49K
 * records across 99 institutions. We filter to IL community colleges
 * registered in our institutions.json and emit transfer mappings.
 *
 * Usage:
 *   npx tsx scripts/il/scrape-transfer-niu.ts
 *   npx tsx scripts/il/scrape-transfer-niu.ts --no-import
 */

import * as fs from "node:fs";
import * as path from "node:path";
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

interface CEMGRecord {
  crseCode: string;
  niucrseCode: string;
  collegeName: string;
  niuCourse: string;
  iaiCode: string;
  iaI2Code: string;
  creditHours: number;
  genEdDomain1: string;
  genEdDomain2: string | null;
  isActive: boolean;
}

const API_URL = "https://apps.niu.edu/CEMG/PubAPI/CourseEquivRead";
const DATA_DIR = path.join(process.cwd(), "data", "il");
const OUT_FILE = path.join(DATA_DIR, "transfer-equiv.json");
const INST_FILE = path.join(DATA_DIR, "institutions.json");

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseCourse(code: string): { prefix: string; number: string } | null {
  const m = code.trim().match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)$/);
  return m ? { prefix: m[1], number: m[2] } : null;
}

function isElective(course: string): boolean {
  const lc = course.toLowerCase();
  return (
    lc.includes("elective") ||
    lc.includes("general elective") ||
    course.includes("TR") ||
    course.endsWith("TR")
  );
}

// NIU's collegeName → our institution slug
// Some names differ slightly; this map handles the mismatches.
const NAME_OVERRIDES: Record<string, string> = {
  "City Colleges of Chicago": "city-colleges-of-chicago",
  "William Rainey Harper College": "william-rainey-harper-college",
  "Moraine Valley Community Colle": "moraine-valley-community-college",
  "Illinois Eastern Comm Colleges": "illinois-eastern-community-colleges",
};

async function main() {
  const skipImport = process.argv.includes("--no-import");

  console.log("NIU CEMG API — Illinois Transfer Equivalencies\n");

  // 1. Load our IL institutions
  const ourInsts: { id: string; name: string }[] = JSON.parse(
    fs.readFileSync(INST_FILE, "utf8"),
  );
  const ourSlugs = new Set(ourInsts.map((i) => i.id));

  // 2. Fetch CEMG data
  console.log(`Fetching ${API_URL} ...`);
  const resp = await fetch(API_URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  const records: CEMGRecord[] = json.data;
  console.log(`  ${records.length} total records\n`);

  // 3. Group by college, match to our slugs
  const byCollege = new Map<string, CEMGRecord[]>();
  for (const r of records) {
    const list = byCollege.get(r.collegeName) || [];
    list.push(r);
    byCollege.set(r.collegeName, list);
  }

  // Match college names to our slugs
  const matchedColleges = new Map<string, string>(); // collegeName → ourSlug
  for (const collegeName of Array.from(byCollege.keys())) {
    // Check override first
    if (NAME_OVERRIDES[collegeName]) {
      const slug = NAME_OVERRIDES[collegeName];
      if (ourSlugs.has(slug)) {
        matchedColleges.set(collegeName, slug);
        continue;
      }
    }

    const slug = slugify(collegeName);
    if (ourSlugs.has(slug)) {
      matchedColleges.set(collegeName, slug);
      continue;
    }

    // Try partial match
    for (const ourSlug of Array.from(ourSlugs)) {
      if (slug.includes(ourSlug) || ourSlug.includes(slug)) {
        matchedColleges.set(collegeName, ourSlug);
        break;
      }
    }
  }

  console.log(`Matched ${matchedColleges.size} IL CCs out of ${byCollege.size} colleges\n`);

  // 4. Build transfer mappings
  const mappings: TransferMapping[] = [];

  for (const [collegeName, slug] of Array.from(matchedColleges)) {
    const recs = byCollege.get(collegeName) || [];
    let count = 0;

    for (const r of recs) {
      const ccParsed = parseCourse(r.crseCode);
      if (!ccParsed) continue;

      const univCourse = r.niucrseCode?.trim() || "";
      if (!univCourse) continue;

      const elective = isElective(r.niuCourse || univCourse);
      const noCredit = univCourse.toLowerCase().includes("no credit");

      let notes = `[${slug}]`;
      if (r.iaiCode) notes += ` IAI ${r.iaiCode}`;
      if (r.genEdDomain1) notes += ` GenEd:${r.genEdDomain1}`;

      mappings.push({
        state: "il",
        cc_prefix: ccParsed.prefix,
        cc_number: ccParsed.number,
        cc_course: `${ccParsed.prefix} ${ccParsed.number}`,
        cc_title: r.niuCourse || "",
        cc_credits: r.creditHours ? String(r.creditHours) : "",
        university: "niu",
        university_name: "Northern Illinois University",
        univ_course: univCourse,
        univ_title: r.niuCourse || "",
        univ_credits: r.creditHours ? String(r.creditHours) : "",
        notes,
        no_credit: noCredit,
        is_elective: elective,
      });
      count++;
    }

    console.log(`  ${slug}: ${count} active mappings`);
  }

  // 5. Merge with existing data (preserve non-NIU rows)
  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(OUT_FILE, "utf-8"));
  } catch {
    // empty or missing
  }
  const nonNIU = existing.filter((m) => m.university !== "niu");
  const merged = [...nonNIU, ...mappings];

  // 6. Summary
  const transferable = mappings.filter((m) => !m.no_credit);
  const direct = transferable.filter((m) => !m.is_elective).length;
  const elective = transferable.filter((m) => m.is_elective).length;

  console.log("\n=== Summary ===");
  console.log(`  NIU mappings: ${mappings.length}`);
  console.log(`  Transferable: ${transferable.length}`);
  console.log(`    Direct equivalencies: ${direct}`);
  console.log(`    Elective credit: ${elective}`);
  console.log(`  No credit: ${mappings.length - transferable.length}`);
  console.log(`  Preserved from other sources: ${nonNIU.length}`);
  console.log(`  Total merged: ${merged.length}`);

  // 7. Write
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nSaved ${merged.length} mappings → ${OUT_FILE}`);

  // 8. Supabase import
  if (!skipImport) {
    console.log("\nImporting to Supabase...");
    await importTransfersToSupabase("il");
    console.log("  Done.");
  } else {
    console.log("\nSkipping Supabase import (--no-import).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
