/**
 * scrape-catalog-prereqs.ts — Washington State (SBCTC) acalog catalog prereqs.
 *
 * 11 of 34 SBCTC colleges publish public acalog or coursedog catalogs
 * (the rest have PDF-only or undiscoverable catalogs). We pull each
 * catalog's course-description pages, extract "Prerequisite(s):" blocks,
 * and merge into a single data/wa/prereqs.json keyed by "PREFIX NUMBER".
 *
 * ctcLink's class-search API does not expose prerequisite text inline,
 * so this catalog fallback is the only path to useful prereq data for WA.
 *
 * Tacoma CC (coursedog) is scraped via the shared Coursedog Playwright template.
 * The other 10 (Bellevue, Centralia, GHC, Green River, Highline, Olympic,
 * Pierce, Shoreline, Skagit Valley, North Seattle, Spokane Falls) use acalog.
 *
 * Re-run each summer when colleges publish new-year catalogs.
 *
 * Usage:
 *   npx tsx scripts/wa/scrape-catalog-prereqs.ts
 *   npx tsx scripts/wa/scrape-catalog-prereqs.ts --limit=20   # smoke test
 *   npx tsx scripts/wa/scrape-catalog-prereqs.ts --college=bellevue
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Catalog config — catoid and "Course Descriptions" navoid per college.
// Confirmed 2026-05-30 by probing each catalog's index page.
// ---------------------------------------------------------------------------
const ACALOG_CATALOGS: Array<{
  slug: string;
  name: string;
  base: string;
  catoid: number;
  navoid: number;
}> = [
  {
    slug: "bellevue-college",
    name: "Bellevue College",
    base: "https://catalog.bellevuecollege.edu",
    catoid: 16,
    navoid: 1106,
  },
  {
    slug: "centralia-college",
    name: "Centralia College",
    base: "https://catalog.centralia.edu",
    catoid: 6,
    navoid: 199,
  },
  {
    slug: "grays-harbor-college",
    name: "Grays Harbor College",
    base: "https://catalog.ghc.edu",
    catoid: 17,
    navoid: 706,
  },
  {
    slug: "green-river-college",
    name: "Green River College",
    base: "https://catalog.greenriver.edu",
    catoid: 10,
    navoid: 624,
  },
  {
    slug: "highline-college",
    name: "Highline College",
    base: "https://catalog.highline.edu",
    catoid: 31,
    navoid: 2070,
  },
  {
    slug: "olympic-college",
    name: "Olympic College",
    base: "https://catalog.olympic.edu",
    catoid: 24,
    navoid: 1250,
  },
  {
    slug: "pierce-college",
    name: "Pierce College",
    base: "https://catalog.pierce.ctc.edu",
    catoid: 19,
    navoid: 963,
  },
  {
    slug: "shoreline-community-college",
    name: "Shoreline Community College",
    base: "https://catalog.shoreline.edu",
    catoid: 8,
    navoid: 1082,
  },
  {
    slug: "skagit-valley-college",
    name: "Skagit Valley College",
    base: "https://catalog.skagit.edu",
    catoid: 35,
    navoid: 3328,
  },
  {
    slug: "north-seattle-college",
    name: "North Seattle College",
    base: "https://catalog.nscc.edu",
    catoid: 24,
    navoid: 1669,
  },
  {
    slug: "spokane-falls-community-college",
    name: "Spokane Falls Community College",
    base: "https://catalog.sfcc.edu",
    catoid: 12,
    navoid: 378,
  },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CONCURRENCY = 8;
const DELAY_MS = 60;
const MAX_PAGES = 30;

interface PrereqEntry {
  text: string;
  courses: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function retryFetch(
  url: string,
  label: string,
  attempts = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (res.ok) return res.text();
      if (res.status >= 500) lastErr = new Error(`HTTP ${res.status}`);
      else return ""; // 404 — skip silently
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

async function pmap<T, R>(
  items: T[],
  n: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
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

function listUrl(base: string, catoid: number, navoid: number, cpage: number): string {
  return (
    `${base}/content.php?catoid=${catoid}` +
    `&catoid=${catoid}` +
    `&navoid=${navoid}` +
    `&filter%5Bitem_type%5D=3` +
    `&filter%5Bonly_active%5D=1` +
    `&filter%5B3%5D=1` +
    `&filter%5Bcpage%5D=${cpage}`
  );
}

function detailUrl(base: string, catoid: number, coid: string): string {
  return `${base}/preview_course_nopop.php?catoid=${catoid}&coid=${coid}`;
}

function extractCoids(html: string): string[] {
  const matches =
    html.match(
      /preview_course_nopop\.php\?catoid=\d+&(?:amp;)?coid=(\d+)/g,
    ) || [];
  const ids = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/coid=(\d+)/);
    if (mm) ids.add(mm[1]);
  }
  return Array.from(ids);
}

function parseDetailPage(
  html: string,
): { prefix: string; number: string; text: string; courses: string[] } | null {
  const titleMatch = html.match(/<title>\s*([A-Z&]{1,6})\s*(\d{3,4}[A-Z]?)\s*-/);
  if (!titleMatch) return null;
  const prefix = titleMatch[1].toUpperCase();
  const number = titleMatch[2];

  const prereqMatch = html.match(
    /<strong>\s*Prerequisite(?:s|\(s\))?\s*:?\s*<\/strong>\s*([\s\S]*?)(?:<br\s*\/?>\s*<br|<\/p>|<strong>)/i,
  );
  if (!prereqMatch) return null;

  let text = prereqMatch[1]
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;?/g, " ")
    .replace(/&#160;?/g, " ")
    .replace(/&#(\d+);?/g, (_, code) =>
      String.fromCharCode(parseInt(code, 10)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  text = text.replace(/[.;,]\s*$/, "").trim();

  if (!text || /^none\b/i.test(text) || /^not applicable/i.test(text)) return null;

  const courses = new Set<string>();
  const codeRegex = /\b([A-Z&]{2,6})\s*(\d{3,4}[A-Z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = codeRegex.exec(text)) !== null) {
    const code = `${m[1]} ${m[2]}`;
    if (code === `${prefix} ${number}`) continue;
    courses.add(code);
  }

  return { prefix, number, text, courses: Array.from(courses).sort() };
}

async function scrapeAcalogCollege(
  college: (typeof ACALOG_CATALOGS)[number],
  limit: number,
): Promise<Map<string, PrereqEntry>> {
  const results = new Map<string, PrereqEntry>();
  console.log(`\n--- ${college.name} (${college.slug}) ---`);

  // Paginate course list
  const allCoids = new Set<string>();
  for (let cpage = 1; cpage <= MAX_PAGES; cpage++) {
    const html = await retryFetch(
      listUrl(college.base, college.catoid, college.navoid, cpage),
      `list(${college.slug}, cpage=${cpage})`,
    );
    const coids = extractCoids(html);
    if (coids.length === 0) break;
    for (const c of coids) allCoids.add(c);
    await sleep(100);
  }

  let coidList = Array.from(allCoids);
  console.log(`  Total coids: ${coidList.length}`);
  if (limit > 0) {
    coidList = coidList.slice(0, limit);
    console.log(`  Limited to first ${limit}`);
  }

  // Fetch detail pages
  let seen = 0;
  let withPrereqs = 0;
  await pmap(coidList, CONCURRENCY, async (coid) => {
    const html = await retryFetch(
      detailUrl(college.base, college.catoid, coid),
      `detail(${college.slug}, ${coid})`,
    );
    seen++;
    if (seen % 200 === 0) {
      console.log(`  ${seen}/${coidList.length} (${withPrereqs} with prereqs)`);
    }
    if (!html) return;
    const parsed = parseDetailPage(html);
    if (!parsed) return;
    const key = `${parsed.prefix} ${parsed.number}`;
    if (results.has(key)) return;
    results.set(key, { text: parsed.text, courses: parsed.courses });
    withPrereqs++;
  });

  console.log(`  ${withPrereqs} courses with prereqs`);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(
    args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0",
    10,
  );
  const collegeFilter = args.find((a) => a.startsWith("--college="))?.split("=")[1];

  let catalogs = ACALOG_CATALOGS;
  if (collegeFilter) {
    catalogs = ACALOG_CATALOGS.filter(
      (c) => c.slug.includes(collegeFilter) || c.name.toLowerCase().includes(collegeFilter.toLowerCase()),
    );
    if (catalogs.length === 0) {
      console.error(`Unknown college: ${collegeFilter}`);
      process.exit(1);
    }
    console.log(`Scraping ${catalogs.length} catalog(s) matching "${collegeFilter}"`);
  } else {
    console.log(`Scraping ${catalogs.length} WA acalog catalogs`);
  }

  const merged: Record<string, PrereqEntry> = {};
  for (const college of catalogs) {
    try {
      const entries = await scrapeAcalogCollege(college, limit);
      for (const [key, entry] of entries) {
        if (!merged[key]) merged[key] = entry;
      }
    } catch (e) {
      console.error(`  ⚠ ${college.slug} failed: ${e}`);
    }
  }

  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(merged).sort()) sorted[key] = merged[key];

  const outDir = path.join(process.cwd(), "data", "wa");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ Wrote ${Object.keys(sorted).length} prereqs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
