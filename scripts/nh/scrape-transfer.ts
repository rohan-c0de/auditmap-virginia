/**
 * scrape-transfer.ts
 *
 * Scrapes transfer equivalency data for the 7 CCSNH (Community College
 * System of New Hampshire) colleges from CollegeTransfer.Net's public
 * OData v2 API.
 *
 * Pattern mirrors scripts/me/scrape-transfer.ts — each CCSNH college is
 * registered individually in CollegeTransfer.Net; we page each one's
 * outgoing equivalencies and merge. Mappings are tagged with the source
 * CC slug via a `[slug]` prefix in the `notes` field.
 *
 * Discovered sender IDs via:
 *   curl ".../Institutions?$filter=State eq 'New Hampshire'"
 *
 * NHTI alone has ~1,570 equivalencies, total across 7 ≈ 4,800 mappings.
 * CollegeTransfer.Net free-tier rate-limits after ~4–5 source institutions,
 * so partial runs are expected — the scraper merges with existing data.
 *
 * Usage:
 *   npx tsx scripts/nh/scrape-transfer.ts
 *   npx tsx scripts/nh/scrape-transfer.ts --no-import    # skip Supabase
 */

import fs from "fs";
import path from "path";
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

const BASE_URL = "https://courseatlasservices.azurewebsites.net/odata/v2";
const API_KEY =
  process.env.COLLEGETRANSFER_API_KEY ||
  "bc923312-6f95-4340-8eed-c89bd576521c";
const PAGE_SIZE = 100;

interface NhCollege {
  slug: string;
  name: string;
  senderId: number;
}

// Discovered via: Institutions?$filter=State eq 'New Hampshire'
const NH_COLLEGES: NhCollege[] = [
  { slug: "gbcc", name: "Great Bay Community College", senderId: 4267 },
  { slug: "lrcc", name: "Lakes Region Community College", senderId: 4349 },
  { slug: "mccnh", name: "Manchester Community College - New Hampshire", senderId: 2189 },
  { slug: "nhti", name: "NHTI-Concord's Community College", senderId: 2187 },
  { slug: "nashuacc", name: "Nashua Community College", senderId: 2912 },
  { slug: "rvcc", name: "River Valley Community College", senderId: 5237 },
  { slug: "wmcc", name: "White Mountains Community College", senderId: 2188 },
];

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

async function scrapeCollege(cc: NhCollege): Promise<TransferMapping[]> {
  const mappings: TransferMapping[] = [];
  let skip = 0;
  let total = 0;
  let skippedCombos = 0;
  let skippedEmpty = 0;

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
        state: "nh",
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
    `  ${cc.slug.padEnd(9)} fetched=${total} mappings=${mappings.length} skipped-combos=${skippedCombos} skipped-empty=${skippedEmpty}`
  );
  return mappings;
}

async function main() {
  const args = process.argv.slice(2);
  const skipImport = args.includes("--no-import");

  console.log("CollegeTransfer.Net — New Hampshire (CCSNH) Transfer Scraper\n");

  const successfulSlugs = new Set<string>();
  const all: TransferMapping[] = [];
  for (const cc of NH_COLLEGES) {
    try {
      const mappings = await scrapeCollege(cc);
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
        "Leaving existing data/nh/transfer-equiv.json untouched; cron will retry next run."
    );
    return;
  }

  const outPath = path.join(process.cwd(), "data", "nh", "transfer-equiv.json");
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

  if (!skipImport) {
    try {
      const imported = await importTransfersToSupabase("nh");
      if (imported > 0) {
        console.log(`Imported ${imported} rows to Supabase`);
      }
    } catch (err) {
      console.error(`Supabase import failed: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
