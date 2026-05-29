/**
 * scrape-catalog-prereqs.ts — Southeast Technical College acalog catalog.
 *
 * Why this exists: SD course-section data (Southeast Tech's Jenzabar STI
 * portlet, OLC's PDF schedules) carries no prerequisite text. The
 * aggregate-from-courses pipeline therefore yields 0 entries. Acalog
 * course-detail pages reliably publish "Prerequisite(s):" blocks inside
 * the description paragraph, so we scrape those directly.
 *
 * Source: Southeast Tech catalog at catalog.southeasttech.edu
 *   - catoid = 35   (2026-2027 catalog)
 *   - navoid = 27244 (Course Descriptions)
 *
 * NOT catalog.southeast.edu — that's a different "Southeast Community
 * College" in Nebraska. The orchestrator's programs discovery in #701
 * confused the two; do not regress.
 *
 * Coverage caveat: this catalog ONLY covers Southeast Tech course codes
 * (BIOL 105, ENGL 101, etc.). The other 5 SD colleges aren't in it. Other
 * SD colleges' course numbering systems differ (e.g. OLC's "Lak 103",
 * "ECH 223") so collisions are rare in practice. Frontend looks up
 * prereqs by `${prefix} ${number}`; we ship Southeast Tech's keys verbatim.
 *
 * Re-run when Southeast publishes a new catoid each summer.
 *
 * Usage:
 *   npx tsx scripts/sd/scrape-catalog-prereqs.ts
 *   npx tsx scripts/sd/scrape-catalog-prereqs.ts --limit=20   # smoke test
 */

import * as fs from "fs";
import * as path from "path";

const BASE = "https://catalog.southeasttech.edu";
const CATOID = 35;
const NAVOID = 27244;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 8;
const DELAY_MS = 50;
const MAX_PAGES = 20;

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
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return ""; // 404 — skip silently
      }
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

function listUrl(cpage: number): string {
  return (
    `${BASE}/content.php?catoid=${CATOID}` +
    `&catoid=${CATOID}` +
    `&navoid=${NAVOID}` +
    `&filter%5Bitem_type%5D=3` +
    `&filter%5Bonly_active%5D=1` +
    `&filter%5B3%5D=1` +
    `&filter%5Bcpage%5D=${cpage}`
  );
}

function detailUrl(coid: string): string {
  return `${BASE}/preview_course_nopop.php?catoid=${CATOID}&coid=${coid}`;
}

function extractCoids(html: string): string[] {
  const matches =
    html.match(/preview_course_nopop\.php\?catoid=\d+&(?:amp;)?coid=(\d+)/g) ||
    [];
  const ids = new Set<string>();
  for (const m of matches) {
    const mm = m.match(/coid=(\d+)/);
    if (mm) ids.add(mm[1]);
  }
  return Array.from(ids);
}

/**
 * Parse a course detail page. Southeast Tech uses 2-5 letter prefixes
 * with 3-digit course numbers (e.g. "AB 110", "ENGL 101", "MA 107").
 * Acalog renders these as e.g. "AB 110 - Intro to Auto Body Repair & Safety -"
 * in <title>.
 */
function parseDetailPage(
  html: string,
): { prefix: string; number: string; text: string; courses: string[] } | null {
  const titleMatch = html.match(
    /<title>\s*([A-Z]{1,5})\s*(\d{3,4}[A-Z]?)\s*-/,
  );
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

  if (!text) return null;
  if (/^none\b/i.test(text)) return null;
  if (/^not applicable/i.test(text)) return null;

  // Southeast Tech course codes: 1-5 letter prefix + 3-digit number
  // (optionally with trailing letter, e.g. "CA 220" or "MATH 102").
  const courses = new Set<string>();
  const codeRegex = /\b([A-Z]{1,5})\s+(\d{3,4}[A-Z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = codeRegex.exec(text)) !== null) {
    const code = `${m[1]} ${m[2]}`;
    if (code === `${prefix} ${number}`) continue;
    courses.add(code);
  }

  return { prefix, number, text, courses: Array.from(courses).sort() };
}

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(
    args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0",
    10,
  );

  console.log("SD catalog prereq scraper (source: Southeast Tech acalog)");
  console.log(`  Base: ${BASE}`);
  console.log(`  catoid=${CATOID} navoid=${NAVOID}`);

  console.log("\n[1/2] Paginating course list...");
  const allCoids = new Set<string>();
  for (let cpage = 1; cpage <= MAX_PAGES; cpage++) {
    const html = await retryFetch(listUrl(cpage), `list(cpage=${cpage})`);
    const coids = extractCoids(html);
    console.log(`  cpage=${cpage}: ${coids.length} coids`);
    if (coids.length === 0) break;
    for (const c of coids) allCoids.add(c);
    await sleep(100);
  }
  let coidList = Array.from(allCoids);
  console.log(`  Total unique coids: ${coidList.length}`);

  if (limit > 0) {
    coidList = coidList.slice(0, limit);
    console.log(`  Limited to first ${limit} for smoke test`);
  }

  console.log("\n[2/2] Fetching detail pages...");
  const prereqs: Record<string, PrereqEntry> = {};
  let seen = 0;
  let withPrereqs = 0;
  await pmap(coidList, CONCURRENCY, async (coid) => {
    const html = await retryFetch(detailUrl(coid), `detail(${coid})`);
    seen++;
    if (seen % 100 === 0) {
      console.log(
        `  ${seen}/${coidList.length} courses (${withPrereqs} with prereqs)`,
      );
    }
    if (!html) return;
    const parsed = parseDetailPage(html);
    if (!parsed) return;
    const key = `${parsed.prefix} ${parsed.number}`;
    if (prereqs[key]) return;
    prereqs[key] = { text: parsed.text, courses: parsed.courses };
    withPrereqs++;
  });
  console.log(`  Parsed ${seen}/${coidList.length} detail pages`);
  console.log(`  Extracted prereqs for ${Object.keys(prereqs).length} courses`);

  const outDir = path.join(process.cwd(), "data", "sd");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");
  fs.writeFileSync(outPath, JSON.stringify(prereqs, null, 2));
  console.log(`\n✓ Wrote ${Object.keys(prereqs).length} prereqs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
