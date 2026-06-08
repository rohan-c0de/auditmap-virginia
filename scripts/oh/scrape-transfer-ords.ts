/**
 * scrape-transfer-ords.ts — Ohio transfer equivalencies via the statewide ORDS API.
 *
 * Ohio's "Transfer to Degree Guarantee" credit-transfer tool is backed by a
 * public Oracle ORDS REST service (no auth) that returns the full statewide
 * equivalency matrix — one source course maps to every receiving institution at
 * once. We add every OH public 4-year receiver in one pass. (OSU is excluded —
 * it's already covered by scrape-transfer-osu.ts; ORDS would duplicate it under
 * a second slug.)
 *
 * Chain (all GET, JSON, no auth):
 *   /inst_list                                  → institutions (CCs + unis)
 *   /coll_subj_list                             → global subjects
 *   /coll_courseid_list/{instId}/{subjId}       → a CC's courses in a subject
 *   /college_univ_credit?inst_id_org=&subj_id=&course_id=&termyear=  → equivalencies
 *
 * In-state only (every ORDS institution is an Ohio public). Heavy crawl
 * (~23 CCs × 69 subjects × courses) — run detached. Companion to
 * scrape-transfer-osu.ts; mergeTransferRows keeps them conflict-free.
 *
 * Usage: npx tsx scripts/oh/scrape-transfer-ords.ts [--no-import]
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

const B = "https://cems.regents.ohio.gov/acprod/odb_dhe/wsc/transfer";
const UA = "Mozilla/5.0 (compatible; cc-coursemap)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: unknown) =>
  String(s ?? "").replace(/<[^>]*>/g, " ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\s+/g, " ").trim();
const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bOf\b/g, "of").replace(/\bAnd\b/g, "and").replace(/\bThe\b/g, "the");

/**
 * Canonicalize an ORDS "Destination" name → {slug,name} for a 4-year Ohio public
 * university, or null to skip. Drops campus-suffix duplicates ("Miami University
 * Oxford" / "… Main Campus" / "… Kent Campus" → one school), 2-year colleges
 * (no "University" in the name), and OSU (owned by scrape-transfer-osu.ts).
 */
function canonDestination(raw: string): { slug: string; name: string } | null {
  if (!raw) return null;
  const stripped = raw.replace(/\b(main campus|kent campus|oxford)\b/gi, "").replace(/\s+/g, " ").trim();
  const low = stripped.toLowerCase();
  if (!/\buniversity\b/.test(low)) return null;
  if (/ohio state/.test(low)) return null;
  return { slug: slugify(stripped), name: titleCase(stripped) };
}

async function getJson<T = unknown>(url: string): Promise<T> {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (r.status === 429 || r.status >= 500) { await sleep((i + 1) * 1500); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      if (i === 4) throw e;
      await sleep((i + 1) * 1500);
    }
  }
  throw new Error("retries exhausted");
}

function splitCode(code: string): { prefix: string; number: string } {
  const m = clean(code).match(/^([A-Za-z]+)\s*([0-9][0-9A-Za-z]*)$/);
  if (m) return { prefix: m[1].toUpperCase(), number: m[2] };
  return { prefix: clean(code).toUpperCase(), number: "" };
}
const isElective = (c: string, t: string) =>
  /X{2,}|UND|ELEC/i.test(c) || /\b(elective|undistributed|general)\b/i.test(t);

