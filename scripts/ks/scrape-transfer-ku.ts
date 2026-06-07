/**
 * scrape-transfer-ku.ts — Kansas transfer equivalencies (KS CCs → University of Kansas).
 *
 * KU publishes a public, no-login JSON API behind its credit-transfer tool
 * (registrar.ku.edu/credittransfer, a SvelteKit app):
 *   GET https://credittransfer-api.ku.edu/api/credtran/schools          → school list
 *   GET https://credittransfer-api.ku.edu/api/credtran/transfer?sch=<code> → equivalencies
 *
 * We keep only Kansas senders (in-state-only rule) matched to our college slugs.
 * Per-receiver companion to scrape-transfer.ts (Wichita State); mergeTransferRows
 * keeps them conflict-free.
 *
 * Usage: npx tsx scripts/ks/scrape-transfer-ku.ts [--no-import]
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

const API = "https://credittransfer-api.ku.edu/api/credtran";
const UA = "Mozilla/5.0 (compatible; cc-coursemap)";
const UNIV_SLUG = "university-of-kansas";
const UNIV_NAME = "University of Kansas";

interface KuSchool { transferSchoolCode: string; transferSchoolName?: string; transferSchoolStateDescription?: string; }
interface KuRow {
  transferSchoolSubject?: string; transferSchoolCourseNumber?: string;
  transferSchoolCourseTitle?: string; transferCourseHours?: string;
  kuCourseSubject?: string; kuCourseNumber?: string; kuCourseTitle?: string; kuCourseHours?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: unknown) =>
  String(s ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\s+/g, " ").trim();

async function getJson<T>(url: string): Promise<T> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.status === 429 || r.status >= 500) { await sleep((i + 1) * 2000); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  }
  throw new Error("retries exhausted");
}

function isElective(_subj: string, num: string, title: string): boolean {
  // KU encodes undistributed/elective credit with a non-numeric course "number"
  // (e.g. "JAZZ U", "HIST AH", "BUS U"); a real course always has digits.
  if (!/\d/.test(num)) return true;
  if (/X{2,}|UNDIST|ELECT/i.test(num)) return true;
  if (/\b(elective|undistributed|transfer credit)\b/i.test(title)) return true;
  return false;
}

async function main() {
  const skipImport = process.argv.includes("--no-import");
  console.log("KU credit-transfer — Kansas (KS CCs → University of Kansas)\n");

  // KU sometimes names KCKCC differently; alias as needed.
  const matcher = buildCcMatcher("ks", {
    "kansas city kansas community college": "kansas-city-kansas-community-college",
  });

  const schools = (await getJson<{ data?: KuSchool[] }>(`${API}/schools`)).data || [];
  const ksSchools = schools.filter(
    (s) => /kansas/i.test(s.transferSchoolStateDescription || ""),
  );
  console.log(`  ${ksSchools.length} Kansas schools in KU's list`);

  const all: TransferMapping[] = [];
  const seen = new Set<string>();
  let matchedCount = 0;
  for (const s of ksSchools) {
    const slug = matcher.match(s.transferSchoolName || "");
    if (!slug) continue; // not one of our CCs (4-years, unknown, etc.)
    matcher.hit(slug);
    matchedCount++;
    try {
      const rows = (await getJson<{ data?: KuRow[] }>(`${API}/transfer?sch=${encodeURIComponent(s.transferSchoolCode)}`)).data || [];
      for (const r of rows) {
        const ccPrefix = clean(r.transferSchoolSubject).toUpperCase();
        const ccNum = clean(r.transferSchoolCourseNumber);
        if (!ccPrefix || !ccNum) continue;
        const kuSubj = clean(r.kuCourseSubject);
        const kuNum = clean(r.kuCourseNumber);
        const kuTitle = clean(r.kuCourseTitle);
        const noCredit = kuSubj === "-" || kuSubj === "" || /does not transfer/i.test(kuTitle);
        const mapping: TransferMapping = {
          state: "ks", cc_prefix: ccPrefix, cc_number: ccNum,
          cc_course: `${ccPrefix} ${ccNum}`, cc_title: clean(r.transferSchoolCourseTitle),
          cc_credits: clean(r.transferCourseHours), university: UNIV_SLUG, university_name: UNIV_NAME,
          univ_course: noCredit ? "" : `${kuSubj} ${kuNum}`.trim(),
          univ_title: noCredit ? "Does not transfer" : kuTitle,
          univ_credits: noCredit ? "" : clean(r.kuCourseHours),
          notes: `[${slug}]`, no_credit: noCredit,
          is_elective: noCredit ? false : isElective(kuSubj, kuNum, kuTitle),
        };
        const key = `${mapping.cc_course}|${mapping.univ_course}|${mapping.univ_title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(mapping);
      }
      console.log(`  ${slug.padEnd(40)} ${rows.length} rows`);
    } catch (e) {
      console.error(`  ${slug}: FAILED — ${(e as Error).message}`);
    }
    await sleep(150);
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Matched KS colleges: ${matchedCount}`);
  console.log(`  Mappings: ${all.length} (direct=${all.filter((m) => !m.is_elective && !m.no_credit).length}, elective=${all.filter((m) => m.is_elective).length}, no-credit=${all.filter((m) => m.no_credit).length})`);
  const unmatched = matcher.unmatchedSlugs();
  if (unmatched.length) console.log(`  Our KS colleges NOT covered by KU: ${unmatched.join(", ")}`);

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
