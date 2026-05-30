/**
 * scrape-transfer-keene.ts
 *
 * Scrapes Keene State College's published CCSNH→Keene transfer
 * equivalencies. Keene maintains a static HTML page per sending
 * institution under:
 *
 *   https://www.keene.edu/academics/sass/academic/transfer/us/nh/{slug}/
 *
 * Each page renders a 3-column table:
 *   col 0  →  <strong>{cc_course}</strong><br/>{cc_title}
 *   col 1  →  <strong>{cc_credits}</strong>
 *   col 2  →  <strong>{univ_course}</strong><br/>{univ_title}
 *
 * Bundle rows whose source side reads "ACCT 101C & ACCT 102C" are
 * skipped — the schema is single-course-keyed and the same source
 * courses appear individually elsewhere on the page.
 *
 * Pattern follows scripts/va/scrape-transfer-uva.ts (per-receiving-
 * university). Writes into data/nh/transfer-equiv.json, replacing
 * any prior `university === "keene"` rows; other receivers untouched.
 *
 * Usage:
 *   npx tsx scripts/nh/scrape-transfer-keene.ts
 *   npx tsx scripts/nh/scrape-transfer-keene.ts --no-import
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import fs from "fs";
import path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

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

interface SendingCollege {
  /** Internal slug used throughout the repo (matches lib/states/nh/config.ts). */
  slug: string;
  /** URL segment Keene uses for this college. */
  keeneSlug: string;
}

const KEENE_BASE =
  "https://www.keene.edu/academics/sass/academic/transfer/us/nh";

const SENDING_COLLEGES: SendingCollege[] = [
  { slug: "gbcc", keeneSlug: "great-bay-community-college" },
  { slug: "lrcc", keeneSlug: "lakes-region-community-college" },
  { slug: "mccnh", keeneSlug: "manchester-community-college" },
  { slug: "nashuacc", keeneSlug: "nashua-community-college" },
  { slug: "nhti", keeneSlug: "nhti-concord-community-college" },
  { slug: "rvcc", keeneSlug: "river-valley-community-college" },
  { slug: "wmcc", keeneSlug: "white-mountains-community-colleg" },
];

