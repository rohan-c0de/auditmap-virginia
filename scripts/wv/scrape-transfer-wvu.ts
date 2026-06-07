/**
 * scrape-transfer-wvu.ts — West Virginia transfer equivalencies (WV CCs → WVU).
 *
 * WVU publishes its entire transfer-credit database as a public XLSX (no login;
 * needs a browser UA + Referer or the CDN 403s):
 *   https://registrar.wvu.edu/files/d/84a7ec63-96cf-4e37-9141-db0f00d84b1c/transfer-credit-database.xlsx
 * One sheet; columns: CollegeDesc, CollegeLocation, Effective_Term, WVUSubj,
 * WVUCourse, Group, TransSubj, TransCrse, Credits, Transfer_Title, GEF_Attributes.
 * We keep only WV-located senders matched to our 9 CC slugs (in-state-only), and
 * dedupe to the latest Effective_Term per (sending course → WVU course).
 * Companion to scrape-transfer-marshall.ts; mergeTransferRows keeps them apart.
 *
 * Usage: npx tsx scripts/wv/scrape-transfer-wvu.ts [--no-import]
 *   (set WVU_XLSX=/path/to/file.xlsx to skip the 31 MB download during dev)
 */

import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { importTransfersToSupabase } from "../lib/supabase-import.js";
import { mergeTransferRows } from "../lib/transfer-merge.js";
import { buildCcMatcher } from "../lib/match-cc-slug.js";

interface TransferMapping {
  state: string; cc_prefix: string; cc_number: string; cc_course: string;
  cc_title: string; cc_credits: string; university: string; university_name: string;
  univ_course: string; univ_title: string; univ_credits: string; notes: string;
  no_credit: boolean; is_elective: boolean;
}

const XLSX_URL =
  "https://registrar.wvu.edu/files/d/84a7ec63-96cf-4e37-9141-db0f00d84b1c/transfer-credit-database.xlsx";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UNIV_SLUG = "west-virginia-university";
const UNIV_NAME = "West Virginia University";

const clean = (s: unknown) =>
  String(s ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\s+/g, " ").trim();

/** Placeholder WVU courses (e.g. "2TC", "1TC", "UD") = elective/un-articulated credit. */
function isElective(wvuCourse: string): boolean {
  const c = wvuCourse.toUpperCase();
  return /TC$|^\d?T$|UD|X{2,}|ELEC/.test(c) || !/\d/.test(c);
}

async function loadWorkbook(): Promise<XLSX.WorkBook> {
  const cached = process.env.WVU_XLSX;
  if (cached && fs.existsSync(cached)) return XLSX.readFile(cached);
  const r = await fetch(XLSX_URL, { headers: { "User-Agent": UA, Referer: "https://registrar.wvu.edu/transfer" } });
  if (!r.ok) throw new Error(`xlsx download HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return XLSX.read(buf, { type: "buffer" });
}

async function main() {
  const skipImport = process.argv.includes("--no-import");
  console.log("WVU transfer-credit database — West Virginia (WV CCs → WVU)\n");

  // WVU's file names WV CCs with "WV" + abbreviations; alias the asymmetric ones
  // (our names use "West Virginia"). WVU divisions (Potomac State, WVU Tech) and
  // 4-years don't match our 9 CC slugs and are dropped.
  const matcher = buildCcMatcher("wv", {
    parkersburg: "wvup",
    "eastern wv": "eastern",
    "southern wv": "southern",
    "northern cc": "wvncc",
  });

  const wb = await loadWorkbook();
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  console.log(`  ${rows.length} total rows`);

  // latest Effective_Term per (slug|cc_course|univ_course)
  const best = new Map<string, { term: number; m: TransferMapping }>();
  let wvRows = 0;
  for (const r of rows) {
    if (!/,\s*WV\s*$/i.test(String(r.CollegeLocation || ""))) continue;
    wvRows++;
    const slug = matcher.match(String(r.CollegeDesc || ""));
    if (!slug) continue;
    matcher.hit(slug);
    const ccPrefix = clean(r.TransSubj).toUpperCase();
    const ccNum = clean(r.TransCrse);
    if (!ccPrefix || !ccNum) continue;
    const wvuSubj = clean(r.WVUSubj);
    const wvuCourse = clean(r.WVUCourse);
    const noCredit = !wvuSubj || !wvuCourse || /^nc$/i.test(wvuCourse);
    const elective = !noCredit && isElective(wvuCourse);
    const m: TransferMapping = {
      state: "wv", cc_prefix: ccPrefix, cc_number: ccNum, cc_course: `${ccPrefix} ${ccNum}`,
      cc_title: clean(r.Transfer_Title), cc_credits: clean(r.Credits),
      university: UNIV_SLUG, university_name: UNIV_NAME,
      univ_course: noCredit ? "" : `${wvuSubj} ${wvuCourse}`.trim(),
      univ_title: noCredit ? "Does not transfer" : "",
      univ_credits: "", notes: `[${slug}]`, no_credit: noCredit, is_elective: elective,
    };
    const term = Number(r.Effective_Term) || 0;
    const key = `${slug}|${m.cc_course}|${m.univ_course}`;
    const prev = best.get(key);
    if (!prev || term > prev.term) best.set(key, { term, m });
  }
  console.log(`  WV-located rows: ${wvRows}`);

  const all = [...best.values()].map((v) => v.m);
  console.log(`\n=== Summary ===`);
  console.log(`  Mappings: ${all.length} (direct=${all.filter((m) => !m.is_elective && !m.no_credit).length}, elective=${all.filter((m) => m.is_elective).length}, no-credit=${all.filter((m) => m.no_credit).length})`);
  const byCollege: Record<string, number> = {};
  all.forEach((m) => { const s = m.notes.match(/^\[([\w-]+)\]/)![1]; byCollege[s] = (byCollege[s] || 0) + 1; });
  Object.entries(byCollege).sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`  ${s.padEnd(14)} ${n}`));
  const unmatched = matcher.unmatchedSlugs();
  if (unmatched.length) console.log(`  Our WV colleges NOT in WVU file: ${unmatched.join(", ")}`);
  if (all.length === 0) { console.warn("  WARN: nothing scraped; leaving data untouched."); return; }

  const outPath = path.join(process.cwd(), "data", "wv", "transfer-equiv.json");
  const merged = mergeTransferRows("wv", all, { log: (m) => console.log(`  ${m}`) });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nSaved ${merged.length} mappings → ${outPath}`);

  if (!skipImport) {
    try { const n = await importTransfersToSupabase("wv"); if (n > 0) console.log(`Imported ${n} rows`); }
    catch (e) { console.error(`Import failed: ${(e as Error).message}`); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
