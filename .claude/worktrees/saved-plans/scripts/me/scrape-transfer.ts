/**
 * scrape-transfer.ts
 *
 * **Status: manual-only — removed from the scheduled-scrape cron matrix
 * in 2026-05.** Across the 4 MCCS colleges that fit under the
 * CollegeTransfer.Net free-tier quota in a single run, 1,649 raw
 * equivalencies target zero in-state institutions, so the in-state
 * rule strips everything to an empty array. The authoritative in-state
 * source is UMaine's MaineStreet Transfer Equivalency Guest portal
 * (`https://mainestreetcs.maine.edu/psp/CSPRDG/EMPLOYEE/SA/c/UM_SA.UM_TRNSFER_GUEST.GBL`)
 * — a PeopleSoft scraper for that is tracked separately. This script is
 * retained for manual use if the in-state rule is ever relaxed.
 *
 * Scrapes transfer equivalency data for Maine's 7 MCCS (Maine Community
 * College System) schools from CollegeTransfer.Net's public OData v2 API.
 *
 * ME has no state-run articulation system (no ARTSYS-equivalent). Each MCCS
 * college is registered individually in CollegeTransfer.Net; we page each
 * one's outgoing equivalencies and merge the results. SMCC alone has
 * ~1,750 equivalencies, so total across 7 sources is ~10k+ mappings.
 *
 * Pattern mirrors the DC scraper (also CollegeTransfer.Net-backed) but
 * loops across multiple source institutions. Each mapping is tagged with
 * its source CC slug via a `[slug]` prefix in the `notes` field, matching
 * the PA scraper's convention.
 *
 * Usage:
 *   npx tsx scripts/me/scrape-transfer.ts
 *   npx tsx scripts/me/scrape-transfer.ts --no-import    # skip Supabase
 */

import fs from "fs";
import path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import.js";
import { fetchInStateInstitutions } from "../lib/in-state-institutions.js";

// ---------------------------------------------------------------------------
// Types — match the shape in scripts/lib/scrape-collegetransfer.ts
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

interface ODataCourse {
  Prefix: string;
  Number: string;
  Title: string;
  Credits?: string;
}

interface ODataEquivalency {
  EquivalencyId: number;
  SourceInstitutionId: number;
  SourceInstitutionName: string;
  TargetInstitutionId: number;
  TargetInstitutionName: string;
  DoesNotTransfer: boolean;
  Notes: string | null;
  SourceCourses: ODataCourse[];
  TargetCourses: ODataCourse[];
}

interface ODataResponse {
  value: ODataEquivalency[];
  "odata.nextLink"?: string;
}

// ---------------------------------------------------------------------------
// Constants — MCCS colleges and their CollegeTransfer.Net institution IDs
// ---------------------------------------------------------------------------

const BASE_URL = "https://courseatlasservices.azurewebsites.net/odata/v2";
const API_KEY =
  process.env.COLLEGETRANSFER_API_KEY ||
  "bc923312-6f95-4340-8eed-c89bd576521c";
const PAGE_SIZE = 100;

interface MeCollege {
  slug: string;
  name: string;
  senderId: number;
}