function norm(s: string): string {
  return s
    .replace(/ /g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Split a sending-side cell like:
 *   <strong>ACCT 101C</strong><br/>Accounting I
 * into { course, title }. Returns null if the cell is a multi-course
 * bundle ("ACCT 101C & ACCT 102C") — we skip those.
 */
function parseSendCell($: cheerio.CheerioAPI, td: AnyNode): {
  course: string;
  title: string;
} | null {
  const strongText = norm($(td).find("strong").first().text());
  if (!strongText) return null;
  if (strongText.includes("&")) return null;

  // The title is everything in the cell after the <strong>...</strong>.
  // cheerio's .text() concatenates with the strong content, so subtract.
  const fullText = norm($(td).text());
  const title = norm(fullText.slice(strongText.length));

  return { course: strongText, title };
}

function parseReceiveCell($: cheerio.CheerioAPI, td: AnyNode): {
  course: string;
  title: string;
} {
  const course = norm($(td).find("strong").first().text());
  const fullText = norm($(td).text());
  const title = norm(fullText.slice(course.length));
  return { course, title };
}

/**
 * Pull out CCSNH-style course code: prefix is 2-5 uppercase letters,
 * number is whatever follows (digits + optional suffix like "C", "L").
 * Falls back to splitting at the letter/digit boundary for entries
 * Keene publishes without a space (e.g. "CHEM138L", "VETA107W").
 */
function splitCourseCode(course: string): { prefix: string; number: string } | null {
  const m = course.match(/^([A-Z]{2,5})\s+(\S+)$/);
  if (m) return { prefix: m[1], number: m[2] };

  const squished = course.match(/^([A-Z]{2,5})(\d\S*)$/);
  if (squished) return { prefix: squished[1], number: squished[2] };

  return null;
}

function isElective(univCourse: string, univTitle: string): boolean {
  if (/elective/i.test(univTitle)) return true;
  // Keene's catch-all elective code looks like "DEPT-188" or "ELECT-188".
  if (/-188$/.test(univCourse)) return true;
  return false;
}

async function scrapeOne(cc: SendingCollege): Promise<TransferMapping[]> {
  const url = `${KEENE_BASE}/${cc.keeneSlug}/`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; cc-coursemap-scraper; +https://communitycollegepath.com)",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];
  const seen = new Set<string>();
  let bundlesSkipped = 0;
  let unparseableSkipped = 0;
  let duplicatesSkipped = 0;

  $("table tbody tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length < 3) return;

    const send = parseSendCell($, tds[0]);
    if (!send) {
      bundlesSkipped++;
      return;
    }

    const credits = norm($(tds[1]).find("strong").first().text() || $(tds[1]).text());
    const recv = parseReceiveCell($, tds[2]);

    const split = splitCourseCode(send.course);
    if (!split) {
      unparseableSkipped++;
      return;
    }

    // Keene occasionally publishes the same course twice on a single
    // page (e.g. lrcc's "CIS 140L" alongside "CIS140L"). Same source +
    // same prefix/number is semantically one mapping.
    const dedupeKey = `${split.prefix}|${split.number}`;
    if (seen.has(dedupeKey)) {
      duplicatesSkipped++;
      return;
    }
    seen.add(dedupeKey);

    mappings.push({
      cc_prefix: split.prefix,
      cc_number: split.number,
      cc_course: `${split.prefix} ${split.number}`,
      cc_title: send.title,
      cc_credits: credits,
      university: "keene",
      university_name: "Keene State College",
      univ_course: recv.course,
      univ_title: recv.title,
      univ_credits: "",
      notes: `[${cc.slug}]`,
      no_credit: false,
      is_elective: isElective(recv.course, recv.title),
    });
  });

  console.log(
    `  ${cc.slug.padEnd(9)} mappings=${mappings.length} skipped-bundles=${bundlesSkipped} skipped-unparseable=${unparseableSkipped} skipped-duplicates=${duplicatesSkipped}`
  );
  return mappings;
}

async function main() {
  const args = process.argv.slice(2);
  const skipImport = args.includes("--no-import");

  console.log("Keene State College — CCSNH Transfer Scraper\n");

  const all: TransferMapping[] = [];
  const failures: string[] = [];

  for (const cc of SENDING_COLLEGES) {
    try {
      const mappings = await scrapeOne(cc);
      all.push(...mappings);
    } catch (err) {
      console.error(`  ${cc.slug}: FAILED — ${(err as Error).message}`);
      failures.push(cc.slug);
    }
    await sleep(300);
  }

  if (failures.length === SENDING_COLLEGES.length) {
    console.error("\n  All sending colleges failed; not updating data file.");
    process.exit(1);
  }

  const directEquiv = all.filter((m) => !m.is_elective).length;
  const electives = all.filter((m) => m.is_elective).length;
  const prefixes = new Set(all.map((m) => m.cc_prefix));

  console.log("\n=== Summary ===");
  console.log(`  Total mappings: ${all.length}`);
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  Unique CCSNH prefixes: ${prefixes.size}`);
  if (failures.length > 0) {
    console.warn(
      `  Partial run: ${failures.length} sending college(s) failed: ${failures.join(", ")}`
    );
  }

  const outPath = path.join(process.cwd(), "data", "nh", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) existing = parsed as TransferMapping[];
  } catch {
    // No existing file — start fresh.
  }

  const nonKeene = existing.filter((m) => m.university !== "keene");
  const merged = [...nonKeene, ...all];

  console.log(
    `\n  Merged: ${nonKeene.length} non-keene preserved + ${all.length} keene = ${merged.length} total`
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Saved → ${outPath}`);

  if (!skipImport) {
    try {
      const imported = await importTransfersToSupabase("nh");
      if (imported > 0) {
        console.log(`Imported ${imported} rows to Supabase`);
      }
    } catch (err) {
      console.error(`Supabase import failed: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
