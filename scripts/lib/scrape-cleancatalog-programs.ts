/**
 * scrape-cleancatalog-programs.ts — shared CleanCatalog (Drupal) program scraper.
 *
 * CleanCatalog is a hosted catalog platform (cleancatalog.io). Each
 * customer publishes at https://live-{slug}.cleancatalog.io/. Programs
 * live under a top-level /degrees index that links to detail pages with
 * the URL shape /{division}/{credential}/{program-slug}.
 *
 * Detail pages share a Drupal-rendered structure:
 *
 *   <title>{Program Name} | {College}</title>
 *   <article class="node--type-degree">
 *     <div class="paragraph--type--degree-section">
 *       <div class="field--name-field-degree-section-description"><p><strong>Semester</strong></p></div>
 *       <article class="node--type-class">
 *         <div class="col-2"><a>ENL101</a></div>
 *         <div class="col-7"><span class="field--name-field-item">English Composition I</span></div>
 *         <div class="col-2"><span class="field--name-field-credits">3</span></div>
 *       </article>
 *       <article class="node--type-elective-group">…</article>   (skipped — no concrete course)
 *       <div class="row degree-row degree-row-subtotal">
 *         <div class="col-10">Sub-Total Credits</div>
 *         <div class="col-2">15</div>
 *       </div>
 *     </div>
 *     … repeats per semester …
 *   </article>
 *
 * Each paragraph--type--degree-section becomes one RequirementGroup. The
 * credential is derived from the URL path segment.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type {
  CollegePrograms,
  ProgramCredential,
  ProgramRequirement,
  RequiredCourse,
  RequirementGroup,
} from "../../lib/types.js";

export interface CleanCatalogProgramConfig {
  collegeSlug: string;
  /** Catalog root, e.g. https://live-capecod.cleancatalog.io (no trailing slash). */
  baseUrl: string;
  /**
   * Program index paths. Default ["/degrees"]. Some installs (Bristol) put
   * degrees at /degrees and certificates at /browse-certificates and need
   * both walked.
   */
  indexPaths?: string[];
  /** Catalog year for output metadata, e.g. "2025-2026". */
  catalogYear: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CONCURRENCY = 6;
const DELAY_MS = 80;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function retryFetch(
  url: string,
  label: string,
  attempts = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const u = new URL(url);
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: `${u.protocol}//${u.host}/`,
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Upgrade-Insecure-Requests": "1",
        },
      });
      if (res.ok) return res.text();
      if (res.status >= 500) lastErr = new Error(`HTTP ${res.status}`);
      else return "";
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
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Index discovery
// ---------------------------------------------------------------------------

const CREDENTIAL_SEGMENTS = new Set([
  "associate-in-arts",
  "associate-in-science",
  "associate-in-applied-science",
  "certificate",
  "diploma",
]);

// CleanCatalog instances expose two URL shapes for program pages:
//   • 3-segment: /{division}/{credential-segment}/{program-slug}    (Cape Cod)
//   • 2-segment: /{division}/{program-slug}                          (Bristol)
// We accept either: 3-segment iff segment[1] is a known credential
// keyword (so we don't accept arbitrary nesting), 2-segment iff both
// segments look like content slugs (lowercase letters/digits/dashes).

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function isProgramPath(p: string): boolean {
  if (!p.startsWith("/")) return false;
  const parts = p.replace(/^\/+/, "").split("/");
  if (parts.length === 3) {
    return (
      SLUG_RE.test(parts[0]) &&
      CREDENTIAL_SEGMENTS.has(parts[1]) &&
      SLUG_RE.test(parts[2])
    );
  }
  if (parts.length === 2) {
    return SLUG_RE.test(parts[0]) && SLUG_RE.test(parts[1]);
  }
  return false;
}

// Routes Bristol's /degrees index links to that aren't programs.
const NON_PROGRAM_PATHS = new Set([
  "/degrees",
  "/degrees-and-certificates",
  "/browse-certificates",
  "/classes",
  "/about",
  "/search",
]);

async function discoverProgramPaths(
  baseUrl: string,
  degreesPath: string,
): Promise<string[]> {
  const html = await retryFetch(`${baseUrl}${degreesPath}`, "degrees-index");
  const $ = cheerio.load(html);
  const found = new Set<string>();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    const clean = href.split("#")[0].split("?")[0];
    if (NON_PROGRAM_PATHS.has(clean)) return;
    if (isProgramPath(clean)) found.add(clean);
  });
  return [...found].sort();
}

