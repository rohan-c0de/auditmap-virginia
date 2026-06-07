/**
 * scrape-transfer-emporia.ts — Kansas transfer equivalencies (KS CCs → Emporia State).
 *
 * ESU's public credit-transfer tool (credittransfer.emporia.edu) is an htmx app:
 *   POST /droplist  (HX-Request: true, body search=<q>) → <a href='/school/KS####'>Name</a>
 *   GET  /school/<code> → HTML table: [sending Subj|Code|Desc] [ESU Subj|Code|Desc]
 * "FREE 000T / Not Transfer Credit" = does-not-transfer. In-state senders only,
 * matched to our college slugs. Per-receiver companion to scrape-transfer.ts
 * (Wichita State) and scrape-transfer-ku.ts; mergeTransferRows keeps them apart.
 *
 * Usage: npx tsx scripts/ks/scrape-transfer-emporia.ts [--no-import]
 */

import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { importTransfersToSupabase } from "../lib/supabase-import.js";
import { mergeTransferRows } from "../lib/transfer-merge.js";
import { buildCcMatcher } from "../lib/match-cc-slug.js";

interface TransferMapping {
  state: string; cc_prefix: string; cc_number: string; cc_course: string;
  cc_title: string; cc_credits: string; university: string; university_name: string;
  univ_course: string; univ_title: string; univ_credits: string; notes: string;
  no_credit: boolean; is_elective: boolean;
}

const BASE = "https://credittransfer.emporia.edu";
const UA = "Mozilla/5.0 (compatible; cc-coursemap)";
const UNIV_SLUG = "emporia-state-university";
const UNIV_NAME = "Emporia State University";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: string) =>
  s.replace(/&nbsp;/gi, " ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\s+/g, " ").trim();

async function droplist(q: string): Promise<Array<{ code: string; name: string }>> {
  const r = await fetch(`${BASE}/droplist`, {
    method: "POST",
    headers: { "User-Agent": UA, "HX-Request": "true", "Content-Type": "application/x-www-form-urlencoded" },
    body: `search=${encodeURIComponent(q)}`,
  });
  if (!r.ok) return [];
  const out: Array<{ code: string; name: string }> = [];
  const re = /href='\/school\/(KS\d+)'>([^<]+)</g;
  let m: RegExpExecArray | null;
  const html = await r.text();
  while ((m = re.exec(html))) out.push({ code: m[1], name: clean(m[2]) });
  return out;
}

async function scrapeSchool(code: string, slug: string): Promise<TransferMapping[]> {
  const r = await fetch(`${BASE}/school/${code}`, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`school ${code} HTTP ${r.status}`);
  const $ = cheerio.load(await r.text());
  const out: TransferMapping[] = [];
  const seen = new Set<string>();
  $("table tbody tr").each((_, tr) => {
    const c = $(tr).find("td").map((__, td) => clean($(td).text())).get();
    if (c.length < 6) return;
    const [ccSubj, ccCode, ccDesc, esuSubj, esuCode, esuDesc] = c;
    if (!ccSubj || !ccCode) return;
    const noCredit = /^free$/i.test(esuSubj) || /not transfer credit/i.test(esuDesc) || !esuSubj;
    const elective = !noCredit && (!/\d/.test(esuCode) || /X{2,}/i.test(esuCode));
    const mapping: TransferMapping = {
      state: "ks", cc_prefix: ccSubj.toUpperCase(), cc_number: ccCode,
      cc_course: `${ccSubj.toUpperCase()} ${ccCode}`, cc_title: ccDesc, cc_credits: "",
      university: UNIV_SLUG, university_name: UNIV_NAME,
      univ_course: noCredit ? "" : `${esuSubj} ${esuCode}`.trim(),
      univ_title: noCredit ? "Does not transfer" : esuDesc,
      univ_credits: "", notes: `[${slug}]`, no_credit: noCredit, is_elective: elective,
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
  console.log("Emporia State credit-transfer — Kansas (KS CCs → ESU)\n");
  const matcher = buildCcMatcher("ks");

  // Discover ESU school codes by searching each of our KS colleges' distinctive
  // words; collect (slug → code), deduped.
  const insts: Array<{ college_slug: string; name: string }> = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "ks", "institutions.json"), "utf-8"),
  );
  const slugToCode = new Map<string, string>();
  for (const inst of insts) {
    const q = inst.name.replace(/\b(community|technical|college|county|area|the)\b/gi, "").replace(/\s+/g, " ").trim();
    let results: Array<{ code: string; name: string }> = [];
    try { results = await droplist(q); } catch { /* ignore */ }
    for (const res of results) {
      const slug = matcher.match(res.name);
      if (slug && !slugToCode.has(slug)) slugToCode.set(slug, res.code);
    }
    await sleep(120);
  }
  console.log(`  Discovered ${slugToCode.size} KS colleges in ESU's list`);

  const all: TransferMapping[] = [];
  for (const [slug, code] of slugToCode) {
    matcher.hit(slug);
    try {
      const rows = await scrapeSchool(code, slug);
      all.push(...rows);
      console.log(`  ${slug.padEnd(40)} ${rows.length} rows`);
    } catch (e) {
      console.error(`  ${slug}: FAILED — ${(e as Error).message}`);
    }
    await sleep(150);
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Mappings: ${all.length} (direct=${all.filter((m) => !m.is_elective && !m.no_credit).length}, elective=${all.filter((m) => m.is_elective).length}, no-credit=${all.filter((m) => m.no_credit).length})`);
  const unmatched = matcher.unmatchedSlugs();
  if (unmatched.length) console.log(`  Our KS colleges NOT in ESU: ${unmatched.join(", ")}`);
  if (all.length === 0) { console.warn("  WARN: nothing scraped; leaving data untouched."); return; }

  const outPath = path.join(process.cwd(), "data", "ks", "transfer-equiv.json");
  const merged = mergeTransferRows("ks", all, { log: (m) => console.log(`  ${m}`) });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nSaved ${merged.length} mappings → ${outPath}`);

  if (!skipImport) {
    try { const n = await importTransfersToSupabase("ks"); if (n > 0) console.log(`Imported ${n} rows`); }
    catch (e) { console.error(`Import failed: ${(e as Error).message}`); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
