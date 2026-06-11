/**
 * scrape-courseleaf-programs.ts — shared CourseLeaf program scraper.
 *
 * CourseLeaf catalogs publish a `/programs-study/` index page listing all
 * degrees/certificates offered by a college. Each program has its own
 * detail page (e.g. `/programs-study/accounting/`) that contains one or
 * more award sections (AAS + Career Studies Certificate, etc.) — each with
 * a "Plan of Study Grid" table (`<table class="sc_plangrid">`) covering
 * the recommended semester-by-semester courses.
 *
 * Mirrors the shape of scrape-acalog-programs.ts so it can be invoked by
 * a per-state wrapper script with a list of college configs.
 *
 * Used by:
 *   scripts/va/scrape-courseleaf-programs.ts — Blue Ridge CC (brcc), see #234
 *   scripts/ma/scrape-courseleaf-programs.ts — Mount Wachusett CC (mwcc), see #240
 */

import * as cheerio from "cheerio";
import { chromium } from "playwright";
// AnyNode is exported from domhandler (cheerio's underlying DOM lib) but
// isn't re-exported as `cheerio.AnyNode` in cheerio 1.2 — import directly.
import type { AnyNode } from "domhandler";
import type {
  CollegePrograms,
  ProgramCredential,
  ProgramRequirement,
  RequiredCourse,
} from "../../lib/types.js";

export interface CourseleafProgramConfig {
  /** Stable college identifier matching `data/{state}/programs/{collegeSlug}.json`. */
  collegeSlug: string;
  /** Catalog root, e.g. https://catalog.brcc.edu (no trailing slash). */
  baseUrl: string;
  /**
   *  Path of the program-list page, default `/programs-study/`.
   *  Override if a college uses a different convention.
   */
  programIndexPath?: string;
  /**
   * How many link levels to walk from the index page. Default 1 (the index
   * links program pages directly). Use 2 when the index links area pages
   * that in turn link the programs (e.g. Clark College's
   * /academic-plans/<area>/<program>/).
   */
  indexDepth?: 1 | 2;
  /**
   * Regex source matched against every href on the index page, replacing
   * prefix-based discovery. For catalogs with no single program index whose
   * nav links every program (e.g. SPSCC's /<division>/(ado|cert)/<name>/).
   */
  programPathPattern?: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const DELAY_MS = 80;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Some CourseLeaf hosts sit behind AWS WAF bot protection that answers a
// flagged client with HTTP 202 + empty body (e.g. catalog.spscc.edu). A
// headless Chromium visit solves the JS challenge and yields an
// aws-waf-token cookie that plain fetch() can then carry. Acquired lazily —
// only when a challenge is actually seen — so non-WAF catalogs never pay
// the browser-launch cost. Deduped per origin to avoid a worker stampede.
const wafCookies = new Map<string, string>();
const wafInFlight = new Map<string, Promise<string>>();

async function acquireWafCookies(origin: string, force = false): Promise<string> {
  if (!force) {
    const cached = wafCookies.get(origin);
    if (cached) return cached;
  }
  const inFlight = wafInFlight.get(origin);
  if (inFlight) return inFlight;
  const p = (async () => {
    console.log(`  Acquiring WAF token via headless browser: ${origin}`);
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({ userAgent: UA });
      const page = await ctx.newPage();
      await page.goto(origin, { waitUntil: "networkidle", timeout: 45_000 });
      await page.waitForTimeout(2_000);
      const cookies = await ctx.cookies();
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      wafCookies.set(origin, cookieStr);
      return cookieStr;
    } finally {
      await browser.close();
      wafInFlight.delete(origin);
    }
  })();
  wafInFlight.set(origin, p);
  return p;
}

function isWafChallenge(status: number, body: string): boolean {
  if (status === 202) return true;
  return body.length < 5_000 && body.includes("awswaf");
}