// Discovered via `curl ...Institutions?$filter=substringof(<name>,Name) and State eq 'Maine'`
const ME_COLLEGES: MeCollege[] = [
  { slug: "cmcc", name: "Central Maine Community College", senderId: 1602 },
  { slug: "emcc", name: "Eastern Maine Community College", senderId: 1603 },
  { slug: "kvcc", name: "Kennebec Valley Community College", senderId: 1605 },
  { slug: "nmcc", name: "Northern Maine Community College", senderId: 1829 },
  { slug: "smcc", name: "Southern Maine Community College", senderId: 1331 },
  { slug: "wccc", name: "Washington County Community College", senderId: 1079 },
  { slug: "yccc", name: "York County Community College", senderId: 3657 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function isElectiveCourse(course: ODataCourse): boolean {
  const num = (course.Number || "").toUpperCase();
  const title = (course.Title || "").toLowerCase();
  if (/X{2,}$/.test(num)) return true;
  if (/^(elective|transfer\s+credit|general\s+elective)/.test(title)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Per-college scrape
// ---------------------------------------------------------------------------

async function scrapeCollege(
  cc: MeCollege,
  inStateIds: Set<number>,
): Promise<TransferMapping[]> {
  const mappings: TransferMapping[] = [];
  let skip = 0;
  let total = 0;
  let skippedCombos = 0;
  let skippedEmpty = 0;
  let skippedOutOfState = 0;

  while (true) {
    const params = new URLSearchParams({
      $format: "json",
      apikey: API_KEY,
      $filter: `SourceInstitutionId eq ${cc.senderId}`,
      $expand: "SourceCourses,TargetCourses",
      $top: String(PAGE_SIZE),
      $skip: String(skip),
    });

    const url = `${BASE_URL}/Equivalencies?${params}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(
        `[${cc.slug}] OData API HTTP ${resp.status}: ${resp.statusText}`
      );
    }

    const data: ODataResponse = await resp.json();
    const batch = data.value;
    if (batch.length === 0) break;
    total += batch.length;

    for (const eq of batch) {
      const sources = eq.SourceCourses || [];
      const targets = eq.TargetCourses || [];

      // In-state-only transfers (memory: feedback_in_state_transfers_only).
      if (!inStateIds.has(eq.TargetInstitutionId)) {
        skippedOutOfState++;
        continue;
      }

      // Skip combo courses (multiple source courses required together)
      if (sources.length > 1) {
        skippedCombos++;
        continue;
      }
      if (sources.length === 0 || targets.length === 0) {
        skippedEmpty++;
        continue;
      }

      const src = sources[0];
      const ccPrefix = src.Prefix?.trim() || "";
      const ccNumber = src.Number?.trim() || "";
      const ccTitle = src.Title?.trim() || "";
      if (!ccPrefix || !ccNumber) continue;

      const tgt = targets[0];
      const univCourse = `${tgt.Prefix} ${tgt.Number}`.trim();
      const univTitle = tgt.Title?.trim() || "";
      const univCredits = tgt.Credits?.trim() || "";

      const noCredit = eq.DoesNotTransfer === true;
      const isElective = !noCredit && isElectiveCourse(tgt);

      // Tag with source CC slug via notes prefix — matches PA scraper's
      // convention for multi-CC states so downstream filtering can tell
      // which community college the mapping originated from.
      const rawNotes = eq.Notes?.trim() || "";
      let notes = rawNotes ? `[${cc.slug}] ${rawNotes}` : `[${cc.slug}]`;
      if (targets.length > 1) {
        const additional = targets
          .slice(1)
          .map((t) => `${t.Prefix} ${t.Number}`)
          .join(", ");
        notes = `${notes}; Also awards: ${additional}`;
      }

      mappings.push({
        state: "me",
        cc_prefix: ccPrefix,
        cc_number: ccNumber,
        cc_course: `${ccPrefix} ${ccNumber}`,
        cc_title: ccTitle,
        cc_credits: src.Credits?.trim() || "",
        university: slugify(eq.TargetInstitutionName),
        university_name: eq.TargetInstitutionName,
        univ_course: univCourse,
        univ_title: univTitle,
        univ_credits: univCredits,
        notes,
        no_credit: noCredit,
        is_elective: isElective,
      });
    }

    if (batch.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    await sleep(200);
  }

  console.log(
    `  ${cc.slug.padEnd(5)} fetched=${total} mappings=${mappings.length} skipped-out-of-state=${skippedOutOfState} skipped-combos=${skippedCombos} skipped-empty=${skippedEmpty}`
  );
  return mappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const skipImport = args.includes("--no-import");

  console.log("CollegeTransfer.Net — Maine (MCCS) Transfer Scraper\n");

  console.log("Fetching in-state institution set (ME-only target filter)…");
  const { ids: inStateIds } = await fetchInStateInstitutions("Maine");
  console.log(`  ${inStateIds.size} ME institutions registered with CT.Net\n`);

  // Track which CCs succeeded this run so we can merge with existing
  // data for CCs that didn't. CollegeTransfer.Net free-tier rate-limits
  // after ~4-5 source institutions; the scraper should preserve data
  // from previously-successful runs for any CCs that hit 402 this time.
  const successfulSlugs = new Set<string>();
  const all: TransferMapping[] = [];
  for (const cc of ME_COLLEGES) {
    try {
      const mappings = await scrapeCollege(cc, inStateIds);
      all.push(...mappings);
      successfulSlugs.add(cc.slug);
    } catch (err) {
      console.error(`  ${cc.slug}: FAILED — ${(err as Error).message}`);
    }
  }

  const transferable = all.filter((m) => !m.no_credit);
  const direct = transferable.filter((m) => !m.is_elective).length;
  const elective = transferable.filter((m) => m.is_elective).length;

  const byUniv = new Map<string, number>();
  for (const m of transferable) {
    byUniv.set(m.university_name, (byUniv.get(m.university_name) || 0) + 1);
  }
  const topUnivs = Array.from(byUniv.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  console.log("\n=== Summary ===");
  console.log(`  Total mappings: ${all.length}`);
  console.log(`  Transferable: ${transferable.length}`);
  console.log(`    Direct equivalencies: ${direct}`);
  console.log(`    Elective credit: ${elective}`);
  console.log(`  No transfer: ${all.filter((m) => m.no_credit).length}`);
  console.log(`  Unique target universities: ${byUniv.size}`);
  console.log("\n  Top targets:");
  for (const [univ, count] of topUnivs) {
    console.log(`    ${univ}: ${count}`);
  }

  // Per-source breakdown
  const bySource = new Map<string, number>();
  for (const m of all) {
    const slug = m.notes.match(/^\[(\w+)\]/)?.[1] || "?";
    bySource.set(slug, (bySource.get(slug) || 0) + 1);
  }
  console.log("\n  Per-source counts:");
  for (const [slug, count] of bySource) {
    console.log(`    ${slug}: ${count}`);
  }

  if (successfulSlugs.size === 0) {
    console.warn(
      "\n  WARN: no colleges scraped successfully (likely API quota exhausted). " +
        "Leaving existing data/me/transfer-equiv.json untouched; cron will retry next run."
    );
    return;
  }

  // Per-source merge: for any MCCS college that didn't succeed this run,
  // preserve its rows from the existing file. CollegeTransfer.Net rate-
  // limits after ~4-5 source institutions on the free tier, so partial
  // runs are expected — this keeps previously-scraped colleges' data
  // intact across retries.
  const outPath = path.join(
    process.cwd(),
    "data",
    "me",
    "transfer-equiv.json"
  );
  let preserved: TransferMapping[] = [];
  try {
    const existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    if (Array.isArray(existing)) {
      preserved = (existing as TransferMapping[]).filter((m) => {
        const slug = m.notes.match(/^\[(\w+)\]/)?.[1];
        return slug && !successfulSlugs.has(slug);
      });
    }
  } catch {
    // No existing file — fresh start.
  }

  const merged = [...preserved, ...all];
  const preservedSlugs = new Set(
    preserved.map((m) => m.notes.match(/^\[(\w+)\]/)?.[1]).filter(Boolean)
  );
  console.log(
    `\n  Merged: ${preserved.length} preserved (from ${preservedSlugs.size} prior CC${preservedSlugs.size === 1 ? "" : "s"}) + ${all.length} new = ${merged.length} total`
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Saved ${merged.length} mappings → ${outPath}`);

  // Import to Supabase
  if (!skipImport) {
    try {
      const imported = await importTransfersToSupabase("me");
      if (imported > 0) {
        console.log(`Imported ${imported} rows to Supabase`);
      }
    } catch (err) {
      console.log(`Supabase import skipped: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
