/**
 * scrape-transfer-marshall.ts (WV)
 *
 * Builds West Virginia CC→Marshall University transfer equivalencies from
 * Marshall's public transfer-equivalency tool.
 *
 * Source: https://mubert.marshall.edu/transfer/
 *   The sending-school dropdown (`<select id="school">`) lists ~994 schools
 *   nationally; results come from a plain GET:
 *     /transfer/equivalencies.php?school=<ID>
 *   returning a 4-column HTML table (no login, no CAPTCHA):
 *     "MU Credit"          → Marshall course code ("ACC 215", or generic
 *                            "ACC 1XX" = Unclassified elective)
 *     "MU Credited Title"  → Marshall course title (or "Unclassified")
 *     "Transfer Course"    → the SENDING (CC) course code ("AC 103")
 *     "Credit Hours"       → "3"
 *   Note the direction: the sender (CC) course is column 2, the receiver
 *   (Marshall) course is column 0.
 *
 * Coverage / honesty: ONE receiving university — Marshall — covering 8 of
 * West Virginia's 9 community/technical colleges (Pierpont is absent from
 * Marshall's dropdown). WVU's equivalencies live behind a DegreeWorks SPA
 * (XHR capture, per-major) and Fairmont/Shepherd use a CollegeSource TES
 * public view that 403s non-browser clients — so those are documented
 * follow-ups. Marshall alone takes WV from no data to one-university coverage.
 *
 * Marshall's dropdown is national; we hardcode the 8 WV-CC school IDs (the
 * in-state-only rule). The VA homonyms ("New River Community College" 4361,
 * "Blue Ridge Community College" X371/4341) are deliberately NOT included —
 * only the WV "... Comm & Tech College" entries.
 *
 * Like the other states, the UI keys on cc_prefix+cc_number+university and
 * ignores sender identity, so we dedupe on (cc_course, univ_course).
 *
 * Run:
 *   npx tsx scripts/wv/scrape-transfer-marshall.ts
 * Writes: data/wv/transfer-equiv.json (overwrites; idempotent).
 * Then: npx tsx scripts/build-transfer-universities-cache.ts --state wv
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const BASE = "https://mubert.marshall.edu/transfer/equivalencies.php";
const OUT_PATH = path.join(process.cwd(), "data", "wv", "transfer-equiv.json");
const THROTTLE_MS = 500;
const UNIVERSITY = { slug: "marshall", name: "Marshall University" };

/** WV community/technical colleges → Marshall sending-school IDs. */
const SENDERS: { id: string; name: string }[] = [
  { id: "4523", name: "Blue Ridge Comm & Tech College" },
  { id: "X580", name: "BridgeValley Comm & Tech College" },
  { id: "4521", name: "Eastern WV Comm & Tech College" },
  { id: "4513", name: "Mountwest Comm & Tech College" },
  { id: "5580", name: "New River Comm & Tech College" },
  { id: "4525", name: "Southern West Virginia C&TC" },
  { id: "4535", name: "West Virginia Northern CC" },
  { id: "4542", name: "WVU at Parkersburg" },
  // Pierpont C&TC is not present in Marshall's dropdown — no data available.
];

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

function splitCourse(raw: string): { prefix: string; number: string } | null {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  const m = cleaned.match(/^([A-Za-z]{2,5})\s+(\d[\dXx]{1,3}[A-Za-z]?)\b/);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), number: m[2].toUpperCase() };
}

async function main() {
  const entries: TransferEntry[] = [];
  const seen = new Set<string>();

  for (const sender of SENDERS) {
    const url = `${BASE}?school=${sender.id}`;
    let html: string;
    try {
      html = await fetchText(url);
    } catch (e) {
      console.warn(`  ! ${sender.name} (${sender.id}): ${(e as Error).message} — skipping`);
      await sleep(THROTTLE_MS);
      continue;
    }
    const $ = cheerio.load(html);
    let newForSender = 0;

    $("table").first().find("tr").each((_i, tr) => {
      const tds = $(tr).find("td");
      if (tds.length < 4) return;
      const muCode = $(tds.get(0)).text().trim().replace(/\s+/g, " "); // receiver
      const muTitle = $(tds.get(1)).text().trim().replace(/\s+/g, " ");
      const ccCode = $(tds.get(2)).text().trim().replace(/\s+/g, " "); // sender (CC)
      const credits = $(tds.get(3)).text().trim();

      const cc = splitCourse(ccCode);
      const uni = splitCourse(muCode);
      if (!cc || !uni) return;

      const ccCourse = `${cc.prefix} ${cc.number}`;
      const univCourse = `${uni.prefix} ${uni.number}`;
      const dedup = `${ccCourse}|${univCourse}`;
      if (seen.has(dedup)) return;
      seen.add(dedup);

      const isElective = /X/.test(uni.number) || /unclassified/i.test(muTitle);
      entries.push({
        state: "wv",
        cc_prefix: cc.prefix,
        cc_number: cc.number,
        cc_course: ccCourse,
        cc_title: "", // Marshall lists only the receiver's title
        cc_credits: credits,
        university: UNIVERSITY.slug,
        university_name: UNIVERSITY.name,
        univ_course: univCourse,
        univ_title: isElective ? "" : muTitle,
        univ_credits: credits,
        notes: "",
        no_credit: false,
        is_elective: isElective,
      });
      newForSender++;
    });
    console.log(`  ${sender.name}: ${newForSender} new mappings`);
    await sleep(THROTTLE_MS);
  }

  entries.sort(
    (a, b) =>
      a.cc_prefix.localeCompare(b.cc_prefix) ||
      a.cc_number.localeCompare(b.cc_number) ||
      a.univ_course.localeCompare(b.univ_course)
  );

  fs.writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2));
  console.log(`\n✓ Wrote ${entries.length} transfer-equiv entries → ${OUT_PATH}`);
  const elective = entries.filter((e) => e.is_elective).length;
  console.log(`  direct equivalencies: ${entries.length - elective}, generic/elective: ${elective}`);
}

main().catch((e) => {
  console.error("❌ WV Marshall transfer scrape failed:", e);
  process.exit(1);
});
