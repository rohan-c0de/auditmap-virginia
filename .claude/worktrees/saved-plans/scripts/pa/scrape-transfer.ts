/**
 * scrape-transfer.ts
 *
 * Scrapes transfer equivalency data from CollegeTransfer.Net for
 * Pennsylvania community colleges → PA universities.
 *
 * PA TRAC (collegetransfer.pa.gov) is powered by CollegeTransfer.Net,
 * so we can use the same OData v2 API that works for DE and other states.
 *
 * Strategy:
 *   1. Discover PA CC sender IDs via the OData API
 *   2. Discover PA university receiver IDs
 *   3. Scrape all CC → University equivalency pairs
 *   4. Write merged results to data/pa/transfer-equiv.json
 *   5. Optionally import to Supabase
 *
 * Usage:
 *   npx tsx scripts/pa/scrape-transfer.ts
 *   npx tsx scripts/pa/scrape-transfer.ts --discover      # only discover IDs
 *   npx tsx scripts/pa/scrape-transfer.ts --no-import      # skip Supabase
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
// OData discovery helpers
// ---------------------------------------------------------------------------

const BASE_URL = "https://courseatlasservices.azurewebsites.net/odata/v2";
const API_KEY =
  process.env.COLLEGETRANSFER_API_KEY ||
  "bc923312-6f95-4340-8eed-c89bd576521c";

interface ODataInstitution {
  InstitutionId: number;
  Name: string;
  City?: string;
  State?: string;
}

interface ODataDiscoveryResponse {
  value: ODataInstitution[];
  "odata.nextLink"?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Search the OData API for institutions matching a name fragment.
 * Returns the institution ID and name.
 */
