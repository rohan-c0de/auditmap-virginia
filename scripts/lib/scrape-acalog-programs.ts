/**
 * scrape-acalog-programs.ts — shared Acalog program scraper library.
 *
 * Extracts degree/certificate program requirements from any Acalog-powered
 * college catalog. Reusable across states — each state scraper passes its
 * catalog URL, catoid, and program navoid(s).
 *
 * Architecture (parallels the course prereq scrapers):
 *   1. Discover catoid via discover-catalog.ts
 *   2. Scrape program listing pages, collect poids
 *   3. Fetch each program detail page
 *   4. Parse requirement groups, course lists, OR alternatives
 *
 * Output: CollegePrograms matching lib/schemas.ts
 */

import { chromium, type Browser, type BrowserContext } from "playwright";
import { discoverAcalogCatoid } from "./discover-catalog.js";
import type {
  CollegePrograms,
  ProgramRequirement,
  RequirementGroup,
  RequiredCourse,
} from "../../lib/types";
import type { ProgramCredential } from "../../lib/types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AcalogProgramConfig {
  collegeSlug: string;
  baseUrl: string;
  catoidFallback: number;
  /** Navoids to scan for program links. Multiple for catalogs that split
   *  programs across "schools" (e.g. CT State: Business, STEM, etc.). */
  programNavoids: number[];
  /** If true, auto-discover catoid from the catalog dropdown. Default true. */
  autoDiscoverCatoid?: boolean;
  /** If true, discover programs via search_advanced.php instead of navoids.
   *  Needed for catalogs where program listing pages are JS-rendered. */
  useSearchDiscovery?: boolean;
  /** If true, use Playwright (headless Chromium) for ALL requests. Required
   *  for catalogs behind AWS WAF JS-challenge (returns 202 + JS token page
   *  on plain fetch). The browser solves the challenge automatically; the
   *  session cookie is reused for subsequent page-fetches in the same context.
   *  Example: catalog.ladelta.edu (Louisiana Delta CC). */
  usePlaywright?: boolean;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const DELAY_MS = 80;

// ---------------------------------------------------------------------------
// HTTP helpers (same pattern as CT prereq scraper)
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function retryFetch(
  url: string,
  label: string,
  attempts = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      // Some Acalog catalogs sit behind AWS WAF Bot Control:
      //   - TBR colleges (NSCC, Northeast, Southwest TN, Volunteer, Walters)
      //     just need the full Chrome-like header set.
      //   - 5 VCCS colleges (RCC, TCC, VPCC, VWCC, WCC) also require
      //     Sec-Fetch-Site: same-origin + a Referer to look like an in-site
      //     navigation. Without it, the WAF returns a 1991-byte JS challenge
      //     page (200 OK with empty preview_program links).
      // Both are harmless on catalogs without WAF.
      const u = new URL(url);
      const referer = `${u.protocol}//${u.host}/`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          Referer: referer,
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        },
      });
      if (res.ok) return res.text();
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return "";
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

// ---------------------------------------------------------------------------
// Playwright helpers — used when usePlaywright:true (AWS WAF JS-challenge)
// ---------------------------------------------------------------------------

/** Fetch a URL via a live Playwright page so the browser can solve any
 *  AWS WAF / Cloudflare JS challenge. Reuses the same BrowserContext so
 *  the WAF session cookie is retained across multiple page fetches. */
async function playwrightFetch(
  ctx: BrowserContext,
  url: string,
): Promise<string> {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    // AWS WAF JS-challenge pages are typically ≤2 KB and auto-redirect once
    // the token is solved. Wait an extra beat to ensure the real page loaded.
    const html = await page.content();
    if (html.length < 5_000 && html.includes("awswaf")) {
      // Challenge page — wait for real navigation
      await page.waitForNavigation({ timeout: 15_000 }).catch(() => {});
      return page.content();
    }
    return html;
  } finally {
    await page.close();
  }
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

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function htmlToText(raw: string): string {
  return raw
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
}

// ---------------------------------------------------------------------------
// Parsing — program list
// ---------------------------------------------------------------------------

