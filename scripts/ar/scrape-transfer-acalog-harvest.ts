/**
 * scrape-transfer-acalog-harvest.ts — AR transfer equivalencies harvested
 * from Acalog course-description pages.
 *
 * Companion to scripts/ar/scrape-transfer-acts-catalogs.ts. That one
 * targets the 3 AR universities that publish a master ACTS-equivalency
 * table (ATU, UAF, UCA). This one targets the universities that *don't*:
 * they embed each ACTS code inline in the corresponding course's
 * description block within their Acalog catalog (Acalog is a SaaS
 * catalog platform used by hundreds of US colleges).
 *
 * Mechanism per university:
 *   1. Walk `content.php?catoid=X&navoid=Y&filter[cpage]=N&expand=1` until
 *      no more coids → collect all coid values.
 *   2. Fetch each `preview_course_nopop.php?catoid=X&coid=N` page.
 *   3. Parse `<h1 id="course_preview_title">PREFIX NUMBER - TITLE</h1>`
 *      for the receiving-university's course code + title.
 *   4. Run a per-university ACTS regex on the description body to extract
 *      the equivalent ACTS course code.
 *   5. Emit one TransferMapping per (course with ACTS embed × receiver).
 *
 * Courses without an ACTS embed are silently skipped (not every course
 * has a state-mandated equivalent — only the ACTS-common-numbered ones).
 *
 * The output is appended to data/ar/transfer-equiv.json — the master-table
 * scraper's records remain untouched, deduped on
 * (cc_prefix, cc_number, university, univ_course, univ_title).
 *
 * Throttled at 500ms between course-page fetches to be polite to Acalog's
 * shared infrastructure. Full run is ~15-20 min unattended; detach via
 * the double-fork pattern when running locally.
 *
 * Usage:
 *   npx tsx scripts/ar/scrape-transfer-acalog-harvest.ts
 *   npx tsx scripts/ar/scrape-transfer-acalog-harvest.ts --receiver ualr
 *   npx tsx scripts/ar/scrape-transfer-acalog-harvest.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const STATE = "ar";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const DELAY_MS = 500;

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

interface Receiver {
  slug: string;
  name: string;
  host: string;
  catoid: number;
  navoid: number;
  /** Regex with two capture groups: subject prefix + course number. */
  actsRegex: RegExp;
}