async function discoverInstitution(
  nameFragment: string
): Promise<ODataInstitution[]> {
  const params = new URLSearchParams({
    $format: "json",
    apikey: API_KEY,
    $filter: `substringof('${nameFragment}',Name)`,
    $top: "20",
  });

  const url = `${BASE_URL}/Institutions?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    console.error(`  Discovery failed for "${nameFragment}": HTTP ${resp.status}`);
    return [];
  }

  const data: ODataDiscoveryResponse = await resp.json();
  return data.value || [];
}

/**
 * Try to find a sender/receiver ID by searching for equivalencies
 * involving a known institution name.
 */
async function discoverIdViaEquivalencies(
  nameFragment: string,
  role: "source" | "target"
): Promise<{ id: number; name: string }[]> {
  const field =
    role === "source" ? "SourceInstitutionName" : "TargetInstitutionName";
  const idField =
    role === "source" ? "SourceInstitutionId" : "TargetInstitutionId";

  const params = new URLSearchParams({
    $format: "json",
    apikey: API_KEY,
    $filter: `substringof('${nameFragment}',${field})`,
    $top: "5",
    $select: `${idField},${field}`,
  });

  const url = `${BASE_URL}/Equivalencies?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) return [];

  const data = await resp.json();
  const results: { id: number; name: string }[] = [];
  const seen = new Set<number>();

  for (const eq of data.value || []) {
    const id = eq[idField] as number;
    const name = eq[field] as string;
    if (id && !seen.has(id)) {
      seen.add(id);
      results.push({ id, name });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Known PA CC sender IDs (CollegeTransfer.Net)
//
// These are discovered via the OData API. If an ID is 0, it means the
// institution was not found and needs manual discovery.
// Run with --discover to refresh these.
// ---------------------------------------------------------------------------

interface PaCollege {
  slug: string;
  name: string;
  senderId: number; // 0 = not yet discovered
  searchName: string; // fragment to search OData API
}

const PA_COLLEGES: PaCollege[] = [
  { slug: "bucks", name: "Bucks County Community College", senderId: 1, searchName: "Bucks County" },
  { slug: "butler", name: "Butler County Community College", senderId: 823, searchName: "Butler County Community" },
  { slug: "ccac", name: "Community College of Allegheny County", senderId: 414, searchName: "Allegheny County" },
  { slug: "ccbc", name: "Community College of Beaver County", senderId: 822, searchName: "Beaver County" },
  { slug: "ccp", name: "Community College of Philadelphia", senderId: 644, searchName: "Philadelphia" },
  { slug: "dccc", name: "Delaware County Community College", senderId: 621, searchName: "Delaware County Community" },
  { slug: "hacc", name: "Harrisburg Area Community College", senderId: 217, searchName: "Harrisburg Area" },
  { slug: "lccc", name: "Lehigh Carbon Community College", senderId: 838, searchName: "Lehigh Carbon" },
  { slug: "luzerne", name: "Luzerne County Community College", senderId: 629, searchName: "Luzerne County" },
  { slug: "mc3", name: "Montgomery County Community College", senderId: 9, searchName: "Montgomery County Community" },
  { slug: "northampton", name: "Northampton Community College", senderId: 635, searchName: "Northampton Community" },
  { slug: "pa-highlands", name: "Pennsylvania Highlands Community College", senderId: 891, searchName: "Pennsylvania Highlands" },
  { slug: "racc", name: "Reading Area Community College", senderId: 443, searchName: "Reading Area" },
  { slug: "westmoreland", name: "Westmoreland County Community College", senderId: 452, searchName: "Westmoreland" },
  { slug: "penn-college", name: "Pennsylvania College of Technology", senderId: 886, searchName: "Pennsylvania College of Technology" },
];

// ---------------------------------------------------------------------------
// Target universities (major PA 4-year institutions)
// ---------------------------------------------------------------------------

interface PaUniversity {
  slug: string;
  name: string;
  receiverId: number; // 0 = not yet discovered
  searchName: string;
}

// Pitt and Temple are not in CollegeTransfer.Net — Pitt uses TES (scrape-pitt-tes.ts).
const PA_UNIVERSITIES: PaUniversity[] = [
  { slug: "penn-state", name: "Penn State University", receiverId: 440, searchName: "Penn State" },
  { slug: "west-chester", name: "West Chester University", receiverId: 853, searchName: "West Chester" },
  { slug: "kutztown", name: "Kutztown University", receiverId: 219, searchName: "Kutztown University" },
  { slug: "millersville", name: "Millersville University", receiverId: 434, searchName: "Millersville University" },
  { slug: "commonwealth", name: "Commonwealth University of Pennsylvania", receiverId: 9250, searchName: "Commonwealth University" },
  { slug: "slippery-rock", name: "Slippery Rock University", receiverId: 447, searchName: "Slippery Rock" },
];

// ---------------------------------------------------------------------------
// Discovery mode
// ---------------------------------------------------------------------------

async function runDiscovery() {
  console.log("=== PA CollegeTransfer.Net ID Discovery ===\n");

  console.log("--- Community Colleges (Senders) ---\n");
  for (const cc of PA_COLLEGES) {
    const results = await discoverIdViaEquivalencies(cc.searchName, "source");
    if (results.length > 0) {
      console.log(`  ${cc.name}:`);
      for (const r of results) {
        console.log(`    ID ${r.id} — ${r.name}`);
      }
      // Auto-assign first match
      cc.senderId = results[0].id;
    } else {
      // Try institution endpoint as fallback
      const instResults = await discoverInstitution(cc.searchName);
      if (instResults.length > 0) {
        console.log(`  ${cc.name} (via Institutions):`);
        for (const r of instResults) {
          console.log(`    ID ${r.InstitutionId} — ${r.Name}`);
        }
        cc.senderId = instResults[0].InstitutionId;
      } else {
        console.log(`  ${cc.name}: NOT FOUND`);
      }
    }
    await sleep(300);
  }

  console.log("\n--- Universities (Receivers) ---\n");
  for (const univ of PA_UNIVERSITIES) {
    const results = await discoverIdViaEquivalencies(
      univ.searchName,
      "target"
    );
    if (results.length > 0) {
      console.log(`  ${univ.name}:`);
      for (const r of results) {
        console.log(`    ID ${r.id} — ${r.name}`);
      }
      univ.receiverId = results[0].id;
    } else {
      const instResults = await discoverInstitution(univ.searchName);
      if (instResults.length > 0) {
        console.log(`  ${univ.name} (via Institutions):`);
        for (const r of instResults) {
          console.log(`    ID ${r.InstitutionId} — ${r.Name}`);
        }
        univ.receiverId = instResults[0].InstitutionId;
      } else {
        console.log(`  ${univ.name}: NOT FOUND`);
      }
    }
    await sleep(300);
  }

  // Print summary
  console.log("\n=== Discovered IDs ===\n");
  console.log("Community Colleges:");
  for (const cc of PA_COLLEGES) {
    const status = cc.senderId > 0 ? `ID ${cc.senderId}` : "NOT FOUND";
    console.log(`  ${cc.slug}: ${status} (${cc.name})`);
  }
  console.log("\nUniversities:");
  for (const univ of PA_UNIVERSITIES) {
    const status =
      univ.receiverId > 0 ? `ID ${univ.receiverId}` : "NOT FOUND";
    console.log(`  ${univ.slug}: ${status} (${univ.name})`);
  }

  // Return discovered IDs for use in scraping
  return { colleges: PA_COLLEGES, universities: PA_UNIVERSITIES };
}

// ---------------------------------------------------------------------------
// Scrape mode
// ---------------------------------------------------------------------------

async function runScrape(skipImport: boolean) {
  console.log("CollegeTransfer.Net — Pennsylvania Transfer Scraper\n");

  const allKnown =
    PA_COLLEGES.every((cc) => cc.senderId > 0) &&
    PA_UNIVERSITIES.every((u) => u.receiverId > 0);

  let colleges = PA_COLLEGES;
  let universities = PA_UNIVERSITIES;

  if (allKnown) {
    console.log("All institution IDs are hardcoded — skipping discovery.\n");
  } else {
    console.log("Step 1: Discovering missing institution IDs...\n");
    ({ colleges, universities } = await runDiscovery());
  }

  // Filter to institutions that were found
  const validColleges = colleges.filter((cc) => cc.senderId > 0);
  const validUniversities = universities.filter((u) => u.receiverId > 0);

  if (validColleges.length === 0) {
    console.log(
      "\nNo PA community colleges found in the OData API. PA TRAC may use a different backend."
    );
    console.log(
      "Consider scraping collegetransfer.pa.gov directly (ASP.NET/DotNetNuke)."
    );
    process.exit(1);
  }

  if (validUniversities.length === 0) {
    console.log(
      "\nNo PA universities found in the OData API."
    );
    process.exit(1);
  }

  console.log(
    `\nStep 2: Scraping ${validColleges.length} colleges × ${validUniversities.length} universities...\n`
  );

  const allMappings: TransferMapping[] = [];
  let pairsScraped = 0;
  let pairsSkipped = 0;

  for (const cc of validColleges) {
    console.log(`\n${cc.name} (sender ID ${cc.senderId}):`);

    for (const univ of validUniversities) {
      const target: ScrapeOptions = {
        senderId: cc.senderId,
        receiverId: univ.receiverId,
        universitySlug: univ.slug,
        universityName: univ.name,
        state: "pa",
      };

      try {
        const mappings = await scrapeCollegeTransfer(target);
        if (mappings.length > 0) {
          // Tag each mapping with the source CC slug for PA's multi-college setup
          for (const m of mappings) {
            m.notes = m.notes
              ? `[${cc.slug}] ${m.notes}`
              : `[${cc.slug}]`;
          }
          allMappings.push(...mappings);
          pairsScraped++;
        } else {
          pairsSkipped++;
        }
      } catch (err) {
        console.error(
          `  Error scraping ${cc.slug} → ${univ.slug}: ${(err as Error).message}`
        );
        pairsSkipped++;
      }

      await sleep(1000);
    }
  }

  // Filter out no-transfer entries
  const transferable = allMappings.filter((m) => !m.no_credit);

  // Stats
  const byUniv = new Map<string, number>();
  for (const m of transferable) {
    byUniv.set(m.university_name, (byUniv.get(m.university_name) || 0) + 1);
  }

  console.log("\n=== Summary ===");
  console.log(`  Pairs scraped: ${pairsScraped}`);
  console.log(`  Pairs skipped/empty: ${pairsSkipped}`);
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

  if (transferable.length === 0) {
    console.log(
      "\nNo transferable mappings found. The OData API may not have PA data."
    );
    console.log(
      "Consider scraping collegetransfer.pa.gov directly."
    );
    process.exit(1);
  }

  // Spot checks
  const eng101 = transferable.find(
    (m) => m.cc_prefix === "ENG" && m.cc_number === "101"
  );
  if (eng101) {
    console.log(
      `\n  Spot check — ENG 101 → ${eng101.university_name}: ${eng101.univ_course} (${eng101.univ_title})`
    );
  }
  const psy101 = transferable.find(
    (m) => m.cc_prefix === "PSY" && m.cc_number === "101"
  );
  if (psy101) {
    console.log(
      `  Spot check — PSY 101 → ${psy101.university_name}: ${psy101.univ_course} (${psy101.univ_title})`
    );
  }

  // Write output
  const outPath = path.join(
    process.cwd(),
    "data",
    "pa",
    "transfer-equiv.json"
  );

  // Merge with existing data if present
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    if (existing.length > 0) {
      console.log(`\nLoaded ${existing.length} existing mappings`);
    }
  } catch {
    // No existing file — fresh start
  }

  // Replace entries for universities we just scraped, keep others
  const scrapedUnivSlugs = new Set(validUniversities.map((u) => u.slug));
  const preserved = existing.filter(
    (m) => !scrapedUnivSlugs.has(m.university)
  );
  const merged = [...preserved, ...transferable];

  console.log(
    `Merged: ${preserved.length} preserved + ${transferable.length} new = ${merged.length} total`
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Saved to ${outPath}`);

  // Import to Supabase
  if (!skipImport) {
    try {
      const imported = await importTransfersToSupabase("pa");
      if (imported > 0) {
        console.log(`Imported ${imported} rows to Supabase`);
      }
    } catch (err) {
      console.log(`Supabase import skipped: ${(err as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const discoverOnly = args.includes("--discover");
  const skipImport = args.includes("--no-import");

  if (discoverOnly) {
    await runDiscovery();
  } else {
    await runScrape(skipImport);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
