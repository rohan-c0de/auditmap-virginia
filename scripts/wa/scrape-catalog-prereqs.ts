/**
 * scrape-catalog-prereqs.ts — Washington State (SBCTC) acalog catalog prereqs.
 *
 * 15 of 34 SBCTC colleges publish public acalog catalogs (the rest are
 * CourseLeaf/CleanCatalog/custom — see scrape-programs.ts — or have no
 * public catalog). We pull each catalog's course-description pages, extract
 * "Prerequisite(s):" blocks, and merge into a single data/wa/prereqs.json
 * keyed by "PREFIX NUMBER".
 *
 * ctcLink's class-search API does not expose prerequisite text inline,
 * so this catalog fallback is the only path to useful prereq data for WA.
 *
 * The acalog hosts sit behind AWS WAF bot protection: a flagged client gets
 * HTTP 202 with an empty body (x-amzn-waf-action: challenge) instead of
 * content. A headless Chromium pass solves the JS challenge and yields an
 * aws-waf-token cookie that plain fetch() can then carry (same mechanism as
 * scripts/mn/scrape-catalog-prereqs.ts). Tokens are re-acquired mid-run if
 * a challenge reappears.
 *
 * Each catalog's <title> is verified against the college name before
 * scraping. Two earlier entries failed this check and were removed:
 * catalog.nscc.edu is Nashville State CC (TN), not North Seattle, and
 * catalog.sfcc.edu is Santa Fe CC (NM), not Spokane Falls — name-guessed
 * hosts that would have merged out-of-state prereqs into WA. Spokane's
 * colleges (SCC/SFCC) live on the custom catalog.spokane.edu site instead
 * (see scrape-ccs-catalog.ts); Seattle Colleges publish no scrapeable
 * catalog (catalog.seattlecolleges.edu is a redirect loop).
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
import { chromium } from "playwright";

// ---------------------------------------------------------------------------
// Catalog config — catoid and "Course Descriptions" navoid per college.
// Confirmed 2026-05-30 by probing each catalog's index page; titles
// re-verified 2026-06-10 (which is when the TN/NM impostors were caught).
// `expectTitle` must appear in the catalog page <title> or the college is
// skipped — this is the guard against name-guessed wrong-school hosts.
// ---------------------------------------------------------------------------
const ACALOG_CATALOGS: Array<{
  slug: string;
  name: string;
  base: string;
  catoid: number;
  navoid: number;
  expectTitle: string;
}> = [
  {
    slug: "bellevue-college",
    name: "Bellevue College",
    base: "https://catalog.bellevuecollege.edu",
    catoid: 16,
    navoid: 1106,
    expectTitle: "Bellevue College",
  },
  {
    slug: "centralia-college",
    name: "Centralia College",
    base: "https://catalog.centralia.edu",
    catoid: 6,
    navoid: 199,
    expectTitle: "Centralia College",
  },
  {
    slug: "grays-harbor-college",
    name: "Grays Harbor College",
    base: "https://catalog.ghc.edu",
    catoid: 17,
    navoid: 706,
    expectTitle: "Grays Harbor",
  },
  {
    slug: "green-river-college",
    name: "Green River College",
    base: "https://catalog.greenriver.edu",
    catoid: 10,
    navoid: 624,
    expectTitle: "Green River",
  },
  {
    slug: "highline-college",
    name: "Highline College",
    base: "https://catalog.highline.edu",
    catoid: 31,
    navoid: 2070,
    expectTitle: "Highline",
  },
  {
    slug: "olympic-college",
    name: "Olympic College",
    base: "https://catalog.olympic.edu",
    catoid: 24,
    navoid: 1250,
    expectTitle: "Olympic College",
  },
  {
    slug: "pierce-college",
    name: "Pierce College",
    base: "https://catalog.pierce.ctc.edu",
    catoid: 19,
    navoid: 963,
    expectTitle: "Pierce College",
  },
  {
    slug: "shoreline-community-college",
    name: "Shoreline Community College",
    base: "https://catalog.shoreline.edu",
    catoid: 8,
    navoid: 1082,
    expectTitle: "Shoreline",
  },
  {
    slug: "skagit-valley-college",
    name: "Skagit Valley College",
    base: "https://catalog.skagit.edu",
    catoid: 35,
    navoid: 3328,
    expectTitle: "Skagit Valley",
  },
  // The six below were found 2026-06-10: they probe as HTTP 202 (WAF
  // challenge) to plain fetch, which is why the original 2026-05-30 sweep
  // missed them — a 202 looked like "no catalog".
  {
    slug: "bellingham-technical-college",
    name: "Bellingham Technical College",
    base: "https://catalog.btc.edu",
    catoid: 15,
    navoid: 386,
    expectTitle: "Bellingham Technical",
  },
  {
    slug: "edmonds-college",
    name: "Edmonds College",
    base: "https://catalog.edmonds.edu",
    catoid: 68,
    navoid: 20378,
    expectTitle: "Edmonds College",
  },
  {
    slug: "lake-washington-institute-of-technology",
    name: "Lake Washington Institute of Technology",
    base: "https://catalog.lwtech.edu",
    catoid: 20,
    navoid: 1149,
    expectTitle: "Lake Washington",
  },
  {
    slug: "renton-technical-college",
    name: "Renton Technical College",
    base: "https://catalog.rtc.edu",
    catoid: 23,
    navoid: 1375,
    expectTitle: "Renton Technical",
  },
  {
    slug: "walla-walla-community-college",
    name: "Walla Walla Community College",
    base: "https://catalog.wwcc.edu",
    catoid: 6,
    navoid: 286,
    // Must include "Community College": catalog.wallawalla.edu is Walla
    // Walla UNIVERSITY (private) — another name-guess trap.
    expectTitle: "Walla Walla Community College",
  },
  {
    slug: "yakima-valley-college",
    name: "Yakima Valley College",
    base: "https://catalog.yvcc.edu",
    catoid: 12,
    navoid: 768,
    expectTitle: "Yakima Valley",
  },
  // north-seattle-college: catalog.nscc.edu is Nashville State CC (TN) — no
  // public Seattle Colleges catalog found (catalog.seattlecolleges.edu loops).
  // spokane-falls-community-college: catalog.sfcc.edu is Santa Fe CC (NM) —
  // real catalog is the custom catalog.spokane.edu (scrape-ccs-programs.ts).
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CONCURRENCY = 6;
const DELAY_MS = 100;
const MAX_PAGES = 30;

interface PrereqEntry {
  text: string;
  courses: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// AWS WAF token acquisition. A flagged client gets HTTP 202 + empty body on
// every request; a headless Chromium visit solves the JS challenge and sets
// an aws-waf-token cookie valid for subsequent plain fetches on that host.
// Acquisition is deduped per host so concurrent workers don't stampede.
// ---------------------------------------------------------------------------
const wafCookies = new Map<string, string>();
const wafInFlight = new Map<string, Promise<string>>();

async function acquireWafCookies(base: string, force = false): Promise<string> {
  if (!force) {
    const cached = wafCookies.get(base);
    if (cached) return cached;
  }
  const inFlight = wafInFlight.get(base);
  if (inFlight) return inFlight;

  const p = (async () => {
    console.log(`  Acquiring WAF token via headless browser: ${base}`);
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({ userAgent: UA });
      const page = await ctx.newPage();
      await page.goto(base, { waitUntil: "networkidle", timeout: 45_000 });
      // Give the challenge JS a moment to set the token cookie.
      await page.waitForTimeout(2_000);
      const cookies = await ctx.cookies();
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      if (!cookies.some((c) => c.name === "aws-waf-token")) {
        console.log(`  ⚠ no aws-waf-token cookie acquired for ${base}`);
      }
      wafCookies.set(base, cookieStr);
      return cookieStr;
    } finally {
      await browser.close();
      wafInFlight.delete(base);
    }
  })();
  wafInFlight.set(base, p);
  return p;
}

function isWafChallenge(status: number, body: string): boolean {
  // This WAF variant answers 202 with an empty body; the MN variant answers
  // 200 with a short interstitial containing "awswaf". Catch both.
  if (status === 202) return true;
  return body.length < 5_000 && body.includes("awswaf");
}

async function retryFetch(
  url: string,
  label: string,
  attempts = 4,
): Promise<string> {
  const base = new URL(url).origin;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const headers: Record<string, string> = {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `${base}/`,
      };
      const cookies = wafCookies.get(base);
      if (cookies) headers["Cookie"] = cookies;
      const res = await fetch(url, { headers });
      const body = res.ok || res.status === 202 ? await res.text() : "";
      if (isWafChallenge(res.status, body)) {
        await acquireWafCookies(base, i > 0);
        continue;
      }
      if (res.ok) return body;
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
  // Title separators vary by catalog: "ACCT 110 - ..." (Bellevue) vs
  // "ACCT 110&nbsp;-&nbsp;..." (Green River, Highline). The prefix may end
  // in WA's common-course-numbering "&" (ENGL& 101), which raw HTML encodes
  // as "&amp;".
  const titleMatch = html.match(
    /<title>\s*([A-Z]{1,6})(&amp;|&)?(?:\s|&nbsp;?|&#160;?| )*(\d{3,4}[A-Z]?)(?:\s|&nbsp;?|&#160;?| )*-/,
  );
  if (!titleMatch) return null;
  const prefix = (titleMatch[1] + (titleMatch[2] ? "&" : "")).toUpperCase();
  const number = titleMatch[3];

  // Label varies by catalog: "Prerequisite(s):" (Bellevue, Centralia) vs
  // "Enrollment Requirement:" (Green River, Highline).
  const prereqMatch = html.match(
    /<strong>(?:\s|&nbsp;?|&#160;?| )*(?:Prerequisite(?:s|\(s\))?|Enrollment Requirements?|Requisites?)(?:\s|&nbsp;?|&#160;?| )*:?(?:\s|&nbsp;?|&#160;?| )*<\/strong>(?:\s|&nbsp;?|&#160;?| )*:?\s*([\s\S]*?)(?:<br\s*\/?>\s*<br|<\/p>|<strong>)/i,
  );
  if (!prereqMatch) return null;

  let text = prereqMatch[1]
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;?/g, " ")
    .replace(/&#160;?/g, " ")
    .replace(/ /g, " ")
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
    if (cpage === 1) {
      const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
      if (!title.toLowerCase().includes(college.expectTitle.toLowerCase())) {
        console.error(
          `  ✗ SKIPPING ${college.slug}: catalog title "${title}" does not ` +
            `contain "${college.expectTitle}" — wrong-school host?`,
        );
        return results;
      }
      console.log(`  Title OK: "${title}"`);
    }
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

  // Don't clobber a good prereqs.json with a near-empty one when the WAF (or
  // a catalog outage) hollowed out the run. Full-run floor: ~9 catalogs at
  // hundreds of prereqs each. Skip the guard for --limit/--college runs.
  const isPartialRun = limit > 0 || Boolean(collegeFilter);
  const total = Object.keys(sorted).length;
  if (!isPartialRun && total < 500 && fs.existsSync(outPath)) {
    console.error(
      `✗ Refusing to overwrite ${outPath}: only ${total} prereqs scraped ` +
        `(floor 500) — leaving existing data untouched.`,
    );
    process.exit(1);
  }
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ Wrote ${total} prereqs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
