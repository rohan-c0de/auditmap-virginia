/**
 * scrape-transfer-tccns.ts
 *
 * Downloads the TCCNS (Texas Common Course Numbering System) equivalency
 * matrix from tccns.org and converts it into transfer-equiv.json mappings.
 *
 * The TCCNS matrix is a publicly accessible Excel file that maps every
 * common course number to each TX institution's local equivalent. One
 * GET request covers all 142 institutions — no auth, no rate limiting.
 *
 * Source: https://tccns.org/export/matrix/l:n/yearid:19
 *         (Fall 2025 – Summer 2026)
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-transfer-tccns.ts
 *   npx tsx scripts/tx/scrape-transfer-tccns.ts --no-import
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface Institution {
  colIdx: number;
  name: string;
  slug: string;
  isCC: boolean;
}

// ---------------------------------------------------------------------------
// Our TX community college slugs → TCCNS matrix name mapping
// ---------------------------------------------------------------------------

const TCCNS_URL = "https://tccns.org/export/matrix/l:n/yearid:19";

const DATA_DIR = path.join(process.cwd(), "data", "tx");
const OUT_FILE = path.join(DATA_DIR, "transfer-equiv.json");
const INST_FILE = path.join(DATA_DIR, "institutions.json");

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseCourse(cell: string): { prefix: string; number: string } | null {
  const s = cell.trim();
  if (!s) return null;
  const m = s.match(/^([A-Z]{2,5})\s+(\d{4}[A-Z]?)$/);
  if (m) return { prefix: m[1], number: m[2] };
  const m2 = s.match(/^([A-Z]{2,5})\s+(\d+)$/);
  if (m2) return { prefix: m2[1], number: m2[2] };
  return null;
}

function isElective(course: string): boolean {
  const lc = course.toLowerCase();
  return (
    lc.includes("elective") ||
    lc.includes("elna") ||
    lc.includes("ld") ||
    course.includes("XXX") ||
    course.includes("---") ||
    /TRNS\s/.test(course)
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const skipImport = process.argv.includes("--no-import");

  console.log("TCCNS Matrix — Texas Transfer Equivalencies\n");

  // 1. Download the matrix
  console.log(`Downloading ${TCCNS_URL} ...`);
  const resp = await fetch(TCCNS_URL);
  if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  console.log(`  ${(buf.length / 1024).toFixed(0)} KB downloaded\n`);

  // 2. Parse Excel
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

  // Row 3 (index 2) = institution names
  const instRow = rows[2];

  // 3. Load our TX institutions to know which slugs are CCs
  const ourInsts: { id: string; name: string }[] = JSON.parse(
    fs.readFileSync(INST_FILE, "utf8"),
  );
  const ourCCSlugs = new Set(ourInsts.map((i) => i.id));

  // 4. Classify columns as CC or university
  const institutions: Institution[] = [];
  for (let c = 3; c < instRow.length; c++) {
    const name = (instRow[c] || "").toString().trim();
    if (!name) continue;
    const slug = slugify(name);

    // Match against our CC list by slug similarity
    let isCC = false;
    let matchedSlug = slug;

    for (const ourSlug of Array.from(ourCCSlugs)) {
      if (
        slug === ourSlug ||
        slug.includes(ourSlug) ||
        ourSlug.includes(slug)
      ) {
        isCC = true;
        matchedSlug = ourSlug;
        break;
      }
    }

    // Also check DCCCD sub-colleges → dallas-college
    if (name.startsWith("DCCCD ")) {
      isCC = true;
      matchedSlug = "dallas-college";
    }
    // San Jacinto sub-campuses
    if (name.startsWith("San Jacinto College")) {
      isCC = true;
      matchedSlug = "san-jacinto-community-college";
    }

    institutions.push({ colIdx: c, name, slug: matchedSlug, isCC });
  }

  const ccs = institutions.filter((i) => i.isCC);
  const univs = institutions.filter((i) => !i.isCC);
  console.log(`Institutions: ${ccs.length} CCs, ${univs.length} universities`);

  // 5. Build transfer mappings
  // For each course row, for each CC, check if the CC has a local equivalent.
  // Then for each university, check if it has a local equivalent.
  // Create a mapping: CC course → University course.
  const mappings: TransferMapping[] = [];

  for (let r = 3; r < rows.length; r++) {
    const row = rows[r];
    const title = (row[0] || "").toString().trim();
    const commonPrefix = (row[1] || "").toString().trim();
    const commonNumber = (row[2] || "").toString().trim();

    if (!commonPrefix || !commonNumber) continue;
    const tccnsCourse = `${commonPrefix} ${commonNumber}`;

    // For each CC that has this course...
    for (const cc of ccs) {
      const ccCell = (row[cc.colIdx] || "").toString().trim();
      if (!ccCell) continue;

      const ccParsed = parseCourse(ccCell);
      const ccPrefix = ccParsed?.prefix || commonPrefix;
      const ccNumber = ccParsed?.number || commonNumber;
      const ccCourse = ccParsed
        ? `${ccPrefix} ${ccNumber}`
        : ccCell;

      // ...map to each university that accepts it
      for (const univ of univs) {
        const univCell = (row[univ.colIdx] || "").toString().trim();
        if (!univCell) continue;

        const noCredit =
          univCell.toLowerCase().includes("no credit") ||
          univCell.toLowerCase().includes("does not transfer");
        const elective = !noCredit && isElective(univCell);

        const univParsed = parseCourse(univCell);
        const univCourse = univParsed
          ? `${univParsed.prefix} ${univParsed.number}`
          : univCell;

        mappings.push({
          state: "tx",
          cc_prefix: ccPrefix,
          cc_number: ccNumber,
          cc_course: ccCourse,
          cc_title: title,
          cc_credits: "",
          university: slugify(univ.name),
          university_name: univ.name,
          univ_course: univCourse,
          univ_title: title,
          univ_credits: "",
          notes: `[${cc.slug}] TCCNS ${tccnsCourse}`,
          no_credit: noCredit,
          is_elective: elective,
        });
      }
    }
  }

  // 6. Deduplicate — same CC slug + same cc_course + same university + same univ_course
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of mappings) {
    const key = `${m.notes.match(/^\[([^\]]+)\]/)?.[1]}|${m.cc_course}|${m.university}|${m.univ_course}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(m);
    }
  }

  // 7. Summary
  const transferable = deduped.filter((m) => !m.no_credit);
  const direct = transferable.filter((m) => !m.is_elective).length;
  const elective = transferable.filter((m) => m.is_elective).length;

  const byUniv = new Map<string, number>();
  for (const m of transferable) {
    byUniv.set(
      m.university_name,
      (byUniv.get(m.university_name) || 0) + 1,
    );
  }
  const topUnivs = Array.from(byUniv.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const byCC = new Map<string, number>();
  for (const m of deduped) {
    const slug = m.notes.match(/^\[([^\]]+)\]/)?.[1] || "?";
    byCC.set(slug, (byCC.get(slug) || 0) + 1);
  }

  console.log("\n=== Summary ===");
  console.log(`  Total mappings: ${deduped.length}`);
  console.log(`  Transferable: ${transferable.length}`);
  console.log(`    Direct equivalencies: ${direct}`);
  console.log(`    Elective credit: ${elective}`);
  console.log(`  No transfer: ${deduped.length - transferable.length}`);
  console.log(`  Unique CCs: ${byCC.size}`);
  console.log(`  Unique target universities: ${byUniv.size}`);
  console.log("\n  Top targets:");
  for (const [univ, count] of topUnivs) {
    console.log(`    ${univ}: ${count}`);
  }

  // 8. Write JSON
  fs.writeFileSync(OUT_FILE, JSON.stringify(deduped, null, 2));
  console.log(`\nSaved ${deduped.length} mappings → ${OUT_FILE}`);

  // 9. Supabase import
  if (!skipImport) {
    console.log("\nImporting to Supabase...");
    await importTransfersToSupabase("tx");
    console.log("  Done.");
  } else {
    console.log("\nSkipping Supabase import (--no-import).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
