/**
 * scrape-nimble-cms-programs.ts — shared Nimble CMS catalog program scraper.
 *
 * Nimble CMS (cms.nimble.education) is a hosted catalog/CMS platform used
 * by several Georgia TCSG colleges (Albany Tech, South GA Tech, Southeastern
 * Tech, Southern Regional Tech) and a smattering of community colleges in
 * other states. The catalog lives at `{baseUrl}/college-catalog/current/`
 * with an index of programs at `/programs` (a flat table).
 *
 * Programs index structure (static HTML, no JS required):
 *   <table class="table table-hover table-programs">
 *     <tr class="program-row" id="3669">
 *       <td><a href="/college-catalog/current/programs/accounting-associate">Accounting Associate</a></td>
 *       ...
 *
 * Some Nimble installs (South GA Tech) hide the flat /programs index behind
 * a "departments → programs" hierarchy and only expose the type-filtered
 * endpoints. We support both: pass `indexPaths` to override the default
 * ["/college-catalog/current/programs"] with the type-filtered variants
 * ["/college-catalog/current/programs/type/degree",
 *  "/college-catalog/current/programs/type/diploma",
 *  "/college-catalog/current/programs/type/certificate"].
 *
 * Program detail page structure:
 *   <h1>{Program Name} <span class="program-code">(AC13)&nbsp;</span>
 *       <span class="small">Degree</span></h1>
 *   <div class="program-summary"><p>Program Description:</p>...</div>
 *   <div class="curriculum-heading">Curriculum Outline (64 hours)</div>
 *   <table class="curriculum-table">
 *     <tr class="area">
 *       <th class="area-heading">General Education Core</th>
 *       <th class="area-credits"><span class="credits">15</span></th>
 *     </tr>
 *     <tr class="area-requirement">
 *       <td><strong>Area I - Language Arts/Communications</strong></td>
 *       <td class="course-credits"><strong>3</strong></td>
 *     </tr>
 *     <tr class="area-course">
 *       <td class="indent">
 *         <span class="course-code">ENGL 1101</span>
 *         <a class="course-name">Composition and Rhetoric</a>
 *       </td>
 *       <td class="course-credits">3</td>
 *     </tr>
 *     ...
 *
 * Each `<tr class="area">` opens a RequirementGroup. Subsequent
 * `<tr class="area-course">` rows belong to that group. `<tr class="area-requirement">`
 * rows are sub-group labels (Area I, II, etc.) — we ignore them for grouping
 * since the parent `area` row already names the group.
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

export interface NimbleCmsProgramConfig {
  collegeSlug: string;
  /** Catalog host, e.g. https://www.albanytech.edu (no trailing slash). */
  baseUrl: string;
  /**
   * Program index paths. Default ["/college-catalog/current/programs"].
   * Some Nimble installs need type-filtered indexes instead.
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

/**
 * Walk every program index URL and collect the per-program detail-page
 * hrefs. Program rows are uniformly `<tr class="program-row">` with one
 * anchor each. We also accept flat `a[href*="/programs/"]` if a college
 * uses a different list element (defensive).
 */
async function discoverProgramPaths(
  baseUrl: string,
  indexPath: string,
): Promise<string[]> {
  const html = await retryFetch(`${baseUrl}${indexPath}`, "programs-index");
  const $ = cheerio.load(html);
  const found = new Set<string>();

  // Primary signal: tr.program-row > td > a
  $("tr.program-row a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    const clean = href.split("#")[0].split("?")[0];
    if (clean.includes("/college-catalog/") && /\/programs\/[^/]+$/.test(clean)) {
      found.add(clean);
    }
  });

  // Fallback: any anchor pointing into /programs/{slug}
  if (found.size === 0) {
    $("a[href]").each((_, a) => {
      const href = $(a).attr("href");
      if (!href) return;
      const clean = href.split("#")[0].split("?")[0];
      if (clean.includes("/college-catalog/") && /\/programs\/[^/]+$/.test(clean)) {
        // Exclude the type-filter indexes themselves
        if (/\/programs\/type\//.test(clean)) return;
        found.add(clean);
      }
    });
  }

  return [...found].sort();
}

// ---------------------------------------------------------------------------
// Per-program parsing
// ---------------------------------------------------------------------------

function credentialFromText(text: string): ProgramCredential {
  const t = text.toLowerCase();
  if (t.includes("applied science") || t.includes("a.a.s") || /\baas\b/.test(t))
    return "AAS";
  if (t.includes("associate of arts") || t.includes("associate in arts"))
    return "AA";
  if (t.includes("associate of science") || t.includes("associate in science"))
    return "AS";
  if (t.includes("degree") || /\baa\b/.test(t)) {
    // Nimble's "Degree" badge with no other qualifier — TCSG uses this for
    // associate-of-applied-science programs almost exclusively, but call it
    // "other" rather than guess.
    return "other";
  }
  if (t.includes("diploma")) return "diploma";
  if (
    t.includes("certificate") ||
    t.includes("tcc") ||
    t.includes("technical certificate of credit")
  )
    return "certificate";
  return "other";
}

function parseCredits(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const range = t.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*\d+(?:\.\d+)?$/);
  if (range) return Number(range[1]);
  const num = t.match(/(\d+(?:\.\d+)?)/);
  if (num) return Number(num[1]);
  return null;
}

