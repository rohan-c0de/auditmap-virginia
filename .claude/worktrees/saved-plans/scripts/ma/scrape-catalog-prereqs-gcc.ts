/**
 * scrape-catalog-prereqs-gcc.ts
 *
 * Scrapes Greenfield Community College's Coursedog-powered catalog at
 * https://catalog.gcc.mass.edu to extract prereq text for every active
 * course. GCC uses Banner 8 for scheduling; the primary course scraper
 * (scripts/ma/scrape-banner8.ts) can't read prereqs from Banner 8's
 * schedule HTML, so this catalog scrape fills the gap.
 *
 * Coursedog API pattern (discovered via browser devtools):
 *   POST https://app.coursedog.com/api/v1/cm/gcc_banner_sql/courses/search/$filters
 *     ?catalogId=Tq3vInBCVkfzBa5krhiu
 *     &skip=N&limit=100
 *     &orderBy=subjectCode
 *     &formatDependents=false
 *     &effectiveDatesRange=YYYY-MM-DD,YYYY-MM-DD
 *     &ignoreEffectiveDating=false
 *     &columns=code,description,subjectCode,courseNumber,...
 *   Referer: https://catalog.gcc.mass.edu/
 *   body: {}
 *
 * Auth: none required, but Referer/Origin headers are checked.
 *
 * Prereq extraction: GCC embeds prereqs as free text in the `description`
 * field, e.g. "…spreadsheet software.\nPrereq: ACC 151". The parser looks
 * for common prefixes ("Prereq:", "Prerequisite:", "Prerequisites:") and
 * extracts course-code refs like "ACC 151" or "ACC151" from the trailing
 * text.
 *
 * Output: data/ma/prereqs-gcc.json keyed by "${PREFIX} ${NUMBER}".
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-catalog-prereqs-gcc.ts
 *   npx tsx scripts/ma/scrape-catalog-prereqs-gcc.ts --limit=200   # smoke test
 */

import * as fs from "fs";
import * as path from "path";
import { discoverCoursedogCatalog } from "../lib/discover-catalog.js";

let CATALOG_ID = "Tq3vInBCVkfzBa5krhiu"; // fallback — auto-discovered at runtime
const SCHOOL = "gcc_banner_sql";
const BASE = `https://app.coursedog.com/api/v1/cm/${SCHOOL}/courses/search/%24filters`;
const REFERER = "https://catalog.gcc.mass.edu/";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PAGE_SIZE = 100;
const DELAY_MS = 150;

interface CoursedogCourse {
  code: string;
  courseNumber: string;
  subjectCode: string;
  description?: string;
  displayName?: string;
  globalCourseTitle?: string;
}

interface CoursedogResponse {
  listLength: number;
  data: CoursedogCourse[];
  limit: number;
  skip: number;
}