async function retryFetch(
  url: string,
  label: string,
  attempts = 4,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const u = new URL(url);
      const headers: Record<string, string> = {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `${u.protocol}//${u.host}/`,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Upgrade-Insecure-Requests": "1",
      };
      const cookies = wafCookies.get(u.origin);
      if (cookies) headers["Cookie"] = cookies;
      const res = await fetch(url, { headers });
      const body = res.ok || res.status === 202 ? await res.text() : "";
      if (isWafChallenge(res.status, body)) {
        await acquireWafCookies(u.origin, i > 0);
        continue;
      }
      if (res.ok) return body;
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
// Step 1: discover all program detail page paths from the index
// ---------------------------------------------------------------------------

function discoverProgramPaths(
  indexHtml: string,
  programIndexPath: string,
): string[] {
  const $ = cheerio.load(indexHtml);
  const paths = new Set<string>();
  $(`a[href^="${programIndexPath}"]`).each((_, el) => {
    const rawHref = $(el).attr("href");
    if (!rawHref) return;
    // Drop URL fragments — same page, different anchor.
    let href = rawHref.split("#")[0];
    if (!href) return;
    // Skip the index page itself, or sibling assets like the section's PDF.
    if (href === programIndexPath) return;
    if (href === programIndexPath.replace(/\/$/, "")) return;
    if (href.endsWith(".pdf")) return;
    if (href.endsWith(".css")) return;
    // Some CourseLeaf catalogs link to "/section/program/index.html" instead
    // of "/section/program/" — both render the same page. Normalize to dir.
    if (href.endsWith("/index.html")) {
      href = href.slice(0, -"index.html".length);
    } else if (!href.endsWith("/")) {
      // Trailing slash is missing (e.g. typo'd link). Add it so dedup works.
      href += "/";
    }
    paths.add(href);
  });
  return Array.from(paths).sort();
}

// ---------------------------------------------------------------------------
// Step 2: classify a credential string into our enum
// ---------------------------------------------------------------------------

function parseCredential(awardText: string): ProgramCredential {
  const t = awardText.toLowerCase();
  if (/applied\s+science/.test(t)) return "AAS";
  // California uses "Associate in Arts/Science" — match both "of" and "in"
  if (/associate\s+(?:of|in)\s+arts/.test(t)) return "AA";
  if (/associate\s+(?:of|in)\s+science/.test(t)) return "AS";
  if (/\baa-?t\b/.test(t)) return "AA";
  if (/\bas-?t\b/.test(t)) return "AS";
  if (/career\s+studies\s+certificate/.test(t)) return "certificate";
  if (/diploma/.test(t)) return "diploma";
  if (/certificate/.test(t)) return "certificate";
  return "other";
}

// ---------------------------------------------------------------------------
// Step 3: parse a single sc_plangrid table into RequiredCourse[]
// ---------------------------------------------------------------------------

interface PlanGridResult {
  courses: RequiredCourse[];
  totalCredits: number | null;
}

function parsePlanGrid(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<AnyNode>,
): PlanGridResult {
  const courses: RequiredCourse[] = [];
  const seen = new Set<string>();
  let totalCredits: number | null = null;

  $table.find("tr").each((_, row) => {
    const $row = $(row);
    const classes = $row.attr("class") || "";

    // Total Credit Hours summary row — sc_plangrid uses "plangridtotal",
    // sc_courselist uses "listsum"
    if (classes.includes("plangridtotal") || classes.includes("listsum")) {
      const hoursText = $row.find("td.hourscol").last().text().trim();
      // Take the upper bound of any range like "60-62"
      const m = hoursText.match(/(\d+)(?:\s*-\s*(\d+))?/);
      if (m) totalCredits = parseInt(m[2] ?? m[1], 10);
      return;
    }
    // Per-semester subtotals, semester/year/area headers — no course
    if (classes.includes("plangridsum")) return;
    if (classes.includes("plangridyear")) return;
    if (classes.includes("areaheader")) return;

    const $code = $row.find("td.codecol").first();
    if (!$code.length) return;

    // Course rows: <a class="bubblelink code">PREFIX NUM</a>
    // Comment / placeholder rows have <span class="comment">…</span> instead
    // of an anchor — those are "Select one of the following:" or generic
    // electives without a concrete course; skip them.
    const $courseLink = $code.find("a.bubblelink.code").first();
    if (!$courseLink.length) return;
    const codeText = $courseLink.text().trim();
    // Course codes may use a space ("ENG 101") or a hyphen ("DDGT-120") between
    // prefix and number — California catalogs commonly use the hyphenated form.
    const m = codeText.match(/^([A-Z]{2,5})[\s-]+(\d{2,4}[A-Z]?)/);
    if (!m) return;
    const [, prefix, number] = m;

    // Title can be in td.titlecol (sc_plangrid) or in the second <td>
    // (sc_courselist, where titlecol isn't always set on the td)
    const $title = $row.find("td.titlecol").first().length
      ? $row.find("td.titlecol").first()
      : $code.next("td");
    const titleText = $title
      .clone()
      .children("sup")
      .remove()
      .end()
      .text()
      .replace(/\s+/g, " ")
      .trim();

    const hoursText = $row.find("td.hourscol").first().text().trim();
    const credits = hoursText && /^\d+/.test(hoursText)
      ? parseInt(hoursText, 10)
      : 0;

    const key = `${prefix} ${number}`;
    if (seen.has(key)) return;
    seen.add(key);
    courses.push({
      prefix,
      number,
      title: titleText,
      credits,
      or_alternatives: [],
    });
  });

  return { courses, totalCredits };
}

// ---------------------------------------------------------------------------
// Step 4: parse a program detail page into one or more ProgramRequirements
// ---------------------------------------------------------------------------

function parseProgramPage(
  html: string,
  baseUrl: string,
  programPath: string,
): ProgramRequirement[] {
  const $ = cheerio.load(html);
  // Support both class="page-title" (most catalogs) and id="page-title"
  // (e.g. Nunez CC uses <h1 id="page-title">).
  const programTitle =
    ($("h1.page-title").first().text().trim() ||
      $("h1#page-title").first().text().trim());
  if (!programTitle) return [];

  const catalogUrl = new URL(programPath, baseUrl).toString();
  const programs: ProgramRequirement[] = [];

  // Each program detail page can list multiple awards (e.g. AAS + Career
  // Studies Certificate). The structure is:
  //   <p><strong>Award: <credential>...</strong></p>
  //   …
  //   <table class="sc_plangrid"> or <table class="sc_courselist">
  // Sometimes the award strong tag lives outside the textcontainer (for the
  // page's primary award) and sometimes inside it (for additional awards).
  // Walk both lists in document order and pair each award with the next
  // curriculum table that follows it.
  const TABLE_SELECTOR = "table.sc_plangrid, table.sc_courselist";

  // Collect award elements: any inline element whose visible text starts with
  // "Award:". Limit the suffix at the next sentence boundary to avoid pulling
  // in unrelated paragraph content.
  type DocItem = { kind: "award"; line: string; index: number } | {
    kind: "table";
    el: AnyNode;
    index: number;
  };
  const items: DocItem[] = [];

  $("strong").each((_, el) => {
    // Replace <br> with a newline so the credential phrase doesn't get
    // glued to the next sub-line ("Major: ...", "Additional Program...").
    const html = $(el).html() ?? "";
    const withBreaks = html.replace(/<br\s*\/?>/gi, "\n");
    const text = cheerio
      .load(`<x>${withBreaks}</x>`)("x")
      .text()
      .replace(/​/g, ""); // zero-width space
    // Take only the first line (everything before the first \n)
    const firstLine = text.split("\n")[0].replace(/\s+/g, " ").trim();
    const m = firstLine.match(/^Award:\s*(.+)$/);
    if (!m) return;
    const line = m[1].trim().replace(/\s*Degree$/i, "");
    const index = $("*").index(el);
    items.push({ kind: "award", line, index });
  });

  $(TABLE_SELECTOR).each((_, el) => {
    const index = $("*").index(el);
    items.push({ kind: "table", el, index });
  });

  items.sort((a, b) => a.index - b.index);

  // Pair: every table consumes the most recent award seen so far. Once an
  // award is consumed, additional tables before the next award are sub-tables
  // (elective lists, sample schedules per specialization, etc.) — skip them.
  let lastAward = "";
  for (const item of items) {
    if (item.kind === "award") {
      lastAward = item.line;
      continue;
    }
    if (!lastAward) continue;
    const $table = $(item.el);
    const { courses, totalCredits } = parsePlanGrid($, $table);
    if (courses.length === 0) continue;

    const credential = parseCredential(lastAward);
    const suffix = ` — ${lastAward}`;
    const fullTitle = `${programTitle}${suffix}`;

    programs.push({
      title: fullTitle,
      credential,
      program_code: null,
      catalog_url: catalogUrl,
      total_credits: totalCredits,
      gpa_minimum: 2.0,
      description: null,
      requirement_groups: [
        {
          name: "Recommended Course Sequence",
          credits_required: totalCredits,
          choose_n: null,
          courses,
        },
      ],
      matched_program_slug: null,
    });
    // After consuming an award for this table, clear it so a sibling table
    // without its own award doesn't re-use the same credential incorrectly.
    lastAward = "";
  }

  // Fall back when the page doesn't use <strong>Award:</strong> markers
  // (some CourseLeaf catalogs — e.g. Mount Wachusett — describe the credential
  // in prose like "earn an Associate of Science Degree in Biology"). Scan the
  // page for the first credential phrase and use that with the first table.
  if (programs.length === 0) {
    const $tables = $(TABLE_SELECTOR);
    if ($tables.length === 0) return programs;

    const pageText = $("main, article, body")
      .first()
      .text()
      .replace(/​/g, "")
      .replace(/\s+/g, " ");
    // Find every credential phrase on the page, then pick the most specific.
    // The page often mentions "Career Studies Certificate" or generic
    // "Certificate" in nav/footer text BEFORE the program-specific
    // "Associate of Science Degree in X" prose, so taking the first match
    // by position misclassifies. Scan all matches and prefer the most-
    // specific credential.
    const credPatterns: { re: RegExp; rank: number }[] = [
      {
        re: /Associate of (?:Applied Science|Arts|Science)\s+Degree/gi,
        rank: 4,
      },
      // California catalogs use "Associate in" instead of "Associate of"
      { re: /Associate in (?:Applied Science|Arts|Science)(?:\s+for Transfer)?/gi, rank: 4 },
      { re: /Associate of (?:Applied Science|Arts|Science)/gi, rank: 3 },
      // CA "AS-T", "AA-T" transfer degrees and "A.A./A.S." shorthand
      { re: /Associate Degree for Transfer/gi, rank: 3 },
      { re: /A\.?[AS]\.?(?:-T)?\s+Degree/gi, rank: 3 },
      // CA "Certificate of Achievement" / "Certificate of Specialization" / etc.
      { re: /Certificate of (?:Achievement|Specialization|Competency|Career Skills|Performance)/gi, rank: 2 },
      { re: /Career Studies Certificate/gi, rank: 2 },
      { re: /Certificate of Completion/gi, rank: 2 },
      { re: /Diploma/gi, rank: 1 },
      { re: /Certificate/gi, rank: 0 },
    ];
    let proseAward = "";
    let proseRank = -1;
    for (const { re, rank } of credPatterns) {
      const m = pageText.match(re);
      if (m && rank > proseRank) {
        proseAward = m[0];
        proseRank = rank;
      }
    }
    let credential = parseCredential(proseAward);
    let suffix = proseAward ? ` — ${proseAward.replace(/\s*Degree$/i, "")}` : "";

    const $first = $tables.first();
    const { courses, totalCredits } = parsePlanGrid($, $first);

    // Credit-hour sanity override. Pages that don't have an explicit
    // "X Certificate" heading but DO mention "Certificate" elsewhere
    // (breadcrumbs / nav / footnotes) get misclassified as certificate.
    // Programs with 50+ credits are virtually never certificates at MA/VA
    // community colleges — bump up to AS when the prose-detected award is
    // certificate or undetermined.
    if (
      totalCredits !== null &&
      totalCredits >= 50 &&
      (credential === "certificate" || credential === "other")
    ) {
      credential = "AS";
      suffix = " — Associate of Science";
    }

    if (courses.length > 0) {
      programs.push({
        title: `${programTitle}${suffix}`,
        credential,
        program_code: null,
        catalog_url: catalogUrl,
        total_credits: totalCredits,
        gpa_minimum: 2.0,
        description: null,
        requirement_groups: [
          {
            name: "Recommended Course Sequence",
            credits_required: totalCredits,
            choose_n: null,
            courses,
          },
        ],
        matched_program_slug: null,
      });
    }
  }

  return programs;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function scrapeCourseleafPrograms(
  config: CourseleafProgramConfig,
): Promise<CollegePrograms> {
  const { collegeSlug, baseUrl } = config;
  const programIndexPath = config.programIndexPath ?? "/programs-study/";

  const indexUrl = `${baseUrl}${programIndexPath}`;
  console.log(`  [${collegeSlug}] Discovering programs at ${indexUrl}`);
  const indexHtml = await retryFetch(indexUrl, "program-index");
  let paths: string[];
  if (config.programPathPattern) {
    const re = new RegExp(config.programPathPattern);
    paths = Array.from(
      new Set(
        [...indexHtml.matchAll(/href="(\/[^"]*)"/g)]
          .map((m) => m[1].split("#")[0])
          .filter((h) => re.test(h)),
      ),
    ).sort();
  } else {
    paths = discoverProgramPaths(indexHtml, programIndexPath);
  }

  if ((config.indexDepth ?? 1) === 2) {
    // The index links area pages; walk each one to find the program pages.
    console.log(
      `  [${collegeSlug}] ${paths.length} area pages — walking depth 2...`,
    );
    const subPaths = new Set<string>();
    await pmap(paths, CONCURRENCY, async (areaPath) => {
      const areaHtml = await retryFetch(
        `${baseUrl}${areaPath}`,
        `area(${areaPath})`,
      );
      if (!areaHtml) return;
      for (const p of discoverProgramPaths(areaHtml, areaPath)) {
        subPaths.add(p);
      }
    });
    paths = Array.from(subPaths).sort();
  }
  console.log(`  [${collegeSlug}] Found ${paths.length} program paths`);

  if (paths.length === 0) {
    return {
      college_slug: collegeSlug,
      catalog_year: "",
      catalog_url: indexUrl,
      scraped_at: new Date().toISOString(),
      programs: [],
    };
  }

  console.log(`  [${collegeSlug}] Fetching program detail pages...`);
  const all: ProgramRequirement[] = [];
  let parsed = 0;
  let skipped = 0;

  await pmap(paths, CONCURRENCY, async (programPath) => {
    const url = `${baseUrl}${programPath}`;
    const html = await retryFetch(url, `program(${programPath})`);
    if (!html) {
      skipped++;
      return;
    }
    const programs = parseProgramPage(html, baseUrl, programPath);
    if (programs.length === 0) {
      skipped++;
      return;
    }
    all.push(...programs);
    parsed += programs.length;
  });

  console.log(
    `  [${collegeSlug}] Parsed ${parsed} program awards across ${paths.length} pages, skipped ${skipped}`,
  );

  return {
    college_slug: collegeSlug,
    catalog_year: "",
    catalog_url: indexUrl,
    scraped_at: new Date().toISOString(),
    programs: all,
  };
}