// ---------------------------------------------------------------------------
// Per-program parsing
// ---------------------------------------------------------------------------

function credentialFromPath(p: string): ProgramCredential {
  const parts = p.replace(/^\/+/, "").split("/");
  // Only 3-segment URLs encode credential in the path.
  const seg = parts.length >= 3 ? parts[1] : "";
  switch (seg) {
    case "associate-in-arts":
      return "AA";
    case "associate-in-science":
      return "AS";
    case "associate-in-applied-science":
      return "AAS";
    case "certificate":
      return "certificate";
    case "diploma":
      return "diploma";
    default:
      return "other";
  }
}

/** Parse credential from a CleanCatalog "degree offered" prose field. */
function credentialFromProse(text: string): ProgramCredential {
  const t = text.toLowerCase();
  if (t.includes("associate in applied science") || t.includes("a.a.s")) return "AAS";
  if (t.includes("associate in arts") || /\ba\.?a\.?\b/.test(t)) return "AA";
  if (t.includes("associate in science") || /\ba\.?s\.?\b/.test(t)) return "AS";
  if (t.includes("certificate")) return "certificate";
  if (t.includes("diploma")) return "diploma";
  return "other";
}

function parseTitle($: cheerio.CheerioAPI): string {
  // Page title is "{Program Name} | {College Name}". Take everything before
  // the last "|" so program names containing "|" survive (rare).
  const raw = $("title").first().text().trim();
  const idx = raw.lastIndexOf("|");
  const title = idx > 0 ? raw.slice(0, idx).trim() : raw;
  return title.replace(/\s+/g, " ");
}

function parseCredits(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  // Range like "15-16" → take the lower bound
  const range = t.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*\d+(?:\.\d+)?$/);
  if (range) return Number(range[1]);
  const num = t.match(/^(\d+(?:\.\d+)?)$/);
  if (num) return Number(num[1]);
  return null;
}

/**
 * Split a CleanCatalog course code into prefix + number. Different
 * instances render the code differently — Cape Cod glues it together
 * ("ENL101"), Bristol spaces it ("CIS 111"), and Washington colleges
 * (Bates, WVC) carry the common-course-numbering "&" suffix ("BUS& 101").
 * Strip whitespace first so all shapes parse.
 */
