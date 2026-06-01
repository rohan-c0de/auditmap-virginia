/**
 * scrape-transfer.ts — Idaho statewide transfer equivalencies.
 *
 * Idaho's State Board of Education runs a single public course-transfer tool
 * at coursetransfer.idaho.gov covering all 8 public institutions (4 community
 * colleges as senders + 4 universities, with the colleges also acting as
 * receivers). CollegeTransfer.Net has NO in-state Idaho data, so this is the
 * authoritative source.
 *
 * Two unauthenticated endpoints (no SSO, no cookies):
 *   1. POST /ceg.aspx/GetCourseTitles  {prefixText, count, contextKey}
 *        -> {"d":["{\"First\":\"<title> (<CODE>)\",\"Second\":\"<MatrixCourseId>\"}", ...]}
 *      An autocomplete that *contains*-matches Title/(CODE); union over a-z0-9
 *      enumerates every course for a sending institution (contextKey).
 *   2. GET  /cegResults.aspx?id=<MatrixCourseId>
 *        -> HTML: source course + one <div id="Institution"> block per receiving
 *           institution (named by the logo's alt=""), each listing destination
 *           course code(s)/title(s)/notes.
 *
 * Credits are not exposed on the results page (a known gap) — cc_credits and
 * univ_credits are left blank.
 *
 * Usage:
 *   npx tsx scripts/id/scrape-transfer.ts
 *   npx tsx scripts/id/scrape-transfer.ts --no-import
 */

import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
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

// Sending community colleges → coursetransfer.idaho.gov contextKey.
const SENDERS: { slug: string; name: string; contextKey: string }[] = [
  { slug: "college-of-southern-idaho", name: "College of Southern Idaho", contextKey: "2" },
  { slug: "college-of-western-idaho", name: "College of Western Idaho", contextKey: "3" },
  { slug: "college-of-eastern-idaho", name: "College of Eastern Idaho", contextKey: "4" },
  { slug: "north-idaho-college", name: "North Idaho College", contextKey: "6" },
];

const BASE = "https://coursetransfer.idaho.gov";
const UA = "Mozilla/5.0 (compatible; cc-coursemap)";

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

/** Split a course code like "ENGL101" / "ENGL 101" / "MATH1153" into prefix+number. */
function splitCode(code: string): { prefix: string; number: string } {
  const m = code.trim().match(/^([A-Za-z]+)\s*([0-9].*)$/);
  if (m) return { prefix: m[1].toUpperCase(), number: m[2].trim() };
  return { prefix: code.trim().toUpperCase(), number: "" };
}

function isElectiveTitle(title: string, code: string): boolean {
  if (/\b(elective|general\s+education|gen\s+ed)\b/i.test(title)) return true;
  if (/X[A-Z]?$/.test(code) || /X{2,}/.test(code)) return true;
  return false;
}