async function main() {
  const skipImport = process.argv.includes("--no-import");
  console.log("Ohio statewide ORDS transfer matrix — Ohio CCs → OH public universities\n");

  const matcher = buildCcMatcher("oh");
  const insts = (await getJson<{ inst_list?: Array<{ inst_id: number; inst_name: string }> }>(`${B}/inst_list`)).inst_list || [];
  // Source CCs = ORDS institutions matching one of our OH CC slugs.
  const sourceCCs: Array<{ id: number; slug: string }> = [];
  const ourSlugs = new Set<string>();
  for (const i of insts) {
    const slug = matcher.match(i.inst_name);
    if (slug) { sourceCCs.push({ id: i.inst_id, slug }); ourSlugs.add(slug); }
  }
  console.log(`  ${sourceCCs.length} OH community colleges matched in ORDS`);

  const subjects = (await getJson<{ subj_list?: Array<{ "Subject ID": number }> }>(`${B}/coll_subj_list`)).subj_list || [];
  const subjIds = subjects.map((s) => s["Subject ID"]);
  const termyears = (await getJson<{ term_year_list?: Array<{ TermYear: string }> }>(`${B}/coll_termyear_list`)).term_year_list || [];
  const termyear = (termyears.map((t) => t.TermYear).filter(Boolean).sort().reverse()[0]) || "AU2024";
  console.log(`  ${subjIds.length} subjects, termyear=${termyear}\n`);

  const all: TransferMapping[] = [];
  const seen = new Set<string>();
  let callCount = 0;
  for (const cc of sourceCCs) {
    let ccRows = 0;
    for (const subjId of subjIds) {
      let courses: Array<{ "Coures ID"?: string; "Course ID Display"?: string }> = [];
      try {
        courses = (await getJson<{ course_id_list?: typeof courses }>(`${B}/coll_courseid_list/${cc.id}/${subjId}`)).course_id_list || [];
      } catch { continue; }
      for (const c of courses) {
        const courseId = c["Coures ID"];
        if (!courseId) continue;
        callCount++;
        let rows: Array<Record<string, unknown>> = [];
        try {
          const res = await getJson<{ coll_and_unv_credits?: typeof rows }>(
            `${B}/college_univ_credit?inst_id_org=${cc.id}&subj_id=${subjId}&course_id=${encodeURIComponent(courseId)}&termyear=${termyear}`,
          );
          rows = res.coll_and_unv_credits || [];
        } catch { continue; }
        for (const r of rows) {
          if (clean(r["Expiration Term"]) && clean(r["Expiration Term"]) !== "-") continue; // expired
          const dest = canonDestination(clean(r["Destination"]));
          // Keep 4-year universities only (drop CC↔CC and "X State College");
          // OSU is owned by scrape-transfer-osu.ts so it's excluded here.
          if (!dest) continue;
          const destSlug = dest.slug;
          const destName = dest.name;
          if (ourSlugs.has(destSlug)) continue;
          const src = clean(r["Source Course ID(s)"]).split(",")[0];
          const { prefix, number } = splitCode(src);
          if (!prefix || !number) continue;
          const destCourse = clean(r["Destination Course ID(s)"]).split(",")[0];
          if (!destCourse) continue;
          const title = clean(r["Course Title"]);
          // Some destinations are gen-ed CATEGORY names ("Arts and Humanities",
          // "Mathematics") rather than a course code — record those as gen-ed
          // electives, not a fake course code.
          const isCategory = !/\d/.test(destCourse);
          const mapping: TransferMapping = {
            state: "oh", cc_prefix: prefix, cc_number: number, cc_course: `${prefix} ${number}`,
            cc_title: title, cc_credits: "",
            university: destSlug, university_name: destName,
            univ_course: isCategory ? "" : destCourse,
            univ_title: isCategory ? `Gen-ed: ${destCourse}` : "",
            univ_credits: "",
            notes: `[${cc.slug}]`, no_credit: false,
            is_elective: isCategory || isElective(destCourse, title),
          };
          const key = `${cc.slug}|${mapping.cc_course}|${destSlug}|${mapping.univ_course || mapping.univ_title}`;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push(mapping);
          ccRows++;
        }
        await sleep(40);
      }
    }
    console.log(`  ${cc.slug.padEnd(42)} ${ccRows} mappings (calls so far: ${callCount})`);
  }

  const unis = new Set(all.map((m) => m.university));
  console.log(`\n=== Summary ===`);
  console.log(`  Mappings: ${all.length} across ${unis.size} receiving universities`);
  console.log(`  Receivers: ${[...unis].join(", ")}`);
  if (all.length === 0) { console.warn("  WARN: nothing scraped; leaving data untouched."); return; }

  const outPath = path.join(process.cwd(), "data", "oh", "transfer-equiv.json");
  const merged = mergeTransferRows("oh", all, { log: (m) => console.log(`  ${m}`) });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nSaved ${merged.length} mappings → ${outPath}`);

  if (!skipImport) {
    try { const n = await importTransfersToSupabase("oh"); if (n > 0) console.log(`Imported ${n} rows`); }
    catch (e) { console.error(`Import failed: ${(e as Error).message}`); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
