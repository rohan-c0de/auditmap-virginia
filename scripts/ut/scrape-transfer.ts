/**
 * scrape-transfer.ts
 *
 * Scrapes transfer equivalency data for Utah's community and technical
 * colleges from the CourseAtlas OData v2 API — the same backend that
 * powers utahtransferguide.com (operated by USHE / CollegeTransfer.Net).
 *
 * Senders: 10 UT CCs / technical colleges
 * Receivers: 7 UT public 4-years
 *
 * Institution IDs verified 2026-05-31 via
 *   GET /odata/v2/Institutions?$filter=State eq 'Utah'&$format=json
 *
 * URL construction note: URLSearchParams encodes $ as %24 which this OData
 * server does not accept (returns HTTP 402). All OData params are built
 * as raw string concatenation. See also the in-state-institutions helper
 * which has the same bug — we avoid calling it and hardcode receiver IDs.
 *
 * Pagination note: filtering by SourceInstitutionId alone returns all
 * 50-state equivalencies (~thousands for SLCC), and the free API key
 * returns HTTP 402 after ~200 records. We include TargetInstitutionId
 * in the OData filter to keep each request scoped to UT 4-years only.
 *
 * Usage:
 *   npx tsx scripts/ut/scrape-transfer.ts
 *   npx tsx scripts/ut/scrape-transfer.ts --no-import
 *   npx tsx scripts/ut/scrape-transfer.ts --cc=slcc
 */

import fs from "fs";
import path from "path";
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
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://courseatlasservices.azurewebsites.net/odata/v2";
const API_KEY =
  process.env.COLLEGETRANSFER_API_KEY ||
  "bc923312-6f95-4340-8eed-c89bd576521c";
const PAGE_SIZE = 100;
const STATE = "ut";

interface UtCollege {
  slug: string;
  name: string;
  senderId: number;
}

const UT_COLLEGES: UtCollege[] = [
  { slug: "slcc", name: "Salt Lake Community College", senderId: 2094 },
  { slug: "snow", name: "Snow College", senderId: 3076 },
  { slug: "ceu", name: "Utah State University-College of Eastern Utah", senderId: 2091 },
  { slug: "bridgerland", name: "Bridgerland Technical College", senderId: 3720 },
  { slug: "mountainland", name: "Mountainland Technical College", senderId: 7542 },
  { slug: "ogden-weber", name: "Ogden-Weber Technical College", senderId: 2735 },
  { slug: "davis-tech", name: "Davis Technical College", senderId: 5753 },
  { slug: "dixie-tech", name: "Dixie Technical College", senderId: 7834 },
  { slug: "uintah-basin", name: "Uintah Basin Technical College", senderId: 2736 },
  { slug: "tooele-tech", name: "Tooele Technical College", senderId: 8945 },
];

