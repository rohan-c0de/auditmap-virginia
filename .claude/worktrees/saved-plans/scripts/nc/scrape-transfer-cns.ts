/**
 * Scrape UNC System Course Numbering System (CNS) transfer equivalency data.
 *
 * Source: https://coursetransfer.northcarolina.edu/search
 * Uses the paginated HTML AJAX endpoint — no browser needed.
 *
 * API flow:
 *   1. GET /search?go=1&q[mode]=course&q[sort]=cnum&q[from]=NCCC&q[load]=init&asAjax=Y → first 24 courses
 *   2. GET /search?...&q[load]=inf&q[o]={offset}&asAjax=Y → next 24 courses
 *   Repeat until 0 courses returned.
 *
 * Each CC course has an expandable detail table with equivalencies at ALL 16 UNC universities.
 * Total: ~6,300 CC courses × up to 16 universities = potentially 50,000+ transfer mappings.
 *
 * Merges mappings into data/nc/transfer-equiv.json alongside existing data.
 * Existing ncstate/uncg data from dedicated scrapers is preserved (more complete).
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-transfer-cns.ts
 */

import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

interface TransferMapping {
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

const BASE_URL = "https://coursetransfer.northcarolina.edu";
const PAGE_SIZE = 24;
const DELAY_MS = 300; // polite delay between requests

// Map institution abbreviations from CNS to our slugs
const INST_MAP: Record<string, { slug: string; name: string }> = {
  ASU: { slug: "appstate", name: "Appalachian State University" },
  ECU: { slug: "ecu", name: "East Carolina University" },
  ECSU: { slug: "ecsu", name: "Elizabeth City State University" },
  FSU: { slug: "fsu", name: "Fayetteville State University" },
  "NCA&T": { slug: "ncat", name: "NC A&T State University" },
  NCCU: { slug: "nccu", name: "North Carolina Central University" },
  NCSU: { slug: "ncstate", name: "NC State University" },
  UNCA: { slug: "unca", name: "UNC Asheville" },
  "UNC-CH": { slug: "unc-ch", name: "UNC Chapel Hill" },
  UNCC: { slug: "uncc", name: "UNC Charlotte" },
  UNCG: { slug: "uncg", name: "UNC Greensboro" },
  UNCP: { slug: "uncp", name: "UNC Pembroke" },
  UNCW: { slug: "uncw", name: "UNC Wilmington" },
  UNCSA: { slug: "uncsa", name: "UNC School of the Arts" },
  WCU: { slug: "wcu", name: "Western Carolina University" },
  WSSU: { slug: "wssu", name: "Winston-Salem State University" },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(offset: number): Promise<string> {
  const load = offset === 0 ? "init" : "inf";
  const params = new URLSearchParams({
    go: "1",
    "q[mode]": "course",
    "q[sort]": "cnum",
    "q[from]": "NCCC",
    "q[load]": load,
    asAjax: "Y",
  });
  if (offset > 0) params.set("q[o]", String(offset));

  const url = `${BASE_URL}/search?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} at offset ${offset}`);
  return res.text();
}

function parsePage(html: string): TransferMapping[] {
  // Wrap in <table> since the response is raw <tr> elements
  const $ = cheerio.load(`<table>${html}</table>`);
  const mappings: TransferMapping[] = [];

  // Find CC course rows (contain "NCCC" in first td)
  // Each CC course is followed by a details row with a detail-table
  const allRows = $("table > tbody > tr, table > tr").toArray();

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const tds = $(row).find("> td");
    if (tds.length < 4) continue;

    const inst = $(tds[0]).text().trim();
    if (inst !== "NCCC") continue;

    // This is a CC course header row
    const courseRaw = $(tds[1]).text().trim().replace(/\u00a0/g, " ");
    const title = $(tds[2]).text().trim();
    const credits = $(tds[3]).text().trim();

    // Parse "ACC 120" → prefix + number
    const parts = courseRaw.match(/^([A-Z]{2,4})\s+(\S+)$/);
    if (!parts) continue;

    const prefix = parts[1];
    const number = parts[2];

    // Find the next row (details) which contains the equivalency table
    const detailRow = allRows[i + 1];
    if (!detailRow) continue;

    const detailTable = $(detailRow).find("table.detail-table");
    if (detailTable.length === 0) continue;

    // Parse each equivalency row
    detailTable.find("tbody tr").each((_, eqRow) => {
      const eqTds = $(eqRow).find("td");
      if (eqTds.length < 5) return;

      const univAbbr = $(eqTds[0]).text().trim();
      // eqTds[1] = CNS (usually empty)
      const univCourse = $(eqTds[2]).text().trim();
      const univTitle = $(eqTds[3]).text().trim();
      const univCredits = $(eqTds[4]).text().trim().replace(/\u2011/g, "-"); // non-breaking hyphen

      const instInfo = INST_MAP[univAbbr];
      if (!instInfo) return; // Unknown institution

      // Detect no credit
      const noCredit =
        !univCourse ||
        univCourse.includes("No Credit") ||
        univCourse.includes("Does Not Transfer") ||
        univCourse === "None";

      // Detect elective patterns
      const isElective =
        !noCredit &&
        (univCourse.includes("XXX") ||
          univCourse.includes("1XX") ||
          univCourse.includes("2XX") ||
          univCourse.includes("3XX") ||
          univCourse.includes("4XX") ||
          univCourse.toLowerCase().includes("elective") ||
          univTitle.toLowerCase().includes("elective") ||
          univTitle.toLowerCase().includes("free elect") ||
          univCourse.includes("19A") || // WCU lower level elective pattern
          univCourse.includes("29A") || // WCU upper level elective pattern
          univCourse.includes("001")); // Generic elective number

      mappings.push({
        cc_prefix: prefix,
        cc_number: number,
        cc_course: `${prefix} ${number}`,
        cc_title: title,
        cc_credits: credits,
        university: instInfo.slug,
        university_name: instInfo.name,
        univ_course: noCredit ? "" : univCourse,
        univ_title: noCredit ? `No ${univAbbr} credit` : univTitle || univCourse,
        univ_credits: noCredit ? "" : univCredits,
        notes: "",
        no_credit: noCredit,
        is_elective: isElective && !noCredit,
      });
    });
  }