/** Nimble course codes: "ENGL 1101" or "ENGL1101". Some are "XXXX xxxx" placeholders. */
function splitCourseCode(
  code: string,
): { prefix: string; number: string } | null {
  const clean = code.replace(/\s+/g, "").toUpperCase();
  // Reject placeholder codes like "XXXXXXXX"
  if (/^X+$/.test(clean)) return null;
  const m = clean.match(/^([A-Z]{2,5})(\d{3,4}[A-Z]?)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

function parseProgramPage(
  html: string,
  pageUrl: string,
): ProgramRequirement | null {
  const $ = cheerio.load(html);

  // Title: <h1>{Program Name} <span class="program-code">(AC13)&nbsp;</span> <span class="small">Degree</span></h1>
  const $h1 = $("h1").first();
  if ($h1.length === 0) return null;

  // Capture program-code and credential-badge text BEFORE we strip them.
  const codeText = $h1.find(".program-code").first().text().trim();
  const credentialText = $h1.find(".small").first().text().trim();

  // Strip child spans to get the program name on its own.
  const $h1Clone = $h1.clone();
  $h1Clone.find(".program-code, .small, .badge").remove();
  const title = $h1Clone.text().replace(/\s+/g, " ").trim();
  if (!title) return null;

  const programCode = codeText.replace(/[()&nbsp;\s]/g, "") || null;
  const credential = credentialFromText(credentialText || title);

  // Description: first <p> inside .program-summary
  const description =
    $(".program-summary p")
      .filter((_, el) => {
        const t = $(el).text().trim();
        return t.length > 0 && !/^program description:?$/i.test(t);
      })
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim() || null;

  // Total credits: parse "Curriculum Outline (64 hours)" header
  let totalCredits: number | null = null;
  $(".curriculum-heading").each((_, el) => {
    if (totalCredits !== null) return;
    const t = $(el).text();
    const m = t.match(/\((\d+(?:\.\d+)?)\s*(?:hours?|credits?|cr)\)/i);
    if (m) totalCredits = Number(m[1]);
  });

  // Requirement groups: iterate every tr.area as a group opener, then collect
  // following tr.area-course rows until the next tr.area or end of table.
  const groups: RequirementGroup[] = [];

  $("table.curriculum-table").each((_, table) => {
    const $table = $(table);
    let current: RequirementGroup | null = null;

    $table.find("tr").each((_, tr) => {
      const $tr = $(tr);
      const cls = $tr.attr("class") || "";

      if (cls.includes("area") && !cls.includes("area-course") && !cls.includes("area-requirement")) {
        // Open a new group
        if (current && current.courses.length > 0) groups.push(current);
        const name = $tr
          .find(".area-heading, th")
          .first()
          .text()
          .replace(/\s+/g, " ")
          .trim();
        const credText = $tr.find(".area-credits .credits, .area-credits").first().text();
        current = {
          name: name || "Required Courses",
          credits_required: parseCredits(credText),
          choose_n: null,
          courses: [],
        };
      } else if (cls.includes("area-course") && current) {
        const codeRaw = $tr.find(".course-code").first().text().trim();
        const split = splitCourseCode(codeRaw);
        if (!split) return;
        const titleText = $tr
          .find(".course-name")
          .first()
          .text()
          .replace(/\s+/g, " ")
          .trim();
        const creditsText = $tr.find(".course-credits").first().text().trim();
        current.courses.push({
          prefix: split.prefix,
          number: split.number,
          title: titleText,
          credits: parseCredits(creditsText),
          or_alternatives: [],
        });
      }
    });

    if (current && current.courses.length > 0) groups.push(current);
  });

  if (groups.length === 0) return null;

  // Fallback total: sum course credits if no curriculum-heading total found.
  if (totalCredits === null) {
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
    if (any) totalCredits = sum;
  }

  return {
    title,
    credential,
    program_code: programCode,
    catalog_url: pageUrl,
    total_credits: totalCredits,
    gpa_minimum: 2.0,
    description,
    requirement_groups: groups,
    matched_program_slug: null,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function scrapeNimbleCmsPrograms(
  config: NimbleCmsProgramConfig,
): Promise<CollegePrograms> {
  const { collegeSlug, baseUrl, catalogYear } = config;
  const indexPaths = config.indexPaths ?? ["/college-catalog/current/programs"];

  const allPaths = new Set<string>();
  for (const indexPath of indexPaths) {
    console.log(`  [${collegeSlug}] Discovering programs at ${baseUrl}${indexPath}`);
    try {
      const paths = await discoverProgramPaths(baseUrl, indexPath);
      console.log(`  [${collegeSlug}]   Found ${paths.length} candidates`);
      for (const p of paths) allPaths.add(p);
    } catch (e) {
      console.warn(`  [${collegeSlug}]   Index walk failed: ${e}`);
    }
  }
  const paths = [...allPaths].sort();
  console.log(`  [${collegeSlug}] Total ${paths.length} unique program detail pages`);

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
  console.log(`  [${collegeSlug}] Parsed ${parsed} programs, skipped ${skipped}`);

  return {
    college_slug: collegeSlug,
    catalog_year: catalogYear,
    catalog_url: `${baseUrl}${indexPaths[0]}`,
    scraped_at: new Date().toISOString(),
    programs,
  };
}