interface PrereqEntry {
  text: string;
  courses: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchPage(skip: number, limit: number): Promise<CoursedogResponse> {
  const today = new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    catalogId: CATALOG_ID,
    skip: String(skip),
    limit: String(limit),
    orderBy: "subjectCode",
    formatDependents: "false",
    effectiveDatesRange: `${today},${today}`,
    ignoreEffectiveDating: "false",
    columns: "code,subjectCode,courseNumber,description,displayName",
  });
  const url = `${BASE}?${params.toString()}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Referer: REFERER,
        Origin: REFERER.replace(/\/$/, ""),
      },
      body: "{}",
    });
    if (resp.ok) return resp.json();
    if (resp.status >= 500) {
      await sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }
  throw new Error(`Exhausted retries at skip=${skip}`);
}

/**
 * Pull prereq text from a course description. Returns the prereq span and
 * any course codes referenced within, or null if no prereq info is present.
 *
 * Handles these GCC patterns observed in the catalog:
 *   "…spreadsheet software.\nPrereq: ACC 151"
 *   "…Prerequisite: ENG 101 or placement test"
 *   "…Prerequisites: MAT 105 and MAT 108"
 *   "…Prereq or Coreq: ENG 101"
 *   "…Prereq: Sophomore standing"  (no course refs — text-only)
 */
function parsePrereq(description: string, selfCode: string): PrereqEntry | null {
  if (!description) return null;
  // Find first "Prereq" or "Prerequisite(s)" label and take everything after.
  const m = description.match(/\b(Prereq(?:uisite)?s?(?:\s+or\s+Coreq)?)\s*:\s*([^\n]+)/i);
  if (!m) return null;
  let text = m[2].trim();
  // Trim trailing "Coreq:" clauses and junk punctuation.
  text = text.replace(/\s+Coreq(?:uisite)?s?\s*:.*$/i, "").trim();
  if (!text || text.toLowerCase() === "none") return null;

  // Extract PREFIX NUMBER pairs — either "ACC 151" (with space) or "ACC151"
  // (without). GCC's Banner data uses "ACC 151" so we normalize with a space.
  const courses = new Set<string>();
  const codeRegex = /\b([A-Z]{2,5})\s?(\d{2,4}[A-Z]?)\b/g;
  let codeMatch;
  while ((codeMatch = codeRegex.exec(text)) !== null) {
    const key = `${codeMatch[1]} ${codeMatch[2]}`;
    if (key !== selfCode) courses.add(key);
  }

  return { text, courses: [...courses].sort() };
}

function splitCode(raw: string): { prefix: string; number: string } | null {
  // "ACC152" → {ACC, 152}, or "ACC 152" → same
  const m = raw.toUpperCase().match(/^([A-Z]{2,5})\s?(\d{2,4}[A-Z]{0,3})$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limitCap = limitArg ? parseInt(limitArg.split("=")[1]) : 0;

  console.log("GCC Coursedog prereq scraper");
  console.log(`  BASE: ${BASE}`);
  CATALOG_ID = await discoverCoursedogCatalog(SCHOOL, REFERER, CATALOG_ID);
  console.log(`  catalogId: ${CATALOG_ID}\n`);

  // --- Phase 1: discover total count ---
  console.log("[1/2] Probing course count...");
  const first = await fetchPage(0, 1);
  const total = limitCap > 0 ? Math.min(limitCap, first.listLength) : first.listLength;
  console.log(`  ${first.listLength} total courses; scraping ${total}\n`);

  // --- Phase 2: paginate ---
  console.log("[2/2] Paginating...");
  const entries: Record<string, PrereqEntry> = {};
  let fetched = 0;
  let skipped = 0;
  for (let skip = 0; skip < total; skip += PAGE_SIZE) {
    const page = await fetchPage(skip, Math.min(PAGE_SIZE, total - skip));
    for (const course of page.data) {
      const split = splitCode(course.code);
      if (!split) continue;
      const selfKey = `${split.prefix} ${split.number}`;
      const parsed = parsePrereq(course.description || "", selfKey);
      if (!parsed) {
        skipped++;
        continue;
      }
      // Collapse duplicates: Coursedog returns one row per effective-dated
      // version of a course. Keep the most recent (last one wins since
      // they're ordered subjectCode-first, which groups versions together).
      entries[selfKey] = parsed;
      fetched++;
    }
    process.stdout.write(`  skip=${skip.toString().padStart(4)} → ${page.data.length} rows; running total prereqs=${Object.keys(entries).length}\n`);
    await sleep(DELAY_MS);
  }

  console.log(`\n  parsed ${fetched} prereq rows; ${skipped} courses had no prereq text`);

  // --- Merge into data/ma/prereqs.json ---
  //
  // See scrape-catalog-prereqs-middlesex.ts for why we merge rather than
  // write a separate file. Same logic: replace our own source's entries,
  // stash collisions with another source under "gcc:KEY".
  const SOURCE = "gcc";
  const outDir = path.join(process.cwd(), "data", "ma");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");

  type MergedEntry = PrereqEntry & { source: string };
  let existing: Record<string, MergedEntry> = {};
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch {
    /* no existing file — fresh start */
  }

  for (const k of Object.keys(existing)) {
    if (existing[k].source === SOURCE) delete existing[k];
  }
  let preserved = 0;
  for (const [key, entry] of Object.entries(entries)) {
    if (existing[key]) {
      existing[`${SOURCE}:${key}`] = { ...entry, source: SOURCE };
    } else {
      existing[key] = { ...entry, source: SOURCE };
      preserved++;
    }
  }

  const sorted: Record<string, MergedEntry> = {};
  for (const key of Object.keys(existing).sort()) sorted[key] = existing[key];
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ Merged ${Object.keys(entries).length} GCC prereqs into ${outPath}`);
  console.log(`  (${preserved} fresh keys + ${Object.keys(entries).length - preserved} collision-suffixed)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