  return mappings;
}

async function main() {
  console.log("UNC System CNS Transfer Equivalency Scraper\n");

  const allMappings: TransferMapping[] = [];
  let offset = 0;
  let pageNum = 0;
  let consecutiveEmpty = 0;

  while (true) {
    pageNum++;
    const html = await fetchPage(offset);
    const mappings = parsePage(html);

    if (mappings.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) break; // Two consecutive empty pages = done
      offset += PAGE_SIZE;
      await sleep(DELAY_MS);
      continue;
    }

    consecutiveEmpty = 0;
    allMappings.push(...mappings);

    // Count unique CC courses in this page
    const ccCourses = new Set(mappings.map((m) => m.cc_course));

    if (pageNum % 20 === 0) {
      process.stdout.write(
        `  Page ${pageNum} (offset ${offset}): ${ccCourses.size} CC courses, ${mappings.length} mappings (total: ${allMappings.length})\n`
      );
    }

    offset += PAGE_SIZE;
    await sleep(DELAY_MS);
  }

  console.log(`\nFetched ${pageNum} pages, ${allMappings.length} raw mappings`);

  // Deduplicate by cc_course + university + univ_course
  const seen = new Set<string>();
  const deduped = allMappings.filter((m) => {
    const key = `${m.cc_course}→${m.university}→${m.univ_course}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Stats by university
  const byUniv = new Map<string, { total: number; direct: number; elective: number; noCredit: number }>();
  for (const m of deduped) {
    const stats = byUniv.get(m.university) || { total: 0, direct: 0, elective: 0, noCredit: 0 };
    stats.total++;
    if (m.no_credit) stats.noCredit++;
    else if (m.is_elective) stats.elective++;
    else stats.direct++;
    byUniv.set(m.university, stats);
  }

  const prefixes = new Set(deduped.map((m) => m.cc_prefix));
  console.log(`\nCNS Summary:`);
  console.log(`  Total mappings: ${deduped.length} (${allMappings.length} before dedup)`);
  console.log(`  Universities: ${byUniv.size}`);
  console.log(`  Subject areas: ${prefixes.size}`);
  console.log(`\n  Per university:`);
  for (const [slug, stats] of [...byUniv.entries()].sort((a, b) => b[1].total - a[1].total)) {
    const info = Object.values(INST_MAP).find((i) => i.slug === slug);
    console.log(
      `    ${(info?.name || slug).padEnd(35)} ${String(stats.total).padStart(5)} total (${stats.direct} direct, ${stats.elective} elective, ${stats.noCredit} no credit)`
    );
  }

  // Spot checks
  const eng111 = deduped.filter((m) => m.cc_prefix === "ENG" && m.cc_number === "111");
  if (eng111.length) {
    console.log(`\n  Spot check — ENG 111 transfers to:`);
    eng111.forEach((m) =>
      console.log(`    ${m.university_name}: ${m.univ_course || "(no credit)"} (${m.univ_title})`)
    );
  }

  // Merge with existing data
  // Strategy: keep existing ncstate/uncg data (from dedicated scrapers, more complete),
  // add CNS data for all other universities, and fill in gaps for ncstate/uncg
  const outPath = path.join(process.cwd(), "data", "nc", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    console.log(`\nLoaded ${existing.length} existing mappings`);
  } catch {
    console.log(`\nNo existing data found, starting fresh`);
  }

  // Keep: unc-system (CAA), ncstate (dedicated scraper), uncg (dedicated scraper)
  const keepSlugs = new Set(["unc-system", "ncstate", "uncg"]);
  const kept = existing.filter((m) => keepSlugs.has(m.university));

  // For ncstate/uncg, only add CNS mappings that don't already exist
  const existingKeys = new Set(kept.map((m) => `${m.cc_course}→${m.university}→${m.univ_course}`));
  const cnsForExisting = deduped.filter(
    (m) => keepSlugs.has(m.university) && !existingKeys.has(`${m.cc_course}→${m.university}→${m.univ_course}`)
  );

  // For new universities, add all CNS data
  const cnsNew = deduped.filter((m) => !keepSlugs.has(m.university));

  const merged = [...kept, ...cnsForExisting, ...cnsNew];

  // Final stats
  const mergedByUniv = new Map<string, number>();
  merged.forEach((m) => mergedByUniv.set(m.university, (mergedByUniv.get(m.university) || 0) + 1));

  console.log(`\nMerge results:`);
  console.log(`  Kept from existing: ${kept.length} (${[...keepSlugs].join(", ")})`);
  console.log(`  Gap-fill for ncstate/uncg: ${cnsForExisting.length}`);
  console.log(`  New from CNS: ${cnsNew.length}`);
  console.log(`  Total: ${merged.length}`);
  console.log(`\n  Universities in final data:`);
  for (const [slug, count] of [...mergedByUniv.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${slug}: ${count}`);
  }

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\nSaved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