function extractPoids(html: string): string[] {
  const re = /preview_program\.php\?catoid=\d+&(?:amp;)?poid=(\d+)/g;
  const ids = new Set<string>();
  let m;
  while ((m = re.exec(html)) !== null) {
    ids.add(m[1]);
  }
  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// Parsing — program detail page
// ---------------------------------------------------------------------------

/** Parse credential type from the H1 title text. */
function parseCredential(title: string): ProgramCredential {
  const t = title.toLowerCase();
  if (/\baas\b|associate of applied science/i.test(t)) return "AAS";
  if (/\ba\.?a\.?\b|associate of arts/i.test(t)) return "AA";
  if (/\ba\.?s\.?\b|associate of science/i.test(t)) return "AS";
  if (/\bcertificate\b|\bcert\b/i.test(t)) return "certificate";
  if (/\bdiploma\b/i.test(t)) return "diploma";
  // Heuristic: if "associate" appears without a more specific match
  if (/\bassociate\b/i.test(t)) return "AA";
  return "other";
}

/** Extract program code from H1 if present, e.g. "(BSAD-AA-TAP)" or "- 718" */
function parseProgramCode(title: string): string | null {
  // Parenthesized code like "(BSAD-AA-TAP)"
  const paren = title.match(/\(([A-Z0-9][-A-Z0-9]+)\)\s*$/);
  if (paren) return paren[1];
  // Trailing code after " - " that's all digits, e.g. "Technical Studies - AAS - 718"
  const trailing = title.match(/\s+-\s+(\d{3,})\s*$/);
  if (trailing) return trailing[1];
  return null;
}

/**
 * Parse a single course list item.
 * Handles every format observed across ~23 Acalog catalogs (2026-06):
 *   - "ENG 1010 - Composition"                            CT State, Germanna (dash separator)
 *   - "BUS 116: Entrepreneurship"                         Germanna (colon separator)
 *   - "ACG2021 - Financial Accounting"                    cf (FL): NO space between prefix and number
 *   - "ACA 122 Transfer & Career Success (1 Credit Hour)" gaston (NC): no separator, trailing credit suffix
 *   - "ENG 1010"                                          code only
 *
 * Pattern: PREFIX, optional space, NUMBER (with optional letter suffix),
 * word boundary, then anything (treated as the title, with trailing
 * "(N Credit Hour)" / "(1-3 Credits)" parentheticals stripped).
 * The leading [A-Z]{2,5} anchor prevents matches against free-text electives
 * like "Math elective" or "Choose 3 credits from…" (lowercase / no code).
 */
// Exported for unit testing (see __tests__/scrape-acalog-programs.test.ts).
export function parseCourseFromLabel(label: string): {
  prefix: string;
  number: string;
  title: string;
} | null {
  const trimmed = label.trim();
  // Prefix→number separator varies by catalog: plain space ("ENG 111"),
  // none ("ACG2021"), hyphen-no-space ("ACCT-101", mott/MI), or
  // nbsp-hyphen-nbsp ("WBL - 110", surry/NC). Allow an optional single
  // hyphen flanked by optional whitespace. (\s already matches nbsp in JS.)
  const m = trimmed.match(
    /^([A-Z]{2,5})\s*-?\s*(\d{3,4}[A-Z]?)\b\s*(?:[-:]\s*)?(.*)$/,
  );
  if (!m) return null;
  // Strip trailing "(N Credit Hour(s))" / "(1-3 Credits)" parentheticals.
  const title = m[3]
    .replace(/\s*\(\d+(?:\s*-\s*\d+)?\s*credits?(?:\s*hours?)?\)\s*$/i, "")
    .trim();
  return { prefix: m[1], number: m[2], title };
}

/** Extract credits from an <em>Credits:</em> <em>3</em> or Credits: 3 pattern */
function parseCredits(html: string): number | null {
  const m = html.match(/Credits:?\s*<\/em>\s*<em>\s*([\d.]+)/i)
    || html.match(/Credits:?\s*([\d.]+)/i);
  if (m) {
    const n = parseFloat(m[1]);
    return isNaN(n) ? null : n;
  }
  return null;
}

/** Parse credits from a group header like "Framework Courses (31-34 credits)" */
function parseGroupCredits(header: string): number | null {
  // "31-34 credits" → take the lower bound
  const range = header.match(/(\d+)\s*-\s*\d+\s*credits?/i);
  if (range) return parseInt(range[1], 10);
  // "30 credits"
  const exact = header.match(/(\d+)\s*credits?/i);
  if (exact) return parseInt(exact[1], 10);
  return null;
}

/** Parse total credits from "Total Credits: 61-65" or "Total Credits: 60" */
function parseTotalCredits(html: string): number | null {
  const m = html.match(/Total\s+Credits:?\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Parse requirement groups from the program detail page HTML.
 * Groups are in `<div class="acalog-core">` blocks with `<h2>`/`<h3>`/`<h4>`
 * headers and `<li class="acalog-course">` items.
 */
function parseRequirementGroups(html: string): {
  groups: RequirementGroup[];
  totalCredits: number | null;
} {
  const groups: RequirementGroup[] = [];
  let totalCredits: number | null = null;

  // Split on acalog-core div boundaries
  const coreBlocks = html.split(/(?=<div\s+class="acalog-core">)/i);

  for (const block of coreBlocks) {
    if (!block.includes("acalog-core")) continue;

    // Extract group header from h2/h3/h4
    const headerMatch = block.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i);
    if (!headerMatch) continue;

    const headerText = htmlToText(headerMatch[1]);

    // Check if this is the "Total Credits" summary block
    if (/^total\s+credits/i.test(headerText)) {
      totalCredits = parseTotalCredits(headerText);
      continue;
    }

    // Skip empty/navigation-only headers
    if (!headerText || headerText.length < 3) continue;

    const creditsRequired = parseGroupCredits(headerText);

    // Parse course list items
    const courses: RequiredCourse[] = [];
    let lastCourse: RequiredCourse | null = null;

    // Match each <li class="acalog-course"> or <li class="acalog-adhoc-list-item">
    const liRegex =
      /<li\s+class="(acalog-course|acalog-adhoc[^"]*)"[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch;
    while ((liMatch = liRegex.exec(block)) !== null) {
      const liClass = liMatch[1];
      const liHtml = liMatch[2];

      // Check if this is an OR alternative (has "OR" text before the course link)
      const isOr = /<strong>\s*(?:&nbsp;|\s)*OR\s*<\/strong>/i.test(liHtml);

      // Extract course info from aria-label or link text
      let courseInfo: { prefix: string; number: string; title: string } | null =
        null;
      const ariaLabel = liHtml.match(
        /aria-label="View course details for ([^"]+)"/,
      );
      if (ariaLabel) {
        courseInfo = parseCourseFromLabel(ariaLabel[1].trim());
      }
      if (!courseInfo) {
        // Try link text
        const linkText = liHtml.match(/>([A-Z]{2,5}\s+\d{3,4}[A-Z]?\s*[-:][^<]+)</);
        if (linkText) {
          courseInfo = parseCourseFromLabel(linkText[1].trim());
        }
      }

      // Handle adhoc items (electives, free-text requirements).
      // Many Acalog catalogs (notably cf in FL, mott in MI) use
      // acalog-adhoc-list-item for REAL courses written as plain text
      // ("ACG1949 - Work Experience I") rather than free-text electives.
      // Try parsing as a real code first; only fall back to ELEC XXX if no
      // PREFIX NUMBER pattern is present at the start of the text.
      if (liClass.includes("adhoc") && !courseInfo) {
        const adhocText = htmlToText(liHtml);
        if (adhocText) {
          const adhocCredits = parseCredits(liHtml);
          const cleanText = adhocText
            .replace(/Credits:?\s*\d+[-\d]*\s*/i, "")
            .trim();
          const tryReal = parseCourseFromLabel(cleanText);
          if (tryReal) {
            const course: RequiredCourse = {
              prefix: tryReal.prefix,
              number: tryReal.number,
              title: tryReal.title,
              credits: adhocCredits,
              or_alternatives: [],
            };
            courses.push(course);
            lastCourse = course;
          } else {
            courses.push({
              prefix: "ELEC",
              number: "XXX",
              title: cleanText,
              credits: adhocCredits,
              or_alternatives: [],
            });
            lastCourse = null;
          }
        } else {
          lastCourse = null;
        }
        continue;
      }

      if (!courseInfo) continue;

      const credits = parseCredits(liHtml);

      if (isOr && lastCourse) {
        // This is an OR alternative to the previous course
        lastCourse.or_alternatives.push({
          prefix: courseInfo.prefix,
          number: courseInfo.number,
          title: courseInfo.title,
        });
      } else {
        const course: RequiredCourse = {
          prefix: courseInfo.prefix,
          number: courseInfo.number,
          title: courseInfo.title,
          credits,
          or_alternatives: [],
        };
        courses.push(course);
        lastCourse = course;
      }
    }

    // Only add groups that have content
    if (courses.length > 0 || creditsRequired !== null) {
      // Clean up the header — remove anchor text artifacts
      const cleanName = headerText
        .replace(/^\s*[A-Za-z]+(?:Courses|Requirements)\d+\w*\s*/i, "")
        .trim() || headerText;

      groups.push({
        name: cleanName,
        credits_required: creditsRequired,
        choose_n: null,
        courses,
      });
    }
  }

  return { groups, totalCredits };
}

