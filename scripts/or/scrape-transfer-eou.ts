/**
 * scrape-transfer-eou.ts — Oregon transfer equivalencies (OR CCs → Eastern Oregon University).
 *
 * EOU publishes a public Banner Extensibility transfer-equivalency report (no
 * login): one GET per sending school returns its full equivalency table:
 *   https://ssb-prod.eou.elluciancloud.com/PROD/ztransferequivalency.P_search?a_sbgi=<FICE>
 * Table `eouDisplayTable`, rows id="D<FICE><CRSE>"; non-empty cells in order:
 *   [sending code, sending title (N Credits), EOU code, EOU title, gen-ed].
 * EOU codes ending -LDT/-UDT/-000 (or "LDVT-LDT") = lower/upper-div elective.
 * In-state senders only (hardcoded FICE→slug). Companion to scrape-transfer-osu.ts
 * (Oregon State); mergeTransferRows keeps them conflict-free.
 *
 * Usage: npx tsx scripts/or/scrape-transfer-eou.ts [--no-import]
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

const BASE = "https://ssb-prod.eou.elluciancloud.com/PROD/ztransferequivalency.P_search";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UNIV_SLUG = "eastern-oregon-university";
const UNIV_NAME = "Eastern Oregon University";

// Oregon community colleges → EOU's a_sbgi (FICE) code. In-state only.
const FICE: Record<string, string> = {
  "blue-mountain-community-college": "003186",
  "central-oregon-community-college": "003188",
  "chemeketa-community-college": "003218",
  "clackamas-community-college": "004878",
  "clatsop-community-college": "003189",
  "columbia-gorge-community-college": "041519",
  "klamath-community-college": "034283",
  "lane-community-college": "003196",
  "linn-benton-community-college": "006938",
  "mt-hood-community-college": "003204",
  "portland-community-college": "003213",
  "rogue-community-college": "010182",
  "southwestern-oregon-community-college": "003220",
  "tillamook-bay-community-college": "666647",
  "treasure-valley-community-college": "003221",
  "umpqua-community-college": "003222",
  "oregon-coast-community-college": "042837",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: string) =>
  s.replace(/&nbsp;/gi, " ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\s+/g, " ").trim();

function splitCode(code: string): { prefix: string; number: string } {
  const m = clean(code).match(/^([A-Za-z]+)[\s-]*([0-9][0-9A-Za-z]*)$/);
  if (m) return { prefix: m[1].toUpperCase(), number: m[2] };
  return { prefix: clean(code).toUpperCase(), number: "" };
}

function isElective(eouCode: string, eouTitle: string): boolean {
  if (/-(LDT|UDT)$|LDVT|UDVT|-000$|X{2,}/i.test(eouCode)) return true;
  if (/\b(elective|lower.div|upper.div|undistributed)\b/i.test(eouTitle)) return true;
  return false;
}

async function scrapeCollege(slug: string, fice: string): Promise<TransferMapping[]> {
  let html = "";
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${BASE}?a_sbgi=${fice}`, { headers: { "User-Agent": UA } });
    if (r.status === 429 || r.status >= 500) { await sleep((i + 1) * 2000); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    html = await r.text();
    break;
  }
  const $ = cheerio.load(html);
  const out: TransferMapping[] = [];
  const seen = new Set<string>();
  $("table.eouDisplayTable tr").each((_, tr) => {
    const cells = $(tr).find("td").map((__, td) => clean($(td).text())).get().filter((c) => c);
    if (cells.length < 4) return;
    const [sendCode, sendTitleRaw, eouCode, eouTitle] = cells;
    const { prefix, number } = splitCode(sendCode);
    if (!prefix || !number) return;
    if (!eouCode) return;
    const credMatch = sendTitleRaw.match(/\((\d+(?:\.\d+)?)\s*Credits?\)/i);
    const sendTitle = clean(sendTitleRaw.replace(/\(\d+(?:\.\d+)?\s*Credits?\)/i, ""));
    const mapping: TransferMapping = {
      state: "or", cc_prefix: prefix, cc_number: number,
      cc_course: `${prefix} ${number}`, cc_title: sendTitle,
      cc_credits: credMatch ? credMatch[1] : "",
      university: UNIV_SLUG, university_name: UNIV_NAME,
      univ_course: eouCode.replace(/\s+/g, " "), univ_title: eouTitle || "",
      univ_credits: "", notes: `[${slug}]`, no_credit: false,
      is_elective: isElective(eouCode, eouTitle || ""),
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
  console.log("Eastern Oregon University transfer equivalencies — Oregon\n");
  const all: TransferMapping[] = [];
  let ok = 0;
  for (const [slug, fice] of Object.entries(FICE)) {
    try {
      const rows = await scrapeCollege(slug, fice);
      all.push(...rows);
      if (rows.length) ok++;
      console.log(`  ${slug.padEnd(42)} ${rows.length} mappings`);
    } catch (e) {
      console.error(`  ${slug}: FAILED — ${(e as Error).message}`);
    }
    await sleep(400);
  }
  console.log(`\n=== Summary ===`);
  console.log(`  Colleges: ${ok}/${Object.keys(FICE).length}`);
  console.log(`  Mappings: ${all.length} (direct=${all.filter((m) => !m.is_elective).length}, elective=${all.filter((m) => m.is_elective).length})`);
  if (all.length === 0) { console.warn("  WARN: nothing scraped; leaving data untouched."); return; }

  const outPath = path.join(process.cwd(), "data", "or", "transfer-equiv.json");
  const merged = mergeTransferRows("or", all, { log: (m) => console.log(`  ${m}`) });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nSaved ${merged.length} mappings → ${outPath}`);

  if (!skipImport) {
    try { const n = await importTransfersToSupabase("or"); if (n > 0) console.log(`Imported ${n} rows`); }
    catch (e) { console.error(`Import failed: ${(e as Error).message}`); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
