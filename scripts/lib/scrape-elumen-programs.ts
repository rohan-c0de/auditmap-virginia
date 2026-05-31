/**
 * scrape-elumen-programs.ts — shared eLumen program scraper.
 *
 * eLumen catalogs (used by ~30 California CCs including all 9 LACCD colleges)
 * are Angular SPAs at <tenant>.elumenapp.com/catalog/. The actual content
 * is served by a public REST API at:
 *
 *   https://api-prod.elumenapp.com/catalog/sites/publish/{year},{path}
 *       ?tenant={tenant}.elumenapp.com&api=https://api-prod.elumenapp.com:443
 *
 * URL → API transformation:
 *   browser:  https://<tenant>/catalog/{year}/{path}
 *   API:      .../publish/{year},{path}?tenant=<tenant>
 *
 * Page schema (across tenants):
 *
 *   - Home page (`{year}/home`): contains the full navigation listing every
 *     subject and policy page as `<a href="{year}/{path}">` anchors.
 *
 *   - Subject page (`{year}/{subj}`, e.g. `/current/aj`): lists programs and
 *     courses under "Degrees and Certificates" and "Course Information"
 *     headings. Programs link via `<a class="navitem" href="{year}/program/...">`.
 *
 *   - Program detail page (`{year}/program/{slug}`): has the program title,
 *     credential, "Program Requirements" section with course codes formatted
 *     PREFIX-NUMBER (e.g. "AJ-110", "ENGL-150").
 *
 * Each tenant uses a different catalog year segment — some use "current",
 * others use "2025-2026", "24-25", "26-27", etc. The wrapper passes
 * `catalogYear` explicitly.
 *
 * Output: CollegePrograms (per lib/schemas.ts).
 */

import * as cheerio from "cheerio";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type {
  CollegePrograms,
  ProgramCredential,
  ProgramRequirement,
  RequiredCourse,
} from "../../lib/types.js";

export interface ElumenProgramConfig {
  /** Stable college identifier matching `data/{state}/programs/{collegeSlug}.json`. */
  collegeSlug: string;
  /** Tenant host, e.g. "deanza.elumenapp.com" (no scheme). */
  tenant: string;
  /** Catalog year segment, e.g. "current", "2025-2026", "24-25". */
  catalogYear: string;
}

const API_BASE = "https://api-prod.elumenapp.com/catalog/sites/publish";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const DELAY_MS = 120;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function apiUrl(year: string, segment: string, tenant: string): string {
  // segment may be empty (homepage) or "{year}/home" / "{year}/aj" /
  // "{year}/program/some-slug" etc. The API uses comma between EVERY path
  // segment, not just between year and page (so {year}/program/foo →
  // {year},program,foo).
  const cleaned = segment.replace(new RegExp(`^${year}/`), "");
  const key = cleaned ? `${year},${cleaned.replace(/\//g, ",")}` : year;
  const q = `?tenant=${tenant}&api=https://api-prod.elumenapp.com:443`;
  return `${API_BASE}/${key}${q}`;
}

interface PublishResponse {
  html?: string;
  title?: string;
  barUrl?: string;
  contentUrl?: string;
  message?: string; // present on error
}

