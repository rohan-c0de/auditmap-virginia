/**
 * scrape-transfer-mitransfer.ts
 *
 * Scrapes transfer equivalencies from MiTransfer.org — Michigan's statewide
 * articulation portal covering all 31 public community colleges.
 *
 * The portal uses an AJAX listing endpoint. For each CC × receiving-university
 * pair, we GET:
 *   /equiv_search_by_transferring_listing.cfm
 *     ?filter_transferInstID=<cc_id>
 *     &filter_acceptInstID=<univ_id>
 *     &startRow=1&maxRows=5000
 *
 * Columns in each row (by position):
 *   0 Sending Subject | 1 Course | 2 Credits |
 *   3 Receiving Institution | 4 Subject | 5 Course | 6 Course Title |
 *   7 Credits | 8 General Credits | 9 Waive Credits | 10 Start | 11 End
 *
 * "GCU" (General Credit Undergraduate) in receiving Course = elective.
 * "NON TRNSFR" in receiving Subject = no credit awarded.
 *
 * We cover 5 major MI universities to maximize student utility while keeping
 * request count manageable (31 CCs × 5 universities = 155 fetches).
 *
 * Usage:
 *   npx tsx scripts/mi/scrape-transfer-mitransfer.ts
 *   npx tsx scripts/mi/scrape-transfer-mitransfer.ts --no-import
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as cheerio from "cheerio";
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

const BASE_URL = "https://www.mitransfer.org";
const LISTING_PATH = "/equiv_search_by_transferring_listing.cfm";
const DATA_DIR = path.join(process.cwd(), "data", "mi");
const OUT_FILE = path.join(DATA_DIR, "transfer-equiv.json");
const INST_FILE = path.join(DATA_DIR, "institutions.json");
const DELAY_MS = 1200;
const MAX_ROWS = 5000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// MiTransfer institution IDs for MI community colleges
// Extracted from /equiv_search_by_transferring.cfm dropdown
const MI_CC_IDS: { id: number; name: string }[] = [
  { id: 7, name: "Alpena Community College" },
  { id: 16, name: "Bay de Noc Community College" },
  { id: 195, name: "Bay Mills Community College" },
  { id: 23, name: "Delta College" },
  { id: 27, name: "Glen Oaks Community College" },
  { id: 28, name: "Gogebic Community College" },
  { id: 30, name: "Grand Rapids Community College" },
  { id: 32, name: "Henry Ford College" },
  { id: 33, name: "Jackson College" },
  { id: 34, name: "Kalamazoo Valley Community College" },
  { id: 35, name: "Kellogg Community College" },
  { id: 130, name: "Keweenaw Bay Ojibwa Community College" },
  { id: 37, name: "Kirtland Community College" },
  { id: 38, name: "Lake Michigan College" },
  { id: 40, name: "Lansing Community College" },
  { id: 42, name: "Macomb Community College" },
  { id: 48, name: "Monroe County Community College" },
  { id: 49, name: "Montcalm Community College" },
  { id: 50, name: "Mott Community College" },
  { id: 51, name: "Muskegon Community College" },
  { id: 52, name: "North Central Michigan College" },
  { id: 54, name: "Northwestern Michigan College" },
  { id: 56, name: "Oakland Community College" },
  { id: 61, name: "Schoolcraft College" },
  { id: 65, name: "St. Clair County Community College" },
  { id: 71, name: "Washtenaw Community College" },
  { id: 72, name: "Wayne County Community College District" },
  { id: 74, name: "West Shore Community College" },
];

// MiTransfer name → our institution slug overrides
const NAME_OVERRIDES: Record<string, string> = {
  "Schoolcraft College": "schoolcraft-community-college-district",
  "Wayne County Community College District": "wayne-county-community-college-district",
  "Keweenaw Bay Ojibwa Community College": "keweenaw-bay-ojibwa-community-college",
};

// Major MI receiving universities: id → { slug, full name }
const RECEIVING_UNIVS: { id: number; slug: string; name: string }[] = [
  { id: 45, slug: "msu", name: "Michigan State University" },
  { id: 67, slug: "umich", name: "University of Michigan-Ann Arbor" },
  { id: 73, slug: "wayne-state", name: "Wayne State University" },
  { id: 75, slug: "wmich", name: "Western Michigan University" },
  { id: 24, slug: "emich", name: "Eastern Michigan University" },
];

async function fetchListing(
  ccId: number,
  univId: number,
): Promise<string> {
  const url =
    `${BASE_URL}${LISTING_PATH}` +
    `?filter_transferInstID=${ccId}` +
    `&search_subject=&search_course=` +
    `&filter_acceptInstID=${univId}` +
    `&startRow=1&maxRows=${MAX_ROWS}`;

  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for cc=${ccId} univ=${univId}`);
  return resp.text();
}

function parseRows(html: string, ccSlug: string, univ: { slug: string; name: string }): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  $("tr[valign='top']").each((_, el) => {
    const cells = $(el).find("td");
    if (cells.length < 7) return;

    const getText = (i: number) => $(cells[i]).text().trim().split("\n")[0].trim();

    const ccPrefix = getText(0);
    const ccNumber = getText(1);
    const ccCredits = getText(2);
    const univPrefix = getText(4);
    const univNumber = getText(5);
    const univTitle = getText(6);
    const univCredits = getText(7);

    if (!ccPrefix || !ccNumber || !univPrefix) return;

    // NON TRNSFR = no credit
    const noCredit = univPrefix === "NON";

    // GCU = General Credit Undergraduate (elective)
    const isElective = univNumber === "GCU" || univPrefix === "GCU";

    const univCourse = noCredit ? "NO CREDIT" : `${univPrefix} ${univNumber}`;

    mappings.push({
      state: "mi",
      cc_prefix: ccPrefix,
      cc_number: ccNumber,
      cc_course: `${ccPrefix} ${ccNumber}`,
      cc_title: "",
      cc_credits: ccCredits,
      university: univ.slug,
      university_name: univ.name,
      univ_course: univCourse,
      univ_title: noCredit ? "" : univTitle,
      univ_credits: univCredits,
      notes: `[${ccSlug}]`,
      no_credit: noCredit,
      is_elective: isElective,
    });
  });

  return mappings;
}

async function main() {
  const skipImport = process.argv.includes("--no-import");

  console.log("MiTransfer.org — Michigan Transfer Equivalencies\n");

  // Load our MI institutions for slug matching
  const ourInsts: { id: string; name: string }[] = JSON.parse(
    fs.readFileSync(INST_FILE, "utf8"),
  );
  const ourSlugs = new Set(ourInsts.map((i) => i.id));

  const allMappings: TransferMapping[] = [];
  const byCC = new Map<string, number>();

  for (const cc of MI_CC_IDS) {
    // Resolve CC slug
    let ccSlug = NAME_OVERRIDES[cc.name] || slugify(cc.name);
    if (!ourSlugs.has(ccSlug)) {
      // Try substring match
      for (const s of Array.from(ourSlugs)) {
        if (s.includes(ccSlug) || ccSlug.includes(s)) {
          ccSlug = s;
          break;
        }
      }
    }

    let ccTotal = 0;
    for (const univ of RECEIVING_UNIVS) {
      try {
        const html = await fetchListing(cc.id, univ.id);
        const rows = parseRows(html, ccSlug, univ);
        allMappings.push(...rows);
        ccTotal += rows.length;
      } catch (err: any) {
        console.error(`  ${ccSlug} → ${univ.slug}: FAILED — ${err.message}`);
      }
      await sleep(DELAY_MS);
    }

    byCC.set(ccSlug, (byCC.get(ccSlug) || 0) + ccTotal);
    console.log(`  ${ccSlug}: ${ccTotal} mappings`);
  }

  // Summary
  const transferable = allMappings.filter((m) => !m.no_credit);
  const direct = transferable.filter((m) => !m.is_elective).length;
  const elective = transferable.filter((m) => m.is_elective).length;

  console.log("\n=== Summary ===");
  console.log(`  Total mappings: ${allMappings.length}`);
  console.log(`  Transferable: ${transferable.length}`);
  console.log(`    Direct equivalencies: ${direct}`);
  console.log(`    Elective credit: ${elective}`);
  console.log(`  No credit: ${allMappings.length - transferable.length}`);
  console.log(`  Unique CCs: ${byCC.size}`);
  console.log(
    `  Universities: ${RECEIVING_UNIVS.map((u) => u.slug).join(", ")}`,
  );

  // Merge with existing data (preserve non-MiTransfer rows)
  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(OUT_FILE, "utf-8"));
  } catch {
    // empty or missing
  }
  const miTransferSlugs = new Set(RECEIVING_UNIVS.map((u) => u.slug));
  const nonMiTransfer = existing.filter((m) => !miTransferSlugs.has(m.university));
  const merged = [...nonMiTransfer, ...allMappings];
  console.log(`  Preserved from other sources: ${nonMiTransfer.length}`);
  console.log(`  Total merged: ${merged.length}`);

  // Write
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nSaved ${merged.length} mappings → ${OUT_FILE}`);

  if (!skipImport) {
    console.log("\nImporting to Supabase...");
    await importTransfersToSupabase("mi");
    console.log("  Done.");
  } else {
    console.log("\nSkipping Supabase import (--no-import).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