async function enumerateCourses(
  contextKey: string,
): Promise<Map<string, string>> {
  const seen = new Map<string, string>(); // MatrixCourseId -> "Title (CODE)"
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
  for (const q of alphabet) {
    let rows: { First: string; Second: string }[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const resp = await fetch(`${BASE}/ceg.aspx/GetCourseTitles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({ prefixText: q, count: 5000, contextKey }),
      });
      if (resp.status === 429 || resp.status >= 500) {
        await sleep((attempt + 1) * 2000);
        continue;
      }
      if (!resp.ok) throw new Error(`GetCourseTitles HTTP ${resp.status}`);
      const d = (await resp.json()).d as string[];
      rows = d.map((s) => JSON.parse(s) as { First: string; Second: string });
      break;
    }
    for (const r of rows) seen.set(r.Second, r.First);
    await sleep(80);
  }
  return seen;
}

async function fetchResults(id: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(`${BASE}/cegResults.aspx?id=${id}`, {
      headers: { "User-Agent": UA },
    });
    if (resp.status === 429 || resp.status >= 500) {
      await sleep((attempt + 1) * 2000);
      continue;
    }
    if (!resp.ok) return null;
    return resp.text();
  }
  return null;
}

function parseResults(
  html: string,
  senderSlug: string,
): TransferMapping[] {
  const $ = cheerio.load(html);
  const srcInstitution = $("#MainContent_lbInstitutionName").text().trim();
  const srcCode = $("#MainContent_lbCourseNumber").text().trim();
  const srcTitle = $("#MainContent_lbCourseName").text().trim();
  if (!srcCode) return [];
  const { prefix: ccPrefix, number: ccNumber } = splitCode(srcCode);

  // GEM (general-education) designation, if any.
  const gem = $("#MainContent_imgGemHeader").attr("title")?.trim() || "";

  const out: TransferMapping[] = [];
  // Each receiving institution is a <div id="Institution"> panel; its name is
  // in the logo's alt="". Destination course labels live in nested spans whose
  // ids contain lvDestinations_<i>_lb{DCourseCode,CourseTitle,Notes}_<j>.
  $("div#Institution").each((_, el) => {
    const $blk = $(el);
    const recvName = $blk.find("img[alt]").first().attr("alt")?.trim() || "";
    if (!recvName) return;
    // Skip self-referential block (course "transfers" to its own college).
    if (recvName === srcInstitution) return;

    // Collect destination entries within this block, indexed by the _<j> suffix.
    const dests: { code: string; title: string; notes: string }[] = [];
    $blk.find('span[id*="lbDCourseCode_"]').each((__, span) => {
      const id = $(span).attr("id") || "";
      const j = id.match(/_(\d+)$/)?.[1];
      if (j === undefined) return;
      const base = id.replace(/lbDCourseCode_\d+$/, "");
      const code = $(span).text().trim();
      const title = $blk.find(`span[id="${base}lbCourseTitle_${j}"]`).text().trim();
      const notes = $blk.find(`span[id="${base}lbNotes_${j}"]`).text().trim();
      if (code) dests.push({ code, title, notes });
    });
    if (dests.length === 0) return;

    // Prefer a specific (non-elective) destination; fall back to the first.
    const direct = dests.find((d) => !isElectiveTitle(d.title, d.code));
    const chosen = direct || dests[0];
    const elective = !direct;

    const { prefix: uPrefix, number: uNumber } = splitCode(chosen.code);
    const noteParts: string[] = [`[${senderSlug}]`];
    if (gem) noteParts.push(`GEM: ${gem}`);
    if (chosen.notes) noteParts.push(chosen.notes);

    out.push({
      state: "id",
      cc_prefix: ccPrefix,
      cc_number: ccNumber,
      cc_course: `${ccPrefix} ${ccNumber}`.trim(),
      cc_title: srcTitle,
      cc_credits: "",
      university: slugify(recvName),
      university_name: recvName,
      univ_course: `${uPrefix} ${uNumber}`.trim(),
      univ_title: chosen.title,
      univ_credits: "",
      notes: noteParts.join(" "),
      no_credit: false,
      is_elective: elective,
    });
  });

  return out;
}

async function main() {
  const skipImport = process.argv.includes("--no-import");
  console.log("Idaho Course Transfer (coursetransfer.idaho.gov) Scraper\n");

  const successful = new Set<string>();
  const all: TransferMapping[] = [];

  for (const sender of SENDERS) {
    try {
      console.log(`Enumerating ${sender.name} (contextKey=${sender.contextKey})…`);
      const courses = await enumerateCourses(sender.contextKey);
      console.log(`  ${courses.size} courses found; fetching equivalency pages…`);

      let n = 0;
      const before = all.length;
      for (const id of courses.keys()) {
        const html = await fetchResults(id);
        if (html) all.push(...parseResults(html, sender.slug));
        n++;
        if (n % 50 === 0) process.stdout.write(`    ${n}/${courses.size}\r`);
        await sleep(60);
      }
      successful.add(sender.slug);
      console.log(`  ${sender.slug}: ${all.length - before} mappings from ${courses.size} courses`);
    } catch (err) {
      console.error(`  ${sender.slug}: FAILED — ${(err as Error).message}`);
    }
  }

  const transferable = all.filter((m) => !m.no_credit);
  const byRecv = new Map<string, number>();
  for (const m of transferable) byRecv.set(m.university_name, (byRecv.get(m.university_name) || 0) + 1);

  console.log("\n=== Summary ===");
  console.log(`  Colleges scraped: ${successful.size}/${SENDERS.length}`);
  console.log(`  Total mappings: ${all.length}`);
  console.log(`    direct=${transferable.filter((m) => !m.is_elective).length} elective=${transferable.filter((m) => m.is_elective).length}`);
  console.log("  By receiving institution:");
  for (const [r, c] of [...byRecv.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${r}: ${c}`);
  }

  if (successful.size === 0) {
    console.warn("\n  WARN: no colleges scraped; leaving existing data untouched.");
    return;
  }

  const outPath = path.join(process.cwd(), "data", "id", "transfer-equiv.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + "\n");
  console.log(`\nSaved ${all.length} mappings → ${outPath}`);

  if (!skipImport) {
    try {
      const imported = await importTransfersToSupabase("id");
      if (imported > 0) console.log(`Imported ${imported} rows to Supabase`);
    } catch (err) {
      console.error(`Supabase import failed: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