async function fetchJson(url: string, label: string, attempts = 3): Promise<PublishResponse | null> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json,*/*" },
      });
      if (res.ok) return (await res.json()) as PublishResponse;
      if (res.status === 404) return null; // page doesn't exist on this tenant
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(500 * (i + 1));
        continue;
      }
      throw new Error(`HTTP ${res.status} on ${label}`);
    } catch (e) {
      lastErr = e;
      await sleep(500 * (i + 1));
    }
  }
  console.warn(`  ⚠ ${label} failed after ${attempts} attempts: ${lastErr}`);
  return null;
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
// Parsing
// ---------------------------------------------------------------------------

function classifyCredential(title: string): ProgramCredential {
  const t = title.toLowerCase();
  // Common eLumen title patterns:
  //   "A.S. in Administration of Justice, Occupational"
  //   "A.A. in Pre-Allied Health"
  //   "AS-T Administration of Justice"
  //   "Certificate of Achievement Administration of Justice"
  if (/applied\s+science|a\.?a\.?s\.?\b/i.test(t)) return "AAS";
  if (/\baa-?t\b|a\.?a\.?\s*(?:in|degree)|associate\s+(?:of|in)\s+arts/.test(t)) return "AA";
  if (/\bas-?t\b|a\.?s\.?\s*(?:in|degree)|associate\s+(?:of|in)\s+science/.test(t)) return "AS";
  if (/career\s+studies\s+certificate/.test(t)) return "certificate";
  if (/diploma/.test(t)) return "diploma";
  if (/certificate/.test(t)) return "certificate";
  return "other";
}

interface ElumenPageSummary {
  paths: string[]; // internal links like "current/aj"
}

function parseNavPaths(html: string, year: string): string[] {
  const $ = cheerio.load(html);
  const paths = new Set<string>();
  $(`a[href^="${year}/"]`).each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href || href.includes("#")) return;
    // Skip home page itself + obvious non-subject pages
    if (href === `${year}/home`) return;
    paths.add(href);
  });
  return Array.from(paths);
}

interface ProgramLink {
  href: string;
  text: string;
}

function parseProgramLinks(html: string, year: string): ProgramLink[] {
  const $ = cheerio.load(html);
  const links: ProgramLink[] = [];
  $(`a[href^="${year}/program/"]`).each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    const text = $(el).text().trim();
    if (href && text) links.push({ href, text });
  });
  return links;
}

function parseProgramDetail(
  html: string,
  programUrl: string,
  programTitle: string,
): ProgramRequirement | null {
  const $ = cheerio.load(html);
  const credential = classifyCredential(programTitle);

  // Locate "Program Requirements" section. Course codes within it follow
  // PREFIX-NUMBER convention.
  // Course codes live in anchor hrefs like `current/course/aj110` (lowercase
  // letters + digits, optional trailing letter / version like `aj204v2`).
  // The visible body text strips these — so parse from the raw HTML.
  // Walk the linkified anchors only inside the "Program Requirements"
  // semantic zone (between "Program Requirements" and "Program Learning
  // Outcomes" headings).
  const rawHtml = $.html();
  const reqIdx = rawHtml.search(/Program\s+Requirements/i);
  const outIdx = rawHtml.search(/Program\s+(?:Learning\s+)?Outcomes/i);
  const reqHtml =
    reqIdx >= 0 && outIdx > reqIdx
      ? rawHtml.substring(reqIdx, outIdx)
      : reqIdx >= 0
      ? rawHtml.substring(reqIdx)
      : rawHtml;

  // Course href pattern: "{year}/course/{subj}{num}" where subj is 2-5 lowercase
  // letters and num is 1-4 digits with an optional trailing letter or `v#`.
  const refRe = /\/course\/([a-z]{2,5})(\d{1,4})([a-z]?)(?:v\d+)?\b/gi;
  const seen = new Set<string>();
  const courses: RequiredCourse[] = [];
  let m: RegExpExecArray | null;
  while ((m = refRe.exec(reqHtml)) !== null) {
    const prefix = m[1].toUpperCase();
    const number = m[2] + (m[3] ? m[3].toUpperCase() : "");
    const code = `${prefix} ${number}`;
    if (seen.has(code)) continue;
    seen.add(code);
    courses.push({
      prefix,
      number,
      title: "",
      credits: null,
      or_alternatives: [],
    });
  }

  if (courses.length === 0) return null;

  // Try to extract total credits from "X units" or "X credits" near the end
  const reqText = cheerio.load(reqHtml).root().text();
  let totalCredits: number | null = null;
  const creditsMatch = reqText.match(/Total\s*(?:Units?|Credits?)\s*:?\s*(\d+(?:\.\d+)?)/i);
  if (creditsMatch) totalCredits = Math.round(parseFloat(creditsMatch[1]));

  return {
    title: programTitle,
    credential,
    program_code: null,
    catalog_url: programUrl,
    total_credits: totalCredits,
    gpa_minimum: 2.0,
    description: null,
    requirement_groups: [
      {
        name: "Program Requirements",
        credits_required: totalCredits,
        choose_n: null,
        courses,
      },
    ],
    matched_program_slug: null,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function scrapeElumenPrograms(
  config: ElumenProgramConfig,
): Promise<CollegePrograms> {
  const { collegeSlug, tenant, catalogYear } = config;
  const browserUrl = `https://${tenant}/catalog/${catalogYear}/`;

  console.log(`  [${collegeSlug}] Fetching home page for ${tenant} (year=${catalogYear})`);
  const home = await fetchJson(
    apiUrl(catalogYear, `${catalogYear}/home`, tenant),
    `${collegeSlug}/home`,
  );

  if (!home || !home.html) {
    console.warn(`  [${collegeSlug}] No home page returned. Skipping.`);
    return {
      college_slug: collegeSlug,
      catalog_year: catalogYear,
      catalog_url: browserUrl,
      scraped_at: new Date().toISOString(),
      programs: [],
    };
  }

  // Step 1: discover subject pages from home navigation
  const navPaths = parseNavPaths(home.html, catalogYear);
  console.log(`  [${collegeSlug}] ${navPaths.length} navigation paths found`);

  // Step 2: walk each subject page, collect program links
  const programLinks = new Map<string, string>(); // href → text
  await pmap(navPaths, CONCURRENCY, async (navPath) => {
    const page = await fetchJson(
      apiUrl(catalogYear, navPath, tenant),
      `${collegeSlug}/${navPath}`,
    );
    if (!page || !page.html) return;
    for (const link of parseProgramLinks(page.html, catalogYear)) {
      if (!programLinks.has(link.href)) {
        programLinks.set(link.href, link.text);
      }
    }
  });
  console.log(`  [${collegeSlug}] ${programLinks.size} unique program links discovered`);

  // Step 3: fetch each program detail page
  const programs: ProgramRequirement[] = [];
  const entries = Array.from(programLinks.entries());
  await pmap(entries, CONCURRENCY, async ([href, text]) => {
    const page = await fetchJson(
      apiUrl(catalogYear, href, tenant),
      `${collegeSlug}/${href}`,
    );
    if (!page || !page.html) return;
    const browserProgUrl = `https://${tenant}/catalog/${href}`;
    const title = page.title || text;
    const prog = parseProgramDetail(page.html, browserProgUrl, title);
    if (prog) programs.push(prog);
  });
  console.log(`  [${collegeSlug}] ${programs.length} programs parsed from ${programLinks.size} pages`);

  applyProgramMatching(programs);

  return {
    college_slug: collegeSlug,
    catalog_year: catalogYear,
    catalog_url: browserUrl,
    scraped_at: new Date().toISOString(),
    programs,
  };
}
