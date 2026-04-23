/**
 * scrape-catalog-prereqs.ts
 *
 * Scrapes prerequisite data from the CCSNH colleges' Clean Catalog sites.
 * 6 of 7 CCSNH colleges use Clean Catalog with a per-course URL scheme:
 *
 *   gbcc      catalog.greatbay.edu/classes
 *   lrcc      catalog.lrcc.edu/classes
 *   mccnh     catalog.mccnh.edu/courses      (note: /courses, not /classes)
 *   nhti      catalog.nhti.edu/classes
 *   rvcc      catalog.rivervalley.edu/classes
 *   wmcc      catalog.wmcc.edu/classes
 *
 * Nashua CC (nashuacc) uses a PDF catalog — not covered here; tracked as
 * future work in the follow-up issue.
 *
 * Clean Catalog structure (verified across all 6):
 *   - Listing pages at /{classes|courses}?page=N, paginated until empty
 *   - Each course lives at /{category-slug}/{coursecode} (code lowercased)
 *   - Course page has <h1>PREFIXNUMBER: Title</h1>
 *   - Prereqs in <div class="field field--name-field-prerequisite-courses">
 *     containing <a href="...">CODE: Title</a> entries
 *
 * Output: data/nh/prereqs.json — single flat object keyed by "PREFIX NUMBER"
 * with { text, courses, source } per entry. `source` is the CCSNH college
 * slug so downstream consumers can tell which college's catalog authored
 * the prereq (since the same course code can differ slightly across the
 * system's colleges).
 *
 * Usage:
 *   npx tsx scripts/nh/scrape-catalog-prereqs.ts
 *   npx tsx scripts/nh/scrape-catalog-prereqs.ts --college nhti
 *   npx tsx scripts/nh/scrape-catalog-prereqs.ts --limit-pages 2       # smoke test
 */

import * as fs from "fs";
import * as path from "path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const DELAY_MS = 100;

interface CollegeCatalog {
  slug: string;
  host: string;
  listingPath: "classes" | "courses";
}

const COLLEGES: CollegeCatalog[] = [
  { slug: "gbcc", host: "catalog.greatbay.edu", listingPath: "classes" },
  { slug: "lrcc", host: "catalog.lrcc.edu", listingPath: "classes" },
  { slug: "mccnh", host: "catalog.mccnh.edu", listingPath: "courses" },
  { slug: "nhti", host: "catalog.nhti.edu", listingPath: "classes" },
  { slug: "rvcc", host: "catalog.rivervalley.edu", listingPath: "classes" },
  { slug: "wmcc", host: "catalog.wmcc.edu", listingPath: "classes" },
];

interface PrereqEntry {
  text: string;
  courses: string[];
  source: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function retryFetch(url: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (res.ok) return res.text();
      if (res.status === 404) return "";
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`fetch ${url} failed: ${lastErr}`);
}

