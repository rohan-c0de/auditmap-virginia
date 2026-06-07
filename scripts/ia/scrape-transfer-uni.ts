/**
 * scrape-transfer-uni.ts — Iowa transfer equivalencies (IA CCs → University of Northern Iowa).
 *
 * UNI's public TransferPlanIt tool (java.access.uni.edu/TransferPlanIt) is a
 * no-login JSON REST API:
 *   GET /TransferPlanIt/rest/College/all                       → colleges + extOrgId
 *   GET /TransferPlanIt/rest/Equivalency/college/{extOrgId}/UNFI → equivalencies
 * In-state senders only, matched to our college slugs. Companion to
 * scrape-transfer-transit.ts (Iowa State); mergeTransferRows keeps them apart.
 *
 * Usage: npx tsx scripts/ia/scrape-transfer-uni.ts [--no-import]
 */

import fs from "fs";
import path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import.js";
import { mergeTransferRows } from "../lib/transfer-merge.js";
import { buildCcMatcher } from "../lib/match-cc-slug.js";

interface TransferMapping {
  state: string; cc_prefix: string; cc_number: string; cc_course: string;
  cc_title: string; cc_credits: string; university: string; university_name: string;
  univ_course: string; univ_title: string; univ_credits: string; notes: string;
  no_credit: boolean; is_elective: boolean;
}

const REST = "https://java.access.uni.edu/TransferPlanIt/rest";
const UA = "Mozilla/5.0 (compatible; cc-coursemap)";
const UNIV_SLUG = "university-of-northern-iowa";
const UNIV_NAME = "University of Northern Iowa";

interface UniCourse { transferCourseNumber?: string[]; transferCourseTitle?: string[]; uniCourseNumber?: string[] }
interface UniEquiv { subjectAreas?: Array<{ courses?: UniCourse[] }> }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: unknown) =>
  String(s ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\s+/g, " ").trim();

async function getJson<T = unknown>(url: string): Promise<T> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.status === 429 || r.status >= 500) { await sleep((i + 1) * 2000); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  }
  throw new Error("retries exhausted");
}

/** "ACC 152" → {prefix:"ACC", number:"152"}; tolerate odd spacing. */
function splitCourse(code: string): { prefix: string; number: string } {
  const m = clean(code).match(/^([A-Za-z]+)\s*([0-9][0-9A-Za-z]*)$/);
  if (m) return { prefix: m[1].toUpperCase(), number: m[2] };
  return { prefix: clean(code).toUpperCase(), number: "" };
}

function flattenColleges(data: unknown): Array<{ name: string; extOrgId: string }> {
  // /College/all returns groups; pull every {descr, extOrgId}.
  const out: Array<{ name: string; extOrgId: string }> = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      if (o.extOrgId && (o.descr || o.name))
        out.push({ name: clean(o.descr ?? o.name), extOrgId: String(o.extOrgId) });
      Object.values(o).forEach(walk);
    }
  };
  walk(data);
  return out;
}

async function main() {
  const skipImport = process.argv.includes("--no-import");
  console.log("UNI TransferPlanIt — Iowa (IA CCs → University of Northern Iowa)\n");
  const matcher = buildCcMatcher("ia");

  const colleges = flattenColleges(await getJson(`${REST}/College/all`));
  const slugToId = new Map<string, string>();
  for (const c of colleges) {
    const slug = matcher.match(c.name);
    if (slug && !slugToId.has(slug)) slugToId.set(slug, c.extOrgId);
  }
  console.log(`  Matched ${slugToId.size} Iowa colleges in UNI's list`);

  const all: TransferMapping[] = [];
  const seen = new Set<string>();
  for (const [slug, extOrgId] of slugToId) {
    matcher.hit(slug);
    try {
      const data = await getJson<UniEquiv>(`${REST}/Equivalency/college/${extOrgId}/UNFI`);
      let n = 0;
      for (const sa of data.subjectAreas ?? []) {
        for (const c of sa.courses ?? []) {
          const ccRaw = clean((c.transferCourseNumber || [])[0]);
          const { prefix, number } = splitCourse(ccRaw);
          if (!prefix || !number) continue;
          const uniNum = clean((c.uniCourseNumber || [])[0]);
          const noCredit = !uniNum;
          const elective = !noCredit && (/Z$/.test(uniNum.replace(/\s/g, "")) || /\b1000\b/.test(uniNum));
          const mapping: TransferMapping = {
            state: "ia", cc_prefix: prefix, cc_number: number,
            cc_course: `${prefix} ${number}`, cc_title: clean((c.transferCourseTitle || [])[0]),
            cc_credits: "", university: UNIV_SLUG, university_name: UNIV_NAME,
            univ_course: noCredit ? "" : uniNum, univ_title: noCredit ? "Does not transfer" : "",
            univ_credits: "", notes: `[${slug}]`, no_credit: noCredit, is_elective: elective,
          };
          const key = `${mapping.cc_course}|${mapping.univ_course}`;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push(mapping);
          n++;
        }
      }
      console.log(`  ${slug.padEnd(42)} ${n} mappings`);
    } catch (e) {
      console.error(`  ${slug}: FAILED — ${(e as Error).message}`);
    }
    await sleep(150);
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Mappings: ${all.length} (direct=${all.filter((m) => !m.is_elective && !m.no_credit).length}, elective=${all.filter((m) => m.is_elective).length}, no-credit=${all.filter((m) => m.no_credit).length})`);
  const unmatched = matcher.unmatchedSlugs();
  if (unmatched.length) console.log(`  Our IA colleges NOT in UNI: ${unmatched.join(", ")}`);
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
