/**
 * scrape-transfer-olemiss.ts (MS)
 *
 * Builds Mississippi CC→University of Mississippi transfer equivalencies from
 * Ole Miss's public registrar pages.
 *
 * Source: https://olemiss.edu/registrar/transfer-equivalencies/community-colleges
 *   — an index linking one static HTML page per Mississippi community college:
 *     /registrar/transfer-equivalencies/schools/<slug>
 *   Each page is a single 3-column table:
 *     "<CC> Course(s)"            → "ACC 1213 — Principles Of Accounting I"
 *     "UM Equivalent"             → "Accy 201 – Introduction to Accounting Principles I [UM Catalog]"
 *                                    (or a generic "UM 1XX – Generic 100 Level..." = elective credit)
 *     "Credits"                   → "3.00"
 *   No login, no CAPTCHA, server-rendered HTML.
 *
 * Coverage / honesty: this is ONE receiving university — the University of
 * Mississippi — covering all 15 MS community colleges at course level. Other
 * MS receivers (Mississippi State, Southern Miss, Jackson State) don't publish
 * a comparable public course-level table (MSU's is behind a Banner
 * Extensibility XHR; USM/JSU defer to the MATT tool / transcript eval). So MS
 * lands at one-university coverage for now; adding MSU is a documented
 * follow-up. The single receiver still gives a complete, accurate answer for
 * any MS CC student transferring to Ole Miss.
 *
 * Mississippi community colleges share a statewide course-numbering scheme, so
 * the same code (e.g. "ENG 1113") recurs across CCs; we dedupe on
 * (cc_course, univ_course) — the UI keys on cc_prefix+cc_number+university and
 * ignores sender identity (like GA/NM/MO/MT).
 *
 * Run:
 *   npx tsx scripts/ms/scrape-transfer-olemiss.ts
 * Writes: data/ms/transfer-equiv.json (overwrites; idempotent).
 * Then: npx tsx scripts/build-transfer-universities-cache.ts --state ms
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const INDEX_URL = "https://olemiss.edu/registrar/transfer-equivalencies/community-colleges";
const SCHOOL_BASE = "https://olemiss.edu";
const OUT_PATH = path.join(process.cwd(), "data", "ms", "transfer-equiv.json");
const THROTTLE_MS = 500;
const UNIVERSITY = { slug: "ole-miss", name: "University of Mississippi" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string, attempts = 4): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 cc-coursemap-scraper" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      lastErr = e;
      await sleep(800 * (i + 1));
    }
  }
  throw new Error(`fetch failed after ${attempts} attempts: ${url} (${lastErr})`);
}

interface TransferEntry {
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

/** Parse a leading course code "ACC 1213" / "ENG 1113" / "UM 1XX" / "ACCY 2XX". */
function parseLeadingCode(raw: string): { prefix: string; number: string; rest: string } | null {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  const m = cleaned.match(/^([A-Za-z]{2,5})\s+(\d[\dXx]{1,3}[A-Za-z]?)\b\s*(.*)$/);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), number: m[2].toUpperCase(), rest: m[3] };
}

/** Strip leading separator chars from a title fragment. */
function cleanTitle(s: string): string {
  return s.replace(/^[\s—–:-]+/, "").replace(/\s*\[UM Catalog\]\s*$/i, "").trim();
}

async function main() {
  console.log("Fetching Ole Miss community-college index…");
  const indexHtml = await fetchText(INDEX_URL);
  const $idx = cheerio.load(indexHtml);
  const schoolPaths = new Set<string>();
  $idx('a[href*="/transfer-equivalencies/schools/"]').each((_i, a) => {
    const href = $idx(a).attr("href");
    if (!href) return;
    // Skip the aggregate "all MS community colleges" page.
    if (/mississippi_community_colleges\b/.test(href)) return;
    schoolPaths.add(href.startsWith("http") ? href : SCHOOL_BASE + href);
  });
  console.log(`  ${schoolPaths.size} community-college pages.`);

  const entries: TransferEntry[] = [];
  const seen = new Set<string>();
  let pagesOk = 0;

  for (const url of schoolPaths) {
    let html: string;
    try {
      html = await fetchText(url);
    } catch (e) {
      console.warn(`  ! ${url}: ${(e as Error).message} — skipping`);
      await sleep(THROTTLE_MS);
      continue;
    }
    const $ = cheerio.load(html);
    const slug = url.split("/schools/")[1] || url;
    let rowsForPage = 0;

    $("table").first().find("tr").each((_i, tr) => {
      const tds = $(tr).find("td");
      if (tds.length < 3) return; // header / malformed
      const ccRaw = $(tds.get(0)).text().trim().replace(/\s+/g, " ");
      const univRaw = $(tds.get(1)).text().trim().replace(/\s+/g, " ");
      const credits = $(tds.get(2)).text().trim();

      const cc = parseLeadingCode(ccRaw);
      const uni = parseLeadingCode(univRaw);
      if (!cc || !uni) return;

      const ccCourse = `${cc.prefix} ${cc.number}`;
      const univCourse = `${uni.prefix} ${uni.number}`;
      const dedup = `${ccCourse}|${univCourse}`;
      if (seen.has(dedup)) return;
      seen.add(dedup);

      // Generic placeholders ("UM 1XX", "ACCY 2XX", or "Generic ..." titles)
      // mean the course transfers only as undifferentiated elective credit.
      const isElective = /X/.test(uni.number) || /\bgeneric\b/i.test(uni.rest);

      entries.push({
        state: "ms",
        cc_prefix: cc.prefix,
        cc_number: cc.number,
        cc_course: ccCourse,
        cc_title: cleanTitle(cc.rest),
        cc_credits: credits,
        university: UNIVERSITY.slug,
        university_name: UNIVERSITY.name,
        univ_course: univCourse,
        univ_title: cleanTitle(uni.rest),
        univ_credits: credits,
        notes: "",
        no_credit: false,
        is_elective: isElective,
      });
      rowsForPage++;
    });
    pagesOk++;
    console.log(`  ${slug}: ${rowsForPage} new mappings`);
    await sleep(THROTTLE_MS);
  }

  entries.sort(
    (a, b) =>
      a.cc_prefix.localeCompare(b.cc_prefix) ||
      a.cc_number.localeCompare(b.cc_number) ||
      a.univ_course.localeCompare(b.univ_course)
  );

  fs.writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2));
  console.log(`\n✓ Wrote ${entries.length} transfer-equiv entries from ${pagesOk} pages → ${OUT_PATH}`);
  const elective = entries.filter((e) => e.is_elective).length;
  console.log(`  direct equivalencies: ${entries.length - elective}, generic/elective: ${elective}`);
}

main().catch((e) => {
  console.error("❌ MS Ole Miss transfer scrape failed:", e);
  process.exit(1);
});
