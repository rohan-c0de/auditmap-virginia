/**
 * scrape-ctnet-multisource.ts
 *
 * Shared engine for states whose community-college → in-state-university
 * transfer equivalencies live in CollegeTransfer.Net's public OData v2 API.
 *
 * This generalizes the per-state scrapers (scripts/nh/scrape-transfer.ts,
 * scripts/me/scrape-transfer.ts, scripts/dc/scrape-transfer.ts) that were all
 * copies of the same logic: page each sending college's outgoing
 * equivalencies, keep only those whose target is an in-state institution
 * (feedback memory: transfer data must be in-state only), and merge into
 * data/{slug}/transfer-equiv.json with a preserve guard so a partial run
 * (CollegeTransfer.Net free-tier rate-limits after a few source institutions)
 * never clobbers previously-scraped colleges.
 *
 * Each row is tagged with the source CC slug via a `[slug]` prefix in `notes`,
 * matching the convention the NH/ME scrapers use so per-receiver scrapers can
 * coexist.
 *
 * Usage (from a thin per-state entry script):
 *   import { scrapeCtnetState } from "../lib/scrape-ctnet-multisource.js";
 *   await scrapeCtnetState({
 *     stateName: "Wyoming",          // CT.Net's spelling of the state
 *     slug: "wy",
 *     colleges: [{ slug, name, senderId }, ...],
 *     skipImport,                    // pass process.argv.includes("--no-import")
 *   });
 */

import fs from "fs";
import path from "path";
import { importTransfersToSupabase } from "./supabase-import.js";
import { fetchInStateInstitutions } from "./in-state-institutions.js";

export interface CtnetCollege {
  /** Our internal college slug (matches data/{slug}/institutions.json). */
  slug: string;
  /** Display name (for logging only). */
  name: string;
  /** CollegeTransfer.Net SourceInstitutionId. */
  senderId: number;
}

export interface TransferMapping {
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
}

const BASE_URL = "https://courseatlasservices.azurewebsites.net/odata/v2";
const API_KEY =
  process.env.COLLEGETRANSFER_API_KEY ||
  "bc923312-6f95-4340-8eed-c89bd576521c";
const PAGE_SIZE = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Strip control characters (NUL bytes etc.) and collapse whitespace.
 * CT.Net serves some titles from fixed-width source systems padded with
 * `\x00` bytes (e.g. "INTRO COMP SCI II \x00\x00…"). Postgres `text` cannot
 * store NUL, so the import aborts with "unsupported Unicode escape sequence"
 * unless we clean every string field at scrape time.
 */
function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\s+/g, " ").trim();
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
  // Wildcard course numbers (e.g. "1XX", "A1H") signal a non-specific award.
  if (/X{2,}$/.test(num)) return true;
  // Title language that marks elective / catch-all credit rather than a
  // specific course equivalent. Match anywhere, not just at the start —
  // CT.Net targets like "Departmental Elective" and "Gen Ed Rqmt: Humanities"
  // are elective awards, not direct equivalencies.
  if (/\b(elective|general\s+education|gen\s+ed|departmental)\b/.test(title)) return true;
  if (/^transfer\s+credit/.test(title)) return true;
  return false;
}

