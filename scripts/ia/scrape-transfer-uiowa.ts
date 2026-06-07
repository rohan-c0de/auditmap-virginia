/**
 * scrape-transfer-uiowa.ts — Iowa transfer equivalencies (IA CCs → University of Iowa).
 *
 * U Iowa's MyUI transfer-equivalency search is a public, no-login server-rendered
 * page; the search binds to GET query params (bypassing the Stripes CSRF form):
 *   GET https://myui.uiowa.edu/my-ui/courses/transfer-sisearch.page
 *       ?institution=<IPEDS>&college=A&genEdCategories=*&doSearch=Search
 * Returns an HTML results table: [Transfer Course | Title | UI Equivalent | …].
 * `college=A` (CLAS) is required but doesn't change the course mappings.
 * In-state senders only. Companion to scrape-transfer-transit.ts (Iowa State).
 *
 * Usage: npx tsx scripts/ia/scrape-transfer-uiowa.ts [--no-import]
 */

import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { importTransfersToSupabase } from "../lib/supabase-import.js";
import { mergeTransferRows } from "../lib/transfer-merge.js";

interface TransferMapping {
  state: string; cc_prefix: string; cc_number: string; cc_course: string;
  cc_title: string; cc_credits: string; university: string; university_name: string;
  univ_course: string; univ_title: string; univ_credits: string; notes: string;
  no_credit: boolean; is_elective: boolean;
}

const BASE = "https://myui.uiowa.edu/my-ui/courses/transfer-sisearch.page";
const UA = "Mozilla/5.0 (compatible; cc-coursemap)";
const UNIV_SLUG = "university-of-iowa";
const UNIV_NAME = "University of Iowa";

// IPEDS UNITID → our college_slug (verified live; Iowa CCs only). Marshalltown +
// Ellsworth sit under the "Iowa Valley" district in MyUI (no per-campus id), so
// they're covered by ISU/UNI rather than here.
const IPEDS: Record<string, string> = {
  "153737": "kirkwood-community-college",
  "153214": "des-moines-area-community-college",
  "153311": "eastern-iowa-community-college-district", // Scott member id; our district slug
  "153445": "hawkeye-community-college",
  "153472": "indian-hills-community-college",
  "153524": "iowa-central-community-college",
  "153533": "iowa-lakes-community-college",
  "153630": "iowa-western-community-college",
  "154059": "north-iowa-area-community-college",
  "154110": "northeast-iowa-community-college",
  "154129": "northwest-iowa-community-college",
  "154378": "southeastern-community-college",
  "154396": "southwestern-community-college",
  "154572": "western-iowa-tech-community-college",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: string) =>
  s.replace(/&nbsp;/gi, " ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\s+/g, " ").trim();

/** Pull a "SUBJ:NNNN" UI course code out of the equivalent cell, if present. */
function uiCode(text: string): string {
  const m = text.match(/\b([A-Z]{2,5}):(\d{3,4}[A-Z]?)\b/);
  return m ? `${m[1]} ${m[2]}` : "";
}

async function scrapeCollege(ipeds: string, slug: string): Promise<TransferMapping[]> {
  const url = `${BASE}?institution=${ipeds}&college=A&genEdCategories=*&doSearch=Search`;
  let html = "";
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.status === 429 || r.status >= 500) { await sleep((i + 1) * 2000); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    html = await r.text();
    break;
  }
  const $ = cheerio.load(html);
  const out: TransferMapping[] = [];
  const seen = new Set<string>();
  $("table tr").each((_, tr) => {
    const cells = $(tr).find("td").map((__, td) => clean($(td).text())).get();
    if (cells.length < 3) return;
    const sending = cells[0];
    const title = cells[1];
    const equiv = cells[2];
    const sm = sending.match(/^([A-Za-z]+)\s*:?\s*([0-9][0-9A-Za-z]*)$/);
    if (!sm) return;
    const ccPrefix = sm[1].toUpperCase();
    const ccNumber = sm[2];
    const code = uiCode(equiv);
    const noCredit = /does not transfer|no credit|not accepted/i.test(equiv);
    const isElective = !noCredit && !code; // "Transfer Elective" / "Career and Tech credit"
    const mapping: TransferMapping = {
      state: "ia", cc_prefix: ccPrefix, cc_number: ccNumber,
      cc_course: `${ccPrefix} ${ccNumber}`, cc_title: title, cc_credits: "",
      university: UNIV_SLUG, university_name: UNIV_NAME,
      univ_course: noCredit ? "" : code,
      univ_title: noCredit ? "Does not transfer" : isElective ? equiv : "",
      univ_credits: "", notes: `[${slug}]`, no_credit: noCredit, is_elective: isElective,
    };
    const key = `${mapping.cc_course}|${mapping.univ_course}|${mapping.univ_title}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(mapping);
  });
  return out;
}

async function main() {
  const skipImport = process.argv.includes("--no-import");
  console.log("U Iowa MyUI transfer search — Iowa (IA CCs → University of Iowa)\n");

  const all: TransferMapping[] = [];
  let ok = 0;
  for (const [ipeds, slug] of Object.entries(IPEDS)) {
    try {
      const rows = await scrapeCollege(ipeds, slug);
      all.push(...rows);
      if (rows.length) ok++;
      console.log(`  ${slug.padEnd(42)} ${rows.length} rows`);
    } catch (e) {
      console.error(`  ${slug}: FAILED — ${(e as Error).message}`);
    }
    await sleep(200);
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Colleges with data: ${ok}/${Object.keys(IPEDS).length}`);
  console.log(`  Mappings: ${all.length} (direct=${all.filter((m) => !m.is_elective && !m.no_credit).length}, elective=${all.filter((m) => m.is_elective).length}, no-credit=${all.filter((m) => m.no_credit).length})`);
  if (all.length === 0) { console.warn("  WARN: nothing scraped; leaving data untouched."); return; }

  const outPath = path.join(process.cwd(), "data", "ia", "transfer-equiv.json");
  const merged = mergeTransferRows("ia", all, { log: (m) => console.log(`  ${m}`) });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nSaved ${merged.length} mappings → ${outPath}`);

  if (!skipImport) {
    try { const n = await importTransfersToSupabase("ia"); if (n > 0) console.log(`Imported ${n} rows`); }
    catch (e) { console.error(`Import failed: ${(e as Error).message}`); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
