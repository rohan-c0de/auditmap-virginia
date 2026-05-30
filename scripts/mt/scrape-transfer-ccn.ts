/**
 * scrape-transfer-ccn.ts (MT)
 *
 * Builds Montana's statewide CC→4-year transfer-equivalency dataset from the
 * Montana University System Common Course Numbering (CCN) matrix.
 *
 * Source: https://ccn.mus.edu/  — the public CCN tool. Its matrix is served
 * by a plain PHP endpoint that returns server-rendered HTML table fragments
 * (no login, no CAPTCHA, no SPA framework):
 *   GET /admin/ajax/ajax-view-courses.php?limit=<offset>&sort=15&arrange=DESC
 * Paginates 50 rows/page; `.total` reports ~9,682 common-numbered courses.
 *
 * The equivalency model:
 *   Under MUS Board of Regents policy 1302, common-numbered courses (same
 *   rubric + number) transfer between MUS campuses as if taken at the
 *   receiving campus — and the course KEEPS THE SAME CODE statewide. So
 *   unlike NM/MO (where each institution has a distinct local code mapped to
 *   a shared common number), in Montana the common number IS the local code
 *   at every campus. The equivalency is therefore an identity map:
 *   a 2-year college's "WRIT 101" transfers to a 4-year campus as "WRIT 101".
 *
 *   Each matrix row is one common-numbered course; each campus column carries
 *   a graduation-cap icon (`<i class="fa fa-graduation-cap">`) when that
 *   campus offers the course. We emit one CC→university pair for every course
 *   that is offered at BOTH at least one 2-year sender campus AND at least one
 *   4-year receiver campus.
 *
 * Campus classification (from the matrix column groups):
 *   - RECEIVERS = the six 4-year MUS universities (Montana Tech, UM-Western,
 *     UM-Missoula, MSU-Bozeman, MSU-Billings, MSU-Northern).
 *   - SENDERS = the 2-year colleges (the university-affiliated 2-year campuses
 *     like Gallatin/Helena/Missoula/Great Falls/Highlands/City College), the
 *     three independent community colleges (Dawson, Flathead Valley, Miles),
 *     and the four tribal colleges (Blackfeet, Fort Peck, Aaniiih Nakoda,
 *     Stone Child).
 * All in-state by construction (CCN is an MUS-internal system).
 *
 * Like GA/NM/MO, the UI keys on (cc_prefix, cc_number, university) state-wide
 * and ignores sender identity, so we dedupe on (course, university) — one row
 * per (common course × receiving university).
 *
 * Run:
 *   npx tsx scripts/mt/scrape-transfer-ccn.ts
 * Writes: data/mt/transfer-equiv.json (overwrites; idempotent).
 * Then: npx tsx scripts/build-transfer-universities-cache.ts --state mt
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const BASE = "https://ccn.mus.edu/admin/ajax/ajax-view-courses.php";
const OUT_PATH = path.join(process.cwd(), "data", "mt", "transfer-equiv.json");
const PAGE_SIZE = 50;
const THROTTLE_MS = 400;

/** Four-year MUS universities (matrix campus code → slug + name). */
const RECEIVERS: Record<string, { slug: string; name: string }> = {
  TECH: { slug: "montana-tech", name: "Montana Technological University" },
  UMW: { slug: "um-western", name: "University of Montana Western" },
  UM: { slug: "um-missoula", name: "University of Montana" },
  MSU: { slug: "msu-bozeman", name: "Montana State University" },
  MSUB: { slug: "msu-billings", name: "Montana State University Billings" },
  MSUN: { slug: "msu-northern", name: "Montana State University Northern" },
};