// TargetInstitutionId values for UT public 4-years
const UT_RECEIVER_IDS = new Set([
  2737, // University of Utah
  2368, // Utah State University
  3077, // Utah Valley University
  2369, // Weber State University
  2093, // Southern Utah University
  2734, // Utah Tech University
  3075, // Ensign College
]);

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
  cc: UtCollege,
): Promise<TransferMapping[]> {
  const mappings: TransferMapping[] = [];
  let skip = 0;
  let total = 0;

  // Build receiver filter for OData query (include all UT 4-year IDs)
  const receiverFilter = Array.from(UT_RECEIVER_IDS)
    .map((id) => `TargetInstitutionId+eq+${id}`)
    .join("+or+");

  while (true) {
    const url =
      `${BASE_URL}/Equivalencies` +
      `?$format=json` +
      `&apikey=${encodeURIComponent(API_KEY)}` +
      `&$filter=SourceInstitutionId+eq+${cc.senderId}+and+(${receiverFilter})` +
      `&$expand=SourceCourses,TargetCourses` +
      `&$top=${PAGE_SIZE}` +
      `&$skip=${skip}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(
        `[${cc.slug}] OData API HTTP ${resp.status}: ${resp.statusText}`,
      );
    }

    const data: ODataResponse = await resp.json();
    const batch = data.value;
    if (batch.length === 0) break;
    total += batch.length;

    for (const eq of batch) {
      const sources = eq.SourceCourses || [];
      const targets = eq.TargetCourses || [];

      if (sources.length !== 1 || targets.length === 0) continue;

      const src = sources[0];
      const ccPrefix = src.Prefix?.trim() || "";
      const ccNumber = src.Number?.trim() || "";
      if (!ccPrefix || !ccNumber) continue;

      const tgt = targets[0];
      const univCourse = `${tgt.Prefix} ${tgt.Number}`.trim();
      const noCredit = eq.DoesNotTransfer === true;
      const isElective = !noCredit && isElectiveCourse(tgt);

      const rawNotes = eq.Notes?.trim() || "";
      let notes = rawNotes ? `[${cc.slug}] ${rawNotes}` : `[${cc.slug}]`;
      if (targets.length > 1) {
        const extra = targets
          .slice(1)
          .map((t) => `${t.Prefix} ${t.Number}`)
          .join(", ");
        notes = `${notes}; Also awards: ${extra}`;
      }

      mappings.push({
        state: STATE,
        cc_prefix: ccPrefix,
        cc_number: ccNumber,
        cc_course: `${ccPrefix} ${ccNumber}`,
        cc_title: src.Title?.trim() || "",
        cc_credits: src.Credits?.trim() || "",
        university: slugify(eq.TargetInstitutionName),
        university_name: eq.TargetInstitutionName,
        univ_course: univCourse,
        univ_title: tgt.Title?.trim() || "",
        univ_credits: tgt.Credits?.trim() || "",
        notes,
        no_credit: noCredit,
        is_elective: isElective,
      });
    }

    if (batch.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    await sleep(300);
  }

  console.log(`  ${cc.name}: ${total} raw → ${mappings.length} in-state`);
  return mappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");
  const ccFilter = args.find((a) => a.startsWith("--cc="))?.split("=")[1];

  const colleges = ccFilter
    ? UT_COLLEGES.filter(
        (c) =>
          c.slug === ccFilter ||
          c.name.toLowerCase().includes(ccFilter.toLowerCase()),
      )
    : UT_COLLEGES;

  if (colleges.length === 0) {
    console.error(`Unknown CC: ${ccFilter}`);
    process.exit(1);
  }

  console.log(`UT Transfer Scraper — CourseAtlas / Utah Transfer Guide`);
  console.log(`Scraping ${colleges.length} college(s)...\n`);

  const allMappings: TransferMapping[] = [];
  for (const cc of colleges) {
    try {
      const m = await scrapeCollege(cc);
      allMappings.push(...m);
    } catch (err) {
      console.error(`  ERROR scraping ${cc.name}: ${(err as Error).message}`);
    }
    await sleep(500);
  }

  const seen = new Set<string>();
  const deduped = allMappings.filter((m) => {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const direct = deduped.filter((m) => !m.no_credit && !m.is_elective).length;
  const elective = deduped.filter((m) => m.is_elective).length;
  const noCredit = deduped.filter((m) => m.no_credit).length;

  console.log(`\nTotal: ${allMappings.length} raw → ${deduped.length} after dedup`);
  console.log(`  Direct: ${direct}  Elective: ${elective}  No-credit: ${noCredit}`);

  if (deduped.length === 0) {
    console.error("WARNING: zero mappings. Not writing file.");
    process.exit(1);
  }

  const outPath = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2) + "\n");
  console.log(`\nWrote ${deduped.length} mappings → ${outPath}`);

  if (!noImport) {
    try {
      await importTransfersToSupabase(STATE);
    } catch (err) {
      console.log(`Supabase import skipped: ${(err as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