async function scrapeCollege(
  cc: CtnetCollege,
  slug: string,
  inStateIds: Set<number>,
): Promise<TransferMapping[]> {
  const mappings: TransferMapping[] = [];
  let skip = 0;
  let total = 0;
  let skippedCombos = 0;
  let skippedEmpty = 0;
  let skippedOutOfState = 0;
  let skippedSelf = 0;

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
    let resp: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      resp = await fetch(url);
      if (resp.status === 402 || resp.status === 429) {
        const wait = (attempt + 1) * 5000;
        console.log(`    [${cc.slug}] rate-limited (${resp.status}), retry in ${wait / 1000}s…`);
        await sleep(wait);
        continue;
      }
      break;
    }
    if (!resp!.ok) {
      throw new Error(`[${cc.slug}] OData API HTTP ${resp!.status}: ${resp!.statusText}`);
    }

    const data: ODataResponse = await resp!.json();
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
      // Drop self-referential rows (a college "transferring" to itself).
      if (eq.SourceInstitutionId === eq.TargetInstitutionId) {
        skippedSelf++;
        continue;
      }
      if (sources.length > 1) {
        skippedCombos++;
        continue;
      }
      if (sources.length === 0 || targets.length === 0) {
        skippedEmpty++;
        continue;
      }

      const src = sources[0];
      const ccPrefix = clean(src.Prefix || "");
      const ccNumber = clean(src.Number || "");
      const ccTitle = clean(src.Title || "");
      if (!ccPrefix || !ccNumber) continue;

      const tgt = targets[0];
      const tgtPrefix = clean(tgt.Prefix || "");
      const tgtNumber = clean(tgt.Number || "");
      const univTitleRaw = clean(tgt.Title || "");
      const univCredits = clean(tgt.Credits || "");

      // CT.Net stores many rows with a placeholder target — an empty/null
      // prefix+number (renders as "null null"), an "NA" course, or a "Not
      // Applicable" title. These are absence-of-mapping, not real
      // equivalencies, and are usually stale numeric-coded duplicates of a
      // current letter-coded row (e.g. Casper "42 101 General Biology" → null
      // alongside "BIOL 1010 General Biology I" → "BIOL 141"). Skip them so we
      // never surface empty/duplicative entries. Genuine "does not transfer"
      // is signalled separately by DoesNotTransfer and is kept below.
      const placeholderTarget =
        !tgtPrefix ||
        !tgtNumber ||
        /^n\/?a$/i.test(tgtPrefix) ||
        /^not\s+applicable$/i.test(univTitleRaw);
      if (placeholderTarget && eq.DoesNotTransfer !== true) {
        skippedEmpty++;
        continue;
      }
      const noCredit = eq.DoesNotTransfer === true;
      const isElective = !noCredit && isElectiveCourse(tgt);
      const univCourse = `${tgtPrefix} ${tgtNumber}`.trim();
      const univTitle = univTitleRaw;

      const rawNotes = clean(eq.Notes || "");
      let notes = rawNotes ? `[${cc.slug}] ${rawNotes}` : `[${cc.slug}]`;
      if (targets.length > 1) {
        const additional = targets
          .slice(1)
          .map((t) => `${t.Prefix} ${t.Number}`)
          .join(", ");
        notes = `${notes}; Also awards: ${additional}`;
      }

      mappings.push({
        state: slug,
        cc_prefix: ccPrefix,
        cc_number: ccNumber,
        cc_course: `${ccPrefix} ${ccNumber}`,
        cc_title: ccTitle,
        cc_credits: clean(src.Credits || ""),
        university: slugify(eq.TargetInstitutionName),
        university_name: clean(eq.TargetInstitutionName),
        univ_course: noCredit ? "" : univCourse,
        univ_title: noCredit ? "Does not transfer" : univTitle,
        univ_credits: noCredit ? "" : univCredits,
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
    `  ${cc.slug.padEnd(40)} fetched=${total} kept=${mappings.length} oos=${skippedOutOfState} self=${skippedSelf} combos=${skippedCombos} empty=${skippedEmpty}`,
  );
  return mappings;
}

export interface ScrapeCtnetStateOptions {
  stateName: string;
  slug: string;
  colleges: CtnetCollege[];
  skipImport?: boolean;
}

export async function scrapeCtnetState(
  opts: ScrapeCtnetStateOptions,
): Promise<void> {
  const { stateName, slug, colleges, skipImport = false } = opts;

  console.log(`CollegeTransfer.Net — ${stateName} (${slug}) Transfer Scraper\n`);
  console.log(`Fetching in-state institution set (${stateName}-only target filter)…`);
  const { ids: inStateIds } = await fetchInStateInstitutions(stateName);
  console.log(`  ${inStateIds.size} ${stateName} institutions registered with CT.Net\n`);

  const successfulSlugs = new Set<string>();
  const all: TransferMapping[] = [];
  for (const cc of colleges) {
    try {
      const mappings = await scrapeCollege(cc, slug, inStateIds);
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
    .slice(0, 12);

  console.log("\n=== Summary ===");
  console.log(`  Total mappings: ${all.length}`);
  console.log(`  Transferable: ${transferable.length} (direct=${direct}, elective=${elective})`);
  console.log(`  No transfer: ${all.filter((m) => m.no_credit).length}`);
  console.log(`  Unique target institutions: ${byUniv.size}`);
  console.log("  Top targets:");
  for (const [univ, count] of topUnivs) console.log(`    ${univ}: ${count}`);

  if (successfulSlugs.size === 0) {
    console.warn(
      `\n  WARN: no colleges scraped successfully (likely API quota exhausted). ` +
        `Leaving existing data/${slug}/transfer-equiv.json untouched; cron will retry next run.`,
    );
    return;
  }

  const outPath = path.join(process.cwd(), "data", slug, "transfer-equiv.json");
  let preserved: TransferMapping[] = [];
  // Drop only rows we just refreshed: same sending CC slug AND same receiving
  // university. Mirrors scripts/nh/scrape-transfer.ts merge semantics so a
  // partial run preserves colleges that weren't re-scraped this time.
  const ourUniversities = new Set(all.map((m) => m.university));
  try {
    const existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    if (Array.isArray(existing)) {
      preserved = (existing as TransferMapping[]).filter((m) => {
        const sl = m.notes.match(/^\[([\w-]+)\]/)?.[1];
        const ownedByThisRun =
          sl !== undefined && successfulSlugs.has(sl) && ourUniversities.has(m.university);
        return !ownedByThisRun;
      });
    }
  } catch {
    // No existing file — fresh start.
  }

  const merged = [...preserved, ...all];
  console.log(`\n  Merged: ${preserved.length} preserved + ${all.length} new = ${merged.length} total`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Saved ${merged.length} mappings → ${outPath}`);

  if (!skipImport) {
    try {
      const imported = await importTransfersToSupabase(slug);
      if (imported > 0) console.log(`Imported ${imported} rows to Supabase`);
    } catch (err) {
      console.error(`Supabase import failed: ${(err as Error).message}`);
    }
  }
}