const RECEIVERS: Receiver[] = [
  // The actsRegex below is broad on purpose — UALR's catalog alone uses at
  // least three phrasings ("ACTS Course Number", "ACTS was", "ACTS
  // Equivalent"), and the other universities use yet more variants:
  //   • UAFS: "ACTS: ACCT 2003"
  //   • SAU:  "ACTS Course Equivalent: ACCT 2003"
  //   • UAM:  "A.C.T.S. Equivalent Course # ENGL 1023"  (dotted!)
  // We anchor on "ACTS" or "A.C.T.S." then accept any short connective
  // (≤30 chars) before the subject code + 4-digit number.
  {
    slug: "ualr",
    name: "University of Arkansas at Little Rock",
    host: "catalog.ualr.edu",
    catoid: 36,
    navoid: 4231,
    actsRegex: /(?:\bACTS\b|A\.C\.T\.S\.?)[^.<>(\n]{0,30}?\b([A-Z]{2,5})\s*(\d{4})\b/,
  },
  {
    slug: "uafs",
    name: "University of Arkansas — Fort Smith",
    host: "catalog.uafs.edu",
    catoid: 9,
    navoid: 371,
    actsRegex: /(?:\bACTS\b|A\.C\.T\.S\.?)[^.<>(\n]{0,30}?\b([A-Z]{2,5})\s*(\d{4})\b/,
  },
  {
    slug: "sau",
    name: "Southern Arkansas University",
    host: "catalog.saumag.edu",
    catoid: 8,
    navoid: 282,
    actsRegex: /(?:\bACTS\b|A\.C\.T\.S\.?)[^.<>(\n]{0,30}?\b([A-Z]{2,5})\s*(\d{4})\b/,
  },
  {
    slug: "uam",
    name: "University of Arkansas at Monticello",
    host: "catalog.uamont.edu",
    catoid: 5,
    navoid: 287,
    actsRegex: /(?:\bACTS\b|A\.C\.T\.S\.?)[^.<>(\n]{0,30}?\b([A-Z]{2,5})\s*(\d{4})\b/,
  },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchHtml(url: string, attempt = 0): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await sleep(3000 * Math.pow(2, attempt));
        return fetchHtml(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return await res.text();
  } catch (e) {
    if (attempt < 3 && /timeout|network|ECONN/i.test(String(e))) {
      await sleep(3000 * Math.pow(2, attempt));
      return fetchHtml(url, attempt + 1);
    }
    throw e;
  }
}

/**
 * Walk the master content.php pages collecting all coids. Stops when a
 * page returns no new coids (handles the off-by-one of cpage going past
 * the last real page — Acalog returns an empty results block but still
 * HTTP 200).
 */
async function discoverCoids(receiver: Receiver): Promise<number[]> {
  const seen = new Set<number>();
  let page = 1;
  const maxPages = 100; // hard safety; Acalog catalogs rarely exceed ~25 pages
  while (page <= maxPages) {
    const url = `https://${receiver.host}/content.php?catoid=${receiver.catoid}&navoid=${receiver.navoid}&filter%5Bcpage%5D=${page}&expand=1`;
    const html = await fetchHtml(url);
    const matches = html.matchAll(/coid=(\d+)/g);
    let newCount = 0;
    for (const m of matches) {
      const c = Number(m[1]);
      if (!seen.has(c)) {
        seen.add(c);
        newCount++;
      }
    }
    if (newCount === 0) break; // no new coids → past last page
    page++;
    await sleep(DELAY_MS);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * Parse the title bar of an Acalog course page:
 *   <h1 id="course_preview_title">ACCT 20003 - (was 2310) Principles of Accounting I </h1>
 *
 * We strip parenthetical reorg notes ("(was 2310)") and split into
 * prefix + number + title.
 */
function parseTitle(rawTitle: string): { prefix: string; number: string; title: string } | null {
  const cleaned = rawTitle
    .replace(/\([^)]*\)/g, " ") // drop "(was 2310)" / "(3 cr)"
    .replace(/\s+/g, " ")
    .trim();
  // "ACCT 20003 - Principles of Accounting I"
  const m = cleaned.match(/^([A-Z]{2,5})\s+([0-9]{3,5}[A-Z]?)\s*-\s*(.+?)\s*$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], title: m[3] };
}

async function fetchCoursePage(
  receiver: Receiver,
  coid: number,
): Promise<{ univCode: string; univNum: string; univTitle: string; actsPrefix: string; actsNum: string } | null> {
  const url = `https://${receiver.host}/preview_course_nopop.php?catoid=${receiver.catoid}&coid=${coid}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const titleRaw = $("#course_preview_title").first().text();
  if (!titleRaw) return null;
  const t = parseTitle(titleRaw);
  if (!t) return null;
  // Pull the ACTS code from the full page text (the regex anchors are
  // robust enough to ignore navigation chrome).
  const pageText = $.text();
  const m = pageText.match(receiver.actsRegex);
  if (!m) return null;
  return {
    univCode: t.prefix,
    univNum: t.number,
    univTitle: t.title,
    actsPrefix: m[1].toUpperCase(),
    actsNum: m[2],
  };
}

async function scrapeReceiver(receiver: Receiver): Promise<TransferMapping[]> {
  console.log(`\n=== ${receiver.slug} (${receiver.name}) ===`);
  console.log(`  discovering coids...`);
  const coids = await discoverCoids(receiver);
  console.log(`  found ${coids.length} courses; fetching each...`);
  const out: TransferMapping[] = [];
  let withActs = 0;
  let noActs = 0;
  let errors = 0;
  for (let i = 0; i < coids.length; i++) {
    const coid = coids[i];
    try {
      const r = await fetchCoursePage(receiver, coid);
      if (r) {
        withActs++;
        out.push({
          state: STATE,
          cc_prefix: r.actsPrefix,
          cc_number: r.actsNum,
          cc_course: `${r.actsPrefix} ${r.actsNum}`,
          cc_title: "", // not in source — the ACTS title comes from the master-table scraper
          cc_credits: "",
          university: receiver.slug,
          university_name: receiver.name,
          univ_course: `${r.univCode} ${r.univNum}`,
          univ_title: r.univTitle,
          univ_credits: "",
          notes: "",
          no_credit: false,
          is_elective: false,
        });
      } else {
        noActs++;
      }
    } catch (e) {
      errors++;
      // Don't blow up the whole crawl on one bad page.
      if (errors <= 3) console.error(`    coid=${coid}: ${(e as Error).message}`);
    }
    if ((i + 1) % 50 === 0) {
      console.log(`    ${i + 1}/${coids.length}: ${withActs} with ACTS, ${noActs} without, ${errors} errors`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`  ${receiver.slug}: ${withActs} mappings (no-ACTS: ${noActs}, errors: ${errors})`);
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const recvIdx = args.indexOf("--receiver");
  const recvFilter = recvIdx >= 0 ? args[recvIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("AR Transfer Equivalency Scraper (Acalog harvest)");

  const targets = recvFilter ? RECEIVERS.filter((r) => r.slug === recvFilter) : RECEIVERS;
  if (targets.length === 0) {
    console.error(`Unknown receiver: ${recvFilter}. Known: ${RECEIVERS.map((r) => r.slug).join(", ")}`);
    process.exit(1);
  }

  const newMappings: TransferMapping[] = [];
  const failures: { receiver: string; error: string }[] = [];

  for (const receiver of targets) {
    try {
      const rows = await scrapeReceiver(receiver);
      newMappings.push(...rows);
    } catch (e) {
      console.error(`  ${receiver.slug}: FAILED — ${(e as Error).message}`);
      failures.push({ receiver: receiver.slug, error: (e as Error).message });
    }
    try {
      fs.writeFileSync(
        "/tmp/ar-acalog-checkpoint.json",
        JSON.stringify({ done: receiver.slug, newRows: newMappings.length, failures: failures.length }),
      );
      fs.writeFileSync("/tmp/ar-acalog-checkpoint-data.json", JSON.stringify(newMappings));
    } catch {
      /* checkpoint best-effort */
    }
  }

  console.log(`\nNew mappings from Acalog harvest: ${newMappings.length}`);
  if (failures.length > 0) {
    console.log(`Failures: ${failures.length}`);
    for (const f of failures) console.log(`  - ${f.receiver}: ${f.error}`);
  }

  // Merge with existing data/ar/transfer-equiv.json (from the master-table
  // scraper) and dedup.
  const outPath = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  if (fs.existsSync(outPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
    } catch {
      existing = [];
    }
  }
  // Don't overwrite a non-empty existing file with zero new rows when the
  // master scraper's records aren't preserved alongside our new ones.
  if (newMappings.length === 0 && existing.length > 0 && !recvFilter) {
    console.error(
      `REFUSING to clobber transfer-equiv.json (existing ${existing.length} rows) with 0 new Acalog rows.`,
    );
    process.exit(1);
  }
  const combined = [...existing, ...newMappings];
  const seen = new Set<string>();
  const deduped = combined.filter((m) => {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}|${m.univ_title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const droppedDupes = combined.length - deduped.length;

  deduped.sort(
    (a, b) =>
      a.cc_prefix.localeCompare(b.cc_prefix) ||
      a.cc_number.localeCompare(b.cc_number) ||
      a.university.localeCompare(b.university),
  );

  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2));
  console.log(`\nMerged: existing=${existing.length} + new=${newMappings.length} - dupes=${droppedDupes} = ${deduped.length}`);
  console.log(`Wrote ${deduped.length} mappings → ${outPath}`);

  if (!noImport && newMappings.length > 0) {
    try {
      const { importTransfersToSupabase } = await import("../lib/supabase-import");
      await importTransfersToSupabase(STATE);
    } catch (e) {
      console.log(`Supabase import skipped: ${(e as Error).message}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
