/**
 * scrape-transfer-collegetransfer.ts
 *
 * Scrapes transfer equivalency data from CollegeTransfer.Net for:
 *   - DTCC → Delaware State University (718 equivalencies)
 *   - DTCC → Wilmington University (546 equivalencies)
 *
 * Uses the shared CollegeTransfer.Net OData API utility.
 * Merges with existing data in data/de/transfer-equiv.json.
 *
 * Usage:
 *   npx tsx scripts/de/scrape-transfer-collegetransfer.ts
 */

import fs from "fs";
import path from "path";
import {
  scrapeCollegeTransfer,
  type TransferMapping,
  type ScrapeOptions,
} from "../lib/scrape-collegetransfer.js";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DTCC_SENDER_ID = 3396;

const TARGETS: ScrapeOptions[] = [
  {
    senderId: DTCC_SENDER_ID,
    receiverId: 511,
    universitySlug: "desu",
    universityName: "Delaware State University",
    state: "de",
  },
  {
    senderId: DTCC_SENDER_ID,
    receiverId: 3773,
    universitySlug: "wilmington",
    universityName: "Wilmington University",
    state: "de",
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("CollegeTransfer.Net — Delaware Transfer Scraper\n");
  console.log("Source: Delaware Technical Community College (DTCC)\n");

  const allMappings: TransferMapping[] = [];

  for (const target of TARGETS) {
    console.log(
      `${target.universityName} (CT.net ID ${target.receiverId}):`
    );
    const mappings = await scrapeCollegeTransfer(target);
    allMappings.push(...mappings);
    console.log("");
  }

  // Filter out no-transfer entries
  const transferable = allMappings.filter((m) => !m.no_credit);

  // Stats
  const byUniv = new Map<string, number>();
  for (const m of transferable) {
    byUniv.set(m.university, (byUniv.get(m.university) || 0) + 1);
  }

  console.log("Summary:");
  console.log(`  Total mappings: ${allMappings.length}`);
  console.log(`  Transferable: ${transferable.length}`);
  for (const [univ, count] of byUniv) {
    console.log(`    ${univ}: ${count}`);
  }
  console.log(
    `  Direct equivalencies: ${transferable.filter((m) => !m.is_elective).length}`
  );
  console.log(
    `  Elective credit: ${transferable.filter((m) => m.is_elective).length}`
  );
  console.log(
    `  No transfer: ${allMappings.filter((m) => m.no_credit).length}`
  );

  // Spot checks
  const eng101 = transferable.find(
    (m) =>
      m.cc_prefix === "ENG" &&
      m.cc_number === "101" &&
      m.university === "desu"
  );
  if (eng101) {
    console.log(
      `\n  Spot check — ENG 101 → DSU: ${eng101.univ_course} (${eng101.univ_title})`
    );
  }
  const acc101 = transferable.find(
    (m) =>
      m.cc_prefix === "ACC" &&
      m.cc_number === "101" &&
      m.university === "wilmington"
  );
  if (acc101) {
    console.log(
      `  Spot check — ACC 101 → Wilmington: ${acc101.univ_course} (${acc101.univ_title})`
    );
  }

  if (transferable.length === 0) {
    console.log(
      "\n⚠ No transferable mappings found! Check if the API changed."
    );
    process.exit(1);
  }

  // Merge with existing data (preserve UDel and other non-CT.net entries)
  const outPath = path.join(
    process.cwd(),
    "data",
    "de",
    "transfer-equiv.json"
  );
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    if (existing.length > 0) {
      console.log(`\nLoaded ${existing.length} existing mappings`);
    }
  } catch {
    // No existing file
  }

  // Remove old DSU and Wilmington entries, keep everything else (e.g., UDel)
  const universitySlugSet = new Set(TARGETS.map((t) => t.universitySlug));
  const preserved = existing.filter(
    (m) => !universitySlugSet.has(m.university)
  );
  const merged = [...preserved, ...transferable];

  console.log(
    `Merged: ${preserved.length} preserved + ${transferable.length} new = ${merged.length} total`
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Saved to ${outPath}`);

  // Import to Supabase
  try {
    const imported = await importTransfersToSupabase("de");
    if (imported > 0) {
      console.log(`Imported ${imported} rows to Supabase`);
    }
  } catch (err) {
    console.log(`Supabase import skipped: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