async function pmap<T, R>(
  items: T[],
  n: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        console.error(`  pmap[${idx}] error: ${e}`);
        results[idx] = undefined as unknown as R;
      }
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function htmlToText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/g, " ")
    .replace(/&#160;?/g, " ")
    .replace(/&#(\d+);?/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a raw course code like "ACCT113G" into { prefix: "ACCT", number: "113G" }. */
function splitCode(raw: string): { prefix: string; number: string } | null {
  const m = raw.toUpperCase().match(/^([A-Z]{2,5})(\d{2,4}[A-Z]{0,3})$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

/** Extract all distinct course paths from one listing page. */
function extractCoursePaths(html: string): string[] {
  const re = /href="(\/[a-z0-9-]+\/[a-z]{2,6}\d{2,4}[a-z]{0,3})"/gi;
  const paths = new Set<string>();
  let m;
  while ((m = re.exec(html)) !== null) paths.add(m[1]);
  return [...paths];
}

/** Parse one course page and return { code, prereq text, prereq codes } or null. */
function parseCoursePage(html: string): {
  prefix: string;
  number: string;
  text: string;
  courses: string[];
} | null {
  // Course code from <h1>PREFIXNUMBER: ...</h1>
  const h1Match = html.match(/<h1[^>]*>\s*([A-Z]{2,5}\d{2,4}[A-Z]{0,3})\s*:/i);
  if (!h1Match) return null;
  const split = splitCode(h1Match[1]);
  if (!split) return null;

  // Find the prereq courses block.
  const blockMatch = html.match(
    /<div[^>]*field--name-field-prerequisite-courses[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i
  );
  if (!blockMatch) return null;

  const block = blockMatch[1];

  // Course links inside the block. Anchor text is "PREFIXNUMBER: Title".
  const courses = new Set<string>();
  // Anchor text is typically "PREFIXNUMBER: Title" but some CCSNH catalogs
  // (e.g. RVCC) emit just "PREFIXNUMBER" — colon is optional.
  const linkRegex =
    /<a\s+href="\/[a-z0-9-]+\/[a-z]{2,6}\d{2,4}[a-z]{0,3}"[^>]*>\s*([A-Z]{2,5}\d{2,4}[A-Z]{0,3})\b/gi;
  let m;
  while ((m = linkRegex.exec(block)) !== null) {
    const s = splitCode(m[1]);
    if (!s) continue;
    const code = `${s.prefix} ${s.number}`;
    if (code !== `${split.prefix} ${split.number}`) courses.add(code);
  }

  if (courses.size === 0) return null;

  // Human-readable text: join prereq titles from the block.
  const text = htmlToText(block).replace(/^Prerequisite Courses\s*/i, "").trim();

  return {
    prefix: split.prefix,
    number: split.number,
    text,
    courses: [...courses].sort(),
  };
}

async function scrapeCollege(
  college: CollegeCatalog,
  limitPages: number
): Promise<Record<string, PrereqEntry>> {
  const base = `https://${college.host}`;
  console.log(`\n=== ${college.slug} (${college.host}) ===`);

  // Phase 1: enumerate course paths via pagination.
  const coursePaths = new Set<string>();
  for (let page = 0; ; page++) {
    if (limitPages > 0 && page >= limitPages) break;
    const html = await retryFetch(`${base}/${college.listingPath}?page=${page}`);
    const paths = extractCoursePaths(html);
    if (paths.length === 0) break;
    for (const p of paths) coursePaths.add(p);
    await sleep(DELAY_MS);
  }
  console.log(`  Found ${coursePaths.size} distinct course URLs`);

  // Phase 2: fetch each course page in parallel.
  const entries: Record<string, PrereqEntry> = {};
  const pathsList = [...coursePaths];
  let withPrereqs = 0;
  await pmap(pathsList, CONCURRENCY, async (p) => {
    const html = await retryFetch(`${base}${p}`);
    if (!html) return;
    const parsed = parseCoursePage(html);
    if (!parsed) return;
    const key = `${parsed.prefix} ${parsed.number}`;
    if (entries[key]) return; // first-seen wins within a college
    entries[key] = {
      text: parsed.text,
      courses: parsed.courses,
      source: college.slug,
    };
    withPrereqs++;
  });
  console.log(`  Parsed ${withPrereqs} courses with prereqs`);
  return entries;
}

async function main() {
  const args = process.argv.slice(2);
  const onlyCollege = args.includes("--college") ? args[args.indexOf("--college") + 1] : null;
  const limitPagesArg = args.includes("--limit-pages")
    ? parseInt(args[args.indexOf("--limit-pages") + 1], 10)
    : 0;

  const targets = onlyCollege
    ? COLLEGES.filter((c) => c.slug === onlyCollege)
    : COLLEGES;
  if (targets.length === 0) {
    console.error(`Unknown college: ${onlyCollege}. Available: ${COLLEGES.map((c) => c.slug).join(", ")}`);
    process.exit(1);
  }

  // Merge across colleges: when two colleges list the same course code with
  // different prereqs, the first-seen wins. We record `source` on each entry.
  const merged: Record<string, PrereqEntry> = {};
  let totalPerCollege: Record<string, number> = {};

  for (const college of targets) {
    const entries = await scrapeCollege(college, limitPagesArg);
    totalPerCollege[college.slug] = Object.keys(entries).length;
    for (const [key, entry] of Object.entries(entries)) {
      if (!merged[key]) merged[key] = entry;
    }
  }

  // Sort keys for deterministic output.
  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(merged).sort()) sorted[key] = merged[key];

  const outPath = path.join(process.cwd(), "data", "nh", "prereqs.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2) + "\n");

  console.log("\n=== Summary ===");
  for (const [slug, n] of Object.entries(totalPerCollege)) {
    console.log(`  ${slug.padEnd(8)} ${n} courses with prereqs`);
  }
  console.log(`  merged: ${Object.keys(sorted).length} unique course codes`);
  console.log(`  written → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