/** Parse a full program detail page into ProgramRequirement. */
function parseProgramPage(
  html: string,
  poid: string,
  baseUrl: string,
  catoid: number,
): ProgramRequirement | null {
  // Extract title from H1. Most Acalog catalogs use id="acalog-content" but
  // some (e.g. Delta's gateway-themed catalog) use id="acalog-page-title".
  const h1 =
    html.match(/<h1[^>]*id="acalog-content"[^>]*>([\s\S]*?)<\/h1>/i) ??
    html.match(/<h1[^>]*id="acalog-page-title"[^>]*>([\s\S]*?)<\/h1>/i);
  if (!h1) return null;
  const rawTitle = htmlToText(h1[1]);
  if (!rawTitle) return null;

  // Parse out credential, code, and clean title
  const credential = parseCredential(rawTitle);
  const programCode = parseProgramCode(rawTitle);

  // Clean title: remove program code and trailing credential abbreviations
  const title = rawTitle
    .replace(/\s*\([A-Z0-9][-A-Z0-9]+\)\s*$/, "")
    .replace(/\s+-\s+\d{3,}\s*$/, "")
    .trim();

  // Extract description from first <p> after the header section
  let description: string | null = null;
  const descMatch = html.match(
    /<\/h3>\s*(?:<div[^>]*>[\s\S]*?<\/div>\s*)*<(?:p|div)[^>]*class="[^"]*"[^>]*>([\s\S]*?)<(?:\/p|\/div)>/i,
  );
  if (descMatch) {
    const d = htmlToText(descMatch[1]);
    if (d && d.length > 20 && d.length < 2000 && !/^\s*</.test(d)) {
      description = d;
    }
  }

  // Parse requirement groups
  const { groups, totalCredits } = parseRequirementGroups(html);

  // Parse GPA from page text
  let gpaMinimum: number | null = null;
  const gpaMatch = html.match(
    /(?:minimum|required)\s+(?:cumulative\s+)?GPA\s*(?:of\s+)?(\d\.\d)/i,
  );
  if (gpaMatch) gpaMinimum = parseFloat(gpaMatch[1]);

  return {
    title,
    credential,
    program_code: programCode,
    catalog_url: `${baseUrl}/preview_program.php?catoid=${catoid}&poid=${poid}`,
    total_credits: totalCredits,
    gpa_minimum: gpaMinimum,
    description,
    requirement_groups: groups,
    matched_program_slug: null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scrape all programs from an Acalog catalog.
 *
 * Usage:
 *   const data = await scrapeAcalogPrograms({
 *     collegeSlug: "ctstate",
 *     baseUrl: "https://catalog.ctstate.edu",
 *     catoidFallback: 24,
 *     programNavoids: [2871, 2872, 2873, 2878, 2880],
 *   });
 */
export async function scrapeAcalogPrograms(
  config: AcalogProgramConfig,
): Promise<CollegePrograms> {
  const {
    collegeSlug,
    baseUrl,
    catoidFallback,
    programNavoids,
    autoDiscoverCatoid = true,
    useSearchDiscovery = false,
    usePlaywright = false,
  } = config;

  // When usePlaywright is requested, launch a browser and create a shared
  // context so the WAF session cookie persists across all page fetches.
  let browser: Browser | null = null;
  let pwCtx: BrowserContext | null = null;
  if (usePlaywright) {
    browser = await chromium.launch({ headless: true });
    pwCtx = await browser.newContext({
      userAgent: UA,
      extraHTTPHeaders: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  }

  // Unified fetch — uses Playwright when pwCtx is set, plain fetch otherwise.
  const fetchHtml = async (url: string, label: string): Promise<string> => {
    if (pwCtx) return playwrightFetch(pwCtx, url);
    return retryFetch(url, label);
  };

  try {
  // Step 1: Discover catoid
  const catoid = autoDiscoverCatoid
    ? await discoverAcalogCatoid(baseUrl, catoidFallback)
    : catoidFallback;
  console.log(`  [${collegeSlug}] catoid=${catoid}`);

  // Step 2: Collect all program poids from the nav pages
  console.log(
    `  [${collegeSlug}] Scanning ${programNavoids.length} navoid(s) for programs...`,
  );
  const allPoids = new Set<string>();
  for (const navoid of programNavoids) {
    const html = await fetchHtml(
      `${baseUrl}/content.php?catoid=${catoid}&navoid=${navoid}`,
      `navoid=${navoid}`,
    );
    const poids = extractPoids(html);
    for (const p of poids) allPoids.add(p);
    console.log(`    navoid=${navoid}: ${poids.length} programs`);
    await sleep(100);
  }
  console.log(`  [${collegeSlug}] Total unique programs: ${allPoids.size}`);

  if (allPoids.size === 0 && useSearchDiscovery) {
    console.log(`  [${collegeSlug}] Navoids empty — falling back to search_advanced.php`);
    let page = 1;
    const maxPages = 20;
    while (page <= maxPages) {
      const searchUrl = `${baseUrl}/search_advanced.php?cur_cat_oid=${catoid}&filter%5B1%5D=1&filter%5Bonly_active%5D=1&ppage=${page}`;
      const html = await fetchHtml(searchUrl, `search-page-${page}`);
      const poids = extractPoids(html);
      if (poids.length === 0) break;
      for (const p of poids) allPoids.add(p);
      console.log(`    search page ${page}: ${poids.length} programs (total: ${allPoids.size})`);
      page++;
      await sleep(200);
    }
    console.log(`  [${collegeSlug}] Search discovery found ${allPoids.size} programs`);
  }

  if (allPoids.size === 0) {
    return {    // finally block will close browser
      college_slug: collegeSlug,
      catalog_year: "",
      catalog_url: baseUrl,
      scraped_at: new Date().toISOString(),
      programs: [],
    };
  }

  // Step 3: Fetch and parse each program detail page
  console.log(`  [${collegeSlug}] Fetching program detail pages...`);
  const poidList = Array.from(allPoids);
  const programs: ProgramRequirement[] = [];
  let parsed = 0;
  let skipped = 0;

  // Use concurrency 1 with Playwright (single browser context, pages opened
  // sequentially) to avoid hammering the WAF with parallel requests.
  const concurrency = pwCtx ? 1 : CONCURRENCY;
  await pmap(poidList, concurrency, async (poid) => {
    const url = `${baseUrl}/preview_program.php?catoid=${catoid}&poid=${poid}`;
    const html = await fetchHtml(url, `program(${poid})`);
    if (!html) {
      skipped++;
      return;
    }

    const program = parseProgramPage(html, poid, baseUrl, catoid);
    if (program) {
      programs.push(program);
      parsed++;
    } else {
      skipped++;
    }
  });

  console.log(
    `  [${collegeSlug}] Parsed ${parsed} programs, skipped ${skipped}`,
  );

  // Detect catalog year from the catalog page title
  let catalogYear = "";
  try {
    const indexHtml = await fetchHtml(
      `${baseUrl}/index.php`,
      "catalog-index",
    );
    const yearMatch = indexHtml.match(
      /(\d{4})\s*[-–]\s*(\d{4})\s*(?:Catalog|College)/i,
    );
    if (yearMatch) catalogYear = `${yearMatch[1]}-${yearMatch[2]}`;
  } catch {
    // Non-fatal — catalog year is nice-to-have
  }

  return {
    college_slug: collegeSlug,
    catalog_year: catalogYear,
    catalog_url: baseUrl,
    scraped_at: new Date().toISOString(),
    programs,
  };
  } finally {
    if (pwCtx) await pwCtx.close();
    if (browser) await browser.close();
  }
}

/**
 * Auto-discover program navoids by scanning the catalog sidebar for links
 * containing "program" text. Returns navoid numbers.
 */
export async function discoverProgramNavoids(
  baseUrl: string,
  catoid: number,
): Promise<number[]> {
  try {
    const html = await retryFetch(
      `${baseUrl}/content.php?catoid=${catoid}&navoid=0`,
      "nav-discovery",
    );
    // Look for nav links with "program" in the text
    const re =
      /<a[^>]*navoid=(\d+)[^>]*>[^<]*(?:program|degree|certificate|associate|academic\s+programs)[^<]*/gi;
    const navoids = new Set<number>();
    let m;
    while ((m = re.exec(html)) !== null) {
      navoids.add(parseInt(m[1], 10));
    }

    // For each candidate navoid, check if it actually has program links
    const confirmed: number[] = [];
    for (const navoid of navoids) {
      const page = await retryFetch(
        `${baseUrl}/content.php?catoid=${catoid}&navoid=${navoid}`,
        `check-navoid-${navoid}`,
      );
      const poids = extractPoids(page);
      if (poids.length > 0) {
        confirmed.push(navoid);
        console.log(`    navoid=${navoid}: ${poids.length} programs (confirmed)`);
      }
      await sleep(100);
    }

    return confirmed;
  } catch {
    return [];
  }
}