/** 2-year / community / tribal campuses that send transfers (matrix codes). */
const SENDER_CODES = new Set<string>([
  "GFC", "HCMT", "CC", "GC", "HC", "MC", // university-affiliated 2-year colleges
  "DCC", "FVCC", "MCC",                   // independent community colleges
  "BFCC", "FPCC", "ANC", "SCC",           // tribal colleges
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(limit: number, attempts = 4): Promise<string> {
  const url = `${BASE}?limit=${limit}&sort=15&arrange=DESC`;
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

async function main() {
  // First page tells us the column order and the total.
  const firstHtml = await fetchPage(0);
  const $first = cheerio.load(firstHtml);
  const total = parseInt($first(".total").first().text().trim().slice(0, 4), 10) || 9682;

  // Column index → campus code, read from the campus sub-header row (first
  // tbody row, whose cells contain <a data-id>CODE</a>).
  const colCode: Record<number, string> = {};
  $first("tbody tr").first().find("td").each((i, td) => {
    const a = $first(td).find("a[data-id]");
    if (a.length) colCode[i] = a.text().trim();
  });
  const receiverCols = Object.entries(colCode).filter(([, c]) => RECEIVERS[c]);
  const senderCols = Object.entries(colCode).filter(([, c]) => SENDER_CODES.has(c));
  console.log(
    `Columns: ${Object.keys(colCode).length} campuses ` +
      `(${receiverCols.length} receivers, ${senderCols.length} senders). Total courses: ${total}.`
  );

  const entries: TransferEntry[] = [];
  const seen = new Set<string>();
  let coursesParsed = 0;
  let coursesWithBothSides = 0;

  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const html = offset === 0 ? firstHtml : await fetchPage(offset);
    const $ = cheerio.load(html);
    $("tbody tr").each((_i, tr) => {
      const tds = $(tr).find("td");
      const rubric = $(tds.get(0)).find(".rubric").text().trim();
      const number = $(tds.get(0)).find(".number").text().trim();
      if (!rubric || !number) return; // campus-header row or empty
      coursesParsed++;
      const title = $(tds.get(0)).find(".title").text().trim();

      const offeredBy = (cols: [string, string][]) =>
        cols.filter(([idx]) => $(tds.get(Number(idx))).find("i.fa-graduation-cap").length > 0);

      const recvOffered = offeredBy(receiverCols);
      const sendOffered = offeredBy(senderCols);
      if (recvOffered.length === 0 || sendOffered.length === 0) return;
      coursesWithBothSides++;

      const course = `${rubric.toUpperCase()} ${number.toUpperCase()}`;
      for (const [, code] of recvOffered) {
        const recv = RECEIVERS[code];
        const dedup = `${course}|${recv.slug}`;
        if (seen.has(dedup)) continue;
        seen.add(dedup);
        entries.push({
          state: "mt",
          cc_prefix: rubric.toUpperCase(),
          cc_number: number.toUpperCase(),
          cc_course: course,
          cc_title: title,
          cc_credits: "",
          university: recv.slug,
          university_name: recv.name,
          univ_course: course, // identity: CCN keeps the same code statewide
          univ_title: title,
          univ_credits: "",
          notes: "Montana Common Course Numbering — transfers with the same course number",
          no_credit: false,
          is_elective: false,
        });
      }
    });
    if (offset !== 0) await sleep(THROTTLE_MS);
  }

  entries.sort(
    (a, b) =>
      a.cc_prefix.localeCompare(b.cc_prefix) ||
      a.cc_number.localeCompare(b.cc_number) ||
      a.university.localeCompare(b.university)
  );

  fs.writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2));
  console.log(`\n✓ Wrote ${entries.length} transfer-equiv entries → ${OUT_PATH}`);
  console.log(`  courses parsed: ${coursesParsed}, with both CC + university sides: ${coursesWithBothSides}`);

  const byReceiver: Record<string, number> = {};
  for (const e of entries) byReceiver[e.university] = (byReceiver[e.university] || 0) + 1;
  console.log("\nBy receiving university:");
  for (const [s, n] of Object.entries(byReceiver).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`);
  }
}

main().catch((e) => {
  console.error("❌ MT CCN transfer scrape failed:", e);
  process.exit(1);
});