function splitCourseCode(
  code: string,
): { prefix: string; number: string } | null {
  const m = code.replace(/\s+/g, "").match(/^([A-Z]{2,5}&?)(\d{3,4}[A-Z]?)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

function parseSection(
  $: cheerio.CheerioAPI,
  $section: cheerio.Cheerio<AnyNode>,
): RequirementGroup | null {
  // Section name comes from the section title (Bristol: "Program Courses",
  // "Concentration Courses") if present, otherwise the per-section
  // description (Cape Cod: "First Semester", "Second Semester").
  const titleText = $section
    .find(".field--name-field-degree-section-title")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  const descText = $section
    .find(".field--name-field-degree-section-description")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  const name = titleText || descText || "Required Courses";

  const courses: RequiredCourse[] = [];

  // Only count course rows that belong to *this* section, not ones nested
  // inside an elective-group modal that's a descendant of this section.
  // Course code lives in:
  //   .col-2 a   — Cape Cod's compact layout
  //   .col-3 a   — Bristol's wider layout
  //   .degree-row-item a — Coastal Pines (Drupal-hosted CleanCatalog variant)
  $section.find("article.node--type-class").each((_, el) => {
    const $el = $(el);
    if ($el.parents(".modal").length > 0) return;
    const codeRaw =
      $el.find(".col-2 a").first().text().trim() ||
      $el.find(".col-3 a").first().text().trim() ||
      $el.find(".degree-row-item a").first().text().trim();
    if (!codeRaw) return;
    const split = splitCourseCode(codeRaw);
    if (!split) return;
    const title = $el
      .find(".field--name-field-item")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const creditsText = $el
      .find(".field--name-field-credits")
      .first()
      .text()
      .trim();
    courses.push({
      prefix: split.prefix,
      number: split.number,
      title,
      credits: parseCredits(creditsText),
      or_alternatives: [],
    });
  });

  if (courses.length === 0) return null;

  let creditsRequired: number | null = null;
  $section.find(".degree-row-subtotal .col-2").each((_, el) => {
    if (creditsRequired !== null) return;
    const $el = $(el);
    if ($el.parents(".modal").length > 0) return;
    creditsRequired = parseCredits($el.text());
  });

  return {
    name,
    credits_required: creditsRequired,
    choose_n: null,
    courses,
  };
}

function parseProgramPage(
  html: string,
  pageUrl: string,
): ProgramRequirement | null {
  const $ = cheerio.load(html);
  const title = parseTitle($);
  if (!title) return null;

  // 3-segment URLs (Cape Cod) carry credential in the path; 2-segment URLs
  // (Bristol) don't, so fall back to the .field--name-field-degree-offered
  // prose ("Associate in Science in Business Administration Career …").
  let credential = credentialFromPath(new URL(pageUrl).pathname);
  if (credential === "other") {
    const offered = $(".field--name-field-degree-offered")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    if (offered) credential = credentialFromProse(offered);
  }

  // Iterate only top-level sections — skip ones nested inside elective-group
  // modals (option lists for "choose one"). Sections inside
  // .field--name-field-course-sequencing are skipped only when standalone
  // sections also exist: on Bristol the "Recommended Course Sequence"
  // duplicates the real Program/Elective/Concentration sections by semester
  // (counting both would double everything), but on Bates the sequencing
  // wrapper holds the ONLY course listing.
  const standalone: RequirementGroup[] = [];
  const sequenced: RequirementGroup[] = [];
  $(".paragraph--type--degree-section").each((_, el) => {
    const $el = $(el);
    if ($el.parents(".modal").length > 0) return;
    const group = parseSection($, $el);
    if (!group) return;
    if ($el.parents(".field--name-field-course-sequencing").length > 0) {
      sequenced.push(group);
    } else {
      standalone.push(group);
    }
  });
  const groups = standalone.length > 0 ? standalone : sequenced;

  if (groups.length === 0) return null;

  // Total credits: prefer summing sub-totals if every group has one;
  // otherwise sum course-level credits.
  let total: number | null = null;
  if (groups.every((g) => g.credits_required !== null)) {
    total = groups.reduce((s, g) => s + (g.credits_required ?? 0), 0);
  } else {
    let sum = 0;
    let any = false;
    for (const g of groups) {
      for (const c of g.courses) {
        if (c.credits !== null && c.credits > 0) {
          sum += c.credits;
          any = true;
        }
      }
    }
    if (any) total = sum;
  }

  return {
    title,
    credential,
    program_code: null,
    catalog_url: pageUrl,
    total_credits: total,
    gpa_minimum: 2.0,
    description: null,
    requirement_groups: groups,
    matched_program_slug: null,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function scrapeCleanCatalogPrograms(
  config: CleanCatalogProgramConfig,
): Promise<CollegePrograms> {
  const { collegeSlug, baseUrl, catalogYear } = config;
  const indexPaths = config.indexPaths ?? ["/degrees"];

  const allPaths = new Set<string>();
  for (const indexPath of indexPaths) {
    console.log(
      `  [${collegeSlug}] Discovering programs at ${baseUrl}${indexPath}`,
    );
    const paths = await discoverProgramPaths(baseUrl, indexPath);
    console.log(`  [${collegeSlug}]   Found ${paths.length} candidates`);
    for (const p of paths) allPaths.add(p);
  }
  const paths = [...allPaths].sort();
  console.log(
    `  [${collegeSlug}] Total ${paths.length} unique program detail pages`,
  );

  if (paths.length === 0) {
    return {
      college_slug: collegeSlug,
      catalog_year: catalogYear,
      catalog_url: `${baseUrl}${indexPaths[0]}`,
      scraped_at: new Date().toISOString(),
      programs: [],
    };
  }

  const programs: ProgramRequirement[] = [];
  let parsed = 0;
  let skipped = 0;
  await pmap(paths, CONCURRENCY, async (p) => {
    const url = `${baseUrl}${p}`;
    const html = await retryFetch(url, `program(${p})`);
    if (!html) {
      skipped++;
      return;
    }
    const program = parseProgramPage(html, url);
    if (!program) {
      skipped++;
      return;
    }
    programs.push(program);
    parsed++;
  });
  console.log(
    `  [${collegeSlug}] Parsed ${parsed} programs, skipped ${skipped}`,
  );

  return {
    college_slug: collegeSlug,
    catalog_year: catalogYear,
    catalog_url: `${baseUrl}${indexPaths[0]}`,
    scraped_at: new Date().toISOString(),
    programs,
  };
}
